/**
 * Oracle Snapshot — aggregates all ICT/liquidity intel into one structured object.
 * Designed for AI Oracle context injection and sensor fusion display.
 * All prices ranked by proximity to current price.
 */
import type { Bar } from '../../../indicators/boom3d-tech';
import { detectFvgZones } from './fvgZones';
import { detectOrderBlocks } from './orderBlocks';
import { detectEqualLevels } from './equalLevels';
import { detectBreakerBlocks } from './breakerBlocks';
import { computeLiquidityThermal } from './liquidityThermal';
import { detectSwingRays } from './swingLevels';
import { sessionLevelsByBar } from './sessionLevels';
import { computeMtfLevels, mtfToPriceLevels } from './mtfLevels';

export type PriceLevel = {
  price: number;
  kind: string;       // 'FVG_BULL' | 'FVG_BEAR' | 'OB_BULL' | 'OB_BEAR' | 'EQH' | 'EQL' | 'BREAKER_BULL' | 'BREAKER_BEAR' | 'HVN' | 'POC' | 'PDH' | 'PDL' | 'ORH' | 'ORL' | 'SWING_H' | 'SWING_L'
  proximity: number;  // abs distance from current price
  proxPct: number;    // proximity as % of current price
  priority: 1 | 2 | 3; // 1=critical, 2=major, 3=context
  dir: 'above' | 'below' | 'at';
  note?: string;
};

export type OracleSnapshot = {
  asset: string;
  tf: string;
  timestamp: number;
  price: number;
  atr: number;
  atrPct: number;
  regime: 'BULL' | 'BEAR' | 'RANGING' | 'TRANSITION';
  sessionName: string;
  // Ranked levels (closest first)
  levels: PriceLevel[];
  // Counts by type
  fvgBullCount: number;
  fvgBearCount: number;
  obBullCount: number;
  obBearCount: number;
  eqhCount: number;
  eqlCount: number;
  breakerCount: number;
  hvnCount: number;
  // Nearest significant levels
  nearestSupport: number | null;
  nearestResistance: number | null;
  poc: number | null;
  pdh: number | null;
  pdl: number | null;
  buyLiqPct: number;
  sellLiqPct: number;
  // Oracle context string (for AI prompt injection)
  context: string;
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

function sessionName(): string {
  const h = new Date().getUTCHours();
  if (h >= 8  && h < 10)  return 'LONDON_OPEN';
  if (h >= 10 && h < 12)  return 'LONDON_MID';
  if (h >= 12 && h < 14)  return 'DOLDRUMS';
  if (h >= 14 && h < 16)  return 'NY_OPEN';
  if (h >= 16 && h < 18)  return 'NY_MID';
  if (h >= 18 && h < 20)  return 'NY_CLOSE';
  if (h >= 0  && h < 8)   return 'ASIA';
  return 'DEAD_ZONE';
}

function regime(bars: Bar[]): OracleSnapshot['regime'] {
  if (bars.length < 55) return 'RANGING';
  const closes = bars.slice(-55).map(b => b.close);
  const ema9  = closes.slice(-9).reduce((s, v) => s + v, 0) / 9;
  const ema21 = closes.slice(-21).reduce((s, v) => s + v, 0) / 21;
  const slope = (closes[closes.length - 1]! - closes[closes.length - 10]!) / closes[closes.length - 10]!;
  const spread = Math.abs(ema9 - ema21) / closes[closes.length - 1]!;
  if (spread < 0.001) return 'RANGING';
  if (ema9 > ema21 && slope > 0) return 'BULL';
  if (ema9 < ema21 && slope < 0) return 'BEAR';
  return 'TRANSITION';
}

export function buildOracleSnapshot(
  bars: Bar[],
  asset = 'UNKNOWN',
  tf = '5m',
  /** Optional daily bars for MTF level extraction (PWH/PWL/PMH/PML/PQH/PQL). */
  dailyBars?: Bar[],
): OracleSnapshot {
  const last = bars[bars.length - 1]!;
  const price = last.close;
  const atr = atr14(bars);
  const atrPct = atr / price * 100;
  const now = last.time as number;
  const sess = sessionName();
  const reg = regime(bars);

  const levels: PriceLevel[] = [];

  const addLevel = (p: number, kind: string, priority: 1 | 2 | 3, note?: string) => {
    if (!Number.isFinite(p) || p <= 0) return;
    const proximity = Math.abs(p - price);
    const proxPct   = proximity / price * 100;
    const dir = proxPct < 0.01 ? 'at' : p > price ? 'above' : 'below';
    levels.push({ price: p, kind, proximity, proxPct, priority, dir, note });
  };

  // ── FVGs ─────────────────────────────────────────────────────────────────
  const fvgs = detectFvgZones(bars, 40);
  let fvgBull = 0, fvgBear = 0;
  for (const z of fvgs) {
    const mid = (z.top + z.bottom) / 2;
    if (z.dir === 1) { addLevel(mid, 'FVG_BULL', 2, `FVG ${z.bottom.toFixed(2)}–${z.top.toFixed(2)}`); fvgBull++; }
    else             { addLevel(mid, 'FVG_BEAR', 2, `FVG ${z.bottom.toFixed(2)}–${z.top.toFixed(2)}`); fvgBear++; }
  }

  // ── Order Blocks ─────────────────────────────────────────────────────────
  const obs = detectOrderBlocks(bars, { maxEach: 14 });
  let obBull = 0, obBear = 0;
  for (const z of obs) {
    const mid = (z.top + z.bottom) / 2;
    if (z.dir === 1) { addLevel(mid, 'OB_BULL', 1, `OB ${z.bottom.toFixed(2)}–${z.top.toFixed(2)}`); obBull++; }
    else             { addLevel(mid, 'OB_BEAR', 1, `OB ${z.bottom.toFixed(2)}–${z.top.toFixed(2)}`); obBear++; }
  }

  // ── Equal Highs/Lows ─────────────────────────────────────────────────────
  const eqLevels = detectEqualLevels(bars);
  let eqhCount = 0, eqlCount = 0;
  for (const z of eqLevels) {
    if (!z.swept) {
      addLevel(z.price, z.kind, z.strength >= 3 ? 1 : 2,
        `${z.kind} ×${z.strength}${z.strength >= 3 ? ' ★ STRONG' : ''}`);
    }
    if (z.kind === 'EQH') eqhCount++;
    else eqlCount++;
  }

  // ── Breaker Blocks ───────────────────────────────────────────────────────
  const breakers = detectBreakerBlocks(bars);
  for (const z of breakers) {
    const mid = (z.top + z.bottom) / 2;
    addLevel(mid, z.breakerDir === 1 ? 'BREAKER_BULL' : 'BREAKER_BEAR', 1,
      `Breaker ${z.bottom.toFixed(2)}–${z.top.toFixed(2)}`);
  }

  // ── Swing highs/lows ─────────────────────────────────────────────────────
  const swings = detectSwingRays(bars, { pivot: 2, maxHighs: 6, maxLows: 6 });
  for (const s of swings) {
    addLevel(s.price, s.kind === 'H' ? 'SWING_H' : 'SWING_L', 3);
  }

  // ── Liquidity thermal ────────────────────────────────────────────────────
  const lt = computeLiquidityThermal(bars, 300, 31);
  let hvnCount = 0;
  let poc: number | null = null;
  let buyLiqPct = 0.5, sellLiqPct = 0.5;
  if (lt) {
    poc = lt.poc;
    buyLiqPct = lt.buyLiqPct;
    sellLiqPct = lt.sellLiqPct;
    addLevel(lt.poc, 'POC', 1, `POC — highest vol node`);
    for (const h of lt.hvnsAbove.slice(0, 4)) { addLevel(h, 'HVN', 2); hvnCount++; }
    for (const h of lt.hvnsBelow.slice(0, 4)) { addLevel(h, 'HVN', 2); hvnCount++; }
  }

  // ── Session levels ───────────────────────────────────────────────────────
  const sessMap = sessionLevelsByBar(bars, 30);
  const sl = sessMap.get(last.time);
  if (sl) {
    if (sl.prevDayHigh) addLevel(sl.prevDayHigh, 'PDH', 1, 'Prev Day High');
    if (sl.prevDayLow)  addLevel(sl.prevDayLow,  'PDL', 1, 'Prev Day Low');
    if (sl.orHigh)      addLevel(sl.orHigh,       'ORH', 2, 'Opening Range High');
    if (sl.orLow)       addLevel(sl.orLow,        'ORL', 2, 'Opening Range Low');
  }

  // ── MTF ICT levels (PWH/PWL/PMH/PML/PQH/PQL) from daily bars ───────────
  if (dailyBars && dailyBars.length >= 5) {
    const mtf = computeMtfLevels(dailyBars);
    for (const m of mtfToPriceLevels(mtf, price)) {
      levels.push(m);
    }
  }

  // ── Sort by proximity ────────────────────────────────────────────────────
  levels.sort((a, b) => a.proximity - b.proximity);

  // ── Nearest support / resistance ─────────────────────────────────────────
  const below  = levels.filter(l => l.dir === 'below' && l.priority <= 2);
  const above  = levels.filter(l => l.dir === 'above' && l.priority <= 2);
  const nearestSupport    = below.length  ? below[0]!.price  : null;
  const nearestResistance = above.length  ? above[0]!.price  : null;

  // ── Context string for AI prompt ─────────────────────────────────────────
  const top5 = levels.slice(0, 5).map(l =>
    `${l.kind}@${l.price.toFixed(2)}(${l.dir},${l.proxPct.toFixed(2)}%)`
  ).join(' | ');

  const context = [
    `ASSET:${asset} TF:${tf} PRICE:${price.toFixed(4)} ATR:${atr.toFixed(4)}(${atrPct.toFixed(2)}%)`,
    `REGIME:${reg} SESSION:${sess}`,
    `LIQ: buy${(buyLiqPct * 100).toFixed(0)}% sell${(sellLiqPct * 100).toFixed(0)}%`,
    `POC:${poc?.toFixed(4) ?? 'n/a'} PDH:${sl?.prevDayHigh?.toFixed(4) ?? 'n/a'} PDL:${sl?.prevDayLow?.toFixed(4) ?? 'n/a'}`,
    `NEAREST LEVELS: ${top5}`,
    `COUNTS: FVG_B${fvgBull} FVG_S${fvgBear} OB_B${obBull} OB_S${obBear} EQH${eqhCount} EQL${eqlCount} BRK${breakers.length} HVN${hvnCount}`,
  ].join('\n');

  return {
    asset, tf, timestamp: now, price, atr, atrPct,
    regime: reg, sessionName: sess,
    levels,
    fvgBullCount: fvgBull, fvgBearCount: fvgBear,
    obBullCount: obBull, obBearCount: obBear,
    eqhCount, eqlCount,
    breakerCount: breakers.length,
    hvnCount,
    nearestSupport, nearestResistance,
    poc, pdh: sl?.prevDayHigh ?? null, pdl: sl?.prevDayLow ?? null,
    buyLiqPct, sellLiqPct,
    context,
  };
}
