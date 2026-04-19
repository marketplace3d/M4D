use serde_json::json;
use super::AlgoContext;

/// Bank C · CA — Casper IFVG: inverse FVG (filled gap recycled as draw target).
/// Scans 200-bar lookback for filled bullish/bearish FVGs — same bar window used
/// by IC for weekly-grade gaps.  Fully OHLCV-native on daily bars.
pub fn eval_ca(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
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
    let mut best_payload = json!({"scan":"no_ifvg"});

    for k in start..idx.saturating_sub(1) {
        let b1 = &ctx.bars[k];
        let b3 = &ctx.bars[k + 2];

        // Bullish FVG that was filled → becomes IFVG (bullish draw above)
        if b1.high < b3.low {
            let _top = b3.low;
            let bot = b1.high;
            let mut filled = false;
            for j in (k + 3)..=idx { if ctx.bars[j].low <= bot { filled = true; break; } }
            if filled && c < bot {
                let draw = (bot - c) / (3.0 * atr);
                if draw > 0.3 && draw < 5.0 {
                    let s = (draw / 3.0).min(1.0).max(0.2);
                    if s > best_strength {
                        best_vote = 1;
                        best_strength = s;
                        best_payload = json!({"ifvg":"bullish_draw","level":bot,"draw_atr":draw,"age":idx-k});
                    }
                }
            }
        }
        // Bearish FVG that was filled → bearish draw below
        if b1.low > b3.high {
            let top = b1.low;
            let _bot = b3.high;
            let mut filled = false;
            for j in (k + 3)..=idx { if ctx.bars[j].high >= top { filled = true; break; } }
            if filled && c > top {
                let draw = (c - top) / (3.0 * atr);
                if draw > 0.3 && draw < 5.0 {
                    let s = (draw / 3.0).min(1.0).max(0.2);
                    if s > best_strength {
                        best_vote = -1;
                        best_strength = s;
                        best_payload = json!({"ifvg":"bearish_draw","level":top,"draw_atr":draw,"age":idx-k});
                    }
                }
            }
        }
    }

    (best_vote, best_strength, best_payload)
}
