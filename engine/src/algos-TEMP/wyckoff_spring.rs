use serde_json::json;
use super::AlgoContext;

/// Bank B · WS — Wyckoff Spring: accumulation/distribution phase detection.
/// Looks for SC→AR→ST→Spring pattern using volume + price structure.
pub fn eval_ws(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 40 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let va = ctx.cache.vol_avg20[idx];
    if !va.is_finite() || va < 1.0 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let window = 40_usize;
    let start = idx - window;

    // Find selling climax (SC): sharpest high-volume drop
    let mut sc_idx = start;
    let mut sc_score = 0.0_f64;
    for k in start..idx {
        let drop = ctx.bars[k].open - ctx.bars[k].close;
        let vol_r = ctx.bars[k].volume / va;
        if drop > 0.0 && vol_r > 1.5 {
            let score = drop * vol_r;
            if score > sc_score { sc_score = score; sc_idx = k; }
        }
    }
    if sc_score == 0.0 {
        return (0, 0.0, json!({"phase":"no_sc"}));
    }
    let sc_low = ctx.bars[sc_idx].low;

    // Automatic rally (AR): first strong bounce after SC
    let mut ar_high = sc_low;
    for k in (sc_idx + 1)..=idx.min(sc_idx + 10) {
        if ctx.bars[k].high > ar_high { ar_high = ctx.bars[k].high; }
    }
    if ar_high <= sc_low {
        return (0, 0.0, json!({"phase":"no_ar"}));
    }

    // Secondary test (ST): retest near SC low on lower volume
    let mut st_found = false;
    let mut st_low = f64::MAX;
    for k in (sc_idx + 5)..=idx {
        let b = &ctx.bars[k];
        if b.low < sc_low * 1.02 && b.low > sc_low * 0.98 && b.volume < ctx.bars[sc_idx].volume * 0.8 {
            st_found = true;
            if b.low < st_low { st_low = b.low; }
        }
    }

    // Spring: brief dip below ST/SC low on very low volume
    let c = ctx.bars[idx].close;
    let l = ctx.bars[idx].low;
    let vol_r = ctx.bars[idx].volume / va;

    if st_found && l < sc_low && vol_r < 0.7 && c > sc_low {
        let conf = if st_found { 70.0 } else { 40.0 };
        let strength = (conf / 100.0_f64).min(1.0);
        return (1, strength, json!({"phase":"spring","sc_low":sc_low,"ar_high":ar_high,"vol_ratio":vol_r}));
    }

    // LPS (Last Point of Support): higher low on low volume after spring
    if st_found && l > sc_low && vol_r < 0.8 {
        return (1, 0.4, json!({"phase":"lps","sc_low":sc_low,"low":l,"vol_ratio":vol_r}));
    }

    // Distribution mirror: buying climax detection
    let mut bc_idx = start;
    let mut bc_score = 0.0_f64;
    for k in start..idx {
        let rise = ctx.bars[k].close - ctx.bars[k].open;
        let vol_r2 = ctx.bars[k].volume / va;
        if rise > 0.0 && vol_r2 > 1.5 {
            let score = rise * vol_r2;
            if score > bc_score { bc_score = score; bc_idx = k; }
        }
    }
    if bc_score > 0.0 {
        let bc_high = ctx.bars[bc_idx].high;
        if ctx.bars[idx].high > bc_high && vol_r < 0.7 && c < bc_high {
            return (-1, 0.6, json!({"phase":"upthrust","bc_high":bc_high,"vol_ratio":vol_r}));
        }
    }

    (0, 0.0, json!({"phase":"ranging","sc_low":sc_low}))
}
