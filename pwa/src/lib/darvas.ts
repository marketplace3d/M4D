import type { Bar } from '../../../indicators/boom3d-tech';

/** Rolling box + breakout: close crosses above prior window high (bull) or below prior window low (bear). */
export function darvasSeries(bars: Bar[], period = 20): { boxHigh: number[]; boxLow: number[]; breakout: number[] } {
  const n = bars.length;
  const boxHigh = new Array<number>(n).fill(NaN);
  const boxLow = new Array<number>(n).fill(NaN);
  const breakout = new Array<number>(n).fill(0);

  for (let i = period; i < n; i++) {
    let hiPrev = -Infinity;
    let loPrev = Infinity;
    for (let j = i - period; j < i; j++) {
      hiPrev = Math.max(hiPrev, bars[j]!.high);
      loPrev = Math.min(loPrev, bars[j]!.low);
    }
    const hi = hiPrev;
    const lo = loPrev;
    boxHigh[i] = hi;
    boxLow[i] = lo;

    const c = bars[i]!.close;
    const pc = bars[i - 1]!.close;
    if (c > hi && pc <= hi) breakout[i] = 1;
    else if (c < lo && pc >= lo) breakout[i] = -1;
  }
  return { boxHigh, boxLow, breakout };
}
