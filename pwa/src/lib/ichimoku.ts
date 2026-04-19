import type { Bar } from '../../../indicators/boom3d-tech';

function highestHigh(bars: readonly Bar[], end: number, len: number): number {
  let h = -Infinity;
  const start = end - len + 1;
  for (let i = Math.max(0, start); i <= end && i < bars.length; i++) {
    h = Math.max(h, bars[i]!.high);
  }
  return h;
}

function lowestLow(bars: readonly Bar[], end: number, len: number): number {
  let l = Infinity;
  const start = end - len + 1;
  for (let i = Math.max(0, start); i <= end && i < bars.length; i++) {
    l = Math.min(l, bars[i]!.low);
  }
  return l;
}

/** Standard Ichimoku (9 / 26 / 52), Senkou spans shifted +26 bars on the time axis. */
export function computeIchimoku(bars: readonly Bar[]): {
  senkouA: number[];
  senkouB: number[];
} {
  const n = bars.length;
  const tenkan = new Array(n).fill(NaN);
  const kijun = new Array(n).fill(NaN);
  const senkouA = new Array(n).fill(NaN);
  const senkouB = new Array(n).fill(NaN);

  for (let i = 8; i < n; i++) {
    tenkan[i] = (highestHigh(bars, i, 9) + lowestLow(bars, i, 9)) / 2;
  }
  for (let i = 25; i < n; i++) {
    kijun[i] = (highestHigh(bars, i, 26) + lowestLow(bars, i, 26)) / 2;
  }

  const shift = 26;
  for (let k = 0; k < n; k++) {
    const src = k - shift;
    if (src >= 25 && src < n && Number.isFinite(tenkan[src]!) && Number.isFinite(kijun[src]!)) {
      senkouA[k] = (tenkan[src]! + kijun[src]!) / 2;
    }
    if (src >= 51 && src < n) {
      const hh = highestHigh(bars, src, 52);
      const ll = lowestLow(bars, src, 52);
      if (Number.isFinite(hh) && Number.isFinite(ll)) {
        senkouB[k] = (hh + ll) / 2;
      }
    }
  }

  return { senkouA, senkouB };
}
