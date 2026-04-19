use serde_json::json;
use super::AlgoContext;

/// Bank C · MM — Minervini VCP: progressive range contraction + pivot breakout.
/// Needs ≥60 bars for full contraction scan (40-bar base + history).  OHLCV-native.
pub fn eval_mm(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 40 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let va = ctx.cache.vol_avg20[idx];
    if !va.is_finite() || va < 1.0 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    // Look back up to 60 bars and find contracting swing ranges
    let window = 60.min(idx);
    let base_start = idx - window;

    let peak = (base_start..=idx).map(|i| ctx.bars[i].high).fold(f64::NEG_INFINITY, f64::max);

    // Split into roughly 4 segments to check progressive tightening
    let seg = window / 4;
    if seg < 3 { return (0, 0.0, json!({"reason":"short_base"})); }

    let mut contractions: Vec<f64> = Vec::new();
    for s in 0..4 {
        let from = base_start + s * seg;
        let to = (from + seg).min(idx);
        let hi = (from..=to).map(|i| ctx.bars[i].high).fold(f64::NEG_INFINITY, f64::max);
        let lo = (from..=to).map(|i| ctx.bars[i].low).fold(f64::INFINITY, f64::min);
        contractions.push(hi - lo);
    }

    let mut tightening = 0_u32;
    for i in 1..contractions.len() {
        if contractions[i] < contractions[i - 1] * 0.75 { tightening += 1; }
    }

    let c = ctx.bars[idx].close;
    let pivot = peak;
    let near_pivot = (pivot - c) / pivot.abs().max(1e-12) < 0.05;
    let vol_ratio = ctx.bars[idx].volume / va;

    let vcp_stage = tightening;
    let strength = (vcp_stage as f64 / 4.0).min(1.0);

    if vcp_stage >= 2 && near_pivot && vol_ratio > 1.5 {
        (1, strength.max(0.4), json!({"vcp_stage":vcp_stage,"pivot":pivot,"vol_ratio":vol_ratio,"contractions":contractions}))
    } else if vcp_stage >= 2 && near_pivot {
        (1, 0.25, json!({"vcp_stage":vcp_stage,"pivot":pivot,"vol_pending":true}))
    } else {
        (0, 0.0, json!({"vcp_stage":vcp_stage,"pivot":pivot,"close":c}))
    }
}
