/**
 * Lance Breitstein "Market Wizard" EV Scoring Engine
 * + Andrea Order Flow Scalper signals
 *
 * Framework: Expected Value = P(win) × Reward - P(lose) × Risk
 * A+ (90+) → HIGH SIZE entry
 * A  (80-89) → standard size
 * B  (70-79) → reduced size
 * C  (<70)   → NO SIGNAL — wait for better setup
 *
 * Entry method: "Right Side of the V"
 *   1. Detect waterfall (asymptotic drop, ≥3 SD from 20MA)
 *   2. Wait for exhaustion (volume capitulation + delta flip)
 *   3. Enter ONLY on break of previous 1-2m candle HIGH
 *   4. Stop = low of move. Target = 20MA equilibrium.
 */
import type { Bar } from '../../../indicators/boom3d-tech';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LanceGrade = 'A+' | 'A' | 'B' | 'C';

export type LanceCategoryScore = {
  /** Price & Momentum (30%) — waterfall ROC, SD distance, leg count */
  priceScore: number;        // 0–10
  /** Market Structure (25%) — volume capitulation, stop run, boringness */
  structureScore: number;    // 0–10
  /** Context & Sentiment (25%) — sector convergence, news filter, time of day */
  contextScore: number;      // 0–10
  /** Order Flow (20%) — delta divergence, trapped liquidity, Andrea signals */
  orderFlowScore: number;    // 0–10
};

export type WaterfallInfo = {
  detected: boolean;
  legCount: number;           // 1-4 pushes down
  sdDistance: number;         // SDs from 20MA
  rocPct: number;             // % drop over last N bars
  moveLowest: number;         // low of the waterfall
  moveLowestIdx: number;      // bar index of the low
  rightSideArmed: boolean;    // price has turned, watching for candle break
  entryTrigger: number | null; // price level that triggers "Right Side of V"
};

export type AndreaSignal = {
  /** Absorption: large activity at level but price not moving → reversal candidate */
  absorption: boolean;
  absorptionDir: 'BULL' | 'BEAR' | null;
  /** Momentum: aggressive volume spike + level break → momentum entry */
  momentum: boolean;
  momentumDir: 'BULL' | 'BEAR' | null;
  /** Delta = approx(aggressive buys - sells). Positive = buying pressure. */
  deltaProxy: number;         // -1 to +1
  /** Divergence: price new low but delta improving (positive) */
  deltaDivergence: boolean;
};

export type LanceEVScore = {
  // Input summary
  asset: string;
  tf: string;
  price: number;
  atr: number;
  timestamp: number;

  // Scoring
  categories: LanceCategoryScore;
  evScore: number;            // 0–100
  grade: LanceGrade;
  gradeLabel: string;         // human-readable

  // Waterfall state machine
  waterfall: WaterfallInfo;

  // Andrea order flow layer
  andrea: AndreaSignal;

  // Entry mechanics
  entryReady: boolean;        // true when "Right Side of V" trigger fires
  entryPrice: number | null;  // break of prev candle high
  stopPrice: number | null;   // low of move
  targetPrice: number | null; // 20MA equilibrium

  // Evidence
  bullEvidence: string[];
  bearEvidence: string[];
  narrative: string;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function sma(vals: number[], p: number): number {
  const slice = vals.slice(-p);
  return slice.reduce((s, v) => s + v, 0) / Math.max(slice.length, 1);
}

function stddev(vals: number[], period: number): number {
  const slice = vals.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
  return Math.sqrt(variance);
}

function atrN(bars: Bar[], period = 14): number {
  let s = 0;
  const n = Math.min(period, bars.length - 1);
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i]!, p = bars[i - 1]!;
    s += Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
  }
  return n > 0 ? s / n : 0;
}

function rvol(bars: Bar[], recent = 3, lookback = 20): number {
  const base = bars.slice(-(lookback + recent), -recent);
  const rec  = bars.slice(-recent);
  const avgBase = base.reduce((s, b) => s + (b.volume ?? 0), 0) / Math.max(base.length, 1);
  const avgRec  = rec.reduce((s, b) => s + (b.volume ?? 0), 0)  / Math.max(rec.length, 1);
  return avgBase > 0 ? avgRec / avgBase : 1;
}

/** Detect "Pocket Aces" session bonus (open/close of major sessions) */
function sessionBonus(bar: Bar): number {
  const t = typeof bar.time === 'number' ? bar.time : 0;
  const hourUTC = Math.floor((t % 86400) / 3600);
  // London Open 08:00-10:00, NY Open 14:00-16:00
  if ((hourUTC >= 8 && hourUTC < 10) || (hourUTC >= 14 && hourUTC < 16)) return 1.5;
  // Suppress: lunch 12-14, dead 20-24
  if ((hourUTC >= 12 && hourUTC < 14) || hourUTC >= 20) return 0;
  return 1.0;
}

// ── Waterfall detector ────────────────────────────────────────────────────────

function detectWaterfall(bars: Bar[], atr14: number): WaterfallInfo {
  const n = bars.length;
  if (n < 25) {
    return {
      detected: false, legCount: 0, sdDistance: 0, rocPct: 0,
      moveLowest: 0, moveLowestIdx: -1, rightSideArmed: false, entryTrigger: null,
    };
  }

  const closes = bars.map(b => b.close);
  const ma20   = sma(closes, 20);
  const sd20   = stddev(closes, 20);
  const last   = bars[n - 1]!;
  const sdDist = sd20 > 0 ? (ma20 - last.close) / sd20 : 0; // positive = below MA (oversold)

  // ROC: % drop over last 5 bars
  const rocBase  = bars[n - 6]?.close ?? last.close;
  const rocPct   = rocBase > 0 ? (rocBase - last.close) / rocBase * 100 : 0; // positive = drop

  // Find local low in last 30 bars
  const window = bars.slice(-30);
  let lowestClose = Infinity;
  let lowestIdx   = n - 30;
  for (let i = 0; i < window.length; i++) {
    if (window[i]!.close < lowestClose) {
      lowestClose = window[i]!.close;
      lowestIdx   = n - 30 + i;
    }
  }

  // Count legs: pushes below each prior low
  let legCount = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i]!.low < window[i - 1]!.low && window[i - 1]!.low < window[i - 2]?.low!) {
      legCount++;
    }
  }
  legCount = Math.min(legCount, 4);

  const detected = sdDist >= 2.5 && rocPct >= 1.5 && legCount >= 1;

  // Right side armed: price has bounced from lowest at least 0.5 ATR
  const rightSideArmed = detected && (last.close - lowestClose) > atr14 * 0.5;

  // Entry trigger: break of previous candle high (1-2 bar)
  const prevHigh = bars[n - 2]?.high ?? null;
  const entryTrigger = rightSideArmed && prevHigh ? prevHigh : null;

  return {
    detected,
    legCount: Math.max(legCount, detected ? 1 : 0),
    sdDistance: Math.max(sdDist, 0),
    rocPct,
    moveLowest: lowestClose,
    moveLowestIdx: lowestIdx,
    rightSideArmed,
    entryTrigger,
  };
}

// ── Andrea order flow proxies ─────────────────────────────────────────────────

function computeAndrea(bars: Bar[], atr14: number): AndreaSignal {
  const n = bars.length;
  if (n < 5) {
    return { absorption: false, absorptionDir: null, momentum: false, momentumDir: null, deltaProxy: 0, deltaDivergence: false };
  }

  // Delta proxy: candle body direction and size weighted by volume
  // Positive body = buying aggression; negative = selling aggression
  function barDelta(b: Bar): number {
    const vol = b.volume ?? 1;
    const body = b.close - b.open;
    const range = Math.max(b.high - b.low, 1e-9);
    return (body / range) * Math.log1p(vol);
  }

  const recentBars = bars.slice(-5);
  const deltaVals  = recentBars.map(barDelta);
  const rawDelta   = deltaVals.reduce((s, v) => s + v, 0);
  const maxDelta   = recentBars.length * Math.log1p(Math.max(...recentBars.map(b => b.volume ?? 1)));
  const deltaProxy = maxDelta > 0 ? rawDelta / maxDelta : 0; // -1 to +1

  // Absorption: price stalled at a level (last 3 bars' range < 0.4 ATR) but volume elevated
  const last3 = bars.slice(-3);
  const rangeHigh = Math.max(...last3.map(b => b.high));
  const rangeLow  = Math.min(...last3.map(b => b.low));
  const rangeSpan = rangeHigh - rangeLow;
  const baseVol   = bars.slice(-20).reduce((s, b) => s + (b.volume ?? 0), 0) / 20;
  const lastVol   = bars[n - 1]!.volume ?? 0;
  const absorption = rangeSpan < atr14 * 0.4 && lastVol > baseVol * 1.8;
  const absorptionDir = absorption
    ? (deltaProxy > 0 ? 'BULL' : 'BEAR')
    : null;

  // Momentum: large bar (> 1.2 ATR) + volume spike (> 2×)
  const lastBar  = bars[n - 1]!;
  const lastRange = lastBar.high - lastBar.low;
  const momentum  = lastRange > atr14 * 1.2 && lastVol > baseVol * 2;
  const momentumDir = momentum
    ? (lastBar.close > lastBar.open ? 'BULL' : 'BEAR')
    : null;

  // Delta divergence: price made a new low but deltaProxy is positive (buying)
  const priorLow   = Math.min(...bars.slice(-10, -1).map(b => b.low));
  const newPriceLow = bars[n - 1]!.low < priorLow;
  const deltaDivergence = newPriceLow && deltaProxy > 0.15;

  return { absorption, absorptionDir, momentum, momentumDir, deltaProxy, deltaDivergence };
}

// ── Category scorers ──────────────────────────────────────────────────────────

function scorePrice(bars: Bar[], wf: WaterfallInfo): number {
  // Max 10 — waterfall ROC (4), SD distance (3), leg count (3)
  let s = 0;
  s += Math.min(4, wf.rocPct / 0.8);           // 0-4: each 0.8% drop = 1 pt
  s += Math.min(3, wf.sdDistance / 1.0);        // 0-3: each SD = 1 pt (cap 3)
  s += Math.min(3, (wf.legCount - 1) * 1.5);   // 0-3: 2nd leg=1.5, 3rd=3
  return Math.min(10, Math.max(0, s));
}

function scoreStructure(bars: Bar[], atr14: number): number {
  // Max 10 — RVOL spike (4), stop run (3), boringness / large asset (3)
  let s = 0;
  const rv = rvol(bars, 3, 20);
  s += Math.min(4, (rv - 1) * 2.5);            // RVOL > 1 starts contributing

  // Stop run: price poked low then snapped back (wick below prev low, close above)
  const n = bars.length;
  const last = bars[n - 1]!;
  const prev = bars[n - 2]!;
  if (last.low < prev.low && last.close > prev.low) s += 3; // classic stop run

  // Boringness proxy: low ATR% (stable asset, not micro-cap chaos)
  const atrPct = last.close > 0 ? (atr14 / last.close) * 100 : 5;
  if (atrPct < 1.0) s += 3;       // very stable (Gold, major index)
  else if (atrPct < 2.5) s += 2;  // moderate
  else if (atrPct < 5.0) s += 1;  // volatile but not extreme

  return Math.min(10, Math.max(0, s));
}

function scoreContext(bars: Bar[], andrea: AndreaSignal): number {
  // Max 10 — session bonus (4), delta divergence / absorption (3), no-news proxy (3)
  let s = 0;
  const last = bars[bars.length - 1]!;
  const sb = sessionBonus(last);
  s += Math.min(4, sb * 2.5);                  // 0-4: session quality

  if (andrea.deltaDivergence) s += 3;           // delta flip at low = high conviction
  else if (andrea.absorption && andrea.absorptionDir === 'BULL') s += 2;

  // No-news proxy: stable/moderate moves on a "boring" day (low ATR vs longer avg)
  const atr14v = atrN(bars, 14);
  const atr50v = atrN(bars, 50);
  if (atr50v > 0 && atr14v < atr50v * 1.3) s += 3; // today not unusually wild

  return Math.min(10, Math.max(0, s));
}

function scoreOrderFlow(andrea: AndreaSignal, wf: WaterfallInfo): number {
  // Max 10 — delta divergence (4), absorption (3), right-side armed (3)
  let s = 0;
  if (andrea.deltaDivergence)                         s += 4;
  if (andrea.absorption && andrea.absorptionDir === 'BULL') s += 3;
  else if (andrea.momentum && andrea.momentumDir === 'BULL') s += 2;
  if (wf.rightSideArmed)                              s += 3;
  return Math.min(10, Math.max(0, s));
}

// ── 20% heuristic (Lance's optimism bias buffer) ──────────────────────────────
const HUMILITY_FACTOR = 0.80;

// ── Main export ───────────────────────────────────────────────────────────────

export function computeLanceEV(
  bars: Bar[],
  asset = 'UNKNOWN',
  tf = '5m',
): LanceEVScore {
  if (bars.length < 25) {
    const empty: LanceEVScore = {
      asset, tf, price: 0, atr: 0, timestamp: 0,
      categories: { priceScore: 0, structureScore: 0, contextScore: 0, orderFlowScore: 0 },
      evScore: 0, grade: 'C', gradeLabel: 'NO SIGNAL — insufficient data',
      waterfall: { detected: false, legCount: 0, sdDistance: 0, rocPct: 0, moveLowest: 0, moveLowestIdx: -1, rightSideArmed: false, entryTrigger: null },
      andrea: { absorption: false, absorptionDir: null, momentum: false, momentumDir: null, deltaProxy: 0, deltaDivergence: false },
      entryReady: false, entryPrice: null, stopPrice: null, targetPrice: null,
      bullEvidence: [], bearEvidence: [], narrative: 'Insufficient bars.',
    };
    return empty;
  }

  const last    = bars[bars.length - 1]!;
  const atr14   = atrN(bars, 14);
  const wf      = detectWaterfall(bars, atr14);
  const andrea  = computeAndrea(bars, atr14);

  const pS  = scorePrice(bars, wf);
  const stS = scoreStructure(bars, atr14);
  const cS  = scoreContext(bars, andrea);
  const ofS = scoreOrderFlow(andrea, wf);

  // Weighted sum: 30 / 25 / 25 / 20
  const rawEV = (pS * 3.0 + stS * 2.5 + cS * 2.5 + ofS * 2.0) / 10;
  const evScore = Math.round(Math.min(100, rawEV * HUMILITY_FACTOR * 10));

  // Suppress if session is dead zone (sb === 0)
  const sb = sessionBonus(last);
  const gatedEV = sb === 0 ? Math.min(evScore, 40) : evScore;

  let grade: LanceGrade;
  let gradeLabel: string;
  if (gatedEV >= 90)       { grade = 'A+'; gradeLabel = 'POCKET ACES / LEGEND TIER — HIGH SIZE'; }
  else if (gatedEV >= 80)  { grade = 'A';  gradeLabel = 'GRADE A — STANDARD SIZE'; }
  else if (gatedEV >= 70)  { grade = 'B';  gradeLabel = 'GRADE B — REDUCED SIZE'; }
  else                     { grade = 'C';  gradeLabel = 'NO SIGNAL — PAPER CUT TERRITORY'; }

  // Entry mechanics
  const closes  = bars.map(b => b.close);
  const ma20    = sma(closes, 20);
  const prevHigh = bars[bars.length - 2]?.high ?? null;
  const entryReady = wf.rightSideArmed && prevHigh !== null && last.close > prevHigh && gatedEV >= 70;
  const entryPrice  = entryReady ? prevHigh : (wf.entryTrigger ?? null);
  const stopPrice   = wf.detected ? wf.moveLowest : null;
  const targetPrice = ma20;

  // Evidence strings
  const bullEvidence: string[] = [];
  const bearEvidence: string[] = [];

  if (wf.detected) bullEvidence.push(`Waterfall: ${wf.rocPct.toFixed(1)}% drop, ${wf.sdDistance.toFixed(1)} SD below 20MA`);
  if (wf.legCount >= 3) bullEvidence.push(`Leg ${wf.legCount} — higher EV reversal probability`);
  if (andrea.deltaDivergence) bullEvidence.push(`Delta divergence: price low + buying pressure → reversal signal`);
  if (andrea.absorption && andrea.absorptionDir === 'BULL') bullEvidence.push(`Andrea absorption: price stalled at level, large vol, no further down`);
  if (wf.rightSideArmed) bullEvidence.push(`Right Side of V armed — watching for candle break at ${prevHigh?.toFixed(4) ?? '?'}`);
  if (sb === 0) bearEvidence.push(`SESSION SUPPRESSED — lunch/dead zone, gate closed`);
  if (gatedEV < 70) bearEvidence.push(`EV ${gatedEV} below threshold — wait for A+ setup`);
  if (andrea.momentum && andrea.momentumDir === 'BEAR') bearEvidence.push(`Bearish momentum spike — not yet exhausted`);

  const narrative = [
    `Lance EV: ${gatedEV}/100 [${grade}] — ${gradeLabel}`,
    `Waterfall: ${wf.detected ? `YES (${wf.legCount} legs, ${wf.sdDistance.toFixed(1)}σ, ${wf.rocPct.toFixed(1)}% drop)` : 'NOT DETECTED'}`,
    `Right Side of V: ${wf.rightSideArmed ? `ARMED — entry above ${prevHigh?.toFixed(4) ?? '?'}` : 'WAITING'}`,
    `Stop: ${stopPrice?.toFixed(4) ?? '—'} | Target: ${targetPrice?.toFixed(4) ?? '—'} (20MA)`,
    `Andrea: delta=${andrea.deltaProxy.toFixed(2)} | div=${andrea.deltaDivergence} | abs=${andrea.absorption}`,
    `Scores: Price=${pS.toFixed(1)} Struct=${stS.toFixed(1)} Ctx=${cS.toFixed(1)} OF=${ofS.toFixed(1)}`,
    bullEvidence.length ? `BULL: ${bullEvidence.join(' · ')}` : '',
    bearEvidence.length ? `BEAR: ${bearEvidence.join(' · ')}` : '',
  ].filter(Boolean).join('\n');

  return {
    asset, tf, price: last.close, atr: atr14, timestamp: typeof last.time === 'number' ? last.time : 0,
    categories: { priceScore: pS, structureScore: stS, contextScore: cS, orderFlowScore: ofS },
    evScore: gatedEV, grade, gradeLabel,
    waterfall: wf, andrea,
    entryReady, entryPrice, stopPrice, targetPrice,
    bullEvidence, bearEvidence, narrative,
  };
}
