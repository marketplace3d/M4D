use serde_json::json;
use super::AlgoContext;

/// Bank C · TF — TTrades Fractal: MTF HH/HL alignment via 5/20/60-bar windows.
/// On daily input these correspond to ~weekly / ~monthly / ~quarterly structure.
/// Bar-window multi-timeframe analysis is standard quant practice.  OHLCV-native.
pub fn eval_tf(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 60 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    fn trend_score(bars: &[crate::bar::Bar], end: usize, lookback: usize) -> i8 {
        if end < lookback * 2 { return 0; }
        let recent_hi = (end - lookback..=end).map(|i| bars[i].high).fold(f64::NEG_INFINITY, f64::max);
        let recent_lo = (end - lookback..=end).map(|i| bars[i].low).fold(f64::INFINITY, f64::min);
        let prior_hi = (end - lookback * 2..end - lookback).map(|i| bars[i].high).fold(f64::NEG_INFINITY, f64::max);
        let prior_lo = (end - lookback * 2..end - lookback).map(|i| bars[i].low).fold(f64::INFINITY, f64::min);
        let hh = recent_hi > prior_hi;
        let hl = recent_lo > prior_lo;
        let lh = recent_hi < prior_hi;
        let ll = recent_lo < prior_lo;
        if hh && hl { 1 } else if lh && ll { -1 } else { 0 }
    }

    let d = trend_score(ctx.bars, idx, 5);   // "daily"
    let w = trend_score(ctx.bars, idx, 20);  // "weekly"
    let m = trend_score(ctx.bars, idx, 60);  // "monthly"
    let align = d + w + m;

    if align == 3 {
        (1, 0.8, json!({"daily":d,"weekly":w,"monthly":m,"mtf_align":3}))
    } else if align == -3 {
        (-1, 0.8, json!({"daily":d,"weekly":w,"monthly":m,"mtf_align":-3}))
    } else if align >= 2 {
        (1, 0.4, json!({"daily":d,"weekly":w,"monthly":m,"mtf_align":align}))
    } else if align <= -2 {
        (-1, 0.4, json!({"daily":d,"weekly":w,"monthly":m,"mtf_align":align}))
    } else {
        (0, 0.0, json!({"daily":d,"weekly":w,"monthly":m,"mtf_align":align}))
    }
}
