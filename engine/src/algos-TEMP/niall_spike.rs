use serde_json::json;
use super::AlgoContext;

/// Bank A · NS — Niall Spike: OHLCV proxy for vol-delta explosion.
/// Without L2 data we approximate via (close-open) direction × volume vs 20-bar σ.
pub fn eval_ns(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 21 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let va = ctx.cache.vol_avg20[idx];
    if !va.is_finite() || va < 1.0 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let b = &ctx.bars[idx];
    let delta_proxy = (b.close - b.open) * b.volume;

    // Rolling mean and σ of delta_proxy over 20 bars
    let mut vals = Vec::with_capacity(20);
    for k in (idx - 19)..=idx {
        let bk = &ctx.bars[k];
        vals.push((bk.close - bk.open) * bk.volume);
    }
    let mean: f64 = vals.iter().sum::<f64>() / 20.0;
    let var: f64 = vals.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / 20.0;
    let sigma = var.sqrt();
    if sigma < 1e-12 {
        return (0, 0.0, json!({"reason":"no_variance"}));
    }

    let z = (delta_proxy - mean) / sigma;
    let strength = ((z.abs() - 2.5) / 2.5).max(0.0).min(1.0);

    if z > 2.5 {
        (1, strength, json!({"delta_sigma":z,"vol":b.volume,"vol_avg":va}))
    } else if z < -2.5 {
        (-1, strength, json!({"delta_sigma":z,"vol":b.volume,"vol_avg":va}))
    } else {
        (0, 0.0, json!({"delta_sigma":z}))
    }
}
