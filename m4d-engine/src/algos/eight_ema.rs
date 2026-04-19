use serde_json::json;

use super::AlgoContext;

/// Bank B · 8-EMA Ribbon — price vs EMA(8).
pub fn eval_8e(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    let c = ctx.bars[idx].close;
    let e = ctx.cache.ema8[idx];
    let atr = ctx.cache.atr14[idx];
    if !e.is_finite() || !atr.is_finite() || atr <= 1e-12 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let eps = c * 1e-4;
    let raw = (c - e) / atr;
    let strength = (raw.abs() / 3.0).min(1.0);
    if c > e + eps {
        (1, strength, json!({"ema8":e,"close":c,"z_atr": raw}))
    } else if c < e - eps {
        (-1, strength, json!({"ema8":e,"close":c,"z_atr": raw}))
    } else {
        (0, 0.0, json!({"ema8":e,"close":c,"z_atr": raw}))
    }
}
