use serde_json::json;
use super::AlgoContext;

/// Bank B · VK — Volkov Keltner: KC(20, 2×ATR10) breakout with volume surge.
pub fn eval_vk(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 2 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let ku = ctx.cache.kc2_upper[idx];
    let kl = ctx.cache.kc2_lower[idx];
    let va = ctx.cache.vol_avg20[idx];
    if !ku.is_finite() || !kl.is_finite() || !va.is_finite() || va < 1.0 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let c = ctx.bars[idx].close;
    let vol = ctx.bars[idx].volume;
    let vol_ratio = vol / va;

    // False break filter: prior bar must have been inside KC
    let prev_c = ctx.bars[idx - 1].close;
    let prev_ku = ctx.cache.kc2_upper[idx - 1];
    let prev_kl = ctx.cache.kc2_lower[idx - 1];
    let was_inside = prev_ku.is_finite() && prev_kl.is_finite() && prev_c <= prev_ku && prev_c >= prev_kl;

    let strength = (vol_ratio / 4.0).min(1.0).max(0.0);

    if c > ku && vol_ratio >= 2.0 && was_inside {
        (1, strength, json!({"kc_upper":ku,"close":c,"vol_surge":vol_ratio}))
    } else if c < kl && vol_ratio >= 2.0 && was_inside {
        (-1, strength, json!({"kc_lower":kl,"close":c,"vol_surge":vol_ratio}))
    } else {
        (0, 0.0, json!({"kc_upper":ku,"kc_lower":kl,"close":c,"vol_ratio":vol_ratio}))
    }
}
