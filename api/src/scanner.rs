/// scanner.rs — Real-time crypto scanner (Binance 1m klines, Rust async)
/// Runs as a background tokio task every 60 seconds.
/// Detects: SURGE | BREAKOUT | MOMENTUM | REVERSAL | GAP
use std::sync::Arc;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};

// ── Config ────────────────────────────────────────────────────────────────────
const SCAN_INTERVAL_SECS: u64 = 60;
const KLINE_LIMIT: u32 = 22; // 21 bars + current forming
const SURGE_MULT: f64 = 2.5;
const BREAKOUT_BARS: usize = 20;
const GAP_PCT: f64 = 0.01;
const RSI_OB: f64 = 72.0;
const RSI_OS: f64 = 28.0;
const RSI_PERIOD: usize = 14;

const SYMBOLS: &[&str] = &[
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    "ADAUSDT", "AVAXUSDT", "DOGEUSDT", "DOTUSDT", "LINKUSDT",
    "MATICUSDT", "LTCUSDT", "UNIUSDT", "ATOMUSDT", "FILUSDT",
    "ARBUSDT", "OPUSDT", "INJUSDT", "TIAUSDT", "SUIUSDT",
    "NEARUSDT", "AAVEUSDT", "WBTCUSDT", "APTUSDT", "FETUSDT",
    "RENDERUSDT", "IMXUSDT", "STXUSDT", "RUNEUSDT", "SEIUSDT",
    "WLDUSDT", "JUPUSDT", "PYTHUSDT", "TIAUSUSDT", "TONUSDT",
    "BEAMXUSDT", "ORDIUSDT", "SATSUSDT", "BOMEUSDT", "WIFUSDT",
    "PEPEUSDT", "FLOKIUSDT", "BONKUSDT", "MEMEUSDT", "NOTUSDT",
    "EIGENUSDT", "ZROUSDT", "BBUSDT", "REZUSDT", "IOUSDT",
];

// ── Types ─────────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannerAlert {
    pub symbol: String,
    pub market: String,
    pub alert_type: String,
    pub direction: String,
    pub price: f64,
    pub change_pct: f64,
    pub rel_vol: f64,
    pub score: f64,
    pub detail: String,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ScannerState {
    pub alerts: Vec<ScannerAlert>,
    pub last_scan: i64,
    pub symbols_scanned: usize,
    pub error: Option<String>,
}

// ── Background task entry point ───────────────────────────────────────────────
pub async fn run_scanner(
    state: Arc<RwLock<ScannerState>>,
    tx: broadcast::Sender<String>,
) {
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("reqwest client");

    let mut interval = tokio::time::interval(Duration::from_secs(SCAN_INTERVAL_SECS));
    loop {
        interval.tick().await;
        scan_once(&client, &state, &tx).await;
    }
}

async fn scan_once(
    client: &Client,
    state: &Arc<RwLock<ScannerState>>,
    tx: &broadcast::Sender<String>,
) {
    let mut alerts: Vec<ScannerAlert> = Vec::new();
    let mut scanned = 0usize;

    // Parallel: spawn up to 10 concurrent symbol fetches
    let chunks: Vec<&[&str]> = SYMBOLS.chunks(10).collect();
    for chunk in chunks {
        let mut handles = Vec::new();
        for &sym in chunk {
            let c = client.clone();
            let s = sym.to_string();
            handles.push(tokio::spawn(async move { scan_symbol(c, s).await }));
        }
        for handle in handles {
            match handle.await {
                Ok(Ok(mut a)) => {
                    scanned += 1;
                    alerts.append(&mut a);
                }
                Ok(Err(e)) => tracing::debug!("[scanner] symbol error: {e}"),
                Err(e) => tracing::debug!("[scanner] join error: {e}"),
            }
        }
        // Brief pause between chunks — Binance rate limit courtesy
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    // Sort by score desc
    alerts.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    let now = chrono::Utc::now().timestamp();
    let new_state = ScannerState {
        alerts: alerts.clone(),
        last_scan: now,
        symbols_scanned: scanned,
        error: None,
    };

    *state.write().await = new_state;

    if let Ok(json) = serde_json::to_string(&alerts) {
        let _ = tx.send(json);
    }

    tracing::info!("[scanner] {} symbols → {} alerts", scanned, alerts.len());
}

// ── Per-symbol scanner ────────────────────────────────────────────────────────
async fn scan_symbol(
    client: Client,
    symbol: String,
) -> Result<Vec<ScannerAlert>, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!(
        "https://api.binance.com/api/v3/klines?symbol={symbol}&interval=1m&limit={KLINE_LIMIT}"
    );
    let raw: Vec<serde_json::Value> = client.get(&url).send().await?.error_for_status()?.json().await?;
    if raw.len() < RSI_PERIOD + 2 {
        return Ok(vec![]);
    }

    // Parse bars — skip the last (still-forming) bar
    let bars: Vec<[f64; 6]> = raw[..raw.len() - 1]
        .iter()
        .filter_map(parse_kline)
        .collect();

    if bars.len() < RSI_PERIOD + 1 {
        return Ok(vec![]);
    }

    let closes: Vec<f64> = bars.iter().map(|b| b[4]).collect();
    let highs: Vec<f64>  = bars.iter().map(|b| b[2]).collect();
    let lows: Vec<f64>   = bars.iter().map(|b| b[3]).collect();
    let vols: Vec<f64>   = bars.iter().map(|b| b[5]).collect();
    let opens: Vec<f64>  = bars.iter().map(|b| b[1]).collect();
    let ts = bars.last().map(|b| b[0] as i64).unwrap_or(0);

    let cur_close = *closes.last().unwrap();
    let prev_close = closes[closes.len() - 2];
    let cur_vol   = *vols.last().unwrap();
    let cur_open  = *opens.last().unwrap();
    let change_pct = (cur_close - prev_close) / prev_close * 100.0;

    let avg_vol = vols[..vols.len() - 1].iter().sum::<f64>() / (vols.len() - 1) as f64;
    let rel_vol = if avg_vol > 0.0 { cur_vol / avg_vol } else { 1.0 };

    let rsi = calc_rsi(&closes, RSI_PERIOD);
    let prev_prev_close = closes[closes.len() - 3];

    // Trim to last BREAKOUT_BARS for the lookback window (excluding current bar)
    let lookback_end = closes.len() - 1;
    let lookback_start = lookback_end.saturating_sub(BREAKOUT_BARS);
    let lookback_highs = &highs[lookback_start..lookback_end];
    let lookback_lows  = &lows[lookback_start..lookback_end];
    let recent_high = lookback_highs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let recent_low  = lookback_lows.iter().cloned().fold(f64::INFINITY, f64::min);

    let display = symbol.trim_end_matches("USDT").to_string();
    let mut alerts: Vec<ScannerAlert> = Vec::new();

    // SURGE
    if rel_vol >= SURGE_MULT {
        let dir = if change_pct >= 0.0 { "LONG" } else { "SHORT" };
        let score = (rel_vol / SURGE_MULT).min(5.0) * 20.0;
        alerts.push(ScannerAlert {
            symbol: display.clone(),
            market: "crypto".into(),
            alert_type: "SURGE".into(),
            direction: dir.into(),
            price: cur_close,
            change_pct,
            rel_vol,
            score,
            detail: format!("{:.1}x avg vol", rel_vol),
            ts,
        });
    }

    // BREAKOUT
    if cur_close > recent_high {
        let score = 70.0 + (rel_vol.min(3.0) / 3.0) * 30.0;
        alerts.push(ScannerAlert {
            symbol: display.clone(),
            market: "crypto".into(),
            alert_type: "BREAKOUT".into(),
            direction: "LONG".into(),
            price: cur_close,
            change_pct,
            rel_vol,
            score,
            detail: format!("{}-bar high break", BREAKOUT_BARS),
            ts,
        });
    } else if cur_close < recent_low {
        let score = 70.0 + (rel_vol.min(3.0) / 3.0) * 30.0;
        alerts.push(ScannerAlert {
            symbol: display.clone(),
            market: "crypto".into(),
            alert_type: "BREAKOUT".into(),
            direction: "SHORT".into(),
            price: cur_close,
            change_pct,
            rel_vol,
            score,
            detail: format!("{}-bar low break", BREAKOUT_BARS),
            ts,
        });
    }

    // MOMENTUM — 3 consecutive higher closes (LONG) or lower closes (SHORT)
    if cur_close > prev_close && prev_close > prev_prev_close {
        let score = 50.0 + rel_vol.min(2.0) * 15.0;
        alerts.push(ScannerAlert {
            symbol: display.clone(),
            market: "crypto".into(),
            alert_type: "MOMENTUM".into(),
            direction: "LONG".into(),
            price: cur_close,
            change_pct,
            rel_vol,
            score,
            detail: "3 consec up closes".into(),
            ts,
        });
    } else if cur_close < prev_close && prev_close < prev_prev_close {
        let score = 50.0 + rel_vol.min(2.0) * 15.0;
        alerts.push(ScannerAlert {
            symbol: display.clone(),
            market: "crypto".into(),
            alert_type: "MOMENTUM".into(),
            direction: "SHORT".into(),
            price: cur_close,
            change_pct,
            rel_vol,
            score,
            detail: "3 consec down closes".into(),
            ts,
        });
    }

    // REVERSAL (RSI extreme)
    if let Some(rsi_val) = rsi {
        if rsi_val >= RSI_OB {
            let score = 40.0 + (rsi_val - RSI_OB) * 2.0;
            alerts.push(ScannerAlert {
                symbol: display.clone(),
                market: "crypto".into(),
                alert_type: "REVERSAL".into(),
                direction: "SHORT".into(),
                price: cur_close,
                change_pct,
                rel_vol,
                score,
                detail: format!("RSI {:.0} overbought", rsi_val),
                ts,
            });
        } else if rsi_val <= RSI_OS {
            let score = 40.0 + (RSI_OS - rsi_val) * 2.0;
            alerts.push(ScannerAlert {
                symbol: display.clone(),
                market: "crypto".into(),
                alert_type: "REVERSAL".into(),
                direction: "LONG".into(),
                price: cur_close,
                change_pct,
                rel_vol,
                score,
                detail: format!("RSI {:.0} oversold", rsi_val),
                ts,
            });
        }
    }

    // GAP
    let gap = (cur_open - prev_close) / prev_close;
    if gap.abs() >= GAP_PCT {
        let dir = if gap > 0.0 { "LONG" } else { "SHORT" };
        let score = 45.0 + gap.abs() * 500.0;
        alerts.push(ScannerAlert {
            symbol: display.clone(),
            market: "crypto".into(),
            alert_type: "GAP".into(),
            direction: dir.into(),
            price: cur_close,
            change_pct,
            rel_vol,
            score,
            detail: format!("Gap {:.2}%", gap * 100.0),
            ts,
        });
    }

    Ok(alerts)
}

// ── Indicators ────────────────────────────────────────────────────────────────
fn calc_rsi(closes: &[f64], period: usize) -> Option<f64> {
    if closes.len() < period + 1 {
        return None;
    }
    let relevant = &closes[closes.len() - (period + 1)..];
    let (mut avg_gain, mut avg_loss) = (0.0_f64, 0.0_f64);
    for i in 1..=period {
        let d = relevant[i] - relevant[i - 1];
        if d > 0.0 { avg_gain += d; } else { avg_loss += d.abs(); }
    }
    avg_gain /= period as f64;
    avg_loss /= period as f64;
    if avg_loss == 0.0 { return Some(100.0); }
    let rs = avg_gain / avg_loss;
    Some(100.0 - 100.0 / (1.0 + rs))
}

fn parse_kline(v: &serde_json::Value) -> Option<[f64; 6]> {
    let arr = v.as_array()?;
    if arr.len() < 6 { return None; }
    Some([
        pf64(&arr[0])?,  // open_time ms → used as ts
        pf64(&arr[1])?,  // open
        pf64(&arr[2])?,  // high
        pf64(&arr[3])?,  // low
        pf64(&arr[4])?,  // close
        pf64(&arr[5])?,  // volume
    ])
}

fn pf64(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}
