use std::collections::HashMap;

use serde::Serialize;

use crate::bar::Bar;
use crate::vote::AlgoVoteRow;

/// Toy backtest: sum of all algo votes per bar; long when score ≥ enter threshold, flat when ≤ exit.
/// While long, applies bar-to-bar **close** return. Sanity check only — not execution simulation.
#[derive(Serialize)]
pub struct BacktestReport {
    pub threshold_enter: i32,
    pub threshold_exit: i32,
    pub long_entries: u32,
    pub total_return: f64,
    pub bars_in_market: u32,
}

pub fn simple_vote_sum_backtest(
    bars: &[Bar],
    votes: &[AlgoVoteRow],
    threshold_enter: i32,
    threshold_exit: i32,
) -> BacktestReport {
    let mut score_at: HashMap<usize, i32> = HashMap::new();
    for v in votes {
        *score_at.entry(v.bar_index).or_insert(0) += v.vote as i32;
    }

    let mut long = false;
    let mut entries = 0_u32;
    let mut equity = 1.0_f64;
    let mut bars_in = 0_u32;

    // For each bar `i` (close known): first book return from i-1→i if long; then update `long` from vote sum at `i` for the next interval.
    for i in 1..bars.len() {
        let ret = (bars[i].close - bars[i - 1].close) / bars[i - 1].close.max(1e-9);
        if long {
            equity *= 1.0 + ret;
            bars_in += 1;
        }
        let s = *score_at.get(&i).unwrap_or(&0);
        if long && s <= threshold_exit {
            long = false;
        } else if !long && s >= threshold_enter {
            long = true;
            entries += 1;
        }
    }

    BacktestReport {
        threshold_enter,
        threshold_exit,
        long_entries: entries,
        total_return: equity - 1.0,
        bars_in_market: bars_in,
    }
}
