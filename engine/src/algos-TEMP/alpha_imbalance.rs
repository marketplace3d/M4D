use serde_json::json;
use super::AlgoContext;

/// Bank B · AI — Alpha Imbalance: FVG fill probability engine.
/// Catalogs unfilled FVGs by age, proximity, and volume, then votes on dominant direction.
pub fn eval_ai(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 5 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let atr = ctx.cache.atr14[idx];
    if !atr.is_finite() || atr < 1e-12 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let c = ctx.bars[idx].close;
    let start = if idx > 102 { idx - 102 } else { 2 };

    struct Fvg { bullish: bool, top: f64, bot: f64, age: usize, vol_ratio: f64 }
    let mut fvgs: Vec<Fvg> = Vec::new();

    let va = ctx.cache.vol_avg20[idx];
    let va_safe = if va.is_finite() && va > 1.0 { va } else { 1.0 };

    for k in start..idx.saturating_sub(1) {
        let b1 = &ctx.bars[k];
        let b3 = &ctx.bars[k + 2];
        let vol_at = ctx.bars[k + 1].volume / va_safe;

        if b1.high < b3.low {
            let top = b3.low;
            let bot = b1.high;
            let mut filled = false;
            for j in (k+3)..=idx { if ctx.bars[j].low <= bot { filled = true; break; } }
            if !filled {
                fvgs.push(Fvg { bullish: true, top, bot, age: idx - k, vol_ratio: vol_at });
            }
        }
        if b1.low > b3.high {
            let top = b1.low;
            let bot = b3.high;
            let mut filled = false;
            for j in (k+3)..=idx { if ctx.bars[j].high >= top { filled = true; break; } }
            if !filled {
                fvgs.push(Fvg { bullish: false, top, bot, age: idx - k, vol_ratio: vol_at });
            }
        }
    }

    if fvgs.is_empty() {
        return (0, 0.0, json!({"fvg_count":0}));
    }

    // Score each FVG
    let mut scored: Vec<(f64, bool)> = fvgs.iter().map(|f| {
        let freshness = 1.0 / (1.0 + f.age as f64);
        let dist = ((c - (f.top + f.bot) / 2.0).abs()) / (3.0 * atr);
        let proximity = (1.0 - dist).max(0.0);
        let score = freshness * f.vol_ratio * proximity;
        (score, f.bullish)
    }).collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());

    let top3: Vec<&(f64, bool)> = scored.iter().take(3).collect();
    let bull_count = top3.iter().filter(|x| x.1).count();
    let bear_count = top3.iter().filter(|x| !x.1).count();
    let avg_score: f64 = top3.iter().map(|x| x.0).sum::<f64>() / top3.len() as f64;
    let strength = avg_score.min(1.0);

    if bull_count > bear_count {
        (1, strength, json!({"fvg_count":fvgs.len(),"top3_bull":bull_count,"avg_score":avg_score}))
    } else if bear_count > bull_count {
        (-1, strength, json!({"fvg_count":fvgs.len(),"top3_bear":bear_count,"avg_score":avg_score}))
    } else {
        (0, 0.0, json!({"fvg_count":fvgs.len(),"mixed":true}))
    }
}
