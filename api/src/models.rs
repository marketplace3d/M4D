use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CouncilSnapshot {
    pub timestamp: String,
    /// Normalized -100 to +100 from sum of all votes.
    pub jedi_score: f64,
    pub total_long: u32,
    pub total_short: u32,
    /// "BULL" | "BEAR" | "NEUTRAL"
    pub regime: String,
    pub algos: Vec<AlgoVote>,
}

impl Default for CouncilSnapshot {
    fn default() -> Self {
        Self {
            timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            jedi_score: 0.0,
            total_long: 0,
            total_short: 0,
            regime: "NEUTRAL".into(),
            algos: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AlgoVote {
    /// Short id: "NS", "CI", "TREND", etc.
    pub id: String,
    pub name: String,
    /// "BOOM" | "STRAT" | "LEGEND"
    pub tier: String,
    /// -1, 0, +1
    pub vote: i8,
    /// Rolling performance score, 0.0–1.0
    pub score: f64,
    pub win_rate: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AlgoDaySnapshot {
    pub timestamp: String,
    pub assets: Vec<AssetAlgoDay>,
}

impl Default for AlgoDaySnapshot {
    fn default() -> Self {
        Self {
            timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            assets: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssetAlgoDay {
    pub symbol: String,
    pub price: f64,
    pub change_pct: f64,
    pub jedi_score: f64,
    /// algo_id → vote (-1, 0, +1)
    pub votes: HashMap<String, i8>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssetSummary {
    pub symbol: String,
    pub price: f64,
    pub change_pct: f64,
    pub volume: f64,
    pub jedi_score: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VoteRecord {
    pub bar_index: usize,
    pub time: i64,
    pub algo_id: String,
    pub vote: i8,
    pub strength: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BacktestResult {
    pub asset: String,
    pub from: String,
    pub to: String,
    pub total_return: f64,
    pub win_rate: f64,
    pub total_trades: u32,
    pub bars_in_market: u32,
    pub max_drawdown: f64,
    pub sharpe: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VotesQuery {
    pub algo_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BacktestQuery {
    pub asset: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}
