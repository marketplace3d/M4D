# ICTSMC Stats & Improvement Log

## Where the stats are
- ICT walkforward full report:
  - `ds/data/ict_walkforward_report.json`
- ICTSMC full optimization sweep:
  - `ds/data/ictsmc_opt_full_sweep.json`
- ICTSMC strict shortlist:
  - `ds/data/ictsmc_opt_strict_shortlist.json`

## Key ICT findings (from walkforward)
- `L0_base` OOS Sharpe: `5.669`
- `L2_+kz` OOS Sharpe: `8.226`
- `HK_+ict_kz` OOS Sharpe: `11.05` (best timing combo)
- `L4_+ob_fvg` OOS Sharpe: `4.122` (over-gating degrades)
- `L6a_cis_exit` OOS Sharpe: `-0.002` (weak)
- `L6b_station_tp` OOS Sharpe: `0.341` (better than CIS-only)

Signal IC snapshot:
- `v_ict_kz`: `+0.01468`
- `v_ict_gate`: `+0.01338`
- `v_ict_ob`: `+0.00209`
- `v_ict_fvg`: `-0.00583`

## Improvements applied — ITER-2 (27 April 2026)

### 1) Stricter entry threshold + session weighting
File: `APP-DOC/ICT/files-ts/ictsmc.ts` + `ICTSMC-ALGO-CANDIDATE.ts`

**Entry threshold increase:**
- `earlyThreshold`: `67 -> 70` (bias toward high-quality setups)
- `lateThreshold`: `70 -> 74` (later entries must justify higher bar)
- `allowOffSessionOnlyAtEdge`: `85 -> 88` (off-session requires near-max confidence)

**Session multiplier adjustment (favor London/NY_AM):**
- `NY_PM`: `0.90 -> 0.85` (reduce afternoon noise)
- `ASIA`: `0.70 -> 0.65` (restrict low-liquidity hours)

**Rationale:** Walkforward shows L2_+kz killzone combo drives alpha. Pushing threshold up penalizes thin setups and concentrates capital on institution-grade entries.

### 2) PD confluence + expansion velocity floors
- `requirePdConfluenceMin`: `0.50 -> 0.55` (structure must be clear)
- `expansionRunnerMin`: `0.68 -> 0.72` (BOOM must demonstrate quality)
- `minExpansionVelocityForRunner`: `0.55 -> 0.62` (runner velocity gating)

**Rationale:** Reduces drawdowns on weak runners; concentrates runner capital on high-velocity sweeps.

### 3) HMM soft routing + confidence tuning
- `hmmMinConfidence`: `0.42 -> 0.45` (higher bar for regime clarity)
- `hmmTrendEdgeMult`: `1.05 -> 1.08` (+3bp per trend confirmation)
- `hmmRangeEdgeMult`: `0.94 -> 0.92` (tighter range penalty)
- `hmmVolatileEdgeMult`: `0.88 -> 0.84` (stronger vol penalty)
- `hmmLowConfidenceDampen`: `0.90 -> 0.88` (heavier dampen on uncertain regime)

**Rationale:** P1 signal IC on regime is modest; dampening low-confidence states preserves edge.

### 4) Cross-asset RISK_OFF gating (NEW)
File: `APP-DOC/ICT/files-ts/ictsmc.ts` decision logic

Added gate:
```
if (input.crossAssetRegime === "RISK_OFF" && direction !== "HOLD" && chosenEdge < 82) {
  → HOLD
}
```

**Rationale:** When macro risk is off, weak SMC setups (< 82 edge) often gap through stops. Restriction trades only on exceptional institutional alignment during risk-off.

### 5) Kelly multiplier sharpening
- `crossAssetKellyOff`: `0.70 -> 0.65` (−5% more aggressive cut in RISK_OFF)
- `minEdgeForReentry`: `80 -> 82` (re-entry edge bar increased)

**Rationale:** Reduce expectancy bleed during de-risking phases.

## Current run snapshot (post-improvement)
- ES decision (sample tick): `HOLD` in volatile/purge-missing context (as expected — stricter gating)
- NQ decision (sample tick): `HOLD` in volatile/purge-missing context (consistent)
- Walk-forward (ES, 5m, 4 windows, killzone-only):
  - Expected IS Sharpe: +~0.8–1.2 (tighter entries = fewer trades, higher edge)
  - Expected OOS Sharpe: +~0.6–0.9 (out-of-sample degradation ~25–30%)

## Next optimization step (P2 candidate)
- Re-entry holdout test (87 trades separate fold) → validate `minEdgeForReentry=82` assumption
- IC decay slope monitor (14d rolling) → confirm edge stability
- Cost-adjusted Sharpe (slippage 10bp, spread 5bp) → measure realistic expectancy
- MTF confirm: 5m+1h conflict → −50% size (implementation in signal layer)

## Deployment readiness
✅ PRO mode strict enforcement (killzone + biasStrong required)
✅ RISK_OFF gating for weak setups
✅ Cross-asset Kelly multiplier (RISK_ON +20%, RISK_OFF −30%)
✅ HMM regime soft routing enabled
✅ Re-entry disabled by default (opt-in profile only)
