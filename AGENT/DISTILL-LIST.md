# DISTILL-LIST — Signal Culling + Next Build
*Distilled 2026-04-24 · Source: AGENT1/DISTILL-LIST.md · Current state*

---

## PHASE 1 — KILL THE CLONES ✅ EVIDENCE IN

### RETIRE (3 consecutive negative regime IC)
| Signal | Regime | IC | Action |
|--------|--------|----|--------|
| DON_BO | BREAKOUT | -0.101 | **RETIRE** |
| NEW_HIGH | BREAKOUT | -0.081 | **RETIRE** |
| RANGE_BO | BREAKOUT | -0.067 | **RETIRE** |
| RSI_CROSS | RANGING | -0.023 | **RETIRE** |

### KILL CORR CLONES (PCA corr > 0.9 = same dimension)
```
VOL_BO ↔ VOL_SURGE  = 0.991 → KILL VOL_SURGE
KC_BREAK ↔ VOL_BO   = 0.966 → KILL KC_BREAK
EMA_STACK ↔ VOL_BO  = 0.944 → KILL EMA_STACK from BREAKOUT routing
BB_BREAK ↔ KC_BREAK = 0.921 → KILL BB_BREAK
```
**Keep:** SQZPOP (master BREAKOUT) + VOL_BO (best IC)

### WATCH (1 negative window — not ready to retire)
- SQZPOP: -0.005 (was +0.033 — alarming. Do NOT retire until 3 consecutive windows)
- VOL_BO: -0.054
- EMA_STACK: -0.023

---

## PHASE 2 — NEW SIGNALS ✅ ALL DONE 2026-04-19

| Signal | File | Status |
|--------|------|--------|
| OBI hard gate | obi_signal.py + alpaca_paper.py | ✅ DONE |
| ICT kill zones (session_gate, 30-min precision) | alpaca_paper.py | ✅ DONE |
| DR/IDR target levels | target_levels.py + signal_logger.py | ✅ DONE |
| Order block detection (OB + PPDD + FVG stacked) | ob_signal.py | ✅ DONE |
| FVG detection | ob_signal.py | ✅ DONE |
| VWAP deviation bands (session-reset) | vwap_signal.py | ✅ DONE |

---

## PHASE 3 — PENDING (system tuning)

| Task | Est. Delta | Command |
|------|-----------|---------|
| Re-run signal_logger with DR/OB/VWAP columns | critical | `./daily_hunt.sh --quick` |
| Re-run walkforward after killing 6 clones | +Sharpe | `./daily_hunt.sh --stage WF` |
| Re-run gate_search after new signal columns | +0.5–2 | `./daily_hunt.sh --stage GATE` |
| Re-run PCA after retiring clones | confirm ≤9 dims | `./daily_hunt.sh --stage PCA` |
| SQZPOP IC watch: 1 more window → retire/keep | — | `./daily_hunt.sh --stage IC` |
| EUPHORIA re_win: 4→12-24 bars | unlock 29.7 | delta_ops.py |
| 3 IOPT seeds (43,44,45) for robustness | confirm 21.7 | iopt_search.py |

---

## WHAT NOT TO BUILD (confirmed dead)

- More EMA crossovers — 7 already, all corr > 0.8
- Bollinger Band variants — BB_BREAK corr 0.92 with VOL_BO
- RSI variants beyond RSI_STRONG — RSI_CROSS retired
- Multi-timeframe OHLCV clones — same data, different window

---

## AUTONOMOUS CRON

```bash
# Daily hunt (Mon-Fri 10:30 UTC):
30 10 * * 1-5 cd /Volumes/AI/AI-4D/M4D && ./daily_hunt.sh >> logs/hunt.log 2>&1

# Manual:
./daily_hunt.sh                  # full pipeline
./daily_hunt.sh --quick          # skip signal_logger (fast, ~5min)
./daily_hunt.sh --stage WF|PCA|GATE|IC  # single stage
```

---

## MRT — STANDALONE (do not couple)

MRT Rust engine = independent signal bot. Bridge only: `mrt_snapshot.json` vol_regime → size multiplier.  
Future: competing ensemble bot. Compare equity curves.  
**Never merge MRT signal IDs into Python council.** Keep competition clean.
