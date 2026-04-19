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

### T1-A: OBI Hard Gate ★★★★★ (+2–4 Sharpe est)
- obi_signal.py exists, currently = 25% size cut only
- **Fix:** Hard gate — if OBI < 0 AND direction = LONG → HOLD
- **Add:** obi_ratio column to signal_log for backtest validation
- File: `obi_signal.py`, `signal_logger.py`, `alpaca_paper.py`

### T1-B: ICT Kill Zones ★★★★ (+1–2 Sharpe est)
Current: blunt 11 UTC hours killed (HOUR_KILLS set)
Better: 30-min precision windows
```
ALIVE:  London open  07:00–09:00 UTC
ALIVE:  NY open      13:30–14:30 UTC
KILL:   London close 11:00–13:00 UTC
KILL:   NY close     20:30–23:00 UTC
KILL:   Asia dead    22:00–06:00 UTC
KILL:   DR forming   13:30–14:00 UTC (wait for direction)
```
File: `alpaca_paper.py` → `session_gate()` replaces HOUR_KILLS const

### T1-C: DR/IDR Target Levels ★★★★ (+1–2 Sharpe est)
- Pine: `APP-DOC/TARGET-LEVELS-ENERGY/DR-IDR.PINE` (exists)
- Build: `ds_app/target_levels.py` — `dr_high`, `dr_low`, `idr_high`, `idr_low`
- Signal: entry only within ±0.3% of DR level = high-probability zone
- Add `dr_proximity_pct` to signal_log

### T2-A: Order Block Detection ★★★ (+0.5–1.5 Sharpe est)
- Pine: `APP-DOC/TARGET-LEVELS-ENERGY/SUPER ORDER BLOCKS.PINE`
- 3-bar pattern: last down-close before 3-bar rally ≥1.5× ATR
- Signal: `ob_bull_near`, `ob_bear_near` (energy zone, not directional)
- NOT correlated with any existing signal → true new dimension

### T2-B: FVG Detection ★★★ (+0.5–1 Sharpe est)
- Pine: `APP-DOC/TARGET-LEVELS-ENERGY/MTF-FVG.PINE`
- 1-line Python: `fvg_bull = high[i-2] < low[i]`
- Add `fvg_bull`, `fvg_bear`, `fvg_proximity_pct` to signal_log

### T3-A: VWAP Deviation ★★★ (+0.5–1.5 Sharpe est)
- `vwap = cumsum(V×C) / cumsum(V)` reset at session open
- Signal: `vwap_bias` = +1 if close > VWAP, -1 if below
- Pure volume-price relationship — zero OHLCV correlation

---

## PHASE 3 — SYSTEM TUNING (after new signals pass WorldQuant gate)

| Item | Estimated Delta | Effort |
|------|-----------------|--------|
| Re-run gate_search after adding OBI + ICT kill zones | +0.5–2 | 30 min |
| Re-run PCA after retiring 6 clones | confirm 15→9 dims | 5 min |
| Re-run walkforward on futures data with futures.db bars | validate OOS | 40 min |
| MIXED regime: investigate what bars classify as MIXED + exploit | unknown | 1 hr |
| SQZPOP IC watch: run ic_monitor in 1 week, decide retire/keep | — | 0 min |

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
