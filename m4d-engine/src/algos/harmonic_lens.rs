use serde_json::json;
use super::AlgoContext;

/// Bank B · HL — Harmonic Lens: detect Gartley/Bat PRZ from ZigZag swing points.
pub fn eval_hl(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 30 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let atr = ctx.cache.atr14[idx];
    if !atr.is_finite() || atr < 1e-12 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    // ZigZag: collect alternating swing H/L with min 3% swing
    let start = if idx > 120 { idx - 120 } else { 0 };
    let threshold = 0.03;
    let mut pivots: Vec<(usize, f64, bool)> = Vec::new(); // (idx, price, is_high)

    let mut last_h = ctx.bars[start].high;
    let mut last_l = ctx.bars[start].low;
    let mut last_hi = start;
    let mut last_li = start;
    let mut trend_up = true;

    for k in (start + 1)..=idx {
        let h = ctx.bars[k].high;
        let l = ctx.bars[k].low;
        if trend_up {
            if h > last_h { last_h = h; last_hi = k; }
            if l < last_h * (1.0 - threshold) {
                pivots.push((last_hi, last_h, true));
                trend_up = false;
                last_l = l; last_li = k;
            }
        } else {
            if l < last_l { last_l = l; last_li = k; }
            if h > last_l * (1.0 + threshold) {
                pivots.push((last_li, last_l, false));
                trend_up = true;
                last_h = h; last_hi = k;
            }
        }
    }

    if pivots.len() < 5 {
        return (0, 0.0, json!({"pivots":pivots.len()}));
    }

    // Check last 5 pivots for XABCD ratios
    let n = pivots.len();
    let x = pivots[n - 5].1;
    let a = pivots[n - 4].1;
    let b = pivots[n - 3].1;
    let c_p = pivots[n - 2].1;
    let d = pivots[n - 1].1;
    let x_is_low = !pivots[n - 5].2;

    let xa = (a - x).abs();
    if xa < 1e-12 { return (0, 0.0, json!({"reason":"flat_xa"})); }
    let ab_xa = (b - a).abs() / xa;
    let _bc_ab = if (b - a).abs() > 1e-12 { (c_p - b).abs() / (b - a).abs() } else { 0.0 };
    let ad_xa = (d - a).abs() / xa;

    let close = ctx.bars[idx].close;
    let dist_to_d = (close - d).abs() / atr;

    // Gartley: AB/XA≈0.618, AD/XA≈0.786
    let gartley = (ab_xa - 0.618).abs() < 0.1 && (ad_xa - 0.786).abs() < 0.1;
    // Bat: AB/XA≈0.382-0.5, AD/XA≈0.886
    let bat = ab_xa > 0.33 && ab_xa < 0.55 && (ad_xa - 0.886).abs() < 0.1;

    if (gartley || bat) && dist_to_d < 2.0 {
        let pattern = if gartley { "gartley" } else { "bat" };
        let accuracy = 1.0 - (if gartley { (ad_xa - 0.786).abs() } else { (ad_xa - 0.886).abs() }) / 0.1;
        let strength = accuracy.min(1.0).max(0.3);
        if x_is_low {
            return (1, strength, json!({"pattern":pattern,"ab_xa":ab_xa,"ad_xa":ad_xa,"d":d}));
        } else {
            return (-1, strength, json!({"pattern":pattern,"ab_xa":ab_xa,"ad_xa":ad_xa,"d":d}));
        }
    }

    (0, 0.0, json!({"pivots":pivots.len(),"ab_xa":ab_xa,"ad_xa":ad_xa}))
}
