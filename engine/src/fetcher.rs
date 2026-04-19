use crate::processor::Bar;
use reqwest::Client;
use serde::Deserialize;

/// Binance public kline response — each element is an array of mixed types,
/// so we deserialize as raw JSON Value and pick the fields we need.
type KlineRow = Vec<serde_json::Value>;

/// Fetch up to `limit` daily bars from the Binance public REST API.
/// No auth required for public klines.
pub async fn fetch_daily_bars(
    client: &Client,
    symbol: &str,
    limit: u32,
) -> Result<Vec<Bar>, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!(
        "https://api.binance.com/api/v3/klines?symbol={symbol}&interval=1d&limit={limit}"
    );

    let rows: Vec<KlineRow> = client
        .get(&url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let bars = rows
        .into_iter()
        .filter_map(|row| parse_kline(&row))
        .collect();

    Ok(bars)
}

fn parse_kline(row: &KlineRow) -> Option<Bar> {
    // Binance kline fields:
    // [0] open time (ms), [1] open, [2] high, [3] low, [4] close, [5] volume, ...
    if row.len() < 6 {
        return None;
    }

    let time_ms = row[0].as_i64()?;
    let open = parse_f64(&row[1])?;
    let high = parse_f64(&row[2])?;
    let low = parse_f64(&row[3])?;
    let close = parse_f64(&row[4])?;
    let volume = parse_f64(&row[5])?;

    Some(Bar {
        time: time_ms / 1000, // ms → seconds
        open,
        high,
        low,
        close,
        volume,
    })
}

/// Binance returns numeric fields as JSON strings (e.g. `"67420.50"`).
fn parse_f64(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// Canonical list of symbols to process.
/// Add more from the top-500 — the fetching loop is identical for all of them.
pub fn asset_list() -> Vec<&'static str> {
    vec![
        "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "ADAUSDT",
        "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "MATICUSDT",
        "LTCUSDT", "LINKUSDT", "UNIUSDT", "ATOMUSDT", "NEARUSDT",
        "FTMUSDT", "AAVEUSDT", "ALGOUSDT", "MANAUSDT", "SANDUSDT",
    ]
}
