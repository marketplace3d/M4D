use serde_json::json;
use super::AlgoContext;

/// Bank A · HK — High King: Opening Range Breakout + prior day high/low filter.
/// In a generic bar series (no session boundaries), we use the first bar as "OR"
/// relative to the prior 6-bar range (proxy for session open behavior).
pub fn eval_hk(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 7 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let atr = ctx.cache.atr14[idx];
    if !atr.is_finite() || atr < 1e-12 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let or_high = ctx.bars[idx - 5].high.max(ctx.bars[idx - 4].high);
    let or_low = ctx.bars[idx - 5].low.min(ctx.bars[idx - 4].low);
    let or_mid = (or_high + or_low) / 2.0;
    let or_range = or_high - or_low;

    let pdh = (0..5).map(|k| ctx.bars[idx - 6 + k].high).fold(f64::NEG_INFINITY, f64::max);
    let pdl = (0..5).map(|k| ctx.bars[idx - 6 + k].low).fold(f64::INFINITY, f64::min);

    let c = ctx.bars[idx].close;
    let vol = ctx.bars[idx].volume;
    let vol_or = ctx.bars[idx - 4].volume.max(1.0);
    let vol_ratio = vol / vol_or;

    let above_mid = c > or_mid;
    let below_mid = c < or_mid;
    let vol_confirm = vol_ratio > 1.5;

    let strength = if or_range > 1e-12 {
        ((c - or_mid).abs() / or_range * vol_ratio).min(1.0)
    } else {
        0.0
    };

    if above_mid && vol_confirm && (c > pdh || (pdh - c) < 0.5 * atr) {
        (1, strength, json!({"or_high":or_high,"or_low":or_low,"or_mid":or_mid,"pdh":pdh,"vol_ratio":vol_ratio}))
    } else if below_mid && vol_confirm && (c < pdl || (c - pdl) < 0.5 * atr) {
        (-1, strength, json!({"or_high":or_high,"or_low":or_low,"or_mid":or_mid,"pdl":pdl,"vol_ratio":vol_ratio}))
    } else {
        (0, 0.0, json!({"or_mid":or_mid,"close":c,"vol_ratio":vol_ratio}))
    }
}
