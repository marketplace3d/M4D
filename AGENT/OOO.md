# OOO — Oracle Optimization Loop
*Distilled 2026-04-24 · Source: AGENT1/I-OPT-OOO/I-OPT-OOO-MASTER.MD*

---

## WHAT OOO IS

**Iter-Opt + Oracle Optimization** — build/measure/iterate loop for alpha research → paper → institutional readiness.

Current state: strong research + signals + paper hooks. NOT production-grade on OMS, hard risk, reconciliation, audit.

---

## COMPLETENESS SCORECARD

| Domain | Maturity |
|--------|----------|
| Signal / council / engine pipeline | 70–85% |
| API surface + static site | 65–80% |
| DS research (backtest, risk, adapters) | 55–75% |
| Real-time UX (WS → UI) | 40–60% |
| Execution (paper brokers) | 45–65% |
| Governance (auth, audit, model registry) | 15–35% |
| Family-office ops (multi-account, mandates) | 10–30% |

---

## BUILD ORDER (P0 → P2)

### P0 — Trading safety core (weeks 1–4)
1. **Canonical order state machine** — submitted → ack → partial → fill / reject / cancel
2. **Hard pre-trade risk** — enforce limits at order send (not advisory only)
3. **Kill switch + daily halt** — UI + API, flatten/drawdown behaviors
4. **Immutable decision log** — shipped: `order_intent_log.py` · `cycle_id` per run · `GET /v1/audit/order-intent/`

### P1 — Institutional reliability (weeks 5–8)
5. **Reconciliation** — broker fills vs internal positions, PnL/NAV sanity
6. **Model governance** — versioned strategies, promotion gates, shadow vs live
7. **Observability** — structured metrics, alerts on stale data, engine/API latency
8. **Data quality** — stale-feed detection, bad-tick handling, lineage on snapshots

### P2 — Cognitive gold layer (weeks 9–12)
9. **Jedi command loop** — Observe → Decide → Execute → Review in UI
10. **Explainability overlays** — why now, dissent (bear case), JEDI confidence decomposition
11. **Scenario / what-if** — stress basket, correlation unwind, session risk before send

---

## W4D BLOCKERS (gaps that prevent scaling)

| Gap | Why it matters |
|-----|----------------|
| Durable OMS/EMS | Unsafe to scale capital or multi-account without it |
| Risk at execution boundary | Research risk ≠ enforced risk |
| Reconciliation | Cannot trust PnL or compliance without it |
| AuthN/AuthZ + secrets | Family office cannot run on trust-local |
| Audit trail | Regulatory + internal governance |
| TCA / execution quality | Need to know if alpha is real or slippage |
| Multi-account mandates | Sleeves, concentration, per-entity policy |

---

## ORACLE MODES

| Mode | Behavior | Status |
|------|----------|--------|
| A — Advisory Oracle | AI ranks; human sends every order | Lowest risk |
| **B — Guardrailed semi-auto** | Auto within mandate + risk box; human for exceptions | **Recommended now** |
| C — Full auto + circuit breakers | Max speed; max governance need | After P0/P1 proven |

**Use Mode B until reconciliation + audit + hard risk are green in production drills.**

---

## "GOLD" PRODUCT CRITERIA (10-second test)

User must feel three things in under 10 seconds:
1. **Situational awareness** — regime, JEDI, top risk flags
2. **Decision clarity** — top 3 actions, size, and why
3. **Safety** — flatten and halt are obvious and trusted

---

## WINNING PRODUCT TOUCHES

- Regime-first activation — strategies trade only when regime confidence clears threshold
- Confidence-weighted sizing — signal strength × vol × liquidity (never flat sizing)
- Dissent surface — always show bear case / GHOST view
- Session intelligence — kill zones, session phase, aggression schedule (HALO)
- Trade quality gate — skip marginal trades even with positive raw alpha

---

## AUDIT TRAIL (shipped)

`order_intent_log.py` — every paper action writes `order_intent` row:
- `algo_day_timestamp` from `engine/data/algo_day.json`
- `cycle_id` (16 hex chars) — all orders from one `run_cycle`
- Alpaca: `paper_trades.db` · IBKR: `ibkr_trades.db`
- `GET /v1/audit/order-intent/?broker=all|alpaca|ibkr&limit=50&cycle_id=…`
- Rust API :3300 proxies same path to DS; `M3D_DS_BASE` env to override
