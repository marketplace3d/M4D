//! Full 27-algo council — 3 banks × 9 + JEDI composite.
//!
//! Design rules:
//!   • Each algo: 1 signal family, max 2 conditions, fires in real markets
//!   • No state machines, no multi-phase detection
//!   • vote: +1 long, -1 short/bearish, 0 flat
//!   • strength: 0.0–1.0, used by JEDI weighting
//!
//! Bank A — BOOM  (breakout / expansion entry)
//! Bank B — TREND (structure / directional)
//! Bank C — LEGEND (legendary trader methods)

use crate::processor::{Bar, Indicators};

#[derive(Debug, Clone)]
pub struct Vote {
    pub algo_id: &'static str,
    pub vote: i8,
    pub strength: f64,
}

/// Run all 27 algos + JEDI at bar `idx`. Caller ensures idx >= Indicators::warmup().
pub fn run_all(bars: &[Bar], ind: &Indicators, idx: usize) -> Vec<Vote> {
    // Bank A — BOOM
    let don_bo    = eval_don_bo(bars, ind, idx);
    let bb_break  = eval_bb_break(bars, ind, idx);
    let vol_surge = eval_vol_surge(bars, ind, idx);
    let atr_exp   = eval_atr_exp(bars, ind, idx);
    let sqzpop    = eval_sqzpop(bars, ind, idx);
    let consol_bo = eval_consol_bo(bars, ind, idx);
    let gap_up    = eval_gap_up(bars, ind, idx);
    let new_high  = eval_new_high(bars, ind, idx);
    let range_bo  = eval_range_bo(bars, ind, idx);

    // Bank B — TREND
    let ema_cross  = eval_ema_cross(bars, ind, idx);
    let ema_stack  = eval_ema_stack(bars, ind, idx);
    let macd_cross = eval_macd_cross(ind, idx);
    let macd_zero  = eval_macd_zero(ind, idx);
    let golden     = eval_golden(ind, idx);
    let pullback   = eval_pullback(bars, ind, idx);
    let trend_sma  = eval_trend_sma(bars, ind, idx);
    let rsi_trend  = eval_rsi_trend(ind, idx);
    let ma_stack   = eval_ma_stack(ind, idx);

    // Bank C — LEGEND
    let se = eval_se(bars, ind, idx);       // Stockbee EP
    let wn = eval_wn(bars, ind, idx);       // Weinstein Stage 2
    let mm = eval_mm(bars, ind, idx);       // Minervini VCP
    let or_ = eval_or(bars, ind, idx);      // O'Neil breakout
    let rt = eval_rt(bars, ind, idx);       // Rayner 200MA pullback
    let rsi_cross = eval_rsi_cross(ind, idx); // RSI crosses 50
    let obv_rise  = eval_obv_rise(bars, idx); // OBV uptrend
    let consec    = eval_consec(bars, idx);   // 3+ consecutive up bars
    let mfi_bull  = eval_mfi(bars, ind, idx); // Money Flow

    let jedi = eval_jedi(&[
        &don_bo, &bb_break, &vol_surge, &atr_exp, &sqzpop, &consol_bo, &gap_up, &new_high, &range_bo,
        &ema_cross, &ema_stack, &macd_cross, &macd_zero, &golden, &pullback, &trend_sma, &rsi_trend, &ma_stack,
        &se, &wn, &mm, &or_, &rt, &rsi_cross, &obv_rise, &consec, &mfi_bull,
    ]);

    vec![
        don_bo, bb_break, vol_surge, atr_exp, sqzpop, consol_bo, gap_up, new_high, range_bo,
        ema_cross, ema_stack, macd_cross, macd_zero, golden, pullback, trend_sma, rsi_trend, ma_stack,
        se, wn, mm, or_, rt, rsi_cross, obv_rise, consec, mfi_bull,
        jedi,
    ]
}

// ═══════════════════════════════════════════════════════════════════════════════
// BANK A — BOOM  (breakout / expansion)
// ═══════════════════════════════════════════════════════════════════════════════

/// DON_BO — Donchian breakout: close above 20-bar high.
fn eval_don_bo(bars: &[Bar], _ind: &Indicators, idx: usize) -> Vote {
    let n = 20_usize;
    if idx < n { return flat("DON_BO"); }
    let highest = (idx - n..idx).map(|i| bars[i].high).fold(f64::NEG_INFINITY, f64::max);
    let lowest  = (idx - n..idx).map(|i| bars[i].low ).fold(f64::INFINITY,     f64::min);
    let c = bars[idx].close;
    if c > highest {
        let s = ((c - highest) / (highest - lowest + 1e-9)).min(1.0);
        Vote { algo_id: "DON_BO", vote: 1, strength: s.max(0.3) }
    } else if c < lowest {
        Vote { algo_id: "DON_BO", vote: -1, strength: 0.4 }
    } else {
        flat("DON_BO")
    }
}

/// BB_BREAK — Bollinger Band breakout: close exits bands.
fn eval_bb_break(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    let upper = ind.bb_upper[idx];
    let lower = ind.bb_lower[idx];
    if !upper.is_finite() { return flat("BB_BREAK"); }
    let c = bars[idx].close;
    let width = upper - lower;
    if c > upper {
        let s = ((c - upper) / (width + 1e-9)).min(1.0);
        Vote { algo_id: "BB_BREAK", vote: 1, strength: s.max(0.35) }
    } else if c < lower {
        let s = ((lower - c) / (width + 1e-9)).min(1.0);
        Vote { algo_id: "BB_BREAK", vote: -1, strength: s.max(0.35) }
    } else {
        flat("BB_BREAK")
    }
}

/// VOL_SURGE — Volume >2× avg + green bar = accumulation surge.
fn eval_vol_surge(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    if idx < 1 { return flat("VOL_SURGE"); }
    let va = ind.vol_ma20[idx];
    if !va.is_finite() { return flat("VOL_SURGE"); }
    let b = &bars[idx];
    let ratio = b.volume / va.max(1e-9);
    let green = b.close > b.open;
    let red   = b.close < b.open;
    if ratio > 2.0 && green {
        Vote { algo_id: "VOL_SURGE", vote: 1, strength: (ratio / 4.0).min(1.0) }
    } else if ratio > 2.0 && red {
        Vote { algo_id: "VOL_SURGE", vote: -1, strength: (ratio / 4.0).min(1.0) }
    } else {
        flat("VOL_SURGE")
    }
}

/// ATR_EXP — ATR today >1.5× ATR 5 bars ago = volatility expansion.
fn eval_atr_exp(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    if idx < 6 { return flat("ATR_EXP"); }
    let a_now  = ind.atr14[idx];
    let a_prev = ind.atr14[idx - 5];
    if !a_now.is_finite() || !a_prev.is_finite() || a_prev < 1e-9 { return flat("ATR_EXP"); }
    let ratio = a_now / a_prev;
    let b = &bars[idx];
    if ratio > 1.5 && b.close > b.open {
        Vote { algo_id: "ATR_EXP", vote: 1, strength: ((ratio - 1.5) / 1.5).min(1.0).max(0.3) }
    } else if ratio > 1.5 && b.close < b.open {
        Vote { algo_id: "ATR_EXP", vote: -1, strength: ((ratio - 1.5) / 1.5).min(1.0).max(0.3) }
    } else {
        flat("ATR_EXP")
    }
}

/// SQZPOP — TTM Squeeze: BB width narrows then expands + price up.
/// Squeeze = BB inner width < previous 20-bar avg BB width by 30%.
fn eval_sqzpop(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    let n = 20_usize;
    if idx < n + 5 { return flat("SQZPOP"); }
    let cur_width = ind.bb_upper[idx] - ind.bb_lower[idx];
    if !cur_width.is_finite() { return flat("SQZPOP"); }
    // Average BB width over last 20 bars
    let avg_width: f64 = (idx - n..idx)
        .filter_map(|i| {
            let w = ind.bb_upper[i] - ind.bb_lower[i];
            if w.is_finite() { Some(w) } else { None }
        })
        .sum::<f64>() / n as f64;
    // Squeeze was on (width contracted), now expanding
    let prev_width = ind.bb_upper[idx - 1] - ind.bb_lower[idx - 1];
    let was_squeezed = prev_width.is_finite() && prev_width < avg_width * 0.75;
    let expanding = cur_width > prev_width;
    let c = bars[idx].close;
    let mid = ind.sma20[idx];
    if was_squeezed && expanding && c > mid {
        Vote { algo_id: "SQZPOP", vote: 1, strength: 0.7 }
    } else if was_squeezed && expanding && c < mid {
        Vote { algo_id: "SQZPOP", vote: -1, strength: 0.7 }
    } else {
        flat("SQZPOP")
    }
}

/// CONSOL_BO — Consolidation breakout: 10 bars of low ATR then ATR expands + price up.
fn eval_consol_bo(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    let n = 10_usize;
    if idx < n + 2 { return flat("CONSOL_BO"); }
    let a_now = ind.atr14[idx];
    if !a_now.is_finite() { return flat("CONSOL_BO"); }
    // Low-ATR consolidation: all prior n bars had ATR < current ATR * 0.7
    let was_tight = (idx - n..idx).all(|i| {
        ind.atr14[i].is_finite() && ind.atr14[i] < a_now * 0.7
    });
    let b = &bars[idx];
    if was_tight && b.close > b.open {
        Vote { algo_id: "CONSOL_BO", vote: 1, strength: 0.6 }
    } else if was_tight && b.close < b.open {
        Vote { algo_id: "CONSOL_BO", vote: -1, strength: 0.5 }
    } else {
        flat("CONSOL_BO")
    }
}

/// GAP_UP — Open >1% above previous close + hold green.
fn eval_gap_up(bars: &[Bar], _ind: &Indicators, idx: usize) -> Vote {
    if idx < 1 { return flat("GAP_UP"); }
    let prev_close = bars[idx - 1].close;
    let b = &bars[idx];
    let gap = (b.open - prev_close) / prev_close.abs().max(1e-9);
    if gap > 0.01 && b.close > b.open {
        Vote { algo_id: "GAP_UP", vote: 1, strength: (gap * 20.0).min(1.0).max(0.3) }
    } else if gap < -0.01 && b.close < b.open {
        Vote { algo_id: "GAP_UP", vote: -1, strength: (gap.abs() * 20.0).min(1.0).max(0.3) }
    } else {
        flat("GAP_UP")
    }
}

/// NEW_HIGH — Close at 50-bar high (momentum/trend confirmation).
fn eval_new_high(bars: &[Bar], _ind: &Indicators, idx: usize) -> Vote {
    let n = 50_usize;
    if idx < n { return flat("NEW_HIGH"); }
    let highest = (idx - n..idx).map(|i| bars[i].close).fold(f64::NEG_INFINITY, f64::max);
    let lowest  = (idx - n..idx).map(|i| bars[i].close).fold(f64::INFINITY,     f64::min);
    let c = bars[idx].close;
    if c > highest {
        Vote { algo_id: "NEW_HIGH", vote: 1, strength: 0.65 }
    } else if c < lowest {
        Vote { algo_id: "NEW_HIGH", vote: -1, strength: 0.55 }
    } else {
        flat("NEW_HIGH")
    }
}

/// RANGE_BO — 15-bar range breakout: close above range top on up bar.
fn eval_range_bo(bars: &[Bar], _ind: &Indicators, idx: usize) -> Vote {
    let n = 15_usize;
    if idx < n + 1 { return flat("RANGE_BO"); }
    let range_high = (idx - n..idx).map(|i| bars[i].high).fold(f64::NEG_INFINITY, f64::max);
    let range_low  = (idx - n..idx).map(|i| bars[i].low ).fold(f64::INFINITY,     f64::min);
    let b = &bars[idx];
    if b.close > range_high && b.close > b.open {
        let s = ((b.close - range_high) / (range_high - range_low + 1e-9)).min(1.0).max(0.3);
        Vote { algo_id: "RANGE_BO", vote: 1, strength: s }
    } else if b.close < range_low && b.close < b.open {
        Vote { algo_id: "RANGE_BO", vote: -1, strength: 0.4 }
    } else {
        flat("RANGE_BO")
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BANK B — TREND  (structural / directional)
// ═══════════════════════════════════════════════════════════════════════════════

/// EMA_CROSS — EMA9 crosses above/below EMA21.
fn eval_ema_cross(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    if idx < 2 { return flat("EMA_CROSS"); }
    let e9  = ind.ema9[idx];  let e9p  = ind.ema9[idx - 1];
    let e21 = ind.ema21[idx]; let e21p = ind.ema21[idx - 1];
    if !e9.is_finite() || !e21.is_finite() { return flat("EMA_CROSS"); }
    let c = bars[idx].close;
    let bullish_cross = e9 > e21 && e9p <= e21p;
    let bearish_cross = e9 < e21 && e9p >= e21p;
    // Also score sustained alignment with close confirmation
    let sustained_bull = e9 > e21 && c > e9;
    let sustained_bear = e9 < e21 && c < e9;
    if bullish_cross || sustained_bull {
        let sep = ((e9 - e21) / e21.abs().max(1e-9)).min(0.1) / 0.1;
        Vote { algo_id: "EMA_CROSS", vote: 1, strength: if bullish_cross { 0.8 } else { sep.max(0.3) } }
    } else if bearish_cross || sustained_bear {
        Vote { algo_id: "EMA_CROSS", vote: -1, strength: if bearish_cross { 0.8 } else { 0.4 } }
    } else {
        flat("EMA_CROSS")
    }
}

/// EMA_STACK — EMA9 > EMA21 > EMA50: all three EMAs aligned = strong trend.
fn eval_ema_stack(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    let e9 = ind.ema9[idx]; let e21 = ind.ema21[idx]; let e50 = ind.ema50[idx];
    if !e9.is_finite() || !e21.is_finite() || !e50.is_finite() { return flat("EMA_STACK"); }
    let c = bars[idx].close;
    if e9 > e21 && e21 > e50 && c > e9 {
        let sep = ((e9 - e50) / e50.abs().max(1e-9)).min(0.1) / 0.1;
        Vote { algo_id: "EMA_STACK", vote: 1, strength: sep.max(0.5) }
    } else if e9 < e21 && e21 < e50 && c < e9 {
        Vote { algo_id: "EMA_STACK", vote: -1, strength: 0.6 }
    } else {
        flat("EMA_STACK")
    }
}

/// MACD_CROSS — MACD line crosses signal line.
fn eval_macd_cross(ind: &Indicators, idx: usize) -> Vote {
    if idx < 2 { return flat("MACD_CROSS"); }
    let m = ind.macd[idx];     let mp = ind.macd[idx - 1];
    let s = ind.macd_sig[idx]; let sp = ind.macd_sig[idx - 1];
    if !m.is_finite() || !s.is_finite() { return flat("MACD_CROSS"); }
    if m > s && mp <= sp {
        Vote { algo_id: "MACD_CROSS", vote: 1, strength: 0.75 }
    } else if m < s && mp >= sp {
        Vote { algo_id: "MACD_CROSS", vote: -1, strength: 0.75 }
    } else if m > s {
        Vote { algo_id: "MACD_CROSS", vote: 1, strength: 0.35 }
    } else if m < s {
        Vote { algo_id: "MACD_CROSS", vote: -1, strength: 0.35 }
    } else {
        flat("MACD_CROSS")
    }
}

/// MACD_ZERO — MACD line crosses zero (trend confirmation).
fn eval_macd_zero(ind: &Indicators, idx: usize) -> Vote {
    if idx < 2 { return flat("MACD_ZERO"); }
    let m  = ind.macd[idx];
    let mp = ind.macd[idx - 1];
    if !m.is_finite() || !mp.is_finite() { return flat("MACD_ZERO"); }
    if m > 0.0 && mp <= 0.0 {
        Vote { algo_id: "MACD_ZERO", vote: 1, strength: 0.8 }
    } else if m < 0.0 && mp >= 0.0 {
        Vote { algo_id: "MACD_ZERO", vote: -1, strength: 0.8 }
    } else if m > 0.0 {
        Vote { algo_id: "MACD_ZERO", vote: 1, strength: 0.3 }
    } else if m < 0.0 {
        Vote { algo_id: "MACD_ZERO", vote: -1, strength: 0.3 }
    } else {
        flat("MACD_ZERO")
    }
}

/// GOLDEN — SMA50 crosses above/below SMA200 (golden/death cross).
fn eval_golden(ind: &Indicators, idx: usize) -> Vote {
    if idx < 2 { return flat("GOLDEN"); }
    let s50  = ind.sma50[idx];   let s50p  = ind.sma50[idx - 1];
    let s200 = ind.sma200[idx];  let s200p = ind.sma200[idx - 1];
    if !s50.is_finite() || !s200.is_finite() { return flat("GOLDEN"); }
    if s50 > s200 && s50p <= s200p {
        Vote { algo_id: "GOLDEN", vote: 1, strength: 0.9 }  // fresh golden cross
    } else if s50 < s200 && s50p >= s200p {
        Vote { algo_id: "GOLDEN", vote: -1, strength: 0.9 } // fresh death cross
    } else if s50 > s200 {
        Vote { algo_id: "GOLDEN", vote: 1, strength: 0.4 }  // sustained bull
    } else if s50 < s200 {
        Vote { algo_id: "GOLDEN", vote: -1, strength: 0.4 } // sustained bear
    } else {
        flat("GOLDEN")
    }
}

/// PULLBACK — Price pulls back to EMA21 in an uptrend (EMA9>EMA21) then bounces.
fn eval_pullback(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    if idx < 3 { return flat("PULLBACK"); }
    let e9  = ind.ema9[idx];
    let e21 = ind.ema21[idx];
    if !e9.is_finite() || !e21.is_finite() { return flat("PULLBACK"); }
    let c = bars[idx].close;
    let low = bars[idx].low;
    let uptrend = e9 > e21;
    // Price dipped to within 2% of EMA21 then recovered above it
    let touched_21 = low <= e21 * 1.02;
    let above_21   = c > e21;
    let green      = c > bars[idx].open;
    if uptrend && touched_21 && above_21 && green {
        Vote { algo_id: "PULLBACK", vote: 1, strength: 0.65 }
    } else if !uptrend && !above_21 {
        Vote { algo_id: "PULLBACK", vote: -1, strength: 0.35 }
    } else {
        flat("PULLBACK")
    }
}

/// TREND_SMA — Price > rising SMA50 (clean directional trend filter).
fn eval_trend_sma(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    if idx < 5 { return flat("TREND_SMA"); }
    let s50 = ind.sma50[idx]; let s50p = ind.sma50[idx - 3];
    if !s50.is_finite() || !s50p.is_finite() { return flat("TREND_SMA"); }
    let c = bars[idx].close;
    if c > s50 && s50 > s50p {
        let dist = ((c - s50) / s50).min(0.1) / 0.1;
        Vote { algo_id: "TREND_SMA", vote: 1, strength: dist.max(0.3) }
    } else if c < s50 && s50 < s50p {
        Vote { algo_id: "TREND_SMA", vote: -1, strength: 0.4 }
    } else {
        flat("TREND_SMA")
    }
}

/// RSI_TREND — RSI14 sustained above/below 50 (directional bias filter).
fn eval_rsi_trend(ind: &Indicators, idx: usize) -> Vote {
    let r = ind.rsi14[idx];
    if !r.is_finite() { return flat("RSI_TREND"); }
    if r > 55.0 {
        Vote { algo_id: "RSI_TREND", vote: 1, strength: ((r - 55.0) / 45.0).min(1.0).max(0.2) }
    } else if r < 45.0 {
        Vote { algo_id: "RSI_TREND", vote: -1, strength: ((45.0 - r) / 45.0).min(1.0).max(0.2) }
    } else {
        flat("RSI_TREND")
    }
}

/// MA_STACK — SMA20 > SMA50 > SMA200: full regime alignment.
fn eval_ma_stack(ind: &Indicators, idx: usize) -> Vote {
    let s20 = ind.sma20[idx]; let s50 = ind.sma50[idx]; let s200 = ind.sma200[idx];
    if !s20.is_finite() || !s50.is_finite() || !s200.is_finite() { return flat("MA_STACK"); }
    if s20 > s50 && s50 > s200 {
        Vote { algo_id: "MA_STACK", vote: 1, strength: 0.7 }
    } else if s20 < s50 && s50 < s200 {
        Vote { algo_id: "MA_STACK", vote: -1, strength: 0.7 }
    } else {
        flat("MA_STACK")
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BANK C — LEGEND  (legendary trader methods)
// ═══════════════════════════════════════════════════════════════════════════════

/// SE — Stockbee Episodic Pivot: gap >2% + volume >3× avg.
fn eval_se(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    if idx < 21 { return flat("SE"); }
    let va = ind.vol_ma20[idx];
    if !va.is_finite() || va < 1.0 { return flat("SE"); }
    let prev = bars[idx - 1].close;
    let b = &bars[idx];
    let gap = (b.open - prev) / prev.abs().max(1e-9);
    let vr  = b.volume / va;
    if gap > 0.02 && vr > 3.0 {
        Vote { algo_id: "SE", vote: 1, strength: (gap * vr / 5.0).min(1.0).max(0.3) }
    } else if gap < -0.02 && vr > 3.0 {
        Vote { algo_id: "SE", vote: -1, strength: (gap.abs() * vr / 5.0).min(1.0).max(0.3) }
    } else {
        flat("SE")
    }
}

/// WN — Weinstein Stage 2: price > rising SMA30 + volume expansion.
fn eval_wn(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    if idx < 35 { return flat("WN"); }
    let ma = ind.sma30[idx]; let map = ind.sma30[idx - 3];
    let va = ind.vol_ma20[idx];
    if !ma.is_finite() || !map.is_finite() || !va.is_finite() { return flat("WN"); }
    let c = bars[idx].close;
    let vr = bars[idx].volume / va.max(1e-9);
    if c > ma && ma > map && vr > 1.5 {
        Vote { algo_id: "WN", vote: 1, strength: (vr / 3.0).min(1.0).max(0.3) }
    } else if c < ma && ma < map {
        Vote { algo_id: "WN", vote: -1, strength: 0.5 }
    } else {
        flat("WN")
    }
}

/// MM — Minervini VCP: 4-segment progressive range contraction + near pivot.
fn eval_mm(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    if idx < 60 { return flat("MM"); }
    let va = ind.vol_ma20[idx];
    if !va.is_finite() { return flat("MM"); }
    let n = 60_usize;
    let base = idx - n;
    let peak = (base..=idx).map(|i| bars[i].high).fold(f64::NEG_INFINITY, f64::max);
    let seg = n / 4;
    let mut segs: Vec<f64> = (0..4).map(|s| {
        let from = base + s * seg;
        let to = (from + seg).min(idx);
        let hi = (from..=to).map(|i| bars[i].high).fold(f64::NEG_INFINITY, f64::max);
        let lo = (from..=to).map(|i| bars[i].low ).fold(f64::INFINITY,     f64::min);
        hi - lo
    }).collect();
    let tight: u32 = (1..segs.len()).filter(|&i| segs[i] < segs[i-1] * 0.75).count() as u32;
    let c = bars[idx].close;
    let near = (peak - c) / peak.abs().max(1e-9) < 0.05;
    let vr = bars[idx].volume / va;
    if tight >= 2 && near && vr > 1.5 {
        Vote { algo_id: "MM", vote: 1, strength: (tight as f64 / 4.0).max(0.4) }
    } else {
        flat("MM")
    }
}

/// OR — O'Neil CAN SLIM: 60-bar pivot breakout + vol surge + RS + above SMA200.
fn eval_or(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    if idx < 210 { return flat("OR"); }
    let s200 = ind.sma200[idx]; let va = ind.vol_ma20[idx];
    if !s200.is_finite() || !va.is_finite() { return flat("OR"); }
    let c = bars[idx].close;
    let rs = (c - bars[idx - 50].close) / bars[idx - 50].close.abs().max(1e-9);
    let pivot = (idx.saturating_sub(60)..idx).map(|i| bars[i].high).fold(f64::NEG_INFINITY, f64::max);
    let vr = bars[idx].volume / va;
    if c > pivot && vr > 1.4 && rs > 0.05 && c > s200 {
        let s = (rs * 5.0).min(1.0) * (vr / 2.0).min(1.0);
        Vote { algo_id: "OR", vote: 1, strength: s.max(0.4) }
    } else if c < s200 && rs < -0.05 {
        Vote { algo_id: "OR", vote: -1, strength: 0.35 }
    } else {
        flat("OR")
    }
}

/// RT — Rayner 200MA pullback: price above SMA200, pulls to SMA50, bounces.
fn eval_rt(bars: &[Bar], ind: &Indicators, idx: usize) -> Vote {
    if idx < 210 { return flat("RT"); }
    let s200 = ind.sma200[idx]; let s200p = ind.sma200[idx - 20];
    let e50  = ind.ema50[idx];
    if !s200.is_finite() || !e50.is_finite() { return flat("RT"); }
    let c = bars[idx].close;
    let low = bars[idx].low;
    let slope_up = s200 > s200p;
    // Price near EMA50 (within 3%) in SMA200 uptrend
    let near_50 = (c - e50).abs() / e50.abs().max(1e-9) < 0.03;
    let above_200 = c > s200;
    let green = c > bars[idx].open;
    if slope_up && above_200 && near_50 && green {
        Vote { algo_id: "RT", vote: 1, strength: 0.65 }
    } else if !above_200 && !slope_up {
        Vote { algo_id: "RT", vote: -1, strength: 0.4 }
    } else {
        flat("RT")
    }
}

/// RSI_CROSS — RSI14 crosses 50 from below (momentum confirmation).
fn eval_rsi_cross(ind: &Indicators, idx: usize) -> Vote {
    if idx < 2 { return flat("RSI_CROSS"); }
    let r  = ind.rsi14[idx];
    let rp = ind.rsi14[idx - 1];
    if !r.is_finite() || !rp.is_finite() { return flat("RSI_CROSS"); }
    if r > 50.0 && rp <= 50.0 {
        Vote { algo_id: "RSI_CROSS", vote: 1, strength: 0.75 }
    } else if r < 50.0 && rp >= 50.0 {
        Vote { algo_id: "RSI_CROSS", vote: -1, strength: 0.75 }
    } else if r > 60.0 {
        Vote { algo_id: "RSI_CROSS", vote: 1, strength: ((r - 60.0) / 40.0).min(1.0) }
    } else if r < 40.0 {
        Vote { algo_id: "RSI_CROSS", vote: -1, strength: ((40.0 - r) / 40.0).min(1.0) }
    } else {
        flat("RSI_CROSS")
    }
}

/// OBV_RISE — On-Balance Volume uptrend: OBV rises over 10 bars.
fn eval_obv_rise(bars: &[Bar], idx: usize) -> Vote {
    let n = 10_usize;
    if idx < n + 1 { return flat("OBV_RISE"); }
    // Compute OBV from idx-n to idx
    let mut obv = 0.0_f64;
    let mut obvs: Vec<f64> = Vec::with_capacity(n + 1);
    for i in (idx - n)..=idx {
        if i == 0 { obvs.push(0.0); continue; }
        if bars[i].close > bars[i - 1].close { obv += bars[i].volume; }
        else if bars[i].close < bars[i - 1].close { obv -= bars[i].volume; }
        obvs.push(obv);
    }
    let first = obvs[0]; let last = *obvs.last().unwrap();
    let mid   = obvs[n / 2];
    // Rising OBV: last > mid > first
    if last > mid && mid > first {
        Vote { algo_id: "OBV_RISE", vote: 1, strength: 0.55 }
    } else if last < mid && mid < first {
        Vote { algo_id: "OBV_RISE", vote: -1, strength: 0.45 }
    } else {
        flat("OBV_RISE")
    }
}

/// CONSEC — 3+ consecutive up bars (momentum continuation).
fn eval_consec(bars: &[Bar], idx: usize) -> Vote {
    if idx < 4 { return flat("CONSEC"); }
    let up3   = (1..=3).all(|k| bars[idx - k + 1].close > bars[idx - k].close);
    let down3 = (1..=3).all(|k| bars[idx - k + 1].close < bars[idx - k].close);
    if up3 {
        Vote { algo_id: "CONSEC", vote: 1, strength: 0.5 }
    } else if down3 {
        Vote { algo_id: "CONSEC", vote: -1, strength: 0.5 }
    } else {
        flat("CONSEC")
    }
}

/// MFI — Money Flow: raw money flow direction over 14 bars.
/// MF = typical_price × volume. Positive MF = up days.
fn eval_mfi(bars: &[Bar], _ind: &Indicators, idx: usize) -> Vote {
    let n = 14_usize;
    if idx < n + 1 { return flat("MFI"); }
    let mut pos_mf = 0.0_f64;
    let mut neg_mf = 0.0_f64;
    for i in (idx - n + 1)..=idx {
        let tp = (bars[i].high + bars[i].low + bars[i].close) / 3.0;
        let tp_prev = (bars[i-1].high + bars[i-1].low + bars[i-1].close) / 3.0;
        let mf = tp * bars[i].volume;
        if tp > tp_prev { pos_mf += mf; } else { neg_mf += mf; }
    }
    let total = pos_mf + neg_mf;
    if total < 1e-9 { return flat("MFI"); }
    let mfi = 100.0 * pos_mf / total;
    if mfi > 60.0 {
        Vote { algo_id: "MFI", vote: 1, strength: ((mfi - 60.0) / 40.0).min(1.0).max(0.2) }
    } else if mfi < 40.0 {
        Vote { algo_id: "MFI", vote: -1, strength: ((40.0 - mfi) / 40.0).min(1.0).max(0.2) }
    } else {
        flat("MFI")
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// JEDI — composite of all 27 votes (equal weight, −27 to +27 → −1/0/+1)
// ═══════════════════════════════════════════════════════════════════════════════

fn eval_jedi(votes: &[&Vote]) -> Vote {
    let sum: i32 = votes.iter().map(|v| v.vote as i32).sum();
    let vote = if sum > 0 { 1 } else if sum < 0 { -1 } else { 0 };
    let strength = (sum.abs() as f64 / votes.len() as f64).min(1.0);
    Vote { algo_id: "JEDI", vote, strength }
}

// ── helper ────────────────────────────────────────────────────────────────────

#[inline]
fn flat(id: &'static str) -> Vote {
    Vote { algo_id: id, vote: 0, strength: 0.0 }
}
