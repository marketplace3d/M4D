use serde_json::json;
use super::AlgoContext;

/// Bank B · VT — Vega Trap: options GEX/max-pain proxy from OHLCV.
/// Without options chain data, we detect "pinning" behavior: narrowing range near
/// round numbers with volume drop — suggestive of dealer hedging / max-pain gravity.
pub fn eval_vt(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 20 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let atr = ctx.cache.atr14[idx];
    let va = ctx.cache.vol_avg20[idx];
    if !atr.is_finite() || !va.is_finite() || atr < 1e-12 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let c = ctx.bars[idx].close;
    let range = ctx.bars[idx].high - ctx.bars[idx].low;
    let range_ratio = range / atr;
    let vol_ratio = ctx.bars[idx].volume / va.max(1.0);

    // Detect pinning: range contracting (< 0.5 ATR) with low volume
    let pin_detected = range_ratio < 0.5 && vol_ratio < 0.7;

    // Gamma wall proxy: find nearest round number (multiples of ATR×5) and check breakout
    let round_step = (atr * 5.0).max(1.0);
    let nearest_round = (c / round_step).round() * round_step;
    let dist_to_round = (c - nearest_round).abs() / atr;

    if pin_detected && dist_to_round < 0.3 {
        return (0, 0.0, json!({"pin":true,"pin_level":nearest_round,"range_ratio":range_ratio,"note":"max_pain_gravity"}));
    }

    // Breakout above gamma wall proxy with positive delta
    let prev_c = ctx.bars[idx - 1].close;
    if c > nearest_round && prev_c < nearest_round && vol_ratio > 1.5 {
        let s = (vol_ratio / 3.0).min(1.0);
        return (1, s, json!({"gamma_break":"above","level":nearest_round,"vol_ratio":vol_ratio}));
    }
    if c < nearest_round && prev_c > nearest_round && vol_ratio > 1.5 {
        let s = (vol_ratio / 3.0).min(1.0);
        return (-1, s, json!({"gamma_break":"below","level":nearest_round,"vol_ratio":vol_ratio}));
    }

    (0, 0.0, json!({"range_ratio":range_ratio,"vol_ratio":vol_ratio,"nearest_round":nearest_round}))
}
