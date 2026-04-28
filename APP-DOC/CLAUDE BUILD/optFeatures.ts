// =============================================================================
// SURGE v3 — Opt / feature flags (grid-search, walk-forward, A/B in prod)
// Tune these instead of forking — consumed by Fused + BRK + (optional) backtest
// =============================================================================

import type { BRKConfig } from './brkEngine.js';

/** Liquidity: ICT-style BSL/SSL pools + sweeps (see smcEngine + ictLiquidity) */
export interface LiqOptFeatures {
  /** When true, fusion may take direction from SSL/BSL *sweep alone* (rejection bar). */
  allowLiqSweepAlone: boolean;
  /** ATR multiple: price within this of an unswept BSL/SSL → composite / priority boost. */
  maxAtrToLiqForBoost: number;
  /** 0..15 added to raw composite when near ICT liq and direction agrees. */
  ictLiqConfluenceBoost: number;
  /** If true, block fused trade unless BRK or liq-sweep or near-level context exists. */
  requireBrkOrLiqContext: boolean;
}

export interface FusedOptWeights {
  smc: number;
  brk: number;
  mom: number;
}

export interface SurgeOptFeatures {
  liq: LiqOptFeatures;
  fusedWeights: FusedOptWeights;
  /** Passed into BRK — `ict` = tap level + close reclaimed past break (tighter) */
  brkRetestMode: BRKConfig extends { retestMode?: infer R } ? R : 'standard' | 'ict';
}

export const DEFAULT_LIQ_OPT: LiqOptFeatures = {
  allowLiqSweepAlone: true,
  maxAtrToLiqForBoost: 1.25,
  ictLiqConfluenceBoost: 8,
  requireBrkOrLiqContext: false,
};

export const DEFAULT_FUSED_WEIGHTS: FusedOptWeights = {
  smc: 0.55,
  brk: 0.35,
  mom: 0.1,
};

export const DEFAULT_SURGE_OPT: SurgeOptFeatures = {
  liq: { ...DEFAULT_LIQ_OPT },
  fusedWeights: { ...DEFAULT_FUSED_WEIGHTS },
  brkRetestMode: 'standard',
};

export function mergeSurgeOpt(
  base: SurgeOptFeatures = DEFAULT_SURGE_OPT,
  patch?: Partial<SurgeOptFeatures> & {
    liq?: Partial<LiqOptFeatures>;
    fusedWeights?: Partial<FusedOptWeights>;
  },
): SurgeOptFeatures {
  if (!patch) return base;
  return {
    brkRetestMode: patch.brkRetestMode ?? base.brkRetestMode,
    fusedWeights: { ...base.fusedWeights, ...patch.fusedWeights },
    liq: { ...base.liq, ...patch.liq },
  };
}
