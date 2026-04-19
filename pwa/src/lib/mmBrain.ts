/**
 * MM Brain — Market Maker Model prediction engine.
 *
 * ICT Market Maker Model: 4-phase cycle
 *   1. ACCUMULATION — range, stop hunts below, institutional buying
 *   2. MANIPULATION — false move against retail direction (liquidity grab)
 *   3. DISPLACEMENT — explosive move with FVGs, OBs printed
 *   4. DISTRIBUTION — price reaches target liquidity, institutions exit
 *
 * Input: OracleSnapshot + multi-bar price data
 * Output: predicted next MM stop (price level), phase, confidence, reasoning
 */
import type { Bar } from '../../../indicators/boom3d-tech';
import type { OracleSnapshot } from './oracleSnapshot';
import { detectEqualLevels } from './equalLevels';
import { detectFvgZones } from './fvgZones';
import { computeLiquidityThermal } from './liquidityThermal';

export type MMPhase =
  | 'ACCUMULATION'   // range-bound, stops being hunted, no clear displacement
  | 'MANIPULATION'   // sudden spike against retail (stop raid) — short-lived
  | 'DISPLACEMENT'   // strong directional move, FVGs printed, trend phase
  | 'DISTRIBUTION';  // near target liquidity, momentum fading, reversal risk

export type MMPrediction = {
  phase: MMPhase;
  phaseConfidence: number;       // 0–1
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  nextStop: number | null;       // predicted next MM target price
  nextStopKind: string;          // 'EQH' | 'EQL' | 'PDH' | 'PDL' | 'OB_BULL' | 'FVG_MID' | etc.
  nextStopDist: number;          // distance in ATRs
  alternateStop: number | null;  // if MM fakes one way first
  bias: number;                  // -1 to +1 (bear → bull)
  // Evidence chains
  manipulationEvidence: string[];
  displacementEvidence: string[];
  targetEvidence: string[];
  // For AI context injection
  narrative: string;
  // XAI/external context slot (inject Grok summary here)
  externalContext?: string;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function atr(bars: Bar[], period = 14): number {
  let s = 0;
  const n = Math.min(period, bars.length - 1);
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i]!, p = bars[i - 1]!;
    s += Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
  }
  return n > 0 ? s / n : 0;
}

function ema(vals: number[], p: number): number {
  if (!vals.length) return 0;
  const k = 2 / (p + 1);
  let e = vals[0]!;
  for (let i = 1; i < vals.length; i++) e = vals[i]! * k + e * (1 - k);
  return e;
}

function rangeCompression(bars: Bar[], lookback = 20): number {
  // 0 = tight range, 1 = explosive range
  const recent = bars.slice(-lookback);
  const ranges = recent.map(b => b.high - b.low);
  const avg = ranges.reduce((s, v) => s + v, 0) / ranges.length;
  const last5avg = ranges.slice(-5).reduce((s, v) => s + v, 0) / 5;
  return Math.min(1, last5avg / Math.max(avg, 1e-9));
}

function detectManipulationSpike(bars: Bar[], atr14: number): {
  spiked: boolean; dir: 'BULL' | 'BEAR'; reverseClose: boolean;
} {
  if (bars.length < 5) return { spiked: false, dir: 'BULL', reverseClose: false };
  const last = bars[bars.length - 1]!;
  const prev = bars[bars.length - 2]!;
  // Wick rejection: large wick (>1.5× ATR) with close in opposite direction
  const wickUp   = last.high - Math.max(last.open, last.close);
  const wickDown  = Math.min(last.open, last.close) - last.low;
  const body      = Math.abs(last.close - last.open);
  if (wickUp > atr14 * 1.5 && body < atr14 * 0.5) {
    return { spiked: true, dir: 'BEAR', reverseClose: last.close < prev.close };
  }
  if (wickDown > atr14 * 1.5 && body < atr14 * 0.5) {
    return { spiked: true, dir: 'BULL', reverseClose: last.close > prev.close };
  }
  return { spiked: false, dir: 'BULL', reverseClose: false };
}

function fvgMomentum(bars: Bar[]): { count: number; recentDir: 1 | -1 | 0 } {
  const fvgs = detectFvgZones(bars, 20);
  const recent = fvgs.filter(f => (bars[bars.length - 1]!.time as number) - f.time < 3600 * 8);
  const bulls = recent.filter(f => f.dir === 1).length;
  const bears = recent.filter(f => f.dir === -1).length;
  return {
    count: recent.length,
    recentDir: bulls > bears ? 1 : bears > bulls ? -1 : 0,
  };
}

// ── Phase detection ───────────────────────────────────────────────────────────

function detectPhase(
  bars: Bar[],
  atr14: number,
  snapshot: OracleSnapshot,
): { phase: MMPhase; confidence: number; evidence: string[] } {
  const evidence: string[] = [];
  const compression = rangeCompression(bars);
  const manip = detectManipulationSpike(bars, atr14);
  const fvgMom = fvgMomentum(bars);
  const closes = bars.slice(-20).map(b => b.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const emaDiff = Math.abs(e9 - e21) / Math.max(atr14, 1e-9);
  const lastVol = bars[bars.length - 1]!.volume ?? 0;
  const avgVol = bars.slice(-20).reduce((s, b) => s + (b.volume ?? 0), 0) / 20;
  const rvol = avgVol > 0 ? lastVol / avgVol : 1;

  // MANIPULATION: spike with reversal close
  if (manip.spiked && manip.reverseClose) {
    evidence.push(`Manipulation wick (${manip.dir}) with reversal close`);
    if (rvol > 1.5) evidence.push(`RVOL ${rvol.toFixed(1)}× confirms stop raid`);
    return { phase: 'MANIPULATION', confidence: 0.75 + (rvol > 2 ? 0.15 : 0), evidence };
  }

  // DISPLACEMENT: strong trend, FVGs printing, expanding range
  if (emaDiff > 1.5 && fvgMom.count >= 2 && compression > 0.8) {
    evidence.push(`EMA spread ${emaDiff.toFixed(1)}× ATR — strong trend`);
    evidence.push(`${fvgMom.count} recent FVGs (${fvgMom.recentDir === 1 ? 'BULL' : 'BEAR'}) = displacement`);
    if (rvol > 1.8) evidence.push(`RVOL ${rvol.toFixed(1)}× = institutional momentum`);
    return { phase: 'DISPLACEMENT', confidence: Math.min(0.9, 0.65 + fvgMom.count * 0.05), evidence };
  }

  // ACCUMULATION: tight range, low RVOL, no clear displacement
  if (compression < 0.6 && emaDiff < 0.5 && snapshot.regime === 'RANGING') {
    evidence.push(`Range compression ${(compression * 100).toFixed(0)}% — coiling`);
    evidence.push(`EMA spread ${emaDiff.toFixed(2)}× ATR — no trend`);
    if (rvol < 1.0) evidence.push(`RVOL ${rvol.toFixed(1)}× — low institutional activity`);
    return { phase: 'ACCUMULATION', confidence: 0.65, evidence };
  }

  // DISTRIBUTION: near key liquidity (EQH/EQL/PDH/PDL), momentum fading
  const nearTarget = snapshot.levels.slice(0, 3).some(
    l => l.proxPct < 0.3 && (l.kind === 'EQH' || l.kind === 'EQL' || l.kind === 'PDH' || l.kind === 'PDL')
  );
  if (nearTarget && rvol < 1.2 && emaDiff > 0.5) {
    evidence.push(`Price within 0.3% of key liquidity target`);
    evidence.push(`RVOL fading (${rvol.toFixed(1)}×) — institutional distribution`);
    return { phase: 'DISTRIBUTION', confidence: 0.7, evidence };
  }

  // Default: if trending but not displaced yet
  if (emaDiff > 0.5) {
    evidence.push(`EMA spread ${emaDiff.toFixed(2)}× ATR — weak trend`);
    return { phase: 'DISPLACEMENT', confidence: 0.45, evidence };
  }

  evidence.push(`No clear phase signal — defaulting to ACCUMULATION`);
  return { phase: 'ACCUMULATION', confidence: 0.4, evidence };
}

// ── Target selection — next MM stop ──────────────────────────────────────────

function selectNextStop(
  snapshot: OracleSnapshot,
  direction: 'BULL' | 'BEAR' | 'NEUTRAL',
  bars: Bar[],
): { price: number | null; kind: string; distAtr: number; evidence: string[] } {
  const atr14 = snapshot.atr;
  const evidence: string[] = [];

  // Priority order: EQH/EQL (strongest magnet) > PDH/PDL > OB > FVG > HVN
  const priorities: Record<string, number> = {
    EQH: 10, EQL: 10,
    PDH: 8,  PDL: 8,
    OB_BULL: 6, OB_BEAR: 6,
    BREAKER_BULL: 5, BREAKER_BEAR: 5,
    FVG_BULL: 4, FVG_BEAR: 4,
    POC: 3, HVN: 2,
    SWING_H: 2, SWING_L: 2,
  };

  // Filter by direction
  const candidates = snapshot.levels.filter(l => {
    if (direction === 'BULL') return l.dir === 'above';
    if (direction === 'BEAR') return l.dir === 'below';
    return true;
  });

  if (!candidates.length) return { price: null, kind: 'NONE', distAtr: 0, evidence: ['No target candidates'] };

  // Score: priority × (1 / proxPct) — closer + more important = higher score
  const scored = candidates.map(l => ({
    l,
    score: (priorities[l.kind] ?? 1) * (1 / Math.max(l.proxPct, 0.01)),
  })).sort((a, b) => b.score - a.score);

  const best = scored[0]!.l;
  const distAtr = best.proximity / Math.max(atr14, 1e-9);

  evidence.push(`Target: ${best.kind} @ ${best.price.toFixed(4)} (${best.proxPct.toFixed(2)}% away, ${distAtr.toFixed(1)}× ATR)`);
  if (best.kind === 'EQH' || best.kind === 'EQL') {
    evidence.push(`${best.kind} = stop cluster — MM will sweep this before reversing`);
  }
  if (best.kind === 'PDH' || best.kind === 'PDL') {
    evidence.push(`Previous day ${best.kind.slice(2)} = key institutional reference`);
  }
  if (distAtr > 5) evidence.push(`Target is ${distAtr.toFixed(1)}× ATR away — swing horizon`);
  else if (distAtr < 1.5) evidence.push(`Target within 1.5× ATR — scalp range`);

  return { price: best.price, kind: best.kind, distAtr, evidence };
}

// ── Bias score ────────────────────────────────────────────────────────────────

function computeBias(bars: Bar[], snapshot: OracleSnapshot): number {
  const closes = bars.slice(-50).map(b => b.close);
  const e9  = ema(closes, 9);
  const e21 = ema(closes, 21);
  const emaBias = (e9 - e21) / Math.max(snapshot.atr, 1e-9);
  const liqBias = snapshot.buyLiqPct - snapshot.sellLiqPct; // positive = more support below
  const regimeBias = snapshot.regime === 'BULL' ? 0.5 : snapshot.regime === 'BEAR' ? -0.5 : 0;
  const raw = emaBias * 0.4 + liqBias * 0.3 + regimeBias * 0.3;
  return Math.max(-1, Math.min(1, raw));
}

// ── Narrative generator ───────────────────────────────────────────────────────

function buildNarrative(
  phase: MMPhase,
  direction: 'BULL' | 'BEAR' | 'NEUTRAL',
  nextStop: number | null,
  nextStopKind: string,
  snapshot: OracleSnapshot,
  phaseEvidence: string[],
  targetEvidence: string[],
  externalContext?: string,
): string {
  const price = snapshot.price.toFixed(4);
  const stopStr = nextStop ? nextStop.toFixed(4) : 'unclear';
  const lines = [
    `MM MODEL | ${snapshot.asset} ${snapshot.tf} | ${new Date().toISOString().slice(0, 16)}Z`,
    `Price: ${price} | ATR: ${snapshot.atr.toFixed(4)} | Session: ${snapshot.sessionName} | Regime: ${snapshot.regime}`,
    ``,
    `PHASE: ${phase} (${direction})`,
    ...phaseEvidence.map(e => `  · ${e}`),
    ``,
    `NEXT MM STOP: ${stopStr} (${nextStopKind})`,
    ...targetEvidence.map(e => `  · ${e}`),
    ``,
    `LIQUIDITY: ${(snapshot.buyLiqPct * 100).toFixed(0)}% buy / ${(snapshot.sellLiqPct * 100).toFixed(0)}% sell`,
    `NEAREST SUPPORT: ${snapshot.nearestSupport?.toFixed(4) ?? 'n/a'}`,
    `NEAREST RESISTANCE: ${snapshot.nearestResistance?.toFixed(4) ?? 'n/a'}`,
  ];

  if (externalContext) {
    lines.push(``, `XAI/EXTERNAL CONTEXT:`, ...externalContext.split('\n').map(l => `  ${l}`));
  }

  // Phase-specific MM trade logic
  const phaseLogic: Record<MMPhase, string> = {
    ACCUMULATION:
      `MM building inventory. Expect stop hunts of recent lows/highs before displacement. ` +
      `Do NOT trade the range — wait for displacement candle + FVG.`,
    MANIPULATION:
      `Stop raid detected. ${direction === 'BULL' ? 'Bear trap' : 'Bull trap'} — ` +
      `retail caught offside. MM likely reversing. Look for OB/FVG entry on 5m in ${direction === 'BULL' ? 'BULL' : 'BEAR'} direction.`,
    DISPLACEMENT:
      `MM in control. ${direction} displacement with FVG imbalances. ` +
      `Enter on OB retest or FVG fill. Target: ${stopStr} (${nextStopKind}).`,
    DISTRIBUTION:
      `MM near target liquidity (${nextStopKind}). Reduce position, tighten SL. ` +
      `Watch for reversal signals — next phase will be ACCUMULATION or MANIPULATION in opposite direction.`,
  };

  lines.push(``, `MM TRADE LOGIC:`, `  ${phaseLogic[phase]}`);

  return lines.join('\n');
}

// ── Main export ───────────────────────────────────────────────────────────────

export function computeMMBrain(
  bars: Bar[],
  snapshot: OracleSnapshot,
  externalContext?: string,
): MMPrediction {
  const atr14 = snapshot.atr;

  // Phase
  const { phase, confidence, evidence: phaseEvidence } = detectPhase(bars, atr14, snapshot);

  // Direction
  const bias = computeBias(bars, snapshot);
  const direction: 'BULL' | 'BEAR' | 'NEUTRAL' =
    bias > 0.15 ? 'BULL' : bias < -0.15 ? 'BEAR' : 'NEUTRAL';

  // Manipulation check: if MANIPULATION phase, direction is the REVERSE of the spike
  const manip = detectManipulationSpike(bars, atr14);
  const effectiveDir: 'BULL' | 'BEAR' | 'NEUTRAL' =
    phase === 'MANIPULATION' && manip.spiked
      ? (manip.dir === 'BULL' ? 'BEAR' : 'BULL') // fake bull = actual bear target
      : direction;

  // Next stop
  const { price: nextStop, kind: nextStopKind, distAtr: nextStopDist, evidence: targetEvidence } =
    selectNextStop(snapshot, effectiveDir, bars);

  // Alternate stop (opposite side — MM may fake first)
  const altDir: 'BULL' | 'BEAR' | 'NEUTRAL' =
    effectiveDir === 'BULL' ? 'BEAR' : effectiveDir === 'BEAR' ? 'BULL' : 'NEUTRAL';
  const { price: alternateStop } = selectNextStop(snapshot, altDir, bars);

  // Manipulation evidence
  const manipEvidence: string[] = [];
  if (manip.spiked) manipEvidence.push(`Wick rejection (${manip.dir}) detected`);
  const eqls = detectEqualLevels(bars).filter(e => !e.swept);
  const recentSweep = eqls.find(e => {
    const dist = Math.abs(e.price - bars[bars.length - 1]!.close);
    return dist < atr14 * 0.5;
  });
  if (recentSweep) manipEvidence.push(`${recentSweep.kind} cluster at ${recentSweep.price.toFixed(4)} — stop sweep proximity`);
  const lt = computeLiquidityThermal(bars, 300, 31);
  if (lt && Math.abs(lt.imbalance) / Math.max(lt.rangeHigh - lt.rangeLow, 1) > 0.3) {
    manipEvidence.push(`Liquidity imbalance: ${lt.imbalance > 0 ? 'buy' : 'sell'} dominant (${(Math.abs(lt.buyLiqPct - lt.sellLiqPct) * 100).toFixed(0)}% skew)`);
  }

  // Displacement evidence
  const dispEvidence = [...phaseEvidence];

  const narrative = buildNarrative(
    phase, effectiveDir, nextStop, nextStopKind,
    snapshot, phaseEvidence, targetEvidence, externalContext,
  );

  return {
    phase,
    phaseConfidence: confidence,
    direction: effectiveDir,
    nextStop,
    nextStopKind,
    nextStopDist,
    alternateStop,
    bias,
    manipulationEvidence: manipEvidence,
    displacementEvidence: dispEvidence,
    targetEvidence,
    narrative,
    externalContext,
  };
}
