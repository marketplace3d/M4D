/**
 * Single source of truth for PulseHero / council “Jedi alignment” tuning.
 * Bank hierarchy MUST stay in sync with `tools/algo-execution` env defaults:
 * ALGO_EXEC_BANK_H_A / _B / _C (0.2 / 0.3 / 0.5 — LEGEND heaviest).
 *
 * Full combination doc (viz + execution + iter-opt): `spec-kit/docs/MAXJEDIALPHA.md`
 */
export const BANK_H_W_BOOM = 0.2;
export const BANK_H_W_STRAT = 0.3;
export const BANK_H_W_LEGEND = 0.5;

/** Conviction = (non-flat among 27) / 27. Below this → DEAD MARKET. */
export const DEAD_MARKET_CONVICTION_LT = 25;

/** unsigned bank-tension score ∈ [0,1] — above this while FLAT → DANGER */
export const DANGER_X_ENERGY_GT = 0.55;

/** |sum of 27 votes| required for GO (non-FLAT). */
export const GO_SCORE_ABS_MIN = 12;

export const DIRECTION_LONG_MIN = 7;
export const DIRECTION_SHORT_MAX = -7;
