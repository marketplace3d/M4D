use serde_json::json;
use super::AlgoContext;

/// Bank C · OR — O'Neil Breakout: price RS + volume pivot breakout.
/// The C-A-N-S-L-I-M fundamental overlay is additive alpha; the breakout signal
/// itself (RS > 0, pivot on volume) is the chart component and fully OHLCV-native.
pub fn eval_or(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 205 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let ma200 = ctx.cache.sma200[idx];
    let va = ctx.cache.vol_avg20[idx];
    if !ma200.is_finite() || !va.is_finite() || va < 1.0 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let c = ctx.bars[idx].close;

    // RS proxy: price performance over 50 bars vs 200-bar average
    let c_50 = ctx.bars[idx - 50].close;
    let rs_pct = (c - c_50) / c_50.abs().max(1e-12);

    // Base detection: find highest close in last 60 bars as pivot
    let pivot = (idx.saturating_sub(60)..idx).map(|i| ctx.bars[i].high).fold(f64::NEG_INFINITY, f64::max);
    let near_pivot = c > pivot * 0.98;
    let breakout = c > pivot;
    let vol_ratio = ctx.bars[idx].volume / va;

    let strength = (rs_pct * 5.0).min(1.0).max(0.0) * (vol_ratio / 2.0).min(1.0);

    if breakout && vol_ratio > 1.4 && rs_pct > 0.05 && c > ma200 {
        (1, strength.max(0.4), json!({"rs_pct":rs_pct,"pivot":pivot,"vol_ratio":vol_ratio,"breakout":true}))
    } else if near_pivot && rs_pct > 0.05 && c > ma200 {
        (1, 0.2, json!({"rs_pct":rs_pct,"pivot":pivot,"near_pivot":true}))
    } else if c < ma200 && rs_pct < -0.05 {
        (-1, 0.3, json!({"rs_pct":rs_pct,"below_200":true}))
    } else {
        (0, 0.0, json!({"rs_pct":rs_pct,"pivot":pivot,"close":c}))
    }
}
