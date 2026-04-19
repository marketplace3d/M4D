use serde_json::json;
use super::AlgoContext;

/// Bank C · DV — Dragonfly Vol: Mansfield-style RS + accumulation scoring.
/// Single-asset RS (price / 50-SMA) at 52-bar highs with up-day accumulation.
/// Sector-relative RS is additive; this standalone version is OHLCV-native.
pub fn eval_dv(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 60 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let va = ctx.cache.vol_avg20[idx];
    if !va.is_finite() || va < 1.0 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let c = ctx.bars[idx].close;

    // RS line proxy: price / 50-bar SMA (rising = outperforming)
    let sma50: f64 = (idx - 49..=idx).map(|i| ctx.bars[i].close).sum::<f64>() / 50.0;
    let rs_line = c / sma50.max(1e-12);

    // RS at 52-bar high?
    let mut rs_52_high = true;
    for k in (idx.saturating_sub(52))..idx {
        let pk = ctx.bars[k].close;
        let sk: f64 = if k >= 50 {
            (k - 49..=k).map(|i| ctx.bars[i].close).sum::<f64>() / 50.0
        } else { pk };
        if pk / sk.max(1e-12) > rs_line { rs_52_high = false; break; }
    }

    // Accumulation: count up-days on above-avg volume in last 20 bars
    let mut acc_score: i32 = 0;
    for k in (idx.saturating_sub(19))..=idx {
        let bk = &ctx.bars[k];
        let up = bk.close > bk.open;
        let vol_above = bk.volume > va;
        if up && vol_above { acc_score += 1; }
        if !up && vol_above { acc_score -= 1; }
    }

    let strength = ((acc_score as f64).abs() / 10.0).min(1.0);

    if rs_52_high && acc_score > 3 {
        (1, strength.max(0.4), json!({"rs_line":rs_line,"rs_52_high":true,"acc_score":acc_score}))
    } else if !rs_52_high && acc_score < -3 {
        (-1, strength.max(0.3), json!({"rs_line":rs_line,"rs_52_high":false,"acc_score":acc_score}))
    } else {
        (0, 0.0, json!({"rs_line":rs_line,"acc_score":acc_score}))
    }
}
