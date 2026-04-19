//! Research replay: OHLCV + ensemble equity + trade markers using snapshot IS t-stat weights.

use std::path::Path;

use rusqlite::Connection;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ReplayQuery {
    pub symbol: String,
    pub limit: Option<i64>,
}

const WARMUP: usize = 28;

struct Bar {
    ts: i64,
    o: f64,
    h: f64,
    l: f64,
    c: f64,
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

fn weight_from_t(t: f64) -> f64 {
    if !t.is_finite() {
        return 0.0;
    }
    (t / 3.0).clamp(-1.0, 1.0)
}

fn load_weights_snapshot(snapshot_path: &Path, symbol: &str) -> Result<[f64; 4], String> {
    let raw = std::fs::read_to_string(snapshot_path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let syms = v
        .get("symbols")
        .and_then(|x| x.as_array())
        .ok_or_else(|| "snapshot missing symbols".to_string())?;
    let row = syms
        .iter()
        .find(|s| {
            s.get("symbol")
                .and_then(|x| x.as_str())
                .map(|n| n.eq_ignore_ascii_case(symbol))
                .unwrap_or(false)
        })
        .ok_or_else(|| format!("symbol not in snapshot: {symbol}"))?;
    let sigs = row
        .get("signals")
        .and_then(|x| x.as_array())
        .ok_or_else(|| "symbol missing signals".to_string())?;
    if sigs.len() < 4 {
        return Err("need 4 signals".into());
    }
    let mut w = [0.0f64; 4];
    for (i, s) in sigs.iter().take(4).enumerate() {
        let t = s.get("is_t").and_then(|x| x.as_f64()).unwrap_or(0.0);
        w[i] = weight_from_t(t);
    }
    Ok(w)
}

fn load_bars(db: &Path, table: &str, sym: &str, limit: i64) -> Result<Vec<Bar>, String> {
    let conn = Connection::open(db).map_err(|e| e.to_string())?;
    let q = format!(
        "SELECT ts,open,high,low,close FROM {table} WHERE symbol=?1 ORDER BY ts DESC LIMIT ?2"
    );
    let mut stmt = conn.prepare(&q).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![sym.to_uppercase(), limit], |r| {
            Ok(Bar {
                ts: r.get(0)?,
                o: r.get(1)?,
                h: r.get(2)?,
                l: r.get(3)?,
                c: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut v: Vec<Bar> = rows.filter_map(|x| x.ok()).collect();
    v.reverse();
    Ok(v)
}

fn pos_from_composite(w: f64) -> f64 {
    if w > 1e-12 {
        1.0
    } else if w < -1e-12 {
        -1.0
    } else {
        0.0
    }
}

/// ~252 trading days × 24h × 12 five-minute bars (crypto-style annualization).
fn bars_per_year_5m() -> f64 {
    252.0 * 24.0 * 12.0
}

pub fn run(
    snapshot_path: &Path,
    futures_db: &Path,
    table: &str,
    symbol: &str,
    limit: i64,
) -> Result<serde_json::Value, String> {
    if !futures_db.exists() {
        return Err("futures.db not found".into());
    }
    let weights = load_weights_snapshot(snapshot_path, symbol)?;
    let bars = load_bars(futures_db, table, symbol, limit)?;
    if bars.len() < WARMUP + 5 {
        return Err("not enough bars".into());
    }
    let n = bars.len();
    let closes: Vec<f64> = bars.iter().map(|b| b.c).collect();
    let mut r = vec![f64::NAN; n];
    for i in 1..n {
        r[i] = log_ret(closes[i - 1], closes[i]);
    }

    let mut sig_rev_a = vec![f64::NAN; n];
    let mut sig_mom_a = vec![f64::NAN; n];
    let mut sig_range_a = vec![f64::NAN; n];
    let mut sig_trend_a = vec![f64::NAN; n];
    for i in 0..n {
        sig_rev_a[i] = signal_rev(&r, i);
        sig_mom_a[i] = signal_mom(&r, i);
        sig_range_a[i] = signal_range(&closes, i);
        sig_trend_a[i] = signal_trend_part(&r, i);
    }

    let sigs: [&[f64]; 4] = [&sig_rev_a, &sig_mom_a, &sig_range_a, &sig_trend_a];
    let mut composite = vec![0.0f64; n];
    for i in 0..n {
        let mut c = 0.0;
        for k in 0..4 {
            let v = sigs[k][i];
            if v.is_finite() {
                c += weights[k] * v;
            }
        }
        composite[i] = c;
    }

    let mut strat_r: Vec<f64> = Vec::new();
    let mut equity: Vec<f64> = vec![1.0];
    let mut pos_prev = pos_from_composite(composite[WARMUP - 1]);
    let mut trades: Vec<serde_json::Value> = Vec::new();
    let mut pos_changes = 0i64;
    let mut win_bars = 0i64;
    let mut act_bars = 0i64;

    for i in WARMUP..n - 1 {
        let pos = pos_from_composite(composite[i]);
        let bar_ret = (closes[i + 1] / closes[i] - 1.0) * pos;
        strat_r.push(bar_ret);
        let last_eq = *equity.last().unwrap();
        equity.push(last_eq * (1.0 + bar_ret));

        if pos != 0.0 {
            act_bars += 1;
            if bar_ret > 0.0 {
                win_bars += 1;
            }
        }

        if pos != pos_prev {
            pos_changes += 1;
            let side = if pos > 0.0 {
                "long"
            } else if pos < 0.0 {
                "short"
            } else {
                "flat"
            };
            trades.push(serde_json::json!({
                "time": bars[i + 1].ts,
                "bar_index": i + 1,
                "side": side,
                "price": closes[i + 1],
            }));
        }
        pos_prev = pos;
    }

    let m = strat_r.len() as f64;
    let mean = if m > 0.0 {
        strat_r.iter().sum::<f64>() / m
    } else {
        0.0
    };
    let var = if m > 0.0 {
        strat_r.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / m
    } else {
        0.0
    };
    let std = var.sqrt().max(1e-12);
    let sharpe = mean / std * bars_per_year_5m().sqrt();

    let mut peak = equity[0];
    let mut max_dd = 0.0f64;
    for &e in &equity {
        if e > peak {
            peak = e;
        }
        let dd = (peak - e) / peak;
        if dd > max_dd {
            max_dd = dd;
        }
    }

    let net_ret = equity.last().copied().unwrap_or(1.0) - 1.0;
    let hit_rate = if act_bars > 0 {
        win_bars as f64 / act_bars as f64
    } else {
        0.0
    };

    let candles: Vec<serde_json::Value> = bars
        .iter()
        .map(|b| {
            serde_json::json!({
                "time": b.ts,
                "open": b.o,
                "high": b.h,
                "low": b.l,
                "close": b.c,
            })
        })
        .collect();

    let mut eq_line: Vec<serde_json::Value> = Vec::new();
    for k in 0..equity.len() {
        let t = bars[WARMUP + k].ts;
        eq_line.push(serde_json::json!({ "time": t, "value": equity[k] }));
    }

    Ok(serde_json::json!({
        "ok": true,
        "symbol": symbol.to_uppercase(),
        "methodology": {
            "ensemble": "IS t-stat → clipped weights (÷3, ±1); 4 micro-signals same as MRT processor",
            "signals": ["REV_1", "MOM_5v20", "RANGE20", "TREND12"],
            "position": "sign(composite) with flat band at 0",
            "regime_gate": "none in replay — regime in snapshot is cross-sectional vol tertile (monitoring)",
            "weights_live_from_snapshot": weights,
        },
        "bars": candles,
        "equity": eq_line,
        "trades": trades,
        "stats": {
            "sharpe_annualized_5m": sharpe,
            "mean_bar_return": mean,
            "std_bar_return": std,
            "max_drawdown": max_dd,
            "net_return": net_ret,
            "round_turns_approx": pos_changes,
            "active_bars": act_bars,
            "hit_rate_when_active": hit_rate,
            "bars": n,
        }
    }))
}
