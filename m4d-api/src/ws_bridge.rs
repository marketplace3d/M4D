//! WebSocket bridge hub — upstream ingest → `broadcast` → all browser connections.
//!
//! Upstream source is selected via `CRYPTO_SOURCE` env var:
//!   - `binance` (default) — public Binance kline stream, no auth required.
//!   - `alpaca`            — Alpaca market-data WS; requires ALPACA_API_KEY + ALPACA_SECRET_KEY.
//!
//! Downstream contract (all sources normalise to this):
//!   `{ "type": "bar", "symbol": "BTCUSDT", "bar": { time, open, high, low, close, volume, _vendor, _symbol } }`
//!
//! See `spec-kit/docs/ALPACA_PAPER_EXECUTION_AND_DATA_WS.md`.

use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message as TMessage};

const DEFAULT_ALPACA_WS: &str = "wss://stream.data.alpaca.markets/v2/test";
const TEST_SYMBOL: &str = "FAKEPACA";
const BROADCAST_CAP: usize = 1024;

#[derive(Clone)]
pub struct WsBridgeHub {
    tx: Arc<broadcast::Sender<String>>,
}

impl WsBridgeHub {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(BROADCAST_CAP);
        Self { tx: Arc::new(tx) }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }

    pub fn sender(&self) -> broadcast::Sender<String> {
        (*self.tx).clone()
    }
}

fn alpaca_time_to_unix(s: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&Utc).timestamp())
}

fn dispatch_alpaca_payload(text: &str, tx: &broadcast::Sender<String>) {
    let Ok(root) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let Some(arr) = root.as_array() else {
        return;
    };
    for item in arr {
        let Some(ty) = item.get("T").and_then(|x| x.as_str()) else {
            continue;
        };
        if ty != "b" {
            continue;
        }
        let Some(sym) = item.get("S").and_then(|x| x.as_str()) else {
            continue;
        };
        let (Some(o), Some(h), Some(l), Some(c)) = (
            item.get("o").and_then(|x| x.as_f64()),
            item.get("h").and_then(|x| x.as_f64()),
            item.get("l").and_then(|x| x.as_f64()),
            item.get("c").and_then(|x| x.as_f64()),
        ) else {
            continue;
        };
        let v = item.get("v").and_then(|x| x.as_f64()).unwrap_or(0.);
        let Some(tstr) = item.get("t").and_then(|x| x.as_str()) else {
            continue;
        };
        let Some(time) = alpaca_time_to_unix(tstr) else {
            continue;
        };
        let payload = json!({
            "type": "bar",
            "symbol": sym,         // top-level for easy client-side filtering
            "bar": {
                "time": time,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": v,
                "_vendor": "alpaca",
                "_symbol": sym,
            }
        });
        let _ = tx.send(payload.to_string());
    }
}

async fn alpaca_session(
    url: &str,
    key: &str,
    secret: &str,
    tx: &broadcast::Sender<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (ws, _) = connect_async(url).await?;
    let (mut write, mut read) = ws.split();

    macro_rules! send_json {
        ($v:expr) => {{
            let s = serde_json::to_string(&$v)?;
            write.send(TMessage::Text(s.into())).await?;
        }};
    }

    // welcome: [{"T":"success","msg":"connected"}]
    let _welcome = read.next().await;

    send_json!(json!({
        "action": "auth",
        "key": key,
        "secret": secret,
    }));

    // wait for authenticated (may be multiple success lines)
    let mut authed = false;
    for _ in 0..20 {
        let Some(Ok(msg)) = read.next().await else {
            break;
        };
        let TMessage::Text(t) = msg else {
            continue;
        };
        let text = t.to_string();
        if text.contains("\"authenticated\"") || text.contains("authenticated") {
            authed = true;
            break;
        }
    }
    if !authed {
        return Err("Alpaca WS: auth did not succeed in time".into());
    }

    let _ = tx.send(
        json!({"type":"info","message": format!("Alpaca WS subscribed · {} · {}", url, TEST_SYMBOL)})
            .to_string(),
    );

    send_json!(json!({
        "action": "subscribe",
        "bars": [TEST_SYMBOL]
    }));

    while let Some(item) = read.next().await {
        let Ok(TMessage::Text(t)) = item else {
            continue;
        };
        dispatch_alpaca_payload(&t.to_string(), tx);
    }

    Ok(())
}

/// Spawn reconnecting Alpaca ingest when `ALPACA_API_KEY` + `ALPACA_SECRET_KEY` are set.
pub fn spawn_alpaca_ingest(hub: &WsBridgeHub) {
    let key = match std::env::var("ALPACA_API_KEY").ok().filter(|s| !s.is_empty()) {
        Some(k) => k,
        None => {
            tracing::warn!(
                "WS bridge: set ALPACA_API_KEY + ALPACA_SECRET_KEY for Alpaca test feed ({TEST_SYMBOL})"
            );
            return;
        }
    };
    let secret = match std::env::var("ALPACA_SECRET_KEY").ok().filter(|s| !s.is_empty()) {
        Some(s) => s,
        None => {
            tracing::warn!("WS bridge: ALPACA_SECRET_KEY missing — Alpaca ingest disabled");
            return;
        }
    };
    let url = std::env::var("M4D_ALPACA_WS_URL").unwrap_or_else(|_| DEFAULT_ALPACA_WS.to_string());
    let tx = hub.sender();
    tokio::spawn(async move {
        loop {
            tracing::info!("Alpaca WS connecting {}", url);
            match alpaca_session(&url, &key, &secret, &tx).await {
                Ok(()) => tracing::warn!("Alpaca WS session ended (stream closed)"),
                Err(e) => tracing::warn!("Alpaca WS error: {e}"),
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

/// Dispatch ingest based on `CRYPTO_SOURCE` env var.
/// Default: `binance` (free, no auth). Set `CRYPTO_SOURCE=alpaca` for Alpaca paper feed.
pub fn spawn_ingest(hub: &WsBridgeHub) {
    let source = std::env::var("CRYPTO_SOURCE").unwrap_or_else(|_| "binance".to_string());
    match source.to_lowercase().as_str() {
        "alpaca" => {
            tracing::info!("ingest source: Alpaca (CRYPTO_SOURCE=alpaca)");
            spawn_alpaca_ingest(hub);
        }
        _ => {
            tracing::info!("ingest source: Binance public kline (CRYPTO_SOURCE=binance, default)");
            crate::binance_ingest::spawn(hub.sender());
        }
    }
}

/// Browser WebSocket: accepts MISSION `useAlgoWS` subscribe messages; fans out broadcast JSON.
pub async fn handle_browser_ws(mut socket: WebSocket, hub: Arc<WsBridgeHub>) {
    let mut rx = hub.subscribe();
    let source = std::env::var("CRYPTO_SOURCE").unwrap_or_else(|_| "binance".to_string());
    let hello = json!({
        "type": "info",
        "message": format!("m4d-api /v1/ws/algo ready · source={source} · CRYPTO_SOURCE env to switch")
    });
    let _ = socket.send(Message::Text(hello.to_string().into())).await;

    loop {
        tokio::select! {
            biased;
            recv = rx.recv() => {
                match recv {
                    Ok(text) => {
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("[ws_bridge] subscriber lagged, dropped {} bars", n);
                    }
                    Err(_) => break,
                }
            }
            inc = socket.recv() => {
                match inc {
                    Some(Ok(Message::Text(_))) => {}
                    Some(Ok(Message::Ping(p))) => {
                        let _ = socket.send(Message::Pong(p)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
}
