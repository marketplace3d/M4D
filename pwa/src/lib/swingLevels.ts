import type { Bar } from '../../../indicators/boom3d-tech';

/** Horizontal “liquidity / structure” ray from pivot time → chart end. */
export type SwingRay = {
  time: number;
  endTime: number;
  price: number;
  kind: 'H' | 'L';
};

function isPivotHigh(bars: Bar[], i: number, p: number): boolean {
  const h = bars[i]!.high;
  for (let k = 1; k <= p; k++) {
    if (bars[i - k]!.high >= h || bars[i + k]!.high >= h) return false;
  }
  return true;
}

function isPivotLow(bars: Bar[], i: number, p: number): boolean {
  const lo = bars[i]!.low;
  for (let k = 1; k <= p; k++) {
    if (bars[i - k]!.low <= lo || bars[i + k]!.low <= lo) return false;
  }
  return true;
}

/**
 * Fractal pivots (default 2); returns recent swing highs/lows as rays to `endTime`.
 */
export function detectSwingRays(
  bars: Bar[],
  opts?: { pivot?: number; maxHighs?: number; maxLows?: number },
): SwingRay[] {
  const p = opts?.pivot ?? 2;
  const maxHighs = opts?.maxHighs ?? 6;
  const maxLows = opts?.maxLows ?? 6;
  const lastT = bars[bars.length - 1]!.time as number;
  const highs: SwingRay[] = [];
  const lows: SwingRay[] = [];

  for (let i = p; i < bars.length - p; i++) {
    if (isPivotHigh(bars, i, p)) {
      highs.push({
        time: bars[i]!.time as number,
        endTime: lastT,
        price: bars[i]!.high,
        kind: 'H',
      });
    }
    if (isPivotLow(bars, i, p)) {
      lows.push({
        time: bars[i]!.time as number,
        endTime: lastT,
        price: bars[i]!.low,
        kind: 'L',
      });
    }
  }

  return [...highs.slice(-maxHighs), ...lows.slice(-maxLows)];
}
