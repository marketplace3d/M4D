/// OHLCV bar — same shape as Binance kline response.
#[derive(Debug, Clone)]
pub struct Bar {
    pub time: i64,   // Unix seconds (open time)
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

impl Bar {
    pub fn typical_price(&self) -> f64 {
        (self.high + self.low + self.close) / 3.0
    }
}

// ---------------------------------------------------------------------------
// Indicator primitives
// ---------------------------------------------------------------------------

pub fn sma(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    let mut out = vec![f64::NAN; n];
    if period == 0 || n < period {
        return out;
    }
    let mut sum: f64 = values[..period].iter().sum();
    out[period - 1] = sum / period as f64;
    for i in period..n {
        sum += values[i] - values[i - period];
        out[i] = sum / period as f64;
    }
    out
}

/// EMA seeded with SMA at index `period-1`.
pub fn ema(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    let mut out = vec![f64::NAN; n];
    if period == 0 || n < period {
        return out;
    }
    let k = 2.0 / (period as f64 + 1.0);
    let sma = sma(values, period);
    let start = period - 1;
    out[start] = sma[start];
    for i in (start + 1)..n {
        out[i] = values[i] * k + out[i - 1] * (1.0 - k);
    }
    out
}

/// Wilder (RMA) smoothed ATR.
pub fn atr(bars: &[Bar], period: usize) -> Vec<f64> {
    let n = bars.len();
    let mut tr = vec![f64::NAN; n];
    if n == 0 {
        return tr;
    }
    tr[0] = bars[0].high - bars[0].low;
    for i in 1..n {
        let h = bars[i].high;
        let l = bars[i].low;
        let pc = bars[i - 1].close;
        tr[i] = (h - l).max((h - pc).abs()).max((l - pc).abs());
    }

    let mut out = vec![f64::NAN; n];
    if n <= period {
        return out;
    }
    let mut sum: f64 = tr[1..=period].iter().sum();
    out[period] = sum / period as f64;
    for i in (period + 1)..n {
        out[i] = (out[i - 1] * (period as f64 - 1.0) + tr[i]) / period as f64;
    }
    out
}

/// RSI(14) using Wilder smoothing.
pub fn rsi(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    let mut out = vec![f64::NAN; n];
    if n <= period {
        return out;
    }

    let mut gains = 0.0_f64;
    let mut losses = 0.0_f64;
    for i in 1..=period {
        let d = closes[i] - closes[i - 1];
        if d > 0.0 { gains += d; } else { losses += (-d); }
    }
    let mut avg_gain = gains / period as f64;
    let mut avg_loss = losses / period as f64;
    out[period] = if avg_loss < 1e-12 {
        100.0
    } else {
        100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    };

    for i in (period + 1)..n {
        let d = closes[i] - closes[i - 1];
        let g = if d > 0.0 { d } else { 0.0 };
        let l = if d < 0.0 { -d } else { 0.0 };
        avg_gain = (avg_gain * (period as f64 - 1.0) + g) / period as f64;
        avg_loss = (avg_loss * (period as f64 - 1.0) + l) / period as f64;
        out[i] = if avg_loss < 1e-12 {
            100.0
        } else {
            100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
        };
    }
    out
}

/// Simple rolling mean of volumes.
pub fn vol_ma(volumes: &[f64], period: usize) -> Vec<f64> {
    sma(volumes, period)
}

// ---------------------------------------------------------------------------
// Pre-computed indicator bundle shared across all algos for one asset.
// ---------------------------------------------------------------------------

pub struct Indicators {
    pub ema9:     Vec<f64>,
    pub ema21:    Vec<f64>,
    pub ema50:    Vec<f64>,
    pub ema12:    Vec<f64>,   // MACD fast
    pub ema26:    Vec<f64>,   // MACD slow
    pub macd:     Vec<f64>,   // ema12 - ema26
    pub macd_sig: Vec<f64>,   // EMA9 of macd
    pub sma20:    Vec<f64>,
    pub sma30:    Vec<f64>,
    pub sma50:    Vec<f64>,
    pub sma200:   Vec<f64>,
    pub bb_upper: Vec<f64>,   // SMA20 + 2σ
    pub bb_lower: Vec<f64>,   // SMA20 - 2σ
    pub rsi14:    Vec<f64>,
    pub atr14:    Vec<f64>,
    pub vol_ma20: Vec<f64>,
}

impl Indicators {
    pub fn build(bars: &[Bar]) -> Self {
        let n = bars.len();
        let closes:  Vec<f64> = bars.iter().map(|b| b.close).collect();
        let volumes: Vec<f64> = bars.iter().map(|b| b.volume).collect();

        let ema12 = ema(&closes, 12);
        let ema26 = ema(&closes, 26);
        let mut macd_line = vec![f64::NAN; n];
        for i in 0..n {
            if ema12[i].is_finite() && ema26[i].is_finite() {
                macd_line[i] = ema12[i] - ema26[i];
            }
        }
        let macd_sig = ema(&macd_line, 9);

        let sma20 = sma(&closes, 20);
        // Bollinger Bands: SMA20 ± 2 × rolling std
        let mut bb_upper = vec![f64::NAN; n];
        let mut bb_lower = vec![f64::NAN; n];
        for i in 19..n {
            let slice = &closes[(i + 1 - 20)..=i];
            let mean = slice.iter().sum::<f64>() / 20.0;
            let variance = slice.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / 20.0;
            let std = variance.sqrt();
            bb_upper[i] = mean + 2.0 * std;
            bb_lower[i] = mean - 2.0 * std;
        }

        Self {
            ema9:     ema(&closes, 9),
            ema21:    ema(&closes, 21),
            ema50:    ema(&closes, 50),
            ema12,
            ema26,
            macd:     macd_line,
            macd_sig,
            sma20,
            sma30:    sma(&closes, 30),
            sma50:    sma(&closes, 50),
            sma200:   sma(&closes, 200),
            bb_upper,
            bb_lower,
            rsi14:    rsi(&closes, 14),
            atr14:    atr(bars, 14),
            vol_ma20: vol_ma(&volumes, 20),
        }
    }

    /// Minimum bars before all indicators are valid.
    pub fn warmup() -> usize { 210 }
}
