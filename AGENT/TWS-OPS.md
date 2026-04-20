# TWS / IBKR Paper Trading — Ops Reference
*M4D · PADAWAN mode · Micro-futures (MES, MNQ)*

---

## ONE-TIME TWS SETUP

1. Download **Trader Workstation** from ibkr.com → install
2. Log in with **Paper Trading** credentials (separate from live account)
3. **Enable API:**
   - Menu → Edit → Global Configuration → API → Settings
   - ☑ Enable ActiveX and Socket Clients
   - Socket port: **7497**  (live TWS paper default)
   - ☑ Allow connections from localhost only
   - Trusted IPs: add **127.0.0.1**
   - Master Client ID: leave blank (or 0)
4. Click **Apply → OK**
5. Leave TWS open whenever DS server is running

> IB Gateway (headless) also works — port 4002 for paper. Change `IBKR_PORT=4002` in `ibkr_paper.py` if using Gateway.

---

## DAILY LAUNCH ORDER

```bash
# 1. Open TWS → log in with paper credentials → leave running

# 2. Start DS server
./go.sh ds

# 3. Verify connection
curl http://localhost:8000/v1/ibkr/test/
# → {"connected": true, "accounts": ["DUQxxxxxx"], "equity": 1000000.00, ...}

# 4. Dry run (no orders placed)
curl -X POST "http://localhost:8000/v1/ibkr/run/?mode=PADAWAN&asset=FUTURES&dry=1"

# 5. Live run (places real paper orders)
curl -X POST "http://localhost:8000/v1/ibkr/run/?mode=PADAWAN&asset=FUTURES"

# 6. Check status / positions
curl http://localhost:8000/v1/ibkr/status/

# 7. Flatten micro ES (MES) — logical symbol ES or IB symbol MES (same position)
curl "http://localhost:8000/v1/ibkr/flatten/?symbol=ES&asset=FUTURES&dry=1"
curl -X POST "http://localhost:8000/v1/ibkr/flatten/?symbol=ES&asset=FUTURES"

# 8. Forex (EURUSD) — bars from IBKR; Mon–Fri UTC hour gate via symbol
curl -X POST "http://localhost:8000/v1/ibkr/run/?mode=PADAWAN&asset=FOREX&dry=1"
```

### Resilience (app / DS stops)

- **TWS** is a separate process — closing the browser tab or killing the Django dev server does **not** close TWS or cancel resting orders you placed in TWS.
- **Algo loop** depends on DS + `curl`; use **`tmux`/`screen`** or **`launchd`** so the loop survives terminal exit: `./ibkr_loop.sh` (see repo root).
- **Flatten** is explicit (`/v1/ibkr/flatten/`) — there is no auto-flatten on disconnect in this adapter.

### MES ↔ ES

Positions are stored at IBKR under **MES**/**MNQ**; the adapter uses logical symbols **ES**/**NQ** and maps micro symbols for size and P&amp;L. Use **`symbol=ES`** or **`symbol=MES`** on **flatten** — both resolve the same open micro position.

### Standalone CLI (any Python with `ib_insync`)

Django is optional for talking to TWS. From repo root, default interpreter is `ds/.venv/bin/python`; override with **`IBKR_PYTHON`** (conda, pyenv, system Python, etc.):

```bash
chmod +x ./ibkr.sh   # once

./ibkr.sh test
./ibkr.sh status
./ibkr.sh run PADAWAN FUTURES --dry
./ibkr.sh flatten ES FUTURES --dry
./ibkr.sh flatten ES FUTURES

IBKR_PYTHON=python3 ./ibkr.sh test
IBKR_PYTHON="$HOME/miniconda3/envs/trade/bin/python" ./ibkr.sh status
```

Install the client in that environment if needed: `pip install ib_insync`.

---

## MODES

| Mode | Entry Threshold | Max Lots | Risk |
|------|----------------|----------|------|
| PADAWAN | 0.55 | 0.5 | Conservative |
| NORMAL | 0.60 | 1.0 | Standard |
| EUPHORIA | 0.65 | 1.5 | Aggressive |
| MAX | 0.70 | 2.0 | Full send |

**Start with PADAWAN.** Promote after OOS Sharpe > 8.0 confirmed.

---

## ASSETS + CONTRACTS

| Symbol | IBKR Contract | Exchange | Tick |
|--------|--------------|----------|------|
| ES | MES (Micro E-mini S&P) | CME | $1.25 |
| NQ | MNQ (Micro NASDAQ) | CME | $0.50 |
| RTY | M2K (Micro Russell) | CME | $0.50 |
| GC | MGC (Micro Gold) | COMEX | $1.00 |
| CL | MCL (Micro Crude) | NYMEX | $1.00 |

Bars pulled live from IBKR historical data (3D × 5m) if not in futures.db.

---

## GATE STACK (entry must pass ALL)

```
1. ICT Session gate    London 07-09 UTC · NY 14-20:30 UTC · else BLOCKED
2. DR/IDR zone         IDR_TRAP → BLOCKED
3. Trade quality gate  check_gates(sc, mode) — regime, vol, score gates
4. Score threshold     soft_score >= mode.entry_thr
5. HALO decision       probabilistic entry / split / jitter
6. OBI hard gate       OBI opposes direction → BLOCKED
                       OBI aligned → +15% size
7. effective_lot = halo × mtf × ca × cap × oi × fng × liq × lvl × vwap
```

---

## CRON — AUTONOMOUS (3-day absence)

```bash
# Edit crontab:
crontab -e

# Add these two lines:
30 10 * * 1-5 cd /Volumes/AI/AI-4D/M4D && ./daily_hunt.sh >> logs/hunt.log 2>&1
00 14 * * 1-5 curl -s -X POST "http://localhost:8000/v1/ibkr/run/?mode=PADAWAN&asset=FUTURES" >> logs/ibkr.log 2>&1
```

`daily_hunt.sh` runs at 10:30 UTC (pre-NY-open) — pipeline: signal → IC → WF → ensemble → gate → PCA → cross → summary.

IBKR run fires at 14:00 UTC (NY open window) — inside ICT ALIVE session.

---

## TROUBLESHOOTING

| Error | Fix |
|-------|-----|
| `No module named 'ib_insync'` | `ds/.venv/bin/python -m pip install ib_insync` |
| `no current event loop` | Fixed in IBKRSession.__init__ — restart DS |
| `TWS/Gateway not reachable` | Open TWS, check API enabled, port 7497 |
| `NO_BARS` for ES/NQ | Fixed — bars fetched from IBKR historical data |
| `'Close'` KeyError | Fixed — column names capitalised in _fetch_ibkr_bars |
| `connected: true` but no entries | Check session gate (must be London/NY window) |
| Dry run only, no live orders | Remove `&dry=1` from URL |

---

## PROMOTE TO LIVE (future)

When paper OOS Sharpe > 8.0 sustained over 10+ trading days:
1. Open **live** TWS (port 7496) alongside paper (7497)
2. Change `IBKR_PORT = 7496` or pass env `IBKR_PORT=7496`
3. Start with `mode=PADAWAN` — same gates, same lot sizing
4. Add `IBKR_SYMBOLS=ES,NQ` env to restrict symbols

---

*Last updated: 2026-04-20 · account DUQ274605 · equity €1,000,048*