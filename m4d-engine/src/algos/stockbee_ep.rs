use serde_json::json;
use super::AlgoContext;

/// Bank C · SE — Stockbee Episodic Pivot: gap + 3× avg volume.
/// This IS the original Pradeep Bonde definition — a catalyst headline is
/// confirmatory but not required.  Fully OHLCV-native.
pub fn eval_se(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 21 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let va = ctx.cache.vol_avg20[idx];
    if !va.is_finite() || va < 1.0 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let b = &ctx.bars[idx];
    let prev = &ctx.bars[idx - 1];
    let gap_pct = (b.open - prev.close) / prev.close.abs().max(1e-12);
    let vol_ratio = b.volume / va;

    let ep_score = gap_pct.abs() * (vol_ratio / 3.0);
    let strength = (ep_score / 5.0).min(1.0);

    if gap_pct > 0.02 && vol_ratio > 3.0 {
        (1, strength.max(0.3), json!({"gap_pct":gap_pct,"vol_ratio":vol_ratio,"ep_score":ep_score}))
    } else if gap_pct < -0.02 && vol_ratio > 3.0 {
        (-1, strength.max(0.3), json!({"gap_pct":gap_pct,"vol_ratio":vol_ratio,"ep_score":ep_score}))
    } else {
        (0, 0.0, json!({"gap_pct":gap_pct,"vol_ratio":vol_ratio}))
    }
}
