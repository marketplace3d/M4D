// =============================================================================
// SURGE v3 — Fused Signal Engine
// Combines SMC state + BRK signal + Momentum gates
// Outputs FusedSignal → consumed by LLM Arbitrator
//
// Priority (conflict resolution):
//   CHoCH + OB S&F  = 5   highest quality, reversal confirmed
//   OB S&F only     = 4   institutional entry
//   Liq Sweep + BRK = 4   stop hunt + structure break
//   BRK confirmed   = 3   structure break retest
//   BOS + MTF       = 3   trend continuation
//   Liq Sweep only  = 2   context, not standalone
//   FVG             = 1   supporting evidence
//   MOM gates       = 1   confirmation only, never primary
// =============================================================================

import { nanoid }   from "nanoid";
import type {
  OHLCV, FusedSignal, SignalDir, MomGates,
} from "../../types/index.js";
import type { SMCState }  from "./smcEngine.js";
import type { BRKSignal } from "../../types/index.js";
import { gatesBlock, gatesConfirmStrength } from "./momGates.js";

export function buildFusedSignal(params: {
  ticker:   string;
  tf:       string;
  bar:      OHLCV;
  smc:      SMCState | null;
  brk:      BRKSignal | null;
  mom:      MomGates  | null;
}): FusedSignal | null {
  const { ticker, tf, bar, smc, brk, mom } = params;

  // Need at least one primary signal
  if (!smc && !brk) return null;

  // ── Direction resolution ───────────────────────────────────────────────
  let direction: SignalDir = "HOLD";
  const keyEvents: string[] = [];

  // Highest priority: CHoCH (structural reversal) present
  if (smc?.newCHoCH) {
    direction = smc.newCHoCH.type.includes("BULL") ? "LONG" : "SHORT";
    keyEvents.push(`CHoCH ${direction} — structural reversal`);
  }
  // OB Sweep-and-Fill (institutional entry confirmed)
  if (smc?.newOBSF) {
    const d = smc.newOBSF.direction === "BULL" ? "LONG" : "SHORT";
    if (direction === "HOLD") direction = d;
    else if (direction !== d) direction = "HOLD";   // conflict
    keyEvents.push(`OB Sweep+Fill ${d}`);
  }
  // Liq sweep + BRK alignment
  if (smc?.newLiqSweep && brk && brk.signal !== "HOLD") {
    const d = brk.signal;
    if (direction === "HOLD") direction = d;
    keyEvents.push(`Liq Sweep (${smc.newLiqSweep.type}) + BRK ${d}`);
  }
  // BRK alone
  if (brk && brk.signal !== "HOLD" && direction === "HOLD") {
    direction = brk.signal;
    keyEvents.push(`BRK Retest ${direction} — ${brk.breakQuality} break`);
  }
  // BOS (trend continuation — lower priority, only use if nothing else)
  if (smc?.newBOS && direction === "HOLD") {
    direction = smc.newBOS.type.includes("BULL") ? "LONG" : "SHORT";
    keyEvents.push(`BOS ${direction} — trend continuation`);
  }

  if (direction === "HOLD") return null;

  // ── Momentum gate conflict check ───────────────────────────────────────
  const gateConflict = mom ? gatesBlock(mom, direction as "LONG"|"SHORT") : false;
  if (gateConflict) {
    keyEvents.push(`MOM GATE CONFLICT — ${direction} blocked`);
    direction = "HOLD";
    return null;   // Hard block: strong opposing EMA stack + stoch extreme
  }
  const gateStrength = mom ? gatesConfirmStrength(mom, direction as "LONG"|"SHORT") : 0.5;

  // ── Composite score ───────────────────────────────────────────────────
  // SMC 55% + BRK 35% + MOM 10%
  const smcNorm  = smc  ? smc.normScore : 50;
  const brkNorm  = brk  ? brk.confidence : 50;
  const momScore = mom  ? (mom.compositeScore + 1) / 2 * 100 : 50;

  const rawComposite = smcNorm * 0.55 + brkNorm * 0.35 + momScore * 0.10;

  // Adjust for gate strength (up to +5 boost)
  const composite = Math.min(100, rawComposite + gateStrength * 5);

  // FVG annotation
  if (smc?.newFVG) keyEvents.push(`FVG ${smc.newFVG.direction} detected`);
  if (smc?.newLiqSweep && !brk) keyEvents.push(`Liq ${smc.newLiqSweep.type} sweep (standalone)`);

  return {
    id:             nanoid(8),
    ticker,         tf,
    ts:             bar.ts,
    smc:            smc ? {
      source: "SURGE_SMC", id: nanoid(6),
      ts: bar.ts, ticker, tf,
      signal: direction,
      confidence: smc ? Math.abs(smc.smcScore) : 50,
      smcScore: smc?.smcScore ?? 0,
      bosType:     smc?.newBOS?.type   ?? null,
      chochType:   smc?.newCHoCH?.type ?? null,
      liqSweep:    smc?.newLiqSweep    ?? null,
      obSweepFill: smc?.newOBSF        ?? null,
      fvgDetected: smc?.newFVG         ?? null,
      trendBull:   smc?.trendBull      ?? false,
      entry: bar.close, sl: brk?.sl ?? 0, tp1: brk?.tp1 ?? 0, tp2: brk?.tp2 ?? 0,
      atr: brk?.atr ?? 0,
    } : null,
    brk:            brk ?? null,
    mtf:            null,   // populated by MTFEngine when used
    mom:            mom ?? null,
    compositeScore: composite,
    direction,
    keyEvents,
  };
}

// ─── Priority ranker (for arbitrator prompt building) ─────────────────────────
export function signalPriority(fused: FusedSignal): number {
  let p = 0;
  if (fused.smc?.chochType)  p = Math.max(p, 5);
  if (fused.smc?.obSweepFill && fused.smc?.chochType) p = Math.max(p, 5);
  if (fused.smc?.obSweepFill) p = Math.max(p, 4);
  if (fused.smc?.liqSweep && fused.brk) p = Math.max(p, 4);
  if (fused.brk) p = Math.max(p, 3);
  if (fused.smc?.bosType) p = Math.max(p, 2);
  return p;
}
