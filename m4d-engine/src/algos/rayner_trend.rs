use serde_json::json;
use super::AlgoContext;

/// Bank C · RT — Rayner Trend: SMA(200) slope + EMA(50) pullback, 1:3 RR.
/// Needs ≥200 bars of daily data (standard for any swing system).  OHLCV-native.
pub fn eval_rt(ctx: &AlgoContext, idx: usize) -> (i8, f64, serde_json::Value) {
    if idx < 205 {
        return (0, 0.0, json!({"reason":"warmup"}));
    }
    let ma200 = ctx.cache.sma200[idx];
    let ma200_prev = ctx.cache.sma200[idx - 20];
    let e50 = ctx.cache.ema50[idx];
    let atr = ctx.cache.atr14[idx];
    if !ma200.is_finite() || !ma200_prev.is_finite() || !e50.is_finite() || !atr.is_finite() {
        return (0, 0.0, json!({"reason":"warmup"}));
    }

    let c = ctx.bars[idx].close;
    let slope_up = ma200 > ma200_prev;

    if !slope_up || c < ma200 {
        if c < ma200 && ma200 < ma200_prev {
            return (-1, 0.4, json!({"ma200":ma200,"slope":"down","below_200":true}));
        }
        return (0, 0.0, json!({"ma200":ma200,"slope":"flat_or_down"}));
    }

    // Pullback to 50 EMA: price within 2% of EMA50 after being 5%+ above
    let near_50 = (c - e50).abs() / e50.abs().max(1e-12) < 0.02;
    let was_extended = (0..10).any(|k| {
        let pk = ctx.bars[idx - 5 - k].close;
        (pk - e50) / e50.abs().max(1e-12) > 0.05
    });

    if near_50 && was_extended {
        // RR estimate: entry at 50EMA, stop below recent 10-bar low, target = 3× risk
        let recent_lo = (idx.saturating_sub(10)..=idx).map(|i| ctx.bars[i].low).fold(f64::INFINITY, f64::min);
        let risk = (e50 - recent_lo).abs().max(atr * 0.5);
        let target = e50 + 3.0 * risk;
        let rr = 3.0;
        let strength: f64 = (rr / 3.0_f64).min(1.0);
        return (1, strength, json!({"ma200":ma200,"ema50":e50,"pullback":true,"rr":rr,"target":target}));
    }

    (0, 0.0, json!({"ma200":ma200,"ema50":e50,"close":c}))
}
