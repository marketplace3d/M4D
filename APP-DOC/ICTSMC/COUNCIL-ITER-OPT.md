# ICTSMC — Council Iter-Opt Brief

## Objective
- Build ICTSMC as an independent institutional sleeve with:
  - Early but disciplined entries
  - Primary exits at next liquidity draw level
  - Re-entry only on qualified retest/expansion
  - CIS emergency only in starter mode

## Current System Policy
- `PRO` account mode:
  - Exit policy: `LIQUIDITY_LEVEL`
  - CIS emergency: OFF
  - EOD force close: ON
- `STARTER` account mode:
  - Exit policy: `LIQUIDITY_LEVEL`
  - CIS emergency: ON
  - EOD force close: ON
- Optional alternative: `EMA13` exit mode for A/B test.

## Iter-Opt Status
- ICT walkforward endpoint:
  - `POST /v1/ict-walkforward/run/` -> launched
  - `GET /v1/ict-walkforward/progress/` -> `done`, `42/42 folds`, `100%`
- Full futures optimization sweep completed (5m killzone mode).

## Key Findings (Actionable)
- Strongest additive timing effect remains killzone routing.
- Hard OB/FVG over-gating can degrade edge vs lighter timing filters.
- CIS as primary exit is weak; keep as emergency only for starter accounts.
- Station/liquidity target exits are preferable base policy.
- Re-entry can dilute expectancy if not heavily filtered.

## ICTSMC Re-entry Rule (Current)
- Re-entry allowed only when all are true:
  - Runner enabled (BOOM expansion >= threshold)
  - Edge score >= 78
  - Direction != HOLD
  - Retest re-entry enabled in config

## Council Questions (Next Iteration)
1. Should re-entry risk be fixed at 50-70% of initial risk to improve expectancy?
2. Should second-leg TP be closer (e.g., 1.0-1.3R from retest) vs next full level?
3. Should EMA13 be used as runner stop instead of fixed adverse cutoff?
4. Should expansion threshold be dynamic by regime/session?
5. Should killzone off-session exceptional threshold be raised from 78 to 82?

## Run Commands
- Single decision:
  - `npx tsx "APP-DOC/ICT/files-ts/ictsmc-run.ts" --ticker ES`
- Starter profile:
  - `npx tsx "APP-DOC/ICT/files-ts/ictsmc-run.ts" --ticker ES --starter`
- EMA exit A/B:
  - `npx tsx "APP-DOC/ICT/files-ts/ictsmc-run.ts" --ticker ES --ema-exit`
- Re-entry simulation:
  - `npx tsx "APP-DOC/ICT/files-ts/ictsmc-run.ts" --ticker ES --reentry-sim`

## Snapshot Artifacts
- Full sweep: `ds/data/ictsmc_opt_full_sweep.json`
- Strict shortlist: `ds/data/ictsmc_opt_strict_shortlist.json`
- Algo snapshot for council review:
  - `APP-DOC/ICTSMC/ICTSMC-ALGO-CANDIDATE.ts`
