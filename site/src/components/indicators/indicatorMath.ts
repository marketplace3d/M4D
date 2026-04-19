/** Indicator math ported from M4D-REF boom3d-tech.ts */

export interface Bar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export function sma(values: number[], period: number): number[] {
  const n = values.length
  const out = new Array<number>(n).fill(NaN)
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += values[i]!
    if (i >= period) sum -= values[i - period]!
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export function ema(values: number[], period: number): number[] {
  const n = values.length
  const out = new Array<number>(n).fill(NaN)
  const k = 2 / (period + 1)
  let prev = values[0]!
  out[0] = prev
  for (let i = 1; i < n; i++) {
    prev = (values[i]! - prev) * k + prev
    out[i] = prev
  }
  return out
}

function rollingStddev(values: number[], period: number): number[] {
  const n = values.length
  const out = new Array<number>(n).fill(NaN)
  for (let i = period - 1; i < n; i++) {
    let s = 0
    for (let j = i - period + 1; j <= i; j++) s += values[j]!
    const mean = s / period
    let acc = 0
    for (let j = i - period + 1; j <= i; j++) acc += (values[j]! - mean) ** 2
    out[i] = Math.sqrt(acc / (period - 1))
  }
  return out
}

function trueRange(high: number[], low: number[], close: number[]): number[] {
  const n = high.length
  const tr = new Array<number>(n)
  tr[0] = high[0]! - low[0]!
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      high[i]! - low[i]!,
      Math.abs(high[i]! - close[i - 1]!),
      Math.abs(low[i]! - close[i - 1]!),
    )
  }
  return tr
}

export interface BandResult { upper: number[]; lower: number[] }

/** Bollinger Bands: SMA20 ± mult×σ (mult2=2.25 matches M4D-REF default) */
export function computeBB(closes: number[], period = 20, mult = 2.25): BandResult {
  const basis = sma(closes, period)
  const dev = rollingStddev(closes, period)
  return {
    upper: basis.map((b, i) => isFinite(b) && isFinite(dev[i]!) ? b + dev[i]! * mult : NaN),
    lower: basis.map((b, i) => isFinite(b) && isFinite(dev[i]!) ? b - dev[i]! * mult : NaN),
  }
}

/** Keltner Channel: EMA20 ± mult×ATR (for squeeze detection) */
export function computeKC(high: number[], low: number[], close: number[], period = 20, mult = 2.0): BandResult {
  const tr = trueRange(high, low, close)
  const rangema = ema(tr, period)
  const basis = ema(close, period)
  return {
    upper: basis.map((b, i) => isFinite(b) && isFinite(rangema[i]!) ? b + rangema[i]! * mult : NaN),
    lower: basis.map((b, i) => isFinite(b) && isFinite(rangema[i]!) ? b - rangema[i]! * mult : NaN),
  }
}

/** BB inside KC = squeeze on */
export function computeSqueezeMask(bb: BandResult, kc: BandResult): boolean[] {
  return bb.upper.map((ub, i) => {
    const lb = bb.lower[i]!
    const ku = kc.upper[i]!
    const kl = kc.lower[i]!
    return isFinite(ub) && isFinite(lb) && isFinite(ku) && isFinite(kl) && ub < ku && lb > kl
  })
}

function highestHigh(bars: Bar[], end: number, len: number): number {
  let h = -Infinity
  for (let i = Math.max(0, end - len + 1); i <= end; i++) h = Math.max(h, bars[i]!.high)
  return h
}

function lowestLow(bars: Bar[], end: number, len: number): number {
  let l = Infinity
  for (let i = Math.max(0, end - len + 1); i <= end; i++) l = Math.min(l, bars[i]!.low)
  return l
}

/** Standard Ichimoku (9/26/52) with Senkou spans shifted +26 bars */
export function computeIchimoku(bars: Bar[]): { senkouA: number[]; senkouB: number[] } {
  const n = bars.length
  const tenkan = new Array<number>(n).fill(NaN)
  const kijun  = new Array<number>(n).fill(NaN)
  const senkouA = new Array<number>(n).fill(NaN)
  const senkouB = new Array<number>(n).fill(NaN)

  for (let i = 8; i < n; i++) {
    tenkan[i] = (highestHigh(bars, i, 9) + lowestLow(bars, i, 9)) / 2
  }
  for (let i = 25; i < n; i++) {
    kijun[i] = (highestHigh(bars, i, 26) + lowestLow(bars, i, 26)) / 2
  }

  const shift = 26
  for (let k = 0; k < n; k++) {
    const src = k - shift
    if (src >= 25 && src < n && isFinite(tenkan[src]!) && isFinite(kijun[src]!)) {
      senkouA[k] = (tenkan[src]! + kijun[src]!) / 2
    }
    if (src >= 51 && src < n) {
      const hh = highestHigh(bars, src, 52)
      const ll = lowestLow(bars, src, 52)
      if (isFinite(hh) && isFinite(ll)) senkouB[k] = (hh + ll) / 2
    }
  }

  return { senkouA, senkouB }
}
