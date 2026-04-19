use serde_json::json;
use super::AlgoContext;

/// Bank C · IC — ICT Weekly FVG: virgin FVG draw on extended lookback (200 bars).
/// On daily input, a 200-bar scan covers ~40 trading weeks — sufficient for
/// weekly-grade FVGs without resampling.  Fully OHLCV-native on daily bars.
pub fn eval_ic(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 10 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let atr = ctx.cache.atr14[idx];
    if !atr.is_finite() || atr < 1e-12 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let c = ctx.bars[idx].close;
    let start = if idx > 200 { idx - 200 } else { 2 };

    let mut best_vote: i8 = 0;
    let mut best_strength = 0.0_f64;
    let mut best_payload = json!({"scan":"no_virgin_fvg"});

    for k in start..idx.saturating_sub(1) {
        let b1 = &ctx.bars[k];
        let b3 = &ctx.bars[k + 2];

        // Bullish FVG
        if b1.high < b3.low {
            let top = b3.low;
            let bot = b1.high;
            let mut virgin = true;
            for j in (k + 3)..=idx { if ctx.bars[j].low <= bot { virgin = false; break; } }
            if virgin && c < bot {
                let draw_pct = (bot - c) / c.abs().max(1e-12);
                let s = (draw_pct * 20.0).min(1.0).max(0.2);
                if s > best_strength {
                    best_vote = 1;
                    best_strength = s;
                    best_payload = json!({"virgin_fvg":"bullish","top":top,"bot":bot,"draw_pct":draw_pct,"age":idx-k});
                }
            }
        }
        // Bearish FVG
        if b1.low > b3.high {
            let top = b1.low;
            let bot = b3.high;
            let mut virgin = true;
            for j in (k + 3)..=idx { if ctx.bars[j].high >= top { virgin = false; break; } }
            if virgin && c > top {
                let draw_pct = (c - top) / c.abs().max(1e-12);
                let s = (draw_pct * 20.0).min(1.0).max(0.2);
                if s > best_strength {
                    best_vote = -1;
                    best_strength = s;
                    best_payload = json!({"virgin_fvg":"bearish","top":top,"bot":bot,"draw_pct":draw_pct,"age":idx-k});
                }
            }
        }
    }

    (best_vote, best_strength, best_payload)
}
