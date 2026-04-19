# MRT System Doctrine — Simons / Medallion Alignment

## 1) Mission (what this app is)

MRT is not a fixed-strategy app. MRT is a **signal discovery and lifecycle machine**.

Primary objective:
- discover weak, repeatable edges,
- validate with strict statistics,
- combine across many signals,
- monitor decay,
- retire and replace continuously.

This is the closest practical alignment to the known RenTech/Medallion philosophy.

---

## 2) Alignment to Simons-Medallion-RenTech (practical)

### What aligns now
- **Signal factory mindset:** many weak signals over one "hero" algo.
- **Statistical gatekeeping:** IS/OOS split + t-stats + FDR (Benjamini-Hochberg).
- **Automation first:** processor + API + monitor loop with minimal discretion.
- **Non-stationarity awareness:** regime snapshot + planned decay lifecycle.

### What is partially aligned (in progress)
- **Regime-aware weighting:** regime exists; full posterior-gated weights still needed.
- **Capacity and cost realism:** high-level present, needs explicit impact/cost in objective.
- **Signal lifecycle manager:** discovery exists; promotion/probation/retirement policy still to formalize in code.

### What does NOT align yet (must build)
- live market-impact-aware execution research loop,
- per-signal capacity ceilings and AUM constraints,
- full cross-asset correlation/risk decomposition and crowding diagnostics.

---

## 3) Current MRT system (as built)

### Runtime
- Single launcher: `./gort.sh` (root) starts M3D + MRT (:3040).
- MRT local launcher: `MRT/gort.sh`.

### Modes
- `./gort.sh` -> full stack
- `cd MRT && ./gort.sh process` -> snapshot (`mrt_snapshot.json`)
- `cd MRT && ./gort.sh discover` -> discovery output (`mrt_discovery.json`)
- `cd MRT && ./gort.sh api` -> MRT API :3040

### Data
- `ds/data/futures.db` (bars_5m universe)

### Outputs
- `MRT/data/mrt_snapshot.json` (baseline ensemble + regime summary)
- `MRT/data/mrt_discovery.json` (feature discovery candidates + q-values)

### UI
- `/mrt` monitor page:
  - market candles + system equity + trade markers,
  - signal radar,
  - IS/OOS diagnostics,
  - performance tiles.

---

## 4) Do we have alpha now?

Short answer: **we have candidate alpha, not proven durable alpha yet.**

Current status:
- Discovery engine is producing statistically significant candidates (post-FDR),
- but durable alpha requires:
  - walk-forward stability,
  - cost-adjusted returns,
  - decay tracking by regime,
  - out-of-time validation windows.

Treat current signals as **research inventory**, not production truth.

---

## 5) Kelly and regime: what to do

### Kelly
- RenTech likely used position sizing principles (possibly Kelly-like variants), but no public "pure Kelly" confirmation.
- MRT should use **fractional Kelly with hard caps**:
  - base fraction by signal confidence,
  - clamp by drawdown/correlation/capacity limits,
  - always subordinate to risk gate.

### Regime
- Regime is necessary for practical non-stationary markets.
- Use regime as **weighting gate**, not a narrative label.
- Next implementation target:
  - HMM/state model -> posterior probabilities,
  - posterior-weighted signal exposure,
  - automatic shrink when posterior uncertainty is high.

---

## 6) Current algo set vs future set

## A) Current core MRT baseline algos (live in snapshot mode)
1. `REV_1` — 1-bar reversal
2. `MOM_5v20` — short-vs-long return momentum
3. `RANGE20` — rolling range position
4. `TREND12` — return-sign participation trend

These are baseline scaffolding, not the final moat.

## B) Current discovery candidates (from `mrt_discovery.json`)
Most frequent winners across symbols so far:
- `RET_MA3_SQSGN`
- `RET_MA5`
- `RET_MA10`
- `RET_MA3`
- `RET_MA5_SQSGN`
- `RET_MA10_SQSGN`
- `RET_L2`
- `PRICE_Z50_SQSGN`
- `VOL10_SQSGN`
- `RET_L3`

Symbols with strongest candidate depth (passed FDR count):
- `DOT` (18)
- `LINK` (15)
- `ARB` (13)
- `DOGE` (9)
- `FIL` (9)

## C) Future algo families (roadmap candidates)
1. **Cross-sectional**
   - relative momentum ranks,
   - dispersion/reversion spreads,
   - sector/cluster residuals.
2. **Volatility-state-aware signals**
   - vol-adjusted momentum/reversal,
   - state-conditioned thresholds.
3. **Cointegration / residual alphas**
   - pair and basket residual z-score models.
4. **Microstructure proxies (OHLCV-first)**
   - impact and liquidity proxy features,
   - turnover-aware edge ranking.
5. **Entropy / complexity transforms**
   - rolling entropy and regime complexity metrics.
6. **Execution-aware meta-signals**
   - signal viability after modeled slippage and impact.

---

## 7) Can we continue MRT legacy?

Yes. The project is now set up to continue as a RenTech-style program if we keep this discipline:

1. discovery never stops,
2. every promotion is evidence-based,
3. every signal has a retirement rule,
4. no discretionary override in execution path.

If we drift back to static hand-picked algos, we lose the thesis.

---

## 8) What we need to do next (execution plan)

## Phase 1 — harden discovery (now)
- Add walk-forward folds to discovery report.
- Add turnover and slippage proxy penalties.
- Add candidate correlation clustering (avoid redundancy).
- Produce `promote / probation / retire` tags automatically.

## Phase 2 — regime-aware weighting
- Implement HMM/state model over vol/correlation/liquidity proxies.
- Replace static weights with posterior-weighted allocations.
- Add uncertainty-aware exposure shrink logic.

## Phase 3 — production research controls
- Capacity model per signal.
- Daily decay dashboard (IC half-life, OOS drift).
- Safety integration: risk gate + kill-switch + exposure constraints in one route.

---

## 9) Research tasks for AI experts (swarm-ready)

Ask experts these specific questions:

1. "Design walk-forward with embargo for 5m futures bars; what split and retrain cadence minimizes leakage?"
2. "Given 200+ candidate transforms, what FDR and effect-size filters best balance false discovery vs missed edge?"
3. "How to estimate turnover-adjusted alpha with only OHLCV and no L2?"
4. "Which changepoint tests best detect signal death early (CUSUM, Bayesian online change detection, sup-F)?"
5. "How to cluster and de-duplicate correlated candidates before ensemble weighting?"
6. "How to map HMM posterior uncertainty into dynamic position scaling?"
7. "What promotion policy beats static top-N selection under non-stationarity?"

---

## 10) When to research new anomalies

Trigger anomaly research when any of these happen:
- OOS t-stat flips sign vs IS for 2+ windows,
- q-values deteriorate across successive retrains,
- hit-rate/IC decay persists despite stable costs,
- regime transition causes repeated drawdown clusters.

Research objective is not "find a better indicator".
Research objective is: **identify data-generating-process change and adapt the library.**

---

## 11) Guardrails (non-negotiable)

- Never promote a signal on one lucky window.
- Never ignore costs/turnover in ranking.
- Never run live route without risk gate.
- Never keep dead signals because of past performance.

System principle: **the library survives by replacing itself.**
