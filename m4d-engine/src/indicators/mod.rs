mod series;
pub use series::{atr_wilder, bollinger, ema, sma, true_range};

use crate::bar::Bar;

/// Precomputed series shared by algos (index-aligned with `bars`).
#[derive(Clone, Debug)]
pub struct IndicatorCache {
    pub ema8: Vec<f64>,
    pub ema21: Vec<f64>,
    pub ema34: Vec<f64>,
    pub ema55: Vec<f64>,
    pub ema89: Vec<f64>,
    pub ema50: Vec<f64>,
    pub sma200: Vec<f64>,
    pub sma30: Vec<f64>,
    pub atr14: Vec<f64>,
    /// Bollinger basis & bands, length 20, 2σ
    pub bb_basis: Vec<f64>,
    pub bb_upper: Vec<f64>,
    pub bb_lower: Vec<f64>,
    /// Keltner: EMA(tp,20) ± 1.5×ATR(20)  (used by BQ)
    pub kc_mid: Vec<f64>,
    pub kc_upper: Vec<f64>,
    pub kc_lower: Vec<f64>,
    /// Keltner breakout band: EMA(20) ± 2×ATR(10) (used by VK)
    pub kc2_upper: Vec<f64>,
    pub kc2_lower: Vec<f64>,
    /// MFI(14) — Money Flow Index  (0–100)
    pub mfi14: Vec<f64>,
    /// 20-bar rolling average volume
    pub vol_avg20: Vec<f64>,
    /// Highest-high / lowest-low over last 20 bars (for momentum histogram)
    pub hh20: Vec<f64>,
    pub ll20: Vec<f64>,
}

impl IndicatorCache {
    pub fn warmup() -> usize {
        30
    }

    pub fn build(bars: &[Bar]) -> Self {
        let n = bars.len();
        let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();
        let highs: Vec<f64> = bars.iter().map(|b| b.high).collect();
        let lows: Vec<f64> = bars.iter().map(|b| b.low).collect();
        let volumes: Vec<f64> = bars.iter().map(|b| b.volume).collect();
        let typical: Vec<f64> = bars.iter().map(|b| b.typical_price()).collect();

        let ema8 = ema(&closes, 8);
        let ema21 = ema(&closes, 21);
        let ema34 = ema(&closes, 34);
        let ema55 = ema(&closes, 55);
        let ema89 = ema(&closes, 89);
        let ema50 = ema(&closes, 50);
        let sma200 = sma(&closes, 200);
        let sma30 = sma(&closes, 30);

        let tr = true_range(bars);
        let atr14 = atr_wilder(&tr, 14);
        let atr10 = atr_wilder(&tr, 10);

        let (bb_basis, bb_upper, bb_lower) = bollinger(&closes, 20, 2.0);

        let kc_mid_raw = ema(&typical, 20);
        let atr20 = atr_wilder(&tr, 20);
        let kc_upper: Vec<f64> = kc_mid_raw.iter().zip(atr20.iter()).map(|(m, a)| m + 1.5 * a).collect();
        let kc_lower: Vec<f64> = kc_mid_raw.iter().zip(atr20.iter()).map(|(m, a)| m - 1.5 * a).collect();

        let ema20c = ema(&closes, 20);
        let kc2_upper: Vec<f64> = ema20c.iter().zip(atr10.iter()).map(|(m, a)| m + 2.0 * a).collect();
        let kc2_lower: Vec<f64> = ema20c.iter().zip(atr10.iter()).map(|(m, a)| m - 2.0 * a).collect();

        let mfi14 = compute_mfi(&typical, &volumes, 14, n);
        let vol_avg20 = rolling_mean(&volumes, 20);

        let hh20 = rolling_extreme(&highs, 20, true);
        let ll20 = rolling_extreme(&lows, 20, false);

        Self {
            ema8, ema21, ema34, ema55, ema89, ema50, sma200, sma30,
            atr14,
            bb_basis, bb_upper, bb_lower,
            kc_mid: kc_mid_raw, kc_upper, kc_lower,
            kc2_upper, kc2_lower,
            mfi14,
            vol_avg20,
            hh20, ll20,
        }
    }
}

pub use IndicatorCache as Cache;

fn compute_mfi(typical: &[f64], volume: &[f64], period: usize, n: usize) -> Vec<f64> {
    let mut out = vec![f64::NAN; n];
    if n < period + 1 { return out; }
    for i in period..n {
        let mut pos_flow = 0.0;
        let mut neg_flow = 0.0;
        for j in (i + 1 - period)..=i {
            let mf = typical[j] * volume[j];
            if j > 0 && typical[j] > typical[j - 1] {
                pos_flow += mf;
            } else if j > 0 && typical[j] < typical[j - 1] {
                neg_flow += mf;
            }
        }
        if neg_flow < 1e-12 {
            out[i] = 100.0;
        } else {
            let ratio = pos_flow / neg_flow;
            out[i] = 100.0 - (100.0 / (1.0 + ratio));
        }
    }
    out
}

fn rolling_mean(v: &[f64], period: usize) -> Vec<f64> {
    let n = v.len();
    let mut out = vec![f64::NAN; n];
    if period == 0 || n < period { return out; }
    let mut s: f64 = v[..period].iter().sum();
    out[period - 1] = s / period as f64;
    for i in period..n {
        s += v[i] - v[i - period];
        out[i] = s / period as f64;
    }
    out
}

fn rolling_extreme(v: &[f64], period: usize, is_max: bool) -> Vec<f64> {
    let n = v.len();
    let mut out = vec![f64::NAN; n];
    if period == 0 || n < period { return out; }
    for i in (period - 1)..n {
        let slice = &v[(i + 1 - period)..=i];
        out[i] = if is_max {
            slice.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
        } else {
            slice.iter().cloned().fold(f64::INFINITY, f64::min)
        };
    }
    out
}
