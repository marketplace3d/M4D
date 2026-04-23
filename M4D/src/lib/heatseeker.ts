import type { Bar } from '$indicators/boom3d-tech';

export type HeatTier = 'S' | 'A' | 'B' | 'C';
export interface HeatResult {
  alphaScore: number;
  tier: HeatTier;
  regime: 'BULL TREND' | 'BEAR TREND' | 'TRANSITION' | 'RANGING';
  regimeScore: number;
  jediBull: boolean;
  jediBear: boolean;
  targetLevel: number;
  dirBias: number;
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = values[Math.max(0, values.length - period)]!;
  for (let i = Math.max(1, values.length - period + 1); i < values.length; i++) {
    e = values[i]! * k + e * (1 - k);
  }
  return e;
}

function sma(values: number[], period: number): number {
  const slice = values.slice(-period);
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
}

function atr(bars: Bar[], period: number): number {
  const trs: number[] = [];
  for (let i = Math.max(1, bars.length - period); i < bars.length; i++) {
    const b = bars[i]!, prev = bars[i - 1]!;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close)));
  }
  return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : 0;
}

// Heatseeker V6.3 — ported from Pine
export function computeHeatseeker(bars: Bar[]): HeatResult | null {
  if (bars.length < 55) return null;

  const closes = bars.map(b => b.close);
  const opens  = bars.map(b => b.open);
  const highs  = bars.map(b => b.high);
  const lows   = bars.map(b => b.low);
  const vols   = bars.map(b => b.volume ?? 0);

  const diffs   = closes.map((c, i) => c - opens[i]!);
  const emaDiff = ema(diffs, 21);
  const dirBias = emaDiff > 0 ? 1 : emaDiff < 0 ? -1 : 0;

  const atr14 = atr(bars, 14);
  const n = bars.length;
  const avgBody = sma(closes.map((c, i) => Math.abs(c - opens[i]!)), 20);

  const bullFVG = lows[n-1]! > highs[n-3]! &&
    (lows[n-1]! - highs[n-3]!) >= 0.45 * atr14 &&
    (closes[n-2]! - opens[n-2]!) > 1.3 * avgBody;
  const bearFVG = highs[n-1]! < lows[n-3]! &&
    (lows[n-3]! - highs[n-1]!) >= 0.45 * atr14 &&
    (opens[n-2]! - closes[n-2]!) > 1.3 * avgBody;

  const rangeHigh = Math.max(...highs.slice(-50));
  const rangeLow  = Math.min(...lows.slice(-50));
  const poc = (rangeHigh + rangeLow) / 2;

  const rvol = vols[n-1]! / Math.max(1e-9, sma(vols, 20));
  const shapeScore = (dirBias > 0 && closes[n-1]! > poc) || (dirBias < 0 && closes[n-1]! < poc) ? 1.0 : 0.4;

  const e9  = ema(closes, 9);
  const e21 = ema(closes, 21);
  const adxProxy = Math.min(50, Math.abs(e9 - e21) / Math.max(1e-9, atr14) * 20);

  const regimeRaw = shapeScore * 0.8 +
    (adxProxy > 25 ? dirBias * 0.8 : 0) +
    (rvol > 1.8 ? dirBias * 0.4 : 0);
  const regimeScore = Math.min(1, Math.max(-1, regimeRaw));

  const volAcc = sma(vols, 14) / Math.max(1e-9, sma(vols, 50));
  const fvgHit = bullFVG || bearFVG ? 1.0 : 0.6;
  const obHit  = dirBias !== 0 ? 1.0 : 0.5;
  const alphaRaw = (volAcc * 35 * 0.38) + (fvgHit * 25 * 0.25) + (obHit * 20 * 0.14) + (1.0 * 25 * 0.23) + (regimeScore * 15);
  const alphaScore = Math.min(100, Math.max(0, Math.round(alphaRaw * 1.61)));

  const tier: HeatTier = alphaScore >= 85 ? 'S' : alphaScore >= 72 ? 'A' : alphaScore >= 58 ? 'B' : 'C';
  const regime = Math.abs(regimeScore) < 0.3 ? 'RANGING'
    : regimeScore > 0.5  ? 'BULL TREND'
    : regimeScore < -0.5 ? 'BEAR TREND'
    : 'TRANSITION';

  const targetLevel = dirBias > 0 ? rangeHigh + atr14 * 0.6 : rangeLow - atr14 * 0.6;

  return {
    alphaScore, tier, regime, regimeScore, dirBias, targetLevel,
    jediBull: regimeScore > 0.4 && alphaScore >= 72,
    jediBear: regimeScore < -0.4 && alphaScore >= 72,
  };
}
