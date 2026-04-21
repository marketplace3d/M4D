# Operator runbook — flatten, halt, rollback

**Audience:** person at the keyboard when something looks wrong.  
**Scope:** M3D/M4D stack + DS paper paths; escalate before increasing notional.  
**Pair with:** [I-OPT-OOO-MASTER.MD](I-OPT-OOO-MASTER.MD) (governance gaps), [AGENT/AGENTS.md](../../AGENT/AGENTS.md) (safety rules), [AGENT/SAFETY.md](../../AGENT/SAFETY.md) if present.

**Audit env (paper order log):** set `PAPER_OPERATOR_ID` to your handle or run id; optional `M3D_PIPELINE_REV` (git SHA) — stored in each `order_intent.snapshot_json` row ([`ds/ds_app/order_intent_log.py`](../../ds/ds_app/order_intent_log.py)).

---

## 1) When to stop trading immediately

- **Stale or missing market data** (engine snapshot old, bars not updating, WS dead) — do not send new orders until data is fresh.
- **Unexpected position or PnL** vs broker — treat as recon break; flatten or freeze per policy.
- **Daily halt / drawdown breach** — follow [AGENTS.md](../../AGENT/AGENTS.md): DAILY_HALT stops new risk.
- **Any doubt** — default to **no new entries**; use flatten/kill below.

---

## 2) Flatten (exit risk now)

1. Use the **broker’s** flatten/close-all for the account in question (Alpaca / IBKR paper or live as deployed).
2. In UI: use **M4D flatten controls** when wired; confirm fills in broker.
3. Log: time, symbol(s), reason code (e.g. `DATA_STALE`, `RECON_BREAK`, `MANUAL_HALT`).

---

## 3) Halt (no new trades)

- Enable **daily halt** / strategy kill in risk pipeline if your deployment exposes it.
- **Disable** automated runners (paper `run` loops, cron, daemons) until cause is found.
- DS: if using quant server, stop the process started via `./go.sh` or your launcher — see [CLAUDE.md](../../CLAUDE.md) for service ports.

---

## 4) Rollback (after bad deploy or config)

1. **Revert** the last config or code change (git revert or restore known-good `paper_trading_config` / env).
2. **Restart** services in order: data/engine → API → DS → frontends (match your `go.sh` convention).
3. **Smoke test:** `GET /health` on API and DS; pull `/v1/council` or `/v1/algo-day`; confirm timestamps recent.
4. **Paper-only** until KPIs in I-OPT-OOO-MASTER §13 are green for a full session.

---

## 5) Escalation (“who to call”)

Fill in for your org:

| Role | Name / channel | When |
|------|----------------|------|
| Platform owner | | infra, deploys, secrets |
| Trading lead | | mandate, flatten authority |
| Compliance / FO admin | | if live capital or external LPs |

---

## 6) Quick health checks (examples)

```bash
# DS quant (port may vary — see CLAUDE.md / your go.sh)
curl -s http://127.0.0.1:8000/health/

# Rust API (port may vary)
curl -s http://127.0.0.1:3030/health
```

Adjust ports to match your environment (`SYSTEM-MAP.md` vs `CLAUDE.md` may differ).

---

## 7) After-action

- One paragraph: what happened, what was done, what will change (runbook or code).
- If incident involved an order: attach **intent id**, **broker order id**, and **signal version** when those exist.
