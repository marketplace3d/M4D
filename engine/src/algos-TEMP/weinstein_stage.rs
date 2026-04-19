use serde_json::json;
use super::AlgoContext;

/// Bank C · WN — Weinstein Stage Analysis: SMA(30) slope + volume expansion.
/// Weinstein's original method uses a 30-week MA on weekly charts.  On daily bars
/// the 30-period SMA is a shorter window, but the stage logic (1→2→3→4) is
/// structurally identical.  Fully OHLCV-native.
pub fn eval_wn(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 35 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let ma = ctx.cache.sma30[idx];
    let ma_prev = ctx.cache.sma30[idx - 3];
    let va = ctx.cache.vol_avg20[idx];
    if !ma.is_finite() || !ma_prev.is_finite() || !va.is_finite() {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let c = ctx.bars[idx].close;
    let slope_up = ma > ma_prev;
    let slope_down = ma < ma_prev;
    let above_ma = c > ma;
    let vol_ratio = ctx.bars[idx].volume / va.max(1.0);

    // Stage 2: price above rising 30-period MA with volume expansion
    if above_ma && slope_up && vol_ratio > 1.5 {
        let s = (vol_ratio / 3.0).min(1.0).max(0.3);
        return (1, s, json!({"stage":2,"ma30":ma,"slope":"up","vol_ratio":vol_ratio}));
    }

    // Stage 4: price below declining MA
    if !above_ma && slope_down {
        let s = 0.5;
        return (-1, s, json!({"stage":4,"ma30":ma,"slope":"down"}));
    }

    // Stage 1/3: ranging
    let stage = if above_ma { 3 } else { 1 };
    (0, 0.0, json!({"stage":stage,"ma30":ma,"close":c}))
}
