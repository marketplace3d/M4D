use serde_json::json;
use super::AlgoContext;

/// Bank A · WH — Wolfhound: 3 consecutive accelerating bars with expanding range.
pub fn eval_wh(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 3 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let atr = ctx.cache.atr14[idx];
    if !atr.is_finite() || atr < 1e-12 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let b1 = &ctx.bars[idx - 2];
    let b2 = &ctx.bars[idx - 1];
    let b3 = &ctx.bars[idx];

    let r1 = b1.high - b1.low;
    let r2 = b2.high - b2.low;
    let r3 = b3.high - b3.low;

    let bull = b1.close > b1.open && b2.close > b2.open && b3.close > b3.open;
    let bear = b1.close < b1.open && b2.close < b2.open && b3.close < b3.open;
    let expanding = r2 > r1 && r3 > r2;
    let vol_ok = b2.volume > b1.volume && b3.volume > b2.volume;

    let velocity = (r3 - r1) / atr;
    let strength = (velocity / 2.0).min(1.0).max(0.0);

    if bull && expanding && vol_ok && velocity > 0.3 {
        (1, strength, json!({"r1":r1,"r2":r2,"r3":r3,"velocity":velocity}))
    } else if bear && expanding && vol_ok && velocity > 0.3 {
        (-1, strength, json!({"r1":r1,"r2":r2,"r3":r3,"velocity":velocity}))
    } else {
        (0, 0.0, json!({"velocity":velocity,"expanding":expanding}))
    }
}
