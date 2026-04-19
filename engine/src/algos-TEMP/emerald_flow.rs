use serde_json::json;
use super::AlgoContext;

/// Bank A · EF — Emerald Flow: MFI(14) cross above/below 50, divergence flag.
pub fn eval_ef(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 2 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let mfi = ctx.cache.mfi14[idx];
    let mfi_prev = ctx.cache.mfi14[idx - 1];
    if !mfi.is_finite() || !mfi_prev.is_finite() {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let slope = mfi - mfi_prev;
    let cross_up = mfi_prev < 50.0 && mfi >= 50.0;
    let cross_down = mfi_prev > 50.0 && mfi <= 50.0;

    let mut div_bull = false;
    let mut div_bear = false;
    if idx >= 14 {
        let price_ll = ctx.bars[idx].low < ctx.bars[idx - 14].low;
        let mfi_hl = mfi > ctx.cache.mfi14[idx - 14];
        let price_hh = ctx.bars[idx].high > ctx.bars[idx - 14].high;
        let mfi_lh = mfi < ctx.cache.mfi14[idx - 14];
        if price_ll && mfi_hl { div_bull = true; }
        if price_hh && mfi_lh { div_bear = true; }
    }

    let strength = ((mfi - 50.0).abs() / 50.0).min(1.0);

    if div_bull {
        return (1, strength.max(0.5), json!({"mfi":mfi,"divergence":"bullish","slope":slope}));
    }
    if div_bear {
        return (-1, strength.max(0.5), json!({"mfi":mfi,"divergence":"bearish","slope":slope}));
    }
    if cross_up || (mfi > 50.0 && slope > 0.0) {
        (1, strength, json!({"mfi":mfi,"cross_up":cross_up,"slope":slope}))
    } else if cross_down || (mfi < 50.0 && slope < 0.0) {
        (-1, strength, json!({"mfi":mfi,"cross_down":cross_down,"slope":slope}))
    } else {
        (0, 0.0, json!({"mfi":mfi,"slope":slope}))
    }
}
