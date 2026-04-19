//! MRT processor — RenTech-style *signal factory* pass over DS `futures.db` OHLCV.
//! Reads bars_5m (configurable), builds weak micro-signals, ranks by IS t-stat vs 1-bar forward return,
//! writes a research snapshot JSON for the API layer.

use std::env;
use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use rayon::prelude::*;
use rusqlite::Connection;
use serde::Serialize;

const DEFAULT_TABLE: &str = "bars_5m";
const MAX_BARS: usize = 6_000;
const MIN_BARS: usize = 200;
const WARMUP: usize = 28;
const IS_FRAC: f64 = 0.75;

#[derive(Clone, Debug)]
struct Bar {
    ts: i64,
    close: f64,
}

#[derive(Serialize)]
struct SignalStats {
    id: &'static str,
    is_t: f64,
    oos_t: f64,
    is_r: f64,
    oos_r: f64,
    n_is: usize,
    n_oos: usize,
}

#[derive(Serialize)]
struct SymbolOut {
    symbol: String,
    bars: usize,
    last_ts: i64,
    last_close: f64,
    realized_vol_20: f64,
    signals: Vec<SignalStats>,
    composite: f64,
}

#[derive(Serialize)]
struct RegimeOut {
    /// 0 = low realized-vol branch, 1 = mid, 2 = high (cross-sectional tertiles at last bar).
    state: u8,
    label: &'static str,
    cross_section_vol_median: f64,
}

#[derive(Serialize)]
struct Snapshot {
    version: u32,
    generated_at_unix: i64,
    table: String,
    universe: usize,
    is_frac: f64,
    regime: RegimeOut,
    symbols: Vec<SymbolOut>,
}

#[derive(Serialize)]
struct DiscoveryCandidateOut {
    id: String,
    is_t: f64,
    oos_t: f64,
    is_r: f64,
    oos_r: f64,
    p_value: f64,
    q_value: f64,
    pass_fdr: bool,
}

#[derive(Serialize)]
struct DiscoverySymbolOut {
    symbol: String,
    bars: usize,
    total_tested: usize,
    passed_fdr: usize,
    winners: Vec<DiscoveryCandidateOut>,
}

#[derive(Serialize)]
struct DiscoveryOut {
    version: u32,
    generated_at_unix: i64,
    table: String,
    is_frac: f64,
    fdr_alpha: f64,
    symbols: Vec<DiscoverySymbolOut>,
}

fn db_path() -> PathBuf {
    PathBuf::from(
        env::var("MRT_FUTURES_DB")
            .unwrap_or_else(|_| "../ds/data/futures.db".to_string()),
    )
}

fn out_json_path() -> PathBuf {
    let dir = env::var("MRT_DATA_DIR").unwrap_or_else(|_| "data".to_string());
    PathBuf::from(dir).join("mrt_snapshot.json")
}

fn out_discovery_path() -> PathBuf {
    let dir = env::var("MRT_DATA_DIR").unwrap_or_else(|_| "data".to_string());
    PathBuf::from(dir).join("mrt_discovery.json")
}

fn open_db(path: &PathBuf) -> Result<Connection, rusqlite::Error> {
    Connection::open(path)
}

fn list_symbols(conn: &Connection, table: &str) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT DISTINCT symbol FROM {table} ORDER BY symbol"
    ))?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

fn load_bars(conn: &Connection, table: &str, sym: &str) -> Result<Vec<Bar>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT ts, close FROM {table} WHERE symbol=?1 ORDER BY ts DESC LIMIT ?2"
    ))?;
    let rows = stmt.query_map(rusqlite::params![sym, MAX_BARS as i64], |r| {
        Ok(Bar {
            ts: r.get(0)?,
            close: r.get(1)?,
        })
    })?;
    let mut v: Vec<Bar> = rows.filter_map(|x| x.ok()).collect();
    v.reverse();
    Ok(v)
}

fn log_ret(c0: f64, c1: f64) -> f64 {
    if c0 <= 0.0 || c1 <= 0.0 {
        return f64::NAN;
    }
    (c1 / c0).ln()
}

fn mean_slice(s: &[f64]) -> f64 {
    if s.is_empty() {
        return f64::NAN;
    }
    s.iter().sum::<f64>() / s.len() as f64
}

fn rolling_min_max(closes: &[f64], i: usize, win: usize) -> Option<(f64, f64)> {
    if i + 1 < win {
        return None;
    }
    let start = i + 1 - win;
    let window = &closes[start..=i];
    let mn = window.iter().copied().fold(f64::INFINITY, f64::min);
    let mx = window.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    Some((mn, mx))
}

fn build_series(bars: &[Bar]) -> Option<(Vec<f64>, Vec<f64>, Vec<f64>)> {
    if bars.len() < MIN_BARS {
        return None;
    }
    let n = bars.len();
    let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();
    let mut r = vec![f64::NAN; n];
    for i in 1..n {
        r[i] = log_ret(closes[i - 1], closes[i]);
    }
    let mut fwd = vec![f64::NAN; n];
    for i in 0..n - 1 {
        fwd[i] = r[i + 1];
    }
    Some((closes, r, fwd))
}

fn signal_rev(r: &[f64], i: usize) -> f64 {
    if i < 2 {
        return f64::NAN;
    }
    -r[i - 1]
}

fn signal_mom(r: &[f64], i: usize) -> f64 {
    if i < 20 {
        return f64::NAN;
    }
    let short = mean_slice(&r[i - 4..=i]);
    let long = mean_slice(&r[i - 19..=i]);
    short - long
}

fn signal_range(closes: &[f64], i: usize) -> f64 {
    let Some((mn, mx)) = rolling_min_max(closes, i, 20) else {
        return f64::NAN;
    };
    let den = mx - mn;
    if den.abs() < 1e-12 {
        return 0.0;
    }
    (closes[i] - mn) / den - 0.5
}

fn signal_trend_part(r: &[f64], i: usize) -> f64 {
    if i < 12 {
        return f64::NAN;
    }
    let mut s = 0.0;
    for k in (i - 11)..=i {
        let x = r[k];
        if x.is_nan() {
            return f64::NAN;
        }
        s += x.signum();
    }
    s / 12.0
}

fn pearson(xs: &[f64], ys: &[f64]) -> (f64, usize) {
    let pairs: Vec<(f64, f64)> = xs
        .iter()
        .zip(ys.iter())
        .filter_map(|(a, b)| {
            if a.is_finite() && b.is_finite() {
                Some((*a, *b))
            } else {
                None
            }
        })
        .collect();
    let n = pairs.len();
    if n < 10 {
        return (f64::NAN, n);
    }
    let mx = pairs.iter().map(|p| p.0).sum::<f64>() / n as f64;
    let my = pairs.iter().map(|p| p.1).sum::<f64>() / n as f64;
    let mut sxx = 0.0;
    let mut syy = 0.0;
    let mut sxy = 0.0;
    for (x, y) in &pairs {
        let dx = x - mx;
        let dy = y - my;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }
    let den = (sxx * syy).sqrt();
    if den < 1e-18 {
        return (f64::NAN, n);
    }
    (sxy / den, n)
}

fn t_from_r(r: f64, n: usize) -> f64 {
    if n < 3 || !r.is_finite() {
        return f64::NAN;
    }
    let r = r.clamp(-0.999999, 0.999999);
    r * ((n as f64 - 2.0) / (1.0 - r * r).max(1e-12)).sqrt()
}

fn norm_cdf(x: f64) -> f64 {
    // Abramowitz-Stegun style approximation.
    let t = 1.0 / (1.0 + 0.2316419 * x.abs());
    let d = 0.3989423 * (-x * x / 2.0).exp();
    let p = 1.0
        - d * ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t
            + 0.319381530)
            * t;
    if x >= 0.0 { p } else { 1.0 - p }
}

fn p_two_sided_from_t(t: f64) -> f64 {
    if !t.is_finite() {
        return 1.0;
    }
    let z = t.abs();
    (2.0 * (1.0 - norm_cdf(z))).clamp(0.0, 1.0)
}

fn bh_qvalues(pvals: &[f64]) -> Vec<f64> {
    let m = pvals.len();
    if m == 0 {
        return Vec::new();
    }
    let mut idx_p: Vec<(usize, f64)> = pvals.iter().copied().enumerate().collect();
    idx_p.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    let mut q_sorted = vec![1.0; m];
    let mut prev = 1.0;
    for k in (0..m).rev() {
        let rank = (k + 1) as f64;
        let raw = (idx_p[k].1 * m as f64 / rank).min(1.0);
        let q = raw.min(prev);
        q_sorted[k] = q;
        prev = q;
    }
    let mut q = vec![1.0; m];
    for (k, (orig, _)) in idx_p.iter().enumerate() {
        q[*orig] = q_sorted[k];
    }
    q
}

fn eval_signal(
    sig: &[f64],
    fwd: &[f64],
    start: usize,
    end: usize,
) -> (f64, f64, usize) {
    let xs: Vec<f64> = sig[start..end].to_vec();
    let ys: Vec<f64> = fwd[start..end].to_vec();
    let (corr, n) = pearson(&xs, &ys);
    (corr, t_from_r(corr, n), n)
}

fn process_one(sym: String, conn: &Connection, table: &str) -> Option<SymbolOut> {
    let bars = load_bars(conn, table, &sym).ok()?;
    let last_ts = bars.last()?.ts;
    let last_close = bars.last()?.close;
    let (closes, r, fwd) = build_series(&bars)?;

    let n = bars.len();
    let mut split = ((n as f64) * IS_FRAC).floor() as usize;
    split = split.clamp(WARMUP + 40, n.saturating_sub(24));

    let mut sig_rev = vec![f64::NAN; n];
    let mut sig_mom = vec![f64::NAN; n];
    let mut sig_range = vec![f64::NAN; n];
    let mut sig_trend = vec![f64::NAN; n];

    for i in 0..n {
        sig_rev[i] = signal_rev(&r, i);
        sig_mom[i] = signal_mom(&r, i);
        sig_range[i] = signal_range(&closes, i);
        sig_trend[i] = signal_trend_part(&r, i);
    }

    let specs: [(&str, &[f64]); 4] = [
        ("REV_1", &sig_rev),
        ("MOM_5v20", &sig_mom),
        ("RANGE20", &sig_range),
        ("TREND12", &sig_trend),
    ];

    let start_ix = WARMUP;
    let mut stats = Vec::new();
    let mut weights: Vec<f64> = Vec::new();
    let mut last_feats: Vec<f64> = Vec::new();

    for (id, s) in specs {
        let (is_r, is_t, n_is) = eval_signal(s, &fwd, start_ix, split);
        let (oos_r, oos_t, n_oos) = eval_signal(s, &fwd, split, n.saturating_sub(1));
        stats.push(SignalStats {
            id,
            is_t,
            oos_t,
            is_r,
            oos_r,
            n_is,
            n_oos,
        });
        let w = if is_t.is_finite() {
            (is_t / 3.0).clamp(-1.0, 1.0)
        } else {
            0.0
        };
        weights.push(w);
        last_feats.push(*s.last().unwrap_or(&f64::NAN));
    }

    let composite: f64 = last_feats
        .iter()
        .zip(weights.iter())
        .filter_map(|(f, w)| {
            if f.is_finite() && w.is_finite() {
                Some(f * w)
            } else {
                None
            }
        })
        .sum();

    let win20 = closes.len().saturating_sub(20);
    let rv = if win20 < closes.len() {
        let chunk = &r[win20..];
        let m = mean_slice(chunk);
        let v: f64 = chunk.iter().filter(|x| x.is_finite()).map(|x| (x - m).powi(2)).sum::<f64>()
            / chunk.iter().filter(|x| x.is_finite()).count().max(1) as f64;
        v.sqrt()
    } else {
        f64::NAN
    };

    Some(SymbolOut {
        symbol: sym,
        bars: n,
        last_ts,
        last_close,
        realized_vol_20: rv,
        signals: stats,
        composite,
    })
}

fn regime_label(state: u8) -> &'static str {
    match state {
        0 => "low_vol",
        1 => "mid_vol",
        _ => "high_vol",
    }
}

fn candidate_family(closes: &[f64], r: &[f64]) -> Vec<(String, Vec<f64>)> {
    let n = closes.len();
    let mut out: Vec<(String, Vec<f64>)> = Vec::new();

    for lag in 1..=5usize {
        let mut s = vec![f64::NAN; n];
        for i in lag..n {
            s[i] = r[i - lag];
        }
        out.push((format!("RET_L{lag}"), s));
    }
    for w in [3usize, 5, 10, 20] {
        let mut s = vec![f64::NAN; n];
        for i in (w - 1)..n {
            s[i] = mean_slice(&r[i + 1 - w..=i]);
        }
        out.push((format!("RET_MA{w}"), s));
    }
    for w in [10usize, 20] {
        let mut s = vec![f64::NAN; n];
        for i in (w - 1)..n {
            let x = &r[i + 1 - w..=i];
            let m = mean_slice(x);
            let v = x
                .iter()
                .filter(|z| z.is_finite())
                .map(|z| (z - m).powi(2))
                .sum::<f64>()
                / x.iter().filter(|z| z.is_finite()).count().max(1) as f64;
            s[i] = v.sqrt();
        }
        out.push((format!("VOL{w}"), s));
    }
    for w in [20usize, 50] {
        let mut s = vec![f64::NAN; n];
        for i in (w - 1)..n {
            let x = &closes[i + 1 - w..=i];
            let m = mean_slice(x);
            let v = x.iter().map(|z| (z - m).powi(2)).sum::<f64>() / x.len() as f64;
            let sd = v.sqrt();
            if sd > 1e-12 {
                s[i] = (closes[i] - m) / sd;
            }
        }
        out.push((format!("PRICE_Z{w}"), s));
    }

    let mut transformed = Vec::new();
    for (id, base) in out {
        let mut sign = vec![f64::NAN; n];
        let mut sqsgn = vec![f64::NAN; n];
        for i in 0..n {
            let x = base[i];
            if x.is_finite() {
                sign[i] = x.signum();
                sqsgn[i] = x.signum() * x * x;
            }
        }
        transformed.push((id.clone(), base));
        transformed.push((format!("{id}_SGN"), sign));
        transformed.push((format!("{id}_SQSGN"), sqsgn));
    }
    transformed
}

fn discover_one(sym: String, conn: &Connection, table: &str, fdr_alpha: f64) -> Option<DiscoverySymbolOut> {
    let bars = load_bars(conn, table, &sym).ok()?;
    let (closes, r, fwd) = build_series(&bars)?;
    let n = bars.len();
    let mut split = ((n as f64) * IS_FRAC).floor() as usize;
    split = split.clamp(WARMUP + 40, n.saturating_sub(24));
    let start_ix = WARMUP;

    let candidates = candidate_family(&closes, &r);
    let mut rows: Vec<(String, f64, f64, f64, f64, usize, usize)> = Vec::new();
    let mut pvals: Vec<f64> = Vec::new();
    for (id, s) in candidates {
        let (is_r, is_t, n_is) = eval_signal(&s, &fwd, start_ix, split);
        let (oos_r, oos_t, n_oos) = eval_signal(&s, &fwd, split, n.saturating_sub(1));
        if n_is < 50 || n_oos < 30 || !is_t.is_finite() {
            continue;
        }
        let p = p_two_sided_from_t(is_t);
        rows.push((id, is_t, oos_t, is_r, oos_r, n_is, n_oos));
        pvals.push(p);
    }
    let qvals = bh_qvalues(&pvals);
    let mut out: Vec<DiscoveryCandidateOut> = rows
        .into_iter()
        .enumerate()
        .map(|(i, (id, is_t, oos_t, is_r, oos_r, _, _))| DiscoveryCandidateOut {
            id,
            is_t,
            oos_t,
            is_r,
            oos_r,
            p_value: pvals[i],
            q_value: qvals.get(i).copied().unwrap_or(1.0),
            pass_fdr: qvals.get(i).copied().unwrap_or(1.0) <= fdr_alpha,
        })
        .filter(|x| x.pass_fdr && x.oos_t.signum() == x.is_t.signum())
        .collect();
    out.sort_by(|a, b| b.is_t.abs().partial_cmp(&a.is_t.abs()).unwrap_or(std::cmp::Ordering::Equal));
    let passed = out.len();
    out.truncate(20);

    Some(DiscoverySymbolOut {
        symbol: sym,
        bars: n,
        total_tested: pvals.len(),
        passed_fdr: passed,
        winners: out,
    })
}

fn run_discovery(table: &str, path: &PathBuf, conn: Connection, symbols: Vec<String>) {
    let alpha = env::var("MRT_FDR_ALPHA")
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.05)
        .clamp(0.001, 0.2);
    let path_s = path.to_string_lossy().to_string();
    let outs: Vec<Option<DiscoverySymbolOut>> = symbols
        .par_iter()
        .map(|sym| {
            Connection::open(path_s.as_str())
                .ok()
                .and_then(|c| discover_one(sym.clone(), &c, table, alpha))
        })
        .collect();
    drop(conn);
    let mut rows: Vec<DiscoverySymbolOut> = outs.into_iter().flatten().collect();
    rows.sort_by(|a, b| b.passed_fdr.cmp(&a.passed_fdr));
    let out = DiscoveryOut {
        version: 1,
        generated_at_unix: Utc::now().timestamp(),
        table: table.to_string(),
        is_frac: IS_FRAC,
        fdr_alpha: alpha,
        symbols: rows,
    };
    let json_path = out_discovery_path();
    if let Some(parent) = json_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let j = serde_json::to_string_pretty(&out).expect("serialize");
    fs::write(&json_path, j).unwrap_or_else(|e| {
        eprintln!("MRT: write {}: {e}", json_path.display());
        std::process::exit(1);
    });
    println!(
        "MRT: discovery wrote {} symbols → {}",
        out.symbols.len(),
        json_path.display()
    );
}

fn run_snapshot(table: &str, path: &PathBuf, conn: Connection, symbols: Vec<String>) {
    let path_s = path.to_string_lossy().to_string();
    let outs: Vec<Option<SymbolOut>> = symbols
        .par_iter()
        .map(|sym| {
            Connection::open(path_s.as_str())
                .ok()
                .and_then(|c| process_one(sym.clone(), &c, &table))
        })
        .collect();

    drop(conn);

    let mut symbols_out: Vec<SymbolOut> = outs.into_iter().flatten().collect();
    symbols_out.sort_by(|a, b| b.composite.abs().partial_cmp(&a.composite.abs()).unwrap());

    let mut vols: Vec<f64> = symbols_out
        .iter()
        .filter_map(|s| {
            if s.realized_vol_20.is_finite() {
                Some(s.realized_vol_20)
            } else {
                None
            }
        })
        .collect();
    vols.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let n_v = vols.len();
    let (state, med) = if n_v < 3 {
        (1u8, vols.first().copied().unwrap_or(f64::NAN))
    } else {
        let med = vols[n_v / 2];
        let lo = vols[n_v / 3];
        let hi = vols[(2 * n_v) / 3];
        let mean_vol: f64 = vols.iter().sum::<f64>() / n_v as f64;
        let st = if mean_vol <= lo {
            0u8
        } else if mean_vol >= hi {
            2u8
        } else {
            1u8
        };
        (st, med)
    };

    let regime = RegimeOut {
        state,
        label: regime_label(state),
        cross_section_vol_median: med,
    };

    let snap = Snapshot {
        version: 1,
        generated_at_unix: Utc::now().timestamp(),
        table: table.to_string(),
        universe: symbols_out.len(),
        is_frac: IS_FRAC,
        regime,
        symbols: symbols_out,
    };

    let json_path = out_json_path();
    if let Some(parent) = json_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let j = serde_json::to_string_pretty(&snap).expect("serialize");
    fs::write(&json_path, j).unwrap_or_else(|e| {
        eprintln!("MRT: write {}: {e}", json_path.display());
        std::process::exit(1);
    });

    println!(
        "MRT: wrote {} symbols → {}",
        snap.universe,
        json_path.display()
    );
}

fn main() {
    let table = env::var("MRT_BARS_TABLE").unwrap_or_else(|_| DEFAULT_TABLE.to_string());
    let path = db_path();
    if !path.exists() {
        eprintln!("MRT: futures db missing at {} — set MRT_FUTURES_DB", path.display());
        std::process::exit(1);
    }
    let conn = match open_db(&path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("MRT: sqlite open: {e}");
            std::process::exit(1);
        }
    };
    let symbols = match list_symbols(&conn, &table) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("MRT: list symbols: {e}");
            std::process::exit(1);
        }
    };

    let mode = env::args().nth(1).unwrap_or_else(|| "snapshot".to_string());
    if mode.eq_ignore_ascii_case("discover") {
        run_discovery(&table, &path, conn, symbols);
    } else {
        run_snapshot(&table, &path, conn, symbols);
    }
}
