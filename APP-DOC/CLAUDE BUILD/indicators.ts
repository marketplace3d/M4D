// =============================================================================
// SURGE v3 — Indicators (vectorized, zero lookahead)
// All rolling functions exclude the current bar: history[1..N] not [0..N]
// =============================================================================

import type { OHLCV } from "../../types/index.js";

// ─── EMA ──────────────────────────────────────────────────────────────────────
export function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  const k   = 2 / (period + 1);
  let seed = -1;
  for (let i = 0; i < values.length; i++) {
    if (!isNaN(values[i])) { seed = i; break; }
  }
  if (seed < 0 || seed + period > values.length) return out;
  let s = 0;
  for (let i = seed; i < seed + period; i++) s += values[i];
  out[seed + period - 1] = s / period;
  for (let i = seed + period; i < values.length; i++)
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

// ─── SMA ──────────────────────────────────────────────────────────────────────
export function sma(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) s += isNaN(values[i-j]) ? 0 : values[i-j];
    out[i] = s / period;
  }
  return out;
}

// ─── Wilder ATR ───────────────────────────────────────────────────────────────
export function atr(bars: OHLCV[], period: number): number[] {
  const out = new Array(bars.length).fill(NaN);
  if (bars.length < period + 1) return out;
  const tr: number[] = [NaN];
  for (let i = 1; i < bars.length; i++) {
    tr.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i-1].close),
      Math.abs(bars[i].low  - bars[i-1].close),
    ));
  }
  let s = 0;
  for (let i = 1; i <= period; i++) s += tr[i];
  out[period] = s / period;
  for (let i = period + 1; i < bars.length; i++)
    out[i] = (out[i-1] * (period - 1) + tr[i]) / period;
  return out;
}

// ─── RSI (Wilder) ─────────────────────────────────────────────────────────────
export function rsi(closes: number[], period: number): number[] {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return out;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i-1];
    if (d >= 0) ag += d; else al += Math.abs(d);
  }
  ag /= period; al /= period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

// ─── Stochastic ───────────────────────────────────────────────────────────────
export function stoch(
  bars: OHLCV[], kLen: number, dLen: number, smooth: number
): { k: number[]; d: number[] } {
  const n = bars.length;
  const raw = new Array(n).fill(NaN);
  for (let i = kLen - 1; i < n; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = i - kLen + 1; j <= i; j++) {
      if (bars[j].low  < lo) lo = bars[j].low;
      if (bars[j].high > hi) hi = bars[j].high;
    }
    raw[i] = hi === lo ? 50 : (bars[i].close - lo) / (hi - lo) * 100;
  }
  const k = sma(raw, smooth);
  return { k, d: sma(k, dLen) };
}

// ─── VWAP (rolling session window) ───────────────────────────────────────────
export function vwap(bars: OHLCV[], sessionLen: number): number[] {
  const out = new Array(bars.length).fill(NaN);
  for (let i = sessionLen - 1; i < bars.length; i++) {
    let pv = 0, v = 0;
    for (let j = i - sessionLen + 1; j <= i; j++) {
      const tp = (bars[j].high + bars[j].low + bars[j].close) / 3;
      pv += tp * bars[j].volume;
      v  += bars[j].volume;
    }
    out[i] = v > 0 ? pv / v : NaN;
  }
  return out;
}

// ─── Rolling high/low (NO current bar — strict no-lookahead) ─────────────────
export function rollingHigh(bars: OHLCV[], len: number): number[] {
  const out = new Array(bars.length).fill(NaN);
  for (let i = len; i < bars.length; i++) {
    let max = -Infinity;
    for (let j = i - len; j < i; j++) if (bars[j].high > max) max = bars[j].high;
    out[i] = max;
  }
  return out;
}

export function rollingLow(bars: OHLCV[], len: number): number[] {
  const out = new Array(bars.length).fill(NaN);
  for (let i = len; i < bars.length; i++) {
    let min = Infinity;
    for (let j = i - len; j < i; j++) if (bars[j].low < min) min = bars[j].low;
    out[i] = min;
  }
  return out;
}

// ─── Swing pivots (ZigZag — no lookahead, confirmed after leftLen + rightLen) ─
// Returns confirmed highs/lows indexed at confirmation bar
export interface SwingPivot {
  price:    number;
  pivotBar: number;   // bar where the actual high/low occurred
  confBar:  number;   // bar where confirmation was available
  type:     "HIGH" | "LOW";
}

export function swingPivots(
  bars: OHLCV[], leftLen: number, rightLen: number
): SwingPivot[] {
  const pivots: SwingPivot[] = [];
  // Confirmed once rightLen bars have formed AFTER the potential pivot
  for (let i = leftLen; i < bars.length - rightLen; i++) {
    let isHigh = true, isLow = true;
    for (let l = 1; l <= leftLen;  l++) {
      if (bars[i].high <= bars[i-l].high) isHigh = false;
      if (bars[i].low  >= bars[i-l].low)  isLow  = false;
    }
    for (let r = 1; r <= rightLen; r++) {
      if (bars[i].high <= bars[i+r].high) isHigh = false;
      if (bars[i].low  >= bars[i+r].low)  isLow  = false;
    }
    if (isHigh) pivots.push({ price: bars[i].high, pivotBar: i, confBar: i + rightLen, type: "HIGH" });
    if (isLow)  pivots.push({ price: bars[i].low,  pivotBar: i, confBar: i + rightLen, type: "LOW"  });
  }
  return pivots.sort((a, b) => a.confBar - b.confBar);
}

// ─── Point-in-time swing lookup ───────────────────────────────────────────────
// Returns last N confirmed swings available at bar `atBar` (no lookahead)
export function confirmedSwingsAt(
  pivots: SwingPivot[], atBar: number, type: "HIGH"|"LOW", n: number
): SwingPivot[] {
  return pivots
    .filter(p => p.type === type && p.confBar <= atBar)
    .slice(-n);
}

// ─── Spot helpers ────────────────────────────────────────────────────────────
export function lowestLow(bars: OHLCV[], len: number, at: number): number {
  let min = Infinity;
  for (let i = Math.max(0, at - len + 1); i <= at; i++)
    if (bars[i].low < min) min = bars[i].low;
  return min;
}

export function highestHigh(bars: OHLCV[], len: number, at: number): number {
  let max = -Infinity;
  for (let i = Math.max(0, at - len + 1); i <= at; i++)
    if (bars[i].high > max) max = bars[i].high;
  return max;
}

export function volSma(bars: OHLCV[], period: number): number[] {
  return sma(bars.map(b => b.volume), period);
}

export function annFactor(tf: string): number {
  const m: Record<string, number> = {
    "1m": 525600, "5m": 105120, "15m": 35040,
    "30m": 17520, "1h": 8760,   "4h": 2190,
    "1d": 365,    "1w": 52,
  };
  return m[tf] ?? 252;
}
