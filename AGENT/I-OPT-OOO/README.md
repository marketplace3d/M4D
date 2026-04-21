# I-OPT-OOO — Iter-Opt · Oracle Optimization Docs

Canonical folder for **iteration optimization** and **Oracle (human + AI) decision-layer** strategy for M3D (science/council stack), M4D (MaxCogViz / human oracle UI), and W4D (quant hedge-fund layer).

**Status:** Doc pack + layer SVG + operator runbook are **shipped**. This folder is **documentation** (roadmap, KPIs, diagrams). Code work for institutional gaps lives in [I-OPT-OOO-MASTER §3–4](I-OPT-OOO-MASTER.MD) (OMS, hard risk, recon, audit).

**Start here:** [I-OPT-OOO-MASTER.MD](I-OPT-OOO-MASTER.MD) · **Incident:** [OPERATOR-RUNBOOK.MD](OPERATOR-RUNBOOK.MD) · **Map index:** [AGENT/SYSTEM-MAP.md](../../AGENT/SYSTEM-MAP.md#related-architecture-diagrams)

**Audit API — DS :8000 direct, or M3D Rust api :3300 (proxies to DS; set `M3D_DS_BASE` if needed):**

```bash
# Latest order-intent rows (Alpaca + IBKR DBs merged)
curl -s 'http://127.0.0.1:8000/v1/audit/order-intent/?broker=all&limit=30' | jq
curl -s 'http://127.0.0.1:3300/v1/audit/order-intent?broker=all&limit=30' | jq

# Rows for one run_cycle (paste cycle_id from POST /v1/paper/run/ or /v1/ibkr/run/ JSON)
curl -s 'http://127.0.0.1:8000/v1/audit/order-intent/?cycle_id=YOUR16HEXHERE&limit=50' | jq
```

## Contents

| File | Purpose |
|------|---------|
| [I-OPT-OOO-MASTER.MD](I-OPT-OOO-MASTER.MD) | Scorecard, gaps, P0/P1/P2 roadmap, BUILDOUT vs I-OPT distinction, **90-day program**, **KPIs**, next artifacts |
| [OPERATOR-RUNBOOK.MD](OPERATOR-RUNBOOK.MD) | Flatten, halt, rollback, escalation table, health checks |
| [assets/iopt_ooo_system_layers.svg](assets/iopt_ooo_system_layers.svg) | Static M3D → M4D → risk → W4D layer diagram |
| [VIZ-DIAGRAM-SPEC.MD](VIZ-DIAGRAM-SPEC.MD) | SVG, TSX inline, and ReactFlow (@xyflow/react) diagram blueprint + repo paths |
| [assets/DIAGRAM-SVG-SOURCE.md](assets/DIAGRAM-SVG-SOURCE.md) | Pointer only — do not duplicate XML; edit `iopt_ooo_system_layers.svg` |

## Related (elsewhere in repo)

- Workspace orientation: [CLAUDE.md](../../CLAUDE.md)
- M4D oracle brief: [AGENT/M4D-BRIEF.md](../../AGENT/M4D-BRIEF.md)
- W4D layer: [W4D/W4D.md](../../W4D/W4D.md)
- System spec: [AGENT/SYSTEM-SPEC.md](../../AGENT/SYSTEM-SPEC.md)
- Co-trader / surge architecture (HTML): [BUILD-ICT-VOL/surge_cotrader_architecture.html](../BUILD-ICT-VOL/surge_cotrader_architecture.html)
- W4D static diagrams: [BUILD-W4D-DOCS/worldquant_system_architecture.svg](../BUILD-W4D-DOCS/worldquant_system_architecture.svg)
