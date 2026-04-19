import type { Bar } from '../../../indicators/boom3d-tech';

export function sma(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += values[i]!;
    if (i >= period) s -= values[i - period]!;
    if (i >= period - 1) out[i] = s / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  const k = 2 / (period + 1);
  let prev = values[0]!;
  out[0] = prev;
  for (let i = 1; i < n; i++) {
    prev = (values[i]! - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

export function atr(bars: Bar[], period = 14): number[] {
  const n = bars.length;
  const tr = new Array<number>(n);
  tr[0] = bars[0]!.high - bars[0]!.low;
  for (let i = 1; i < n; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const pc = bars[i - 1]!.close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sma(tr, period);
}
