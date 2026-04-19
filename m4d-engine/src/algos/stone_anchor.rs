use serde_json::json;
use super::AlgoContext;

/// Bank A · SA — Stone Anchor: OHLCV volume profile (VPOC / VAH / VAL).
/// Builds a 40-bin volume profile from the last 30 bars, distributing each bar's
/// volume proportionally across every bin its H-L range touches.  This is the same
/// technique used by Market Profile from daily data — no tick data required.
pub fn eval_sa(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 30 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let window = &ctx.bars[(idx - 29)..=idx];
    let lo = window.iter().map(|b| b.low).fold(f64::INFINITY, f64::min);
    let hi = window.iter().map(|b| b.high).fold(f64::NEG_INFINITY, f64::max);
    if (hi - lo) < 1e-12 {
        return (0, 0.0, json!({"reason":"flat_range"}));
    }

    const BINS: usize = 40;
    let step = (hi - lo) / BINS as f64;
    let mut profile = [0.0_f64; BINS];

    for b in window {
        let b_lo = ((b.low - lo) / step).floor().max(0.0) as usize;
        let b_hi = ((b.high - lo) / step).floor() as usize;
        let b_hi = b_hi.min(BINS - 1);
        let span = (b_hi - b_lo + 1).max(1) as f64;
        let vol_per_bin = b.volume / span;
        for bin in b_lo..=b_hi {
            profile[bin] += vol_per_bin;
        }
    }

    let vpoc_bin = profile.iter().enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap()).unwrap().0;
    let vpoc = lo + (vpoc_bin as f64 + 0.5) * step;

    // Value Area: 70% of total volume centred on VPOC
    let total_vol: f64 = profile.iter().sum();
    let target_vol = total_vol * 0.70;
    let mut va_lo = vpoc_bin;
    let mut va_hi = vpoc_bin;
    let mut cum = profile[vpoc_bin];
    while cum < target_vol && (va_lo > 0 || va_hi < BINS - 1) {
        let add_lo = if va_lo > 0 { profile[va_lo - 1] } else { 0.0 };
        let add_hi = if va_hi < BINS - 1 { profile[va_hi + 1] } else { 0.0 };
        if add_lo >= add_hi && va_lo > 0 {
            va_lo -= 1;
            cum += profile[va_lo];
        } else if va_hi < BINS - 1 {
            va_hi += 1;
            cum += profile[va_hi];
        } else {
            break;
        }
    }
    let val = lo + va_lo as f64 * step;
    let vah = lo + (va_hi as f64 + 1.0) * step;

    // VPOC slope: compare current VPOC to one 15 bars ago
    let mut vpoc_prev = vpoc;
    if idx >= 45 {
        let pw = &ctx.bars[(idx - 44)..=(idx - 15)];
        let plo = pw.iter().map(|b| b.low).fold(f64::INFINITY, f64::min);
        let phi = pw.iter().map(|b| b.high).fold(f64::NEG_INFINITY, f64::max);
        if (phi - plo) > 1e-12 {
            let ps = (phi - plo) / BINS as f64;
            let mut pp = [0.0_f64; BINS];
            for b in pw {
                let bl = ((b.low - plo) / ps).floor().max(0.0) as usize;
                let bh = ((b.high - plo) / ps).floor().min((BINS - 1) as f64) as usize;
                let sp = (bh - bl + 1).max(1) as f64;
                for bi in bl..=bh { pp[bi.min(BINS - 1)] += b.volume / sp; }
            }
            let pbin = pp.iter().enumerate()
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap()).unwrap().0;
            vpoc_prev = plo + (pbin as f64 + 0.5) * ps;
        }
    }
    let slope_up = vpoc > vpoc_prev;

    let c = ctx.bars[idx].close;
    let near_val = c < val + step;
    let near_vah = c > vah - step;
    let strength = (1.0 - (c - vpoc).abs() / (vah - val).max(1e-12)).max(0.0).min(1.0);

    if near_val && slope_up {
        (1, strength, json!({"vpoc":vpoc,"vah":vah,"val":val,"slope":"up","bins":BINS}))
    } else if near_vah && !slope_up {
        (-1, strength, json!({"vpoc":vpoc,"vah":vah,"val":val,"slope":"down","bins":BINS}))
    } else {
        (0, 0.0, json!({"vpoc":vpoc,"vah":vah,"val":val}))
    }
}
