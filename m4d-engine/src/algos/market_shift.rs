use serde_json::json;
use super::AlgoContext;

/// Bank B · MS — Market Shift: CHoCH / BOS detector via swing structure.
pub fn eval_ms(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 10 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let va = ctx.cache.vol_avg20[idx];
    if !va.is_finite() { return (0, 0.0, json!({"reason":"warmup"})); }

    // Find recent swing highs/lows using 5-bar Williams fractals
    let mut swing_highs: Vec<(usize, f64)> = Vec::new();
    let mut swing_lows: Vec<(usize, f64)> = Vec::new();
    let start = if idx > 30 { idx - 30 } else { 2 };
    for k in (start + 2)..=(idx.saturating_sub(2)) {
        let h = ctx.bars[k].high;
        if h > ctx.bars[k-1].high && h > ctx.bars[k-2].high
            && h > ctx.bars[k+1.min(idx)].high && (k+2 > idx || h > ctx.bars[k+2].high) {
            swing_highs.push((k, h));
        }
        let l = ctx.bars[k].low;
        if l < ctx.bars[k-1].low && l < ctx.bars[k-2].low
            && l < ctx.bars[k+1.min(idx)].low && (k+2 > idx || l < ctx.bars[k+2].low) {
            swing_lows.push((k, l));
        }
    }

    if swing_highs.len() < 2 || swing_lows.len() < 2 {
        return (0, 0.0, json!({"swings":"insufficient"}));
    }

    let sh = &swing_highs;
    let sl = &swing_lows;
    let (_, last_sh) = sh[sh.len()-1];
    let (_, prev_sh) = sh[sh.len()-2];
    let (_, last_sl) = sl[sl.len()-1];
    let (_, prev_sl) = sl[sl.len()-2];

    let c = ctx.bars[idx].close;
    let vol_ratio = ctx.bars[idx].volume / va.max(1.0);

    // BOS: close beyond most recent swing high (bullish) or swing low (bearish)
    if c > last_sh && vol_ratio > 1.0 {
        let s = (vol_ratio / 3.0).min(1.0).max(0.3);
        return (1, s, json!({"bos":"bullish","swing_high":last_sh,"vol_ratio":vol_ratio}));
    }
    if c < last_sl && vol_ratio > 1.0 {
        let s = (vol_ratio / 3.0).min(1.0).max(0.3);
        return (-1, s, json!({"bos":"bearish","swing_low":last_sl,"vol_ratio":vol_ratio}));
    }

    // CHoCH: higher low in downtrend (bullish) or lower high in uptrend (bearish)
    let downtrend = last_sh < prev_sh && last_sl < prev_sl;
    let uptrend = last_sh > prev_sh && last_sl > prev_sl;
    if downtrend && last_sl > prev_sl {
        return (1, 0.4, json!({"choch":"bullish","last_sl":last_sl,"prev_sl":prev_sl}));
    }
    if uptrend && last_sh < prev_sh {
        return (-1, 0.4, json!({"choch":"bearish","last_sh":last_sh,"prev_sh":prev_sh}));
    }

    (0, 0.0, json!({"structure":"neutral","last_sh":last_sh,"last_sl":last_sl}))
}
