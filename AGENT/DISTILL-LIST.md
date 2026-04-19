# DISTILL LIST — Signal Culling + Next Build
*2026-04-19 · Soft-routed 8.094 · Gate-stacked 13.668 · Regime IC run complete*

---

## PHASE 1 — KILL THE CLONES (PCA + IC evidence)

### RETIRE NOW (3 consecutive negative regime IC windows)
| Signal | Home Regime | Regime IC | Action |
|--------|-------------|-----------|--------|
| DON_BO | BREAKOUT | -0.101 | **RETIRE** — worst IC in cluster |
| NEW_HIGH | BREAKOUT | -0.081 | **RETIRE** |
| RANGE_BO | BREAKOUT | -0.067 | **RETIRE** |
| RSI_CROSS | RANGING | -0.023 | **RETIRE** |

→ Remove from `SIGNAL_ROUTING`, `SOFT_REGIME_MULT`, `SURVIVORS` list in `sharpe_ensemble.py`
→ Re-run walkforward after each removal to verify Sharpe delta is positive

### KILL CORR CLONES (PCA corr > 0.9 = same dimension)
The BREAKOUT cluster is ONE signal in four bodies:
```
VOL_BO ↔ VOL_SURGE = 0.991  → KILL VOL_SURGE (lower IC)
KC_BREAK ↔ VOL_BO = 0.966   → KILL KC_BREAK  (lower IC than VOL_BO)
EMA_STACK ↔ VOL_BO = 0.944  → KILL EMA_STACK from BREAKOUT routing only
BB_BREAK ↔ KC_BREAK = 0.921 → KILL BB_BREAK  (keep 1 of this pair)
```
Keep: **SQZPOP** (master BREAKOUT) + **VOL_BO** (best IC after SQZPOP)
Kill: DON_BO ✓, NEW_HIGH ✓, RANGE_BO ✓, KC_BREAK, VOL_SURGE, BB_BREAK

### WATCH (1 negative window — do not retire yet)
| Signal | Home Regime | Regime IC | Watch Until |
|--------|-------------|-----------|-------------|
| SQZPOP | BREAKOUT | -0.005 | Next 2 windows |
| VOL_BO | BREAKOUT | -0.054 | 2 more windows |
| EMA_STACK | BREAKOUT | -0.023 | 2 more windows |

**SQZPOP drop is alarming** — was +0.033, now -0.005. Likely Feb 2026 vol spike effect.
Do NOT retire SQZPOP until 3 consecutive windows. It's the top BREAKOUT master.

---

## PHASE 2 — REPLACE KILLED SLOTS (new uncorrelated dims)

After killing ~6 redundant signals, open slots exist for:

### T1-A: OBI Hard Gate ★★★★★ ✅ DONE 2026-04-19
- Hard gate: OBI opposes direction → BLOCK entry (was 25% size cut)
- OBI aligned → +15% size boost
- obi_label logged on every trade
- Files: `obi_signal.py`, `alpaca_paper.py`

### T1-B: ICT Kill Zones ★★★★ ✅ DONE 2026-04-19
- `HOUR_KILLS` set removed → `session_gate(utc_mins)` 30-min precision
- ALIVE: London 07-09, NY 14-20:30 · KILL: Asia 00-06:30, LC 11-14, NYC 20:30+
- `GET /v1/session/` endpoint + SESSION traffic light on TraderPage TOP STRIP
- File: `alpaca_paper.py`

### T1-C: DR/IDR Target Levels ★★★★ ✅ DONE 2026-04-19
- `ds_app/target_levels.py` — `compute_dr_levels()`, `get_current_levels()`, `dr_entry_allowed()`
- DR: 13:30-14:30 UTC | IDR: 13:30-14:00 UTC | zone: NEAR_DR/NEAR_IDR/IDR_TRAP/DR_EXTEND/NEUTRAL
- IDR_TRAP blocks entry (chop zone) | NEAR_DR = ±0.3% = high-prob zone
- `dr_proximity_pct`, `dr_zone` added to signal_log DDL + compute_signals
- `GET /v1/dr/`, `GET /v1/dr/scan/` endpoints
- DR/IDR card on TraderPage ROUTING tab with per-symbol traffic lights
- Files: `target_levels.py`, `signal_logger.py`, `alpaca_paper.py`, `views.py`

### T2-A: Order Block Detection ★★★ ✅ DONE 2026-04-19
- `ds_app/ob_signal.py` — Super OB Pine method, INST scoring, PPDD, FVG stacked
- `ob_bull_near`, `ob_bear_near`, `ob_inst_score` → signal_log columns
- Stateful forward scan: active OB zones, mitigation, age decay (80 bars)
- `GET /v1/ob/?symbol=BTC` endpoint
- Files: `ob_signal.py`, `signal_logger.py`, `views.py`, `urls.py`

### T2-B: FVG Detection ★★★ ✅ DONE 2026-04-19
- Wired inside `ob_signal.py`: `fvg_bull = high[i-2] < low[i]`
- `fvg_bull`, `fvg_bear` → signal_log columns

### T3-A: VWAP Deviation ★★★ ✅ DONE 2026-04-19
- `ds_app/vwap_signal.py` — session-reset VWAP (13:30 UTC), deviation bands
- Bands: AT_VWAP / VWAP_TAP / LONG_BIAS / SHORT_BIAS / EXTREME_LONG / EXTREME_SHORT
- `vwap_bias` size mult: aligned→1.10, extreme extended→0.80, opposing→0.85
- `vwap`, `vwap_dev_pct`, `vwap_bias`, `vwap_band` → signal_log columns
- `GET /v1/vwap/?symbol=BTC` endpoint
- Files: `vwap_signal.py`, `signal_logger.py`, `alpaca_paper.py`, `views.py`

---

## PHASE 3 — SYSTEM TUNING (after new signals pass WorldQuant gate)

| Item | Estimated Delta | Effort |
|------|-----------------|--------|
| Re-run signal_logger → populate DR/PDH/PWH/OB/VWAP columns | critical | `./daily_hunt.sh --quick` |
| Re-run gate_search after new signal columns land | +0.5–2 | `./daily_hunt.sh --stage GATE` |
| Re-run PCA after retiring 6 clones | confirm 15→9 dims | `./daily_hunt.sh --stage PCA` |
| MIXED regime: investigate what bars classify as MIXED + exploit | unknown | 1 hr |
| SQZPOP IC watch: run ic_monitor in 1 week, decide retire/keep | — | `./daily_hunt.sh --stage IC` |

## AUTONOMOUS OPERATION (3-day absence)
```bash
# Add to crontab (crontab -e):
30 10 * * 1-5 cd /Volumes/AI/AI-4D/M4D && ./daily_hunt.sh >> logs/hunt.log 2>&1

# Manual triggers:
./daily_hunt.sh                  # full pipeline
./daily_hunt.sh --quick          # skip signal_logger (fast, ~5min)
./daily_hunt.sh --stage WF       # single stage
./daily_hunt.sh --offline        # no DS server needed (direct Python)

# IBKR paper cycle (run manually or add separate cron at 14:00 UTC):
curl -X POST "http://localhost:8000/v1/ibkr/run/?mode=PADAWAN&asset=FUTURES&dry=1"
```

---

## EXECUTION ORDER (no scope creep)

```
Week 1 · Kill and validate
  1. Retire DON_BO, NEW_HIGH, RANGE_BO, RSI_CROSS from SURVIVORS + SOFT_REGIME_MULT
  2. Kill KC_BREAK, VOL_SURGE from SURVIVORS (corr clones)
  3. Re-run walkforward → verify Sharpe improved (fewer corr signals = better)
  4. Re-run PCA → verify dims reduced to ≤9

Week 2 · Replace with uncorrelated dims
  5. OBI hard gate → signal_logger + alpaca_paper
  6. ICT kill zones → replace HOUR_KILLS
  7. DR/IDR target levels → target_levels.py + signal_logger

Week 3 · Validate and promote
  8. Run daily_hunt.sh on refreshed signal_log
  9. Verify gate_search finds new optimal gates including OBI + DR
 10. If SQZPOP still negative → retire, promote DON_BO replacement

IBKR LIVE: after Week 2 OOS Sharpe > 8.0 confirmed
  MODE = PADAWAN · ASSET = FUTURES · SYMBOLS = ES,NQ
  CMD: curl -X POST "http://localhost:8000/v1/ibkr/run/?mode=PADAWAN&asset=FUTURES&dry=1"
```

---

## MRT — STANDALONE (do not couple)
MRT Rust engine = independent signal bot.
Current bridge: read `mrt_snapshot.json` vol_regime → size multiplier only.
Future use: MRT as a competing ensemble bot. Let it run independently, compare equity curves.
Never merge MRT signal IDs into the Python council — keep the competition clean.

---

## WHAT NOT TO BUILD (confirmed dead)
- More EMA crossovers — 7 of them already, all corr > 0.8
- Bollinger Band variants — BB_BREAK at 0.92 corr with VOL_BO
- RSI variants beyond RSI_STRONG — RSI_CROSS now RETIRE
- Multi-timeframe OHLCV clones — same data, different window

---
*Version: 1.1 · 2026-04-19*
*Source: walkforward_report.json + ic_monitor.json + pca_report.json (this run)*
*Rule: kill corr clones first, then replace with uncorrelated dims*
