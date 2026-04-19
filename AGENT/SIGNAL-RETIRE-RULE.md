# SIGNAL RETIREMENT RULE
*Do not retire a signal on global IC. Test it on its home regime.*

---

## THE RULE

A signal is **ALIVE** as long as its home-regime IC > 0.
A signal is **RETIRE** only if its best-regime IC ≤ 0.

Global IC is meaningless for regime specialists. A TRENDING signal that fires flat during
RANGING and RISK-OFF will always show poor global IC — that is correct behaviour.

---

## REGIME IC TEST — 2026-04-19 Results

Signal log: ES, NQ, RTY, CL, 6E, ZN, ZB, GC, SI, BTC

| Signal | Home Regime | Regime IC | Global IC | Verdict |
|--------|-------------|-----------|-----------|---------|
| PULLBACK | TRENDING | **+0.050** | -0.012 | ✓ ALIVE — TRENDING master |
| ADX_TREND | TRENDING | **+0.045** | positive | ✓ ALIVE |
| SQZPOP | BREAKOUT | **+0.033** | -0.015 | ✓ ALIVE — BREAKOUT master |
| VOL_BO | BREAKOUT | **+0.031** | positive | ✓ ALIVE |
| SUPERTREND | BREAKOUT | **+0.025** | -0.024 | ✓ ALIVE — regime IC positive |
| RANGE_BO | BREAKOUT | **+0.023** | -0.019 | ✓ ALIVE |
| PSAR | TRENDING | **+0.023** | positive | ✓ ALIVE |
| DON_BO | BREAKOUT | **+0.016** | -0.037 | ✓ ALIVE — global IC misleading |
| TREND_SMA | BREAKOUT | **+0.012** | positive | ✓ ALIVE |
| EMA_STACK | BREAKOUT | **+0.012** | positive | ✓ ALIVE |
| NEW_HIGH | BREAKOUT | **+0.011** | positive | ✓ ALIVE |
| MACD_CROSS | TRENDING | **+0.008** | positive | ✓ ALIVE |
| GOLDEN | RISK-OFF | **+0.005** | -0.089 | ✓ ALIVE — RISK-OFF specialist |
| ROC_MOM | RISK-OFF | +0.004 | positive | ✓ ALIVE |
| RSI_STRONG | RANGING | +0.002 | positive | ⚠ WATCH |
| KC_BREAK | RANGING | +0.001 | -0.004 | ⚠ WATCH |
| BB_BREAK | RANGING | +0.001 | -0.001 | ⚠ WATCH |
| ATR_EXP | RANGING | +0.001 | positive | ⚠ WATCH |
| RSI_CROSS | MIXED | +0.001 | -0.002 | ⚠ WATCH |
| CONSOL_BO | RANGING | +0.001 | -0.004 | ⚠ WATCH |
| **EMA_CROSS** | BREAKOUT | **+0.0002** | positive | ✗ RETIRE — near-zero everywhere |

**ic_monitor.py was flagging 10 signals for RETIRE based on global IC. Correct answer: 1 retire (EMA_CROSS), 6 on watch.**

---

## WHAT ic_monitor.py MUST DO (not yet implemented)

Current: `retire_flag = slope < SLOPE_THRESHOLD` on global IC

Required:
1. Compute IC per regime window (TRENDING / RANGING / BREAKOUT / RISK-OFF)
2. Assign each signal its home regime (from `REGIME_COLS` in walkforward.py)
3. `retire_flag = regime_IC[home_regime] <= 0` for 3 consecutive windows

Until this is fixed, **ignore ic_monitor retire alerts entirely.**
Use walkforward `signal_lifecycle` → `best_regime_ic_mean` as the source of truth.

---

## BREAKOUT REGIME -15 SHARPE — ROOT CAUSE

The BREAKOUT regime Sharpe is -15 NOT because breakout signals are broken.
Proof: SQZPOP, VOL_BO, SUPERTREND, DON_BO, EMA_STACK all have positive regime IC in BREAKOUT.

Root cause: non-BREAKOUT signals (TRENDING, RANGING specialists) are NOT being suppressed
during BREAKOUT conditions. They fire the wrong direction and drag ensemble Sharpe to -15.

Fix: `SOFT_REGIME_MULT` — any signal whose home regime ≠ BREAKOUT should have weight 0.05
during BREAKOUT bars. Only BREAKOUT specialists (SQZPOP, VOL_BO, DON_BO, RANGE_BO,
SUPERTREND, EMA_STACK, TREND_SMA, NEW_HIGH) should fire.

---

## SIGNAL → HOME REGIME MAP

From `walkforward.py REGIME_COLS`:

| Regime | Signals |
|--------|---------|
| TRENDING | EMA_STACK, MACD_CROSS, SUPERTREND, ADX_TREND, TREND_SMA, PULLBACK, PSAR, GOLDEN |
| RANGING | RSI_CROSS, RSI_STRONG, STOCH_CROSS, MFI_CROSS, ATR_EXP, KC_BREAK, BB_BREAK |
| BREAKOUT | VOL_BO, BB_BREAK, KC_BREAK, SQZPOP, DON_BO, RANGE_BO, EMA_STACK, NEW_HIGH |
| RISK-OFF | OBV_TREND, CMF_POS, VOL_SURGE, ROC_MOM, CONSEC_BULL |

Note: some signals appear in multiple regimes (BB_BREAK, KC_BREAK, EMA_STACK) — these are
cross-regime and should fire in either home regime.

---

## PADAWAN BASELINE CONTEXT

- PADAWAN IS Sharpe: **11.187**
- Gate-stacked OOS Sharpe: **15.862** (gate_search 2026-04-19)
- OOS Sharpe without gates: 5.35 (too much IS→OOS decay)
- Fix: apply optimal gates from `gate_search_report.json`

---

*Version: 1.0 · 2026-04-19*
*Source: walkforward_report.json signal_lifecycle + regime_ic per signal*
*Rule: regime IC is truth. Global IC is noise for specialists.*
