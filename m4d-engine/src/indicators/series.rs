use crate::bar::Bar;

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

/// Standard EMA with SMA seed for first `period-1` bars, EMA starts at index `period-1`.
pub fn ema(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    let mut out = vec![f64::NAN; n];
    if period == 0 || n == 0 {
        return out;
    }
    let k = 2.0 / (period as f64 + 1.0);
    let sma_v = sma(values, period);
    let start = period - 1;
    if start >= n || !sma_v[start].is_finite() {
        return out;
    }
    out[start] = sma_v[start];
    for i in (start + 1)..n {
        out[i] = values[i] * k + out[i - 1] * (1.0 - k);
    }
    out
}

pub fn true_range(bars: &[Bar]) -> Vec<f64> {
    let mut tr = vec![f64::NAN; bars.len()];
    if bars.is_empty() {
        return tr;
    }
    tr[0] = bars[0].high - bars[0].low;
    for i in 1..bars.len() {
        let h = bars[i].high;
        let l = bars[i].low;
        let pc = bars[i - 1].close;
        tr[i] = (h - l)
            .max((h - pc).abs())
            .max((l - pc).abs());
    }
    tr
}

pub fn atr_wilder(tr: &[f64], period: usize) -> Vec<f64> {
    let n = tr.len();
    let mut out = vec![f64::NAN; n];
    if period == 0 || n <= period {
        return out;
    }
    let mut sum = 0.0;
    for i in 1..=period {
        sum += tr[i];
    }
    out[period] = sum / period as f64;
    for i in (period + 1)..n {
        out[i] = (out[i - 1] * (period as f64 - 1.0) + tr[i]) / period as f64;
    }
    out
}

pub fn bollinger(closes: &[f64], len: usize, nstd: f64) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let n = closes.len();
    let basis = sma(closes, len);
    let mut upper = vec![f64::NAN; n];
    let mut lower = vec![f64::NAN; n];
    if n < len {
        return (basis, upper, lower);
    }
    for i in (len - 1)..n {
        let slice = &closes[(i + 1 - len)..=i];
        let m = basis[i];
        if !m.is_finite() {
            continue;
        }
        let var = slice.iter().map(|x| (x - m).powi(2)).sum::<f64>() / len as f64;
        let sd = var.sqrt();
        upper[i] = m + nstd * sd;
        lower[i] = m - nstd * sd;
    }
    (basis, upper, lower)
}

