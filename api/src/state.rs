use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::models::{AlgoDaySnapshot, CouncilSnapshot};
use crate::scanner::ScannerState;

/// Shared application state threaded through all Axum handlers via `Arc<AppState>`.
#[derive(Clone)]
pub struct AppState {
    pub council: Arc<RwLock<CouncilSnapshot>>,
    pub algo_day: Arc<RwLock<AlgoDaySnapshot>>,
    pub db_path: String,
    /// Paper CryptoBot SQLite (`cryptobot_account` + `cryptobot_trades`).
    pub cryptobot_db_path: String,
    /// Broadcast channel for WebSocket push — JSON strings.
    pub tx: broadcast::Sender<String>,
    /// Scanner state + broadcast.
    pub scanner: Arc<RwLock<ScannerState>>,
    pub scanner_tx: broadcast::Sender<String>,
}

impl AppState {
    pub fn new(db_path: impl Into<String>, cryptobot_db_path: impl Into<String>) -> Self {
        let (tx, _) = broadcast::channel(1024);
        let (scanner_tx, _) = broadcast::channel(64);
        Self {
            council: Arc::new(RwLock::new(CouncilSnapshot::default())),
            algo_day: Arc::new(RwLock::new(AlgoDaySnapshot::default())),
            db_path: db_path.into(),
            cryptobot_db_path: cryptobot_db_path.into(),
            tx,
            scanner: Arc::new(RwLock::new(ScannerState::default())),
            scanner_tx,
        }
    }
}

/// Derive a `CouncilSnapshot` from an `AlgoDaySnapshot` by aggregating across all assets.
pub fn council_from_algo_day(snap: &AlgoDaySnapshot) -> CouncilSnapshot {
    if snap.assets.is_empty() {
        return CouncilSnapshot::default();
    }

    // Average jedi_score across all assets.
    let avg_jedi = snap.assets.iter().map(|a| a.jedi_score).sum::<f64>()
        / snap.assets.len() as f64;

    // Count assets that are net long vs net short based on jedi_score.
    let total_long = snap.assets.iter().filter(|a| a.jedi_score > 0.0).count() as u32;
    let total_short = snap.assets.iter().filter(|a| a.jedi_score < 0.0).count() as u32;

    // Aggregate per-algo votes across all assets: majority vote per algo.
    use std::collections::HashMap;
    let mut algo_agg: HashMap<String, (i32, u32)> = HashMap::new(); // sum, count
    for asset in &snap.assets {
        for (id, &vote) in &asset.votes {
            let e = algo_agg.entry(id.clone()).or_insert((0, 0));
            e.0 += vote as i32;
            e.1 += 1;
        }
    }

    let algo_defs: &[(&str, &str, &str)] = &[
        ("TREND", "Trend Following", "BOOM"),
        ("MOM",   "Momentum RSI",    "STRAT"),
        ("VOL",   "Volume Surge",    "BOOM"),
        ("ATR",   "ATR Breakout",    "LEGEND"),
        ("COMP",  "Composite",       "STRAT"),
    ];

    let algos = algo_defs
        .iter()
        .filter_map(|(id, name, tier)| {
            algo_agg.get(*id).map(|&(sum, cnt)| {
                let avg = sum as f64 / cnt.max(1) as f64;
                let vote = if avg > 0.2 { 1 } else if avg < -0.2 { -1 } else { 0 };
                // Derive a win_rate proxy from the absolute average.
                let win_rate = 0.50 + (avg.abs() * 0.25).min(0.40);
                crate::models::AlgoVote {
                    id: id.to_string(),
                    name: name.to_string(),
                    tier: tier.to_string(),
                    vote,
                    score: (avg.abs()).min(1.0),
                    win_rate,
                }
            })
        })
        .collect();

    let jedi_norm = (avg_jedi * 100.0).clamp(-100.0, 100.0);
    let regime = if jedi_norm > 20.0 {
        "BULL"
    } else if jedi_norm < -20.0 {
        "BEAR"
    } else {
        "NEUTRAL"
    }
    .to_string();

    CouncilSnapshot {
        timestamp: snap.timestamp.clone(),
        jedi_score: jedi_norm,
        total_long,
        total_short,
        regime,
        algos,
    }
}

/// Load `algo_day.json` from disk and update state.
pub async fn reload_from_disk(state: &AppState, json_path: &PathBuf) {
    match tokio::fs::read_to_string(json_path).await {
        Ok(raw) => match serde_json::from_str::<AlgoDaySnapshot>(&raw) {
            Ok(snap) => {
                let council = council_from_algo_day(&snap);
                let council_json = serde_json::to_string(&council).unwrap_or_default();
                *state.algo_day.write().await = snap;
                *state.council.write().await = council;
                // Broadcast updated council to WS subscribers.
                let _ = state.tx.send(council_json);
                tracing::info!("algo_day.json reloaded from {}", json_path.display());
            }
            Err(e) => tracing::warn!("algo_day.json parse error: {e}"),
        },
        Err(e) => tracing::warn!("algo_day.json read error: {e}"),
    }
}
