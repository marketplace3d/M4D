# I-OPT-OOO — Master: Co-Trading · Max Cognitive Visual · M3D/M4D → W4D

**Purpose:** Single reference for whether the **feature set is “complete”** for a future private family-office hedge fund (W4D-grade), what is missing, how to iterate, and what “gold” looks like in product and ops.

---

## 1) Naming (avoid confusion)

| Layer | Role |
|-------|------|
| **M3D** | Council + engine + API + `site/` Blueprint UI — science stack, ports per [CLAUDE.md](../../CLAUDE.md) |
| **M4D** | Human oracle / MaxCogViz / richer visual command room — see [AGENT/M4D-BRIEF.md](../../AGENT/M4D-BRIEF.md) |
| **W4D** | WorldQuant-style quant hedge-fund layer — [W4D/W4D.md](../../W4D/W4D.md) (note: default data modes and live vs synthetic) |

**I-OPT-OOO** = **Iter-Opt** (build/measure/iterate) + **Oracle Optimization** (human + AI decision quality under constraints).

---

## 2) Is the feature set “complete”?

**Short answer: no** — not for institutional family-office / hedge-fund operations. The stack is **strong on research, signals, council UX, and paper-style execution hooks**; it is **not yet complete on durable OMS, hard risk at the execution boundary, reconciliation, auth/audit, and production SRE**.

### Completeness scorecard (honest ranges)

| Domain | Approx. maturity | Notes |
|--------|------------------|--------|
| Signal / council / engine pipeline | 70–85% | Engine loop, SQLite + JSON snapshots, 27+JEDI concept |
| API surface + static site | 65–80% | Axum routes, health, reload, WS backends |
| DS research (backtest, risk reports, adapters) | 55–75% | Broad; uneven production hardening |
| Real-time UX (WS → UI) | 40–60% | Backend WS exists; frontend adoption varies |
| Execution (paper brokers) | 45–65% | Adapters exist; not full OMS-grade |
| Governance (auth, audit, model registry) | 15–35% | Must be explicit for W4D |
| Family-office ops (multi-account, mandates) | 10–30% | Design-time |

---

## 3) Proposals (what to build next)

### P0 — Trading safety core (weeks 1–4)

1. **Canonical order state machine** — submitted → ack → partial → fill / reject / cancel; single source of truth per broker.
2. **Hard pre-trade risk** — enforce limits at order send, not only advisory DS reports (align with [AGENT/AGENTS.md](../../AGENT/AGENTS.md) safety rules).
3. **Kill switch + daily halt** — one operator path; UI + API contract (M4D brief already names flatten/drawdown behaviors as targets).
4. **Immutable decision log** — who/what/when for intent, overrides, and model version ID on every signal that can become an order. **Shipped:** shared module [`ds/ds_app/order_intent_log.py`](../../ds/ds_app/order_intent_log.py) — env `PAPER_OPERATOR_ID` (default `system`), optional `M3D_PIPELINE_REV` in JSON; each snapshot includes **`algo_day_timestamp`** from `engine/data/algo_day.json` when present. **Alpaca:** `order_intent` in `paper_trades.db`; every `place_order` + CIS **close_position**; `GET /v1/paper/status/` → `recent_order_intent`. **IBKR:** same table in `ibkr_trades.db` for `place_market`, `close_position`, exit/scale/entry, `flatten` CLI; `GET /v1/ibkr/status/` → `recent_order_intent`. **Read-only merge:** `GET /v1/audit/order-intent/?broker=all|alpaca|ibkr&limit=50` (same path on Rust api **:3300** proxies to DS; **`M3D_DS_BASE`**). Optional **`cycle_id=`** (8–32 hex) filters to one run. Each **`run_cycle`** generates a **`cycle_id`** (16 hex chars) returned on paper run JSON responses and embedded in every `order_intent.snapshot_json` for that pass.

### P1 — Institutional reliability (weeks 5–8)

5. **Reconciliation** — broker fills vs internal positions; PnL/NAV sanity checks.
6. **Model governance** — versioned strategies; promotion gates; shadow vs live.
7. **Observability** — structured metrics, alerts on stale data, engine/API latency, WS health.
8. **Data quality** — stale-feed detection, bad-tick handling, lineage notes on snapshots.

### P2 — Cognitive “gold” layer (weeks 9–12)

9. **Jedi command loop in UI** — Observe (council + regime) → Decide (Oracle + risk) → Execute (mandate) → Review (PnL + attribution).
10. **Explainability overlays** — “why now,” dissent (bear case), confidence decomposition (JEDI as score, not binary — per AGENTS).
11. **Scenario / what-if** — stress basket, correlation unwind, session risk before send.

---

## 4) Gaps (blockers to W4D-grade)

| Gap | Why it matters |
|-----|----------------|
| Durable OMS/EMS | Without it, scaling capital or multiple accounts is unsafe |
| Risk at execution boundary | Research risk ≠ enforced risk |
| Reconciliation | Without it, you cannot trust PnL or compliance |
| AuthN/AuthZ + secrets | Family office cannot run on trust-local alone |
| Audit trail | Regulatory and internal governance requirement |
| TCA / execution quality | Needed to know if alpha is real or slippage |
| Multi-account mandates | Sleeves, concentration, per-entity policy |

---

## 5) Success factors (non-negotiables)

1. **Single SSOT** for algo IDs and contracts — in-repo: [M4D/public/council-algos.v1.json](../../M4D/public/council-algos.v1.json) (also mirrored per `CLAUDE.md` under `M4D-REF-TEMP/spec-kit/` when that tree is present), aligned with `api/src/models.rs` and `site/src/types`.
2. **Traceability** — every live order links to signal version + risk snapshot.
3. **Human override ergonomics** — fast approve/reject with explicit reason code.
4. **Latency budget** — define max acceptable delay signal → intent → broker ack.
5. **Daily ritual** — pre-open checks, post-close review, drift/decay report.

---

## 6) Oracle Optimization options (OO modes)

| Mode | Behavior | When to use |
|------|----------|-------------|
| **A — Advisory Oracle** | AI ranks; human sends every order | Lowest risk; training wheels |
| **B — Guardrailed semi-auto** | Auto within mandate + risk box; human for exceptions | **Recommended default** for family office |
| **C — Full auto + circuit breakers** | Max speed; max governance need | Only after P0/P1 proven |

**Recommendation:** **Mode B** until reconciliation + audit + hard risk are green in production drills.

---

## 7) MasterTrader / Jedi “winning touches”

These are product differentiators when the plumbing is solid:

- **Regime-first activation** — strategies trade only when regime confidence clears threshold (see regime/risk visuals in [BUILD-W4D-DOCS](../BUILD-W4D-DOCS/)).
- **Confidence-weighted sizing** — combine signal strength, vol, liquidity; avoid flat sizing (AGENTS: conviction-scaled).
- **Dissent surface** — always show bear case / GHOST view (M4D brief).
- **Session intelligence** — kill zones, session phase, aggression schedule (HALO-style entry spread in M4D brief).
- **Trade quality gate** — skip marginal trades even with positive raw alpha (DS has trade-quality concepts; wire to decisions).

---

## 8) “Next level gold” — product north star

Users should feel three things in under 10 seconds:

1. **Situational awareness** — regime, JEDI, top risk flags.
2. **Decision clarity** — top 3 actions, size, and why.
3. **Safety** — flatten and halt are obvious and trusted.

Visuals serve cognition, not decoration: MaxCogViz radar + council matrix + execution status should tell one coherent story (see [VIZ-DIAGRAM-SPEC.MD](VIZ-DIAGRAM-SPEC.MD)).

---

## 9) Review cadence (I-OPT-OOO loop)

```
SPEC → IMPLEMENT → MEASURE (edge, decay, slippage, incidents) → ITER-OPT → RE-SPEC
```

- Weekly: risk incidents, stale data events, model drift.
- Monthly: strategy promotion/demotion, mandate review.

---

## 10) Document control

- **Owner:** trading + platform leads.
- **Updates:** when P0/P1 items ship or when W4D default data mode / execution scope changes.

---

## 11) How this relates to `BUILDOUT-PROGRESS.md` (do not mix them up)

| Doc | What it is | Use it for |
|-----|------------|------------|
| **[AGENT/BUILDOUT-PROGRESS.md](../../AGENT/BUILDOUT-PROGRESS.md)** | Session build log: shipped DS/UI items, walk-forward metrics, signal lifecycle, paper-adapter checklist | “What did we code? What research numbers did that session produce?” |
| **This file (I-OPT-OOO-MASTER)** | Cross-cutting **institutional / family-office** gap analysis and phased program | “What is still missing for real capital, governance, and ops?” |

Many rows in BUILDOUT are marked **DONE** for **research + paper trading + gates**. That does **not** automatically satisfy Sections **3–4** here (durable OMS, hard risk at send, reconciliation, auth/audit). Treat BUILDOUT as **velocity on the alpha stack**; treat I-OPT-OOO as **readiness for scaled or regulated capital**.

---

## 12) 90-day program (concrete)

Map Sections 3–5 to a rolling quarter. Adjust dates; structure stays the same.

### Days 1–30 — Prove the safety spine

| Week | Focus | Exit criteria (examples) |
|------|--------|---------------------------|
| 1 | Order + intent model | Documented states (submitted → fill/reject); one broker path traced end-to-end on paper |
| 2 | Hard risk at send | Limits enforced in code path that actually submits orders; daily halt / kill reachable from UI or API |
| 3 | Decision log | Every order intent has: signal/strategy id, version, risk snapshot id, operator id (or system) |
| 4 | Drill | Tabletop: “stale feed + half-open order” — runbook + outcome |

### Days 31–60 — Prove reliability

| Week | Focus | Exit criteria |
|------|--------|----------------|
| 5–6 | Reconciliation | Daily match: broker positions vs internal; break resolution process |
| 7 | Observability | Alerts for API/engine/DS health + stale `algo_day` / bar data |
| 8 | Model governance | Named strategy versions; promotion rule (e.g. shadow → small notional → full) |

### Days 61–90 — Cognitive command loop + attribution

| Week | Focus | Exit criteria |
|------|--------|----------------|
| 9–10 | Jedi loop UX | One screen path: Observe → Decide → Execute → Review with linked explainability |
| 11 | Attribution | P&L or paper P&L tagged by signal/regime slice (minimum viable journal) |
| 12 | Review | Go/no-go for increasing notional or adding accounts |

---

## 13) KPI definitions (make “success” measurable)

Define targets with the team; track weekly.

| KPI | Definition | Why |
|-----|------------|-----|
| **Time-to-ack** | p95 latency from intent → broker ack (paper first) | Catches path regressions |
| **Recon break rate** | % of days with unresolved position mismatch | Trust in books |
| **Risk veto rate** | % of signals blocked by hard risk vs total signals | Tuning risk vs opportunity |
| **Stale data incidents** | Count of trades or signals while feed/snapshot stale | Data-quality gate |
| **Incident MTTR** | Mean time to resolve kill-switch / halt events | Ops maturity |
| **Strategy drift** | IC or score decay vs prior window (per [BUILDOUT-PROGRESS](../../AGENT/BUILDOUT-PROGRESS.md) IC tools where applicable) | When to demote a model |

---

## 14) Next artifacts (optional but high value)

1. **Static SVG** — **Shipped:** [assets/iopt_ooo_system_layers.svg](assets/iopt_ooo_system_layers.svg) (M3D → M4D → hard risk → W4D). Note file: [assets/DIAGRAM-SVG-SOURCE.md](assets/DIAGRAM-SVG-SOURCE.md) (pointer only — edit the `.svg`). Spec: [VIZ-DIAGRAM-SPEC.MD](VIZ-DIAGRAM-SPEC.MD).
2. **One-page operator runbook** — **Shipped:** [OPERATOR-RUNBOOK.MD](OPERATOR-RUNBOOK.MD) (flatten, halt, rollback, escalation placeholders, health curls).
3. **Cross-link** from [AGENT/SYSTEM-SPEC.md](../../AGENT/SYSTEM-SPEC.md) — **Shipped:** Section **16** points to this folder and the SVG.

---

## 15) IOPT Surface Panels (live interface standard)

These are the necessary panels to surface in M4D so operators can act without switching context:

- **Action Bus Receipts panel** — `ACK/PARTIAL/ERR`, `eventId`, scope, and message for every action (`close_longs`, `close_shorts`, `flatten_lock`, `rescue`).
- **Account Scope panel** — explicit `ALL|PAPER|IBKR` state visible before any action fires.
- **MT5 Position Matrix panel** — sortable columns: symbol, side, qty, avg, unrealized, account, kill-switch.
- **Rescue Stage panel** — freeze -> cancel pending -> flatten -> server lock -> audit event; must halt on failed stage.
- **Server Lockdown panel** — terminal authority commands visible (`go.sh lock-on`, `go.sh lock-status`) with copy affordance.
- **Layout Profile panel** — `4K|DESKTOP|COMPACT` profile state to keep controls legible in each runtime form factor.

### Surface policy

- No mock data should be shown as live market context.
- If a scope/action is not yet implemented (e.g., paper flatten endpoint), surface explicit `PARTIAL` or `ERR` receipt; never silent success.
