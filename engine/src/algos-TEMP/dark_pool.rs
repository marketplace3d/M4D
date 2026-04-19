use serde_json::json;
use super::AlgoContext;

/// Bank B · DP — Dark Pool: institutional print proxy from OHLCV.
/// Without actual DP data, we detect anomalous volume at key levels (VPOC-like zones)
/// where the bar body is small relative to volume — suggestive of large hidden orders.
pub fn eval_dp(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 21 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let va = ctx.cache.vol_avg20[idx];
    let atr = ctx.cache.atr14[idx];
    if !va.is_finite() || !atr.is_finite() || va < 1.0 || atr < 1e-12 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let b = &ctx.bars[idx];
    let body = (b.close - b.open).abs();
    let range = b.high - b.low;
    let vol_ratio = b.volume / va;

    // DP anomaly: high volume but small body (absorption / hidden iceberg orders)
    let body_ratio = if range > 1e-12 { body / range } else { 1.0 };
    let anomaly = vol_ratio > 2.0 && body_ratio < 0.3;

    if !anomaly {
        return (0, 0.0, json!({"vol_ratio":vol_ratio,"body_ratio":body_ratio}));
    }

    // Direction: is the absorption at support (bullish) or resistance (bearish)?
    let lo20 = ctx.cache.ll20[idx];
    let hi20 = ctx.cache.hh20[idx];
    if !lo20.is_finite() || !hi20.is_finite() {
        return (0, 0.0, json!({"anomaly":true,"reason":"no_range"}));
    }

    let dist_to_lo = (b.low - lo20).abs() / atr;
    let dist_to_hi = (b.high - hi20).abs() / atr;
    let strength = (vol_ratio / 4.0).min(1.0).max(0.3);

    if dist_to_lo < 1.0 {
        (1, strength, json!({"dp_anomaly":"support","vol_ratio":vol_ratio,"body_ratio":body_ratio,"near_lo20":lo20}))
    } else if dist_to_hi < 1.0 {
        (-1, strength, json!({"dp_anomaly":"resistance","vol_ratio":vol_ratio,"body_ratio":body_ratio,"near_hi20":hi20}))
    } else {
        (0, 0.0, json!({"dp_anomaly":"neutral","vol_ratio":vol_ratio,"body_ratio":body_ratio}))
    }
}
