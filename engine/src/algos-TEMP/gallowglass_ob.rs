use serde_json::json;
use super::AlgoContext;

/// Bank A · GO — Gallowglass OB: 3× vol displacement candle creates OB, vote on 50% retrace.
pub fn eval_go(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 21 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let va = ctx.cache.vol_avg20[idx];
    if !va.is_finite() || va < 1.0 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    for lookback in 1..=20_usize {
        let ob_i = idx - lookback;
        let ob = &ctx.bars[ob_i];
        let disp_ratio = ob.volume / va;
        if disp_ratio < 3.0 { continue; }

        let bullish_ob = ob.close > ob.open;
        let ob_body_hi = ob.close.max(ob.open);
        let ob_body_lo = ob.close.min(ob.open);
        let ob_50 = (ob_body_hi + ob_body_lo) / 2.0;

        let mut mitigated = false;
        for k in (ob_i + 1)..idx {
            if bullish_ob && ctx.bars[k].low <= ob_50 { mitigated = true; break; }
            if !bullish_ob && ctx.bars[k].high >= ob_50 { mitigated = true; break; }
        }
        if mitigated { continue; }

        let c = ctx.bars[idx].close;
        let l = ctx.bars[idx].low;
        let h = ctx.bars[idx].high;

        if bullish_ob && l <= ob_50 && c > ob_50 {
            let s = (disp_ratio / 5.0).min(1.0);
            return (1, s, json!({"ob_bar":ob_i,"disp_ratio":disp_ratio,"ob_50":ob_50,"fresh":true}));
        }
        if !bullish_ob && h >= ob_50 && c < ob_50 {
            let s = (disp_ratio / 5.0).min(1.0);
            return (-1, s, json!({"ob_bar":ob_i,"disp_ratio":disp_ratio,"ob_50":ob_50,"fresh":true}));
        }
    }
    (0, 0.0, json!({"scan":"no_fresh_ob"}))
}
