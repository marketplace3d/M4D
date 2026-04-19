use serde_json::json;

use super::AlgoContext;

fn bb_inside_kc(ctx: &AlgoContext, i: usize) -> bool {
    let bu = ctx.cache.bb_upper[i];
    let bl = ctx.cache.bb_lower[i];
    let ku = ctx.cache.kc_upper[i];
    let kl = ctx.cache.kc_lower[i];
    if !bu.is_finite() || !bl.is_finite() || !ku.is_finite() || !kl.is_finite() {
        return false;
    }
    bu < ku && bl > kl
}

/// Bank A · Banshee — TTM squeeze: first bar leaving squeeze (BB no longer inside KC).
pub fn eval_bq(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx == 0 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let was = bb_inside_kc(ctx, idx - 1);
    let now = bb_inside_kc(ctx, idx);
    if !was {
        return (0, 0.0, json!({"squeeze": now}));
    }
    if now {
        return (0, 0.0, json!({"squeeze": true}));
    }
    let c = ctx.bars[idx].close;
    let mid = ctx.cache.kc_mid[idx];
    if !mid.is_finite() {
        return (0, 0.0, json!({"reason":"nan"}));
    }
    let raw = (c - mid) / mid.abs().max(1.0);
    let strength = (raw.abs() * 20.0).min(1.0).max(0.25);
    if c > mid {
        (1, strength, json!({"squeeze_release":"up","kc_mid":mid}))
    } else {
        (-1, strength, json!({"squeeze_release":"down","kc_mid":mid}))
    }
}
