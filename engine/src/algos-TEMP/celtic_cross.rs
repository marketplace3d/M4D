use serde_json::json;

use super::AlgoContext;

/// Bank A · Celtic Cross — full 8/21/34 EMA stack.
pub fn eval_cc(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    let b = &ctx.bars[idx];
    let e8 = ctx.cache.ema8[idx];
    let e21 = ctx.cache.ema21[idx];
    let e34 = ctx.cache.ema34[idx];
    if !e8.is_finite() || !e21.is_finite() || !e34.is_finite() {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let bull = b.close > e8 && e8 > e21 && e21 > e34;
    let bear = b.close < e8 && e8 < e21 && e21 < e34;
    let spread = ((e8 - e21).abs() + (e21 - e34).abs()) / b.close.max(1e-9);
    let strength = (spread * 50.0).min(1.0);
    if bull {
        (1, strength.max(0.2), json!({"ema8":e8,"ema21":e21,"ema34":e34,"stack":"bull"}))
    } else if bear {
        (-1, strength.max(0.2), json!({"ema8":e8,"ema21":e21,"ema34":e34,"stack":"bear"}))
    } else {
        (0, 0.0, json!({"ema8":e8,"ema21":e21,"ema34":e34,"stack":"mixed"}))
    }
}
