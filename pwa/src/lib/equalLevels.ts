/**
 * Equal Highs / Equal Lows — ICT liquidity pool detection.
 *
 * EQH: 2+ swing highs within `tolPct` of each other → buy-stops resting above.
 * EQL: 2+ swing lows within `tolPct` → sell-stops resting below.
 * These are magnetic price targets; ICT uses them as liquidity draws.
 */
import type { Bar } from '../../../indicators/boom3d-tech';

export type EqualLevel = {
  price: number;       // representative price of the cluster
  kind: 'EQH' | 'EQL';
  strength: number;    // count of touches (2 = weak, 3+ = strong)
  time: number;        // earliest touch timestamp
  lastTime: number;    // most recent touch timestamp
  swept: boolean;      // true if price has closed beyond this level
};

function atr14(bars: Bar[]): number {
  const n = bars.length;
  let s = 0;
  const period = Math.min(14, n - 1);
  for (let i = n - period; i < n; i++) {
    const b = bars[i]!, p = bars[i - 1]!;
    s += Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
  }
  return period > 0 ? s / period : 0;
}

function pivotHighs(bars: Bar[], p = 3): { price: number; time: number }[] {
  const out: { price: number; time: number }[] = [];
  for (let i = p; i < bars.length - p; i++) {
    const h = bars[i]!.high;
    let ok = true;
    for (let k = 1; k <= p; k++) {
      if (bars[i - k]!.high >= h || bars[i + k]!.high >= h) { ok = false; break; }
    }
    if (ok) out.push({ price: h, time: bars[i]!.time as number });
  }
  return out;
}

function pivotLows(bars: Bar[], p = 3): { price: number; time: number }[] {
  const out: { price: number; time: number }[] = [];
  for (let i = p; i < bars.length - p; i++) {
    const lo = bars[i]!.low;
    let ok = true;
    for (let k = 1; k <= p; k++) {
      if (bars[i - k]!.low <= lo || bars[i + k]!.low <= lo) { ok = false; break; }
    }
    if (ok) out.push({ price: lo, time: bars[i]!.time as number });
  }
  return out;
}

export function detectEqualLevels(
  bars: Bar[],
  opts?: { pivot?: number; tolAtrMult?: number; max?: number },
): EqualLevel[] {
  if (bars.length < 20) return [];
  const p       = opts?.pivot      ?? 3;
  const tol     = opts?.tolAtrMult ?? 0.25;  // within 0.25× ATR = "equal"
  const max     = opts?.max        ?? 8;
  const atr     = atr14(bars);
  const eps     = atr * tol;
  const lastBar = bars[bars.length - 1]!;
  const lastClose = lastBar.close;
  const lastT  = lastBar.time as number;

  const cluster = (
    pivots: { price: number; time: number }[],
    kind: 'EQH' | 'EQL',
  ): EqualLevel[] => {
    const used = new Set<number>();
    const out: EqualLevel[] = [];
    for (let i = 0; i < pivots.length; i++) {
      if (used.has(i)) continue;
      const grp = [pivots[i]!];
      used.add(i);
      for (let j = i + 1; j < pivots.length; j++) {
        if (used.has(j)) continue;
        if (Math.abs(pivots[j]!.price - pivots[i]!.price) <= eps) {
          grp.push(pivots[j]!);
          used.add(j);
        }
      }
      if (grp.length < 2) continue;
      const price = grp.reduce((s, g) => s + g.price, 0) / grp.length;
      const times = grp.map(g => g.time);
      const swept =
        kind === 'EQH'
          ? lastClose > price + eps * 0.5
          : lastClose < price - eps * 0.5;
      out.push({
        price,
        kind,
        strength: grp.length,
        time: Math.min(...times),
        lastTime: lastT,
        swept,
      });
    }
    // strongest first, cap
    return out.sort((a, b) => b.strength - a.strength).slice(0, max);
  };

  const highs = pivotHighs(bars, p);
  const lows  = pivotLows(bars, p);

  return [
    ...cluster(highs, 'EQH'),
    ...cluster(lows, 'EQL'),
  ];
}
