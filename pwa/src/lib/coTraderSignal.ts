/**
 * Co-Trader Signal Engine — supreme composite score.
 * Fuses: LiquidityThermal + MTF ICT levels + MM Brain → CoTraderSignal.
 * magnetStrength 0–100: stop cluster + HTF rail + HVN + phase × proximity.
 */
import type { Bar } from '../../../indicators/boom3d-tech';
import type { OracleSnapshot } from './oracleSnapshot';
import type { MMPrediction, MMPhase } from './mmBrain';

export type CoTraderSignal = {
  destination: number | null;
  destinationKind: string;
  alternateStop: number | null;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  phase: MMPhase;
  phaseConfidence: number;
  magnetStrength: number;   // 0–100 — the master score
  distAtr: number;
  liqWeight: number;        // 0–1: how much LT volume is at destination vs total
  buyLiqPct: number;
  sellLiqPct: number;
  poc: number | null;
  nearestSupport: number | null;
  nearestResistance: number | null;
  regime: OracleSnapshot['regime'];
  sessionName: string;
  narrative: string;
};

const HTF_KINDS = new Set(['PDH','PDL','PWH','PWL','PMH','PML','PQH','PQL','CWH','CWL','CMH','CML']);
const STOP_KINDS = new Set(['EQH','EQL']);
const HVN_KINDS  = new Set(['HVN','POC']);

export function computeCoTraderSignal(
  _bars: Bar[],
  snap: OracleSnapshot,
  mm: MMPrediction,
): CoTraderSignal {
  const dest = mm.nextStop;
  const destKind = mm.nextStopKind;
  const distAtr = mm.nextStopDist;

  // ── magnetStrength ────────────────────────────────────────────────────────
  let mag = 0;

  // 1. Stop cluster at destination (EQH/EQL) = strongest magnet
  if (STOP_KINDS.has(destKind)) mag += 30;

  // 2. HTF institutional rail
  if (HTF_KINDS.has(destKind)) mag += 25;

  // 3. HVN / POC at destination
  if (HVN_KINDS.has(destKind)) mag += 20;

  // 4. Secondary: any level within 0.5 ATR of destination is also stop/HTF/HVN
  if (dest !== null) {
    const atr = snap.atr;
    const nearby = snap.levels.filter(
      l => Math.abs(l.price - dest) < atr * 0.5 && l.kind !== destKind,
    );
    for (const l of nearby) {
      if (STOP_KINDS.has(l.kind))  mag += 8;
      if (HTF_KINDS.has(l.kind))   mag += 6;
      if (HVN_KINDS.has(l.kind))   mag += 5;
    }
  }

  // 5. Phase confidence × 15
  mag += mm.phaseConfidence * 15;

  // 6. Proximity bonus (closer = more urgent) — max 10 at 0 ATR, 0 at 5 ATR
  mag += Math.max(0, 10 - distAtr * 2);

  mag = Math.min(100, Math.max(0, Math.round(mag)));

  // ── liqWeight: how much of thermal volume is at the destination bin ───────
  let liqWeight = 0;
  if (dest !== null && snap.poc !== null) {
    // Proxy: if dest is POC → high weight; else use proxPct of nearest HVN
    const nearest = snap.levels
      .filter(l => HVN_KINDS.has(l.kind))
      .sort((a, b) => Math.abs(a.price - dest) - Math.abs(b.price - dest))[0];
    if (nearest) {
      liqWeight = Math.max(0, 1 - nearest.proxPct / 3); // 3% away = 0 weight
    }
    if (destKind === 'POC') liqWeight = 1.0;
  }

  // ── direction ─────────────────────────────────────────────────────────────
  const direction: CoTraderSignal['direction'] =
    mm.direction === 'BULL' ? 'LONG' : mm.direction === 'BEAR' ? 'SHORT' : 'FLAT';

  // ── narrative ─────────────────────────────────────────────────────────────
  const magLabel = mag >= 80 ? 'EXTREME' : mag >= 65 ? 'STRONG' : mag >= 45 ? 'MODERATE' : 'WEAK';
  const destStr = dest ? dest.toFixed(4) : 'unclear';
  const narrative =
    `CO-TRADER | ${snap.asset} | ${snap.sessionName} | ${snap.regime}\n` +
    `Phase: ${mm.phase} (${(mm.phaseConfidence * 100).toFixed(0)}%)\n` +
    `Destination: ${destStr} (${destKind}) · ${distAtr.toFixed(1)}× ATR\n` +
    `Magnet: ${mag}/100 [${magLabel}] · LiqWeight: ${(liqWeight * 100).toFixed(0)}%\n` +
    `Liq: ${(snap.buyLiqPct * 100).toFixed(0)}% buy / ${(snap.sellLiqPct * 100).toFixed(0)}% sell\n` +
    (mm.manipulationEvidence.length ? `⚡ ${mm.manipulationEvidence[0]}\n` : '') +
    (mm.targetEvidence[0] ? `▶ ${mm.targetEvidence[0]}` : '');

  return {
    destination: dest,
    destinationKind: destKind,
    alternateStop: mm.alternateStop,
    direction,
    phase: mm.phase,
    phaseConfidence: mm.phaseConfidence,
    magnetStrength: mag,
    distAtr,
    liqWeight,
    buyLiqPct: snap.buyLiqPct,
    sellLiqPct: snap.sellLiqPct,
    poc: snap.poc,
    nearestSupport: snap.nearestSupport,
    nearestResistance: snap.nearestResistance,
    regime: snap.regime,
    sessionName: snap.sessionName,
    narrative,
  };
}
