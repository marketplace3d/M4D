import type { Bar } from '../../../indicators/boom3d-tech';

export type LiquidityThermalResult = {
  /** 31 bin levels from low to high */
  levels: number[];
  /** Volume accumulated in each bin */
  volBins: number[];
  /** Index of max-volume bin (Point of Control) */
  pocIdx: number;
  /** Price of POC midpoint */
  poc: number;
  /** High-volume node prices above current close (sorted by distance, closest first) */
  hvnsAbove: number[];
  /** High-volume node prices below current close (sorted by distance, closest first) */
  hvnsBelow: number[];
  /** Total volume below price / total volume (0–1) */
  buyLiqPct: number;
  /** Total volume above price / total volume (0–1) */
  sellLiqPct: number;
  /** buyVol - sellVol (positive = more support below) */
  imbalance: number;
  rangeHigh: number;
  rangeLow: number;
};

/**
 * Liquidity Thermal Map — Pine translation.
 * Divides the H-L range of the last `period` bars into `bins` equal buckets.
 * Each bucket accumulates volume for bars whose close is within one step of the bucket midpoint.
 * Matches BigBeluga "Balanced Profile" (period=300, bins=31).
 */
export function computeLiquidityThermal(
  bars: Bar[],
  period = 300,
  bins = 31,
): LiquidityThermalResult | null {
  if (bars.length < 10) return null;

  const slice = bars.slice(-period);
  let H = -Infinity;
  let L = Infinity;
  for (const b of slice) {
    if (b.high > H) H = b.high;
    if (b.low < L) L = b.low;
  }
  if (!Number.isFinite(H) || !Number.isFinite(L) || H <= L) return null;

  const step = (H - L) / bins;

  // Build level array (bin lower edges)
  const levels: number[] = Array.from({ length: bins }, (_, i) => L + step * i);

  // Accumulate volume into bins (Pine: abs(close - binMid) < step)
  const volBins: number[] = new Array(bins).fill(0);
  for (const b of slice) {
    const vol = b.volume ?? 0;
    if (vol <= 0) continue;
    for (let i = 0; i < bins; i++) {
      const mid = levels[i]! + step / 2;
      if (Math.abs(b.close - mid) < step) {
        volBins[i] += vol;
      }
    }
  }

  // POC = max volume bin
  let pocIdx = 0;
  let maxVol = 0;
  for (let i = 0; i < bins; i++) {
    if (volBins[i]! > maxVol) { maxVol = volBins[i]!; pocIdx = i; }
  }
  const poc = levels[pocIdx]! + step / 2;

  const close = bars[bars.length - 1]!.close;
  const volThresh = maxVol * 0.5; // HVN: >= 50% of POC volume

  let buyVol = 0;
  let sellVol = 0;
  const hvnsAbove: number[] = [];
  const hvnsBelow: number[] = [];

  for (let i = 0; i < bins; i++) {
    const mid = levels[i]! + step / 2;
    const v = volBins[i]!;
    if (mid < close) {
      buyVol += v;
      if (v >= volThresh && i !== pocIdx) hvnsBelow.push(mid);
    } else {
      sellVol += v;
      if (v >= volThresh && i !== pocIdx) hvnsAbove.push(mid);
    }
  }

  const totalVol = buyVol + sellVol;
  const buyLiqPct = totalVol > 0 ? buyVol / totalVol : 0;
  const sellLiqPct = totalVol > 0 ? sellVol / totalVol : 0;

  // Sort: hvnsBelow closest-to-price first (descending), hvnsAbove ascending
  hvnsBelow.sort((a, b) => b - a);
  hvnsAbove.sort((a, b) => a - b);

  return {
    levels,
    volBins,
    pocIdx,
    poc,
    hvnsAbove,
    hvnsBelow,
    buyLiqPct,
    sellLiqPct,
    imbalance: buyVol - sellVol,
    rangeHigh: H,
    rangeLow: L,
  };
}
