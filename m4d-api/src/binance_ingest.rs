//! Binance public kline WebSocket → `broadcast` hub.
//!
//! Free, no auth required. Streams 1-minute confirmed bars for 5 liquid crypto symbols.
//! Downstream frame matches existing Alpaca contract:
//!   `{ "type": "bar", "symbol": "BTCUSDT", "bar": { time, open, high, low, close, volume, _vendor, _symbol } }`
//!
//! Only closed bars (`k.x == true`) are emitted — same contract as confirmed OHLCV bars.
//! Override via env:
//!   BINANCE_WS_URL   — full combined-stream URL (default: auto-built from CRYPTO_SYMBOLS)
//!   CRYPTO_SYMBOLS   — comma-separated lowercase symbols (default: btcusdt,ethusdt,solusdt,bnbusdt,avaxusdt)

use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message as TMessage};

const DEFAULT_SYMBOLS: &[&str] = &["btcusdt", "ethusdt", "solusdt", "bnbusdt", "avaxusdt"];
const BINANCE_STREAM_BASE: &str = "wss://stream.binance.com:9443/stream";

fn resolve_symbols() -> Vec<String> {
    std::env::var("CRYPTO_SYMBOLS")
        .ok()
        .filter(|s| !s.is_empty())
        .map(|s| s.split(',').map(|x| x.trim().to_lowercase()).collect())
        .unwrap_or_else(|| DEFAULT_SYMBOLS.iter().map(|s| s.to_string()).collect())
}

fn build_url(symbols: &[String]) -> String {
    let streams = symbols
        .iter()
        .map(|s| format!("{}@kline_1m", s))
        .collect::<Vec<_>>()
        .join("/");
    format!("{}?streams={}", BINANCE_STREAM_BASE, streams)
}

/// Parse one Binance combined-stream message. Only emits on closed bars (`k.x == true`).
fn dispatch(text: &str, tx: &broadcast::Sender<String>) {
    let Ok(root) = serde_json::from_str::<Value>(text) else {
        return;
    };
    // Combined stream: { "stream": "btcusdt@kline_1m", "data": { "e": "kline", "k": { ... } } }
    let Some(k) = root.get("data").and_then(|d| d.get("k")) else {
        return;
    };
    // Skip open/updating bars — only confirmed closes
    if !k.get("x").and_then(Value::as_bool).unwrap_or(false) {
        return;
    }

    let sym = k.get("s").and_then(Value::as_str).unwrap_or("UNKNOWN");
    // Binance timestamp is in milliseconds; convert to seconds for lightweight-charts
    let time = k.get("t").and_then(Value::as_i64).unwrap_or(0) / 1000;

    let parse_f64 = |key: &str| -> f64 {
        k.get(key)
            .and_then(Value::as_str)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0)
    };

    let payload = json!({
        "type": "bar",
        "symbol": sym,
        "bar": {
            "time":    time,
            "open":    parse_f64("o"),
            "high":    parse_f64("h"),
            "low":     parse_f64("l"),
            "close":   parse_f64("c"),
            "volume":  parse_f64("v"),
            "_vendor": "binance",
            "_symbol": sym,
        }
    });
    let _ = tx.send(payload.to_string());
}

async fn session(
    url: &str,
    tx: &broadcast::Sender<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (ws, _) = connect_async(url).await?;
    let (_, mut read) = ws.split();

    let _ = tx.send(
        json!({
            "type": "info",
            "message": format!("[binance] connected — streaming 1m klines from {}", url)
        })
        .to_string(),
    );

    while let Some(msg) = read.next().await {
        match msg {
            Ok(TMessage::Text(t)) => dispatch(&t, tx),
            Ok(TMessage::Ping(_)) => {} // tungstenite auto-pongs
            Ok(TMessage::Close(_)) => break,
            Err(e) => return Err(e.into()),
            _ => {}
        }
    }
    Ok(())
}

/// Spawn reconnecting Binance kline ingest. No API key required.
/// Broadcasts confirmed 1m bars for all configured symbols.
pub fn spawn(tx: broadcast::Sender<String>) {
    let symbols = resolve_symbols();
    let url = std::env::var("BINANCE_WS_URL").unwrap_or_else(|_| build_url(&symbols));

    tokio::spawn(async move {
        tracing::info!("[binance] symbols: {:?}", symbols);
        loop {
            tracing::info!("[binance] connecting {}", url);
            match session(&url, &tx).await {
                Ok(()) => tracing::warn!("[binance] session ended cleanly"),
                Err(e) => tracing::warn!("[binance] session error: {e}"),
            }
            tracing::info!("[binance] reconnecting in 5s");
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}
