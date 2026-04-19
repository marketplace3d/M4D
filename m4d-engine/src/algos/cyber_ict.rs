use serde_json::json;
use super::AlgoContext;

/// Bank A · CI — Cyber-ICT: auto-detect OB and FVG zones, vote when price tests them.
pub fn eval_ci(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 5 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let atr = ctx.cache.atr14[idx];
    if !atr.is_finite() || atr < 1e-12 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let c = ctx.bars[idx].close;

    // Scan for FVGs in last 20 bars
    let start = if idx > 22 { idx - 22 } else { 2 };
    let mut best_vote: i8 = 0;
    let mut best_strength = 0.0_f64;
    let mut best_payload = json!({"scan":"no_fvg"});

    for k in start..idx.saturating_sub(1) {
        let b1 = &ctx.bars[k];
        let b3 = &ctx.bars[k + 2];

        // Bullish FVG: candle 1 high < candle 3 low
        if b1.high < b3.low {
            let gap_top = b3.low;
            let gap_bot = b1.high;
            let freshness = 1.0 / (1.0 + (idx - k) as f64);
            if c >= gap_bot && c <= gap_top {
                let s = (freshness * 5.0).min(1.0).max(0.3);
                if s > best_strength {
                    best_vote = 1;
                    best_strength = s;
                    best_payload = json!({"fvg":"bullish","gap_top":gap_top,"gap_bot":gap_bot,"age":idx-k,"freshness":freshness});
                }
            }
        }
        // Bearish FVG: candle 1 low > candle 3 high
        if b1.low > b3.high {
            let gap_top = b1.low;
            let gap_bot = b3.high;
            let freshness = 1.0 / (1.0 + (idx - k) as f64);
            if c >= gap_bot && c <= gap_top {
                let s = (freshness * 5.0).min(1.0).max(0.3);
                if s > best_strength {
                    best_vote = -1;
                    best_strength = s;
                    best_payload = json!({"fvg":"bearish","gap_top":gap_top,"gap_bot":gap_bot,"age":idx-k,"freshness":freshness});
                }
            }
        }
    }

    // OB scan: candle where next 3 bars move away strongly (≥2× ATR body)
    if best_vote == 0 {
        for k in start..idx.saturating_sub(3) {
            let ob = &ctx.bars[k];
            let body = (ob.close - ob.open).abs();
            if body < 2.0 * atr { continue; }
            let bull_ob = ob.close > ob.open;
            let ob_lo = ob.close.min(ob.open);
            let ob_hi = ob.close.max(ob.open);
            if bull_ob && c >= ob_lo && c <= ob_hi {
                best_vote = 1;
                best_strength = 0.4;
                best_payload = json!({"ob":"bullish","ob_hi":ob_hi,"ob_lo":ob_lo,"age":idx-k});
                break;
            }
            if !bull_ob && c >= ob_lo && c <= ob_hi {
                best_vote = -1;
                best_strength = 0.4;
                best_payload = json!({"ob":"bearish","ob_hi":ob_hi,"ob_lo":ob_lo,"age":idx-k});
                break;
            }
        }
    }

    (best_vote, best_strength, best_payload)
}
