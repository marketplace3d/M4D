use serde::Serialize;

use crate::algos::{run_algos_at_bar, AlgoContext};
use crate::bar::Bar;
use crate::indicators::IndicatorCache;
use crate::vote::AlgoVoteRow;

#[derive(Serialize)]
pub struct AlgoDaySummary {
    pub session_id: String,
    pub symbol: String,
    pub bar_count: usize,
    pub warmup: usize,
    pub generated_at: String,
    pub per_algo: std::collections::HashMap<String, VoteTally>,
    pub last_bar_index: usize,
    pub last_bar_time: i64,
    pub last_bar_votes: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Default, Clone)]
pub struct VoteTally {
    pub long_bars: u32,
    pub short_bars: u32,
    pub flat_bars: u32,
}

pub struct HistoricRun {
    pub votes: Vec<AlgoVoteRow>,
    pub warmup: usize,
}

pub fn run_historic(bars: &[Bar], _symbol: &str, session_id: &str) -> HistoricRun {
    let cache = IndicatorCache::build(bars);
    let warmup = IndicatorCache::warmup().min(bars.len().saturating_sub(1));
    let ctx = AlgoContext {
        bars,
        cache: &cache,
    };
    let mut votes = Vec::new();
    for idx in warmup..bars.len() {
        votes.extend(run_algos_at_bar(&ctx, idx, session_id));
    }
    HistoricRun { votes, warmup }
}

pub fn summarize_algo_day(
    session_id: &str,
    symbol: &str,
    bars: &[Bar],
    run: &HistoricRun,
) -> AlgoDaySummary {
    let mut per_algo: std::collections::HashMap<String, VoteTally> =
        std::collections::HashMap::new();

    for v in &run.votes {
        let e = per_algo.entry(v.algo_id.clone()).or_default();
        match v.vote {
            1 => e.long_bars += 1,
            -1 => e.short_bars += 1,
            _ => e.flat_bars += 1,
        }
    }

    let last_bar_index = bars.len().saturating_sub(1);
    let last_bar_time = bars.last().map(|b| b.time).unwrap_or(0);

    let mut last_bar_votes = std::collections::HashMap::new();
    if last_bar_index >= run.warmup {
        for v in run
            .votes
            .iter()
            .filter(|x| x.bar_index == last_bar_index)
        {
            last_bar_votes.insert(
                v.algo_id.clone(),
                serde_json::json!({
                    "vote": v.vote,
                    "strength": v.strength,
                    "payload": v.payload,
                }),
            );
        }
    }

    AlgoDaySummary {
        session_id: session_id.to_string(),
        symbol: symbol.to_string(),
        bar_count: bars.len(),
        warmup: run.warmup,
        generated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        per_algo,
        last_bar_index,
        last_bar_time,
        last_bar_votes,
    }
}
