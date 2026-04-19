# ALPHA SEARCH — DAILY PROTOCOL
*M4D · RenTech / Medallion Style · Solo Operator JR*

---

## DOCTRINE (non-negotiable)

> "The library survives by replacing itself."
> — MRT-RENTECH-ALIGNMENT.md

Alpha is NOT a strategy. Alpha is a **living library** of weak, decorrelated edges that must be:
1. Discovered (candidate search)
2. Validated (walk-forward + regime IC)
3. Promoted (add to ensemble at low weight)
4. Monitored (rolling IC decay)
5. Retired (when IC goes consistently negative in ALL regimes)
6. Replaced (step 1 repeats)

Never stop at step 2. Never skip step 5.

---

## DAILY ROUTINE (15 min, every session start)

### Step 1 — System Health Check (2 min)
```bash
./go.sh ds          # start DS quant :8000
curl http://127.0.0.1:8000/health/
curl http://127.0.0.1:8000/v1/ai/activity/
curl http://127.0.0.1:8000/v1/cross/report/
```
Check:
- Activity gate: ALIVE or HOT? If DEAD → no new signals today
- Cross-asset regime: RISK_ON / NEUTRAL / RISK_OFF
- Any signals in PROBATION → watch for further decline

### Step 2 — Signal Decay Check (3 min)
Review walkforward_report.json `signal_lifecycle` section:
- Any new PROBATION signals? (IC slope < -0.0003 for 3 windows)
- Any SPECIALIST moving to ALIVE? (IC improving in its regime)
- VOL_SURGE + CONSEC_BULL still in PROBATION? → if 2 more weeks negative, demote weight to 0.1×

Key threshold: **if rolling 14-day IC < 0 for 3 consecutive checks → flag for retirement review**

### Step 3 — Alpha Search (10 min, once per week minimum)
See ALPHA SEARCH section below.

---

## ALPHA SEARCH PROTOCOL

### What counts as a new alpha candidate?

1. **New signal dimension** — something NOT in the current 23 (e.g., funding rate, OBI score, VIX analog, COT-equivalent)
2. **New transform of existing data** — lagged return × vol, squeeze duration, ATR expansion rate
3. **New cross-asset relationship** — BTC/ETH ratio crossing threshold, alt beta spike
4. **Calendar / structural** — day-of-week, session open range, specific hour patterns

### What does NOT count as new alpha:
- Another MA crossover variant (crowded, decays fast)
- RSI with different lookback (same signal, different parameter)
- "This indicator worked great on YouTube" — needs validation, not adoption

---

## CANDIDATE GENERATION — HOW TO SEARCH

### From existing data (signal_log.db + futures.db)

```python
# Template: generate candidate signal, test IC, check OOS stability
# ds/ds_app/alpha_candidate.py

import sqlite3, numpy as np
from scipy.stats import spearmanr

# Example: FUNDING RATE PROXY
# In crypto: when price rises but volume falls → funding proxy (longs overcrowded)
# Signal: if (close/close_5bar_ago - 1) > 0 AND volume < volume_20bar_mean → short signal

# Example: SQUEEZE DURATION
# How long has the squeeze been held? Longer squeeze = bigger release
# Signal: bars_in_squeeze × normalized_ATR_contraction

# Example: CROSS-ASSET LEAD
# When BTC breaks above 20-bar high, does SOL follow within N bars?
# Signal: BTC_breakout_N_bars_ago → SOL long signal

# For each candidate:
# 1. Generate signal series from futures.db bars_5m
# 2. Merge with outcomes from signal_log.db
# 3. Compute global IC + regime-conditional IC
# 4. If ANY regime IC > 0.01 with n > 100: CANDIDATE PASSES
# 5. Add to signal_log.db as v_NEW_SIGNAL column
# 6. Re-run walkforward.py to see ensemble impact
```

### From external sources (weekly)

| Source | Signal type | How to capture |
|---|---|---|
| Funding rates | Perpetual futures leverage | Binance API → `GET /fapi/v1/fundingRate` |
| Open interest | Futures participation | Binance API → `GET /fapi/v1/openInterest` |
| Fear & Greed | Sentiment index | `api.alternative.me/fng/` |
| Grok X scan | Social sentiment trend | Already built: /v1/ai/xsocial/ |
| Cross-asset | BTC/ETH/SOL spreads | Already built: /v1/cross/report/ |
| Volume profile | VPOC, VAH, VAL | Compute from bars_5m in futures.db |
| Liquidations | Forced selling | Binance WebSocket: forceOrder stream |

### From MRT discovery engine (weekly)
```bash
cd MRT && ./gort.sh discover
# Produces mrt_discovery.json with FDR-filtered candidates
# Pull top 10 by IC, check if any are new signal types
```

---

## PROMOTION CRITERIA (to add signal to ensemble)

A candidate must pass ALL:

| Gate | Threshold | Why |
|---|---|---|
| OOS IC > 0 | In at least one regime | Not just IS luck |
| n_trades ≥ 50 | Per OOS window | Enough trades for statistics |
| Regime IC stable | Consistent over 3+ folds | Not one-window spike |
| Not redundant | Correlation < 0.85 with any existing signal | Don't add what we have |
| Cost-adjusted IC | IC > 0.005 after 0.10% trade cost | Edge survives real execution |

---

## RETIREMENT CRITERIA

A signal enters PROBATION when:
- Rolling 14-day IC < 0 for 3 consecutive windows
- OR regime-conditional IC drops > 50% from peak in its specialist regime

A signal RETIRES when:
- IC negative in ALL regimes for 30+ days
- OR has been on PROBATION for 60 days with no recovery

**Retirement action**: set weight to 0.0 in weight matrix, log in SIGNAL_GRAVEYARD.md, re-evaluate in 90 days (markets change — a dead signal can revive in new regime).

---

## SIGNAL ROUTING — REGIME MAPPING (NEVER CHANGE WITHOUT WALK-FORWARD TEST)

```
TRENDING regime  → PULLBACK · ADX_TREND · PSAR · MACD_CROSS · SUPERTREND · GOLDEN · EMA_STACK
BREAKOUT regime  → SQZPOP · VOL_BO · DON_BO · RANGE_BO · EMA_STACK · NEW_HIGH · SUPERTREND
RANGING regime   → RSI_STRONG · BB_BREAK · KC_BREAK · ATR_EXP · RSI_CROSS
RISK-OFF regime  → GOLDEN · ROC_MOM · OBV_TREND
ANY regime       → ADX_TREND (ALIVE globally) · GOLDEN (ALIVE globally)

NEVER use in FLAT: SUPERTREND · EMA_CROSS · MACD_CROSS · GOLDEN · TREND_SMA · PSAR

IN SQUEEZE: ZERO signals. Wait for SQZPOP.
```

---

## TRADE QUALITY VETO LIST (pre-entry, any one = BLOCK)

| Veto | Condition | Signal |
|---|---|---|
| SQUEEZE LOCK | BB inside KC (squeeze state) | v_SQZPOP == 0 AND BB_width < KC_width |
| DEAD MARKET | RVOL < 0.65 | rvol column in signal_log |
| FLAT ATR | ATR% < 0.25% | atr_pct < 0.0025 |
| PDH/PDL MIDDLE | Price in 40–60% of prior day range | abs(price - pdm) / pd_range < 0.2 |
| ICHIMOKU CLOUD | Price inside Kumo cloud | (close > span_a AND close < span_b) OR (close < span_a AND close > span_b) |
| LOW CONVICTION | Jedi score < ±8 (absolute) | abs(jedi_score) < 8 |
| MTF DISAGREE | 5m and 1h direction conflict | 5m_signal × 1h_signal < 0 |

---

## SOFT MULTIPLIERS (reduce size, don't block)

| Condition | Kelly multiplier |
|---|---|
| PADAWAN MODE | 0.25× base |
| Single-bank conviction only | 0.50× |
| Cross-asset RISK_OFF | 0.70× |
| Grok sentiment FADING | 0.80× |
| Recent 3-trade drawdown | 0.25× |
| RANGING regime (momentum trade) | 0.50× |
| MTF soft disagree (1h neutral, not opposing) | 0.70× |
| EUPHORIA (all gates clear + RVOL > 2) | 2.0–3.0× |

---

## ITER OPT LOOP (monthly)

Every 30 days, run this pipeline:

```bash
cd /Volumes/AI/AI-4D/M4D/ds

# 1. Refresh walkforward with new data
.venv/bin/python ds_app/walkforward.py

# 2. Check lifecycle — any new DEAD signals?
# Review BUILDOUT-PROGRESS.md signal table

# 3. Run cross-asset refresh
.venv/bin/python ds_app/cross_asset.py

# 4. Run routed ensemble with updated weights
.venv/bin/python ds_app/sharpe_ensemble.py

# 5. Run MRT discovery for new candidates
cd /Volumes/AI/AI-4D/M4D/MRT && ./gort.sh discover

# 6. Check star report for hour/day kill list drift
.venv/bin/python ds_app/star_optimizer.py

# 7. Update BUILDOUT-PROGRESS.md with new results
```

**If OOS Sharpe drops > 1.0 from previous month**: stop, investigate before adding new signals.
**If OOS Sharpe improves**: identify which change caused it, document in CHANGELOG_AI.md.

---

## WHAT NOT TO BUILD (ELON RULE)

> "Stop doing dumb stuff first."

DO NOT add:
- Another MA crossover (DON_BO and EMA_STACK already cover this)
- More oscillators without regime validation first
- Visual features without IC test
- Signals that work on 1 symbol only
- Any signal with IS Sharpe > 20 (almost certainly overfit)
- Signals that require real-time L2 data we don't have

DO build:
- Signals from DATA we don't yet use (funding, OI, liquidations, COT)
- Signals from RELATIONSHIPS between existing data (cross-asset, regime transitions)
- FILTERS that prevent bad entries (each veto improves Sharpe directly)
- REGIME DETECTION that routes existing signals better

---

## STARSHIP SCHOOL (SS) INTEGRATION

TV Pine indicators are in: `AGENT/TV-PINE-TEMPLATES.pine`

For each signal promoted to the library:
1. Write a Pine Script version of the signal
2. Add regime gate annotation (comment: "TRENDING ONLY" or "BREAKOUT ONLY")
3. Include the TRADE QUALITY GATE indicator on every chart
4. SS traders paper-test for 30 days, report which regime they observe
5. Compare their observations to our regime_labels — if divergence > 20%, review _regime_labels()

**SS feedback loop**: human regime observation → weak prior update → HMM posterior nudge

---

*This document is the operating manual for the signal library. Read before every build session.*
*CLAUDE: reference this doc when user says "alpha search" or "continue opt"*
