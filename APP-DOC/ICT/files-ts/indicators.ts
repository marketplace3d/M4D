// =============================================================================
// SURGE — Technical Indicators (vectorized, no Pine dependency)
// =============================================================================

import type { OHLCV } from "../../types/index.js";

/** Wilder smoothed ATR */
export function atr(bars: OHLCV[], period: number): number[] {
  const out = new Array(bars.length).fill(NaN);
  if (bars.length < 2 || period <= 0 || bars.length <= period) return out;

  const trueRanges: number[] = [NaN];
  for (let i = 1; i < bars.length; i++) {
    const hl = bars[i].high - bars[i].low;
    const hc = Math.abs(bars[i].high - bars[i - 1].close);
    const lc = Math.abs(bars[i].low  - bars[i - 1].close);
    trueRanges.push(Math.max(hl, hc, lc));
  }

  // Seed with simple average (requires full `period` true ranges)
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRanges[i];
  out[period] = sum / period;

  // Wilder smoothing
  for (let i = period + 1; i < bars.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + trueRanges[i]) / period;
  }
  return out;
}

/** Exponential moving average */
export function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  const k = 2 / (period + 1);

  let seedStart = -1;
  for (let i = 0; i < values.length; i++) {
    if (!isNaN(values[i])) { seedStart = i; break; }
  }
  if (seedStart < 0) return out;

  let sum = 0, count = 0;
  for (let i = seedStart; i < seedStart + period && i < values.length; i++) {
    if (!isNaN(values[i])) { sum += values[i]; count++; }
  }
  if (count < period) return out;

  out[seedStart + period - 1] = sum / period;
  for (let i = seedStart + period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** Simple moving average */
export function sma(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) s += values[i - j];
    out[i] = s / period;
  }
  return out;
}

/** Rolling highest high over lookback (excludes current bar — no lookahead) */
export function rollingHigh(bars: OHLCV[], lookback: number): number[] {
  const out = new Array(bars.length).fill(NaN);
  for (let i = lookback; i < bars.length; i++) {
    let max = -Infinity;
    // [i-lookback .. i-1] — exclude current bar
    for (let j = i - lookback; j < i; j++) {
      if (bars[j].high > max) max = bars[j].high;
    }
    out[i] = max;
  }
  return out;
}

/** Rolling lowest low over lookback (excludes current bar — no lookahead) */
export function rollingLow(bars: OHLCV[], lookback: number): number[] {
  const out = new Array(bars.length).fill(NaN);
  for (let i = lookback; i < bars.length; i++) {
    let min = Infinity;
    for (let j = i - lookback; j < i; j++) {
      if (bars[j].low < min) min = bars[j].low;
    }
    out[i] = min;
  }
  return out;
}

/** Rolling lowest low of `low` values over last N bars (for swing SL) */
export function lowestLow(bars: OHLCV[], len: number, atBar: number): number {
  let min = Infinity;
  const start = Math.max(0, atBar - len + 1);
  for (let i = start; i <= atBar; i++) {
    if (bars[i].low < min) min = bars[i].low;
  }
  return min;
}

/** Rolling highest high of `high` values over last N bars */
export function highestHigh(bars: OHLCV[], len: number, atBar: number): number {
  let max = -Infinity;
  const start = Math.max(0, atBar - len + 1);
  for (let i = start; i <= atBar; i++) {
    if (bars[i].high > max) max = bars[i].high;
  }
  return max;
}

/** Volume SMA */
export function volSma(bars: OHLCV[], period: number): number[] {
  return sma(bars.map(b => b.volume), period);
}

/** Annualization factor from timeframe string */
export function annFactor(tf: string): number {
  const map: Record<string, number> = {
    "1m":   525600, "5m":  105120, "15m": 35040,
    "30m":  17520,  "1h":  8760,   "4h":  2190,
    "1d":   365,    "1w":  52,
  };
  return map[tf] ?? 252;
}
