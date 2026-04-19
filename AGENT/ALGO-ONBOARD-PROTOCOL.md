# ALGO ONBOARDING PROTOCOL
*The repeatable process for promoting any signal into the JEDI Council.*
*Source: Pine Script | RenTech paper | Legend Trader method | MRT discovery*

---

## THE 7-GATE FUNNEL

```
SOURCE → DEFINE → IMPLEMENT → VALIDATE → BENCHMARK → ROUTE → PROMOTE
  ↓         ↓          ↓           ↓           ↓         ↓        ↓
Pine/     Signal    Python     IC + FDR    vs PADAWAN  Regime   Add to
RenTech/  spec      function   + t-stat    Sharpe      gate     Council
MRT       (binary)  + vote     + OOS       + PCA load           + Panel
```

---

## GATE 1 — SOURCE

Where does the signal come from? Label it honestly.

| Source | Example | Risk |
|--------|---------|------|
| **Pine Script** | SQZPOP, Supertrend, EMA Stack | Look-ahead in repaint signals |
| **RenTech/Paper** | MOM_5v20, REV_1, RANGE20 | Overfitting to equity regimes |
| **Legend Trader** | Minervini VCP, Weinstein Stage 2, ICT FVG | Discretionary rules = implementation loss |
| **MRT Discovery** | Any FDR winner from `mrt_discovery.json` | Thin OOS sample |
| **Internal Search** | `signal_discovery.py` FDR winner | Already validated |

**Rule:** Name the signal `SOURCE_METHOD` (e.g., `PINE_SQZ`, `MRT_REV1`, `ICT_FVG`).  
**Anti-rule:** Never onboard a signal that requires "reading price action" — it must be computable.

---

## GATE 2 — DEFINE (30 min)

Express the signal as **one function** with three constraints:

```python
def signal_MY_SIGNAL(close, high, low, volume, **kwargs) -> np.ndarray:
    """
    Returns array of +1 (long bias), -1 (short bias), 0 (no signal).
    No lookahead. Bar-close only. Deterministic.
    """
    ...
    return votes  # shape: (n_bars,), dtype: int8
```

**Three constraints (all must be true before proceeding):**
1. **Computable** — pure numpy/pandas from OHLCV. No human judgement.
2. **No lookahead** — uses only `close[i-1]` and earlier. Never `close[i]` in decision.
3. **Binary output** — +1 / -1 / 0. Not a float. Not a score. A vote.

---

## GATE 3 — IMPLEMENT (1–2 hours)

Add to `ds/ds_app/algos_crypto.py` (or future `algos_equities.py`):

```python
# ── MY_SIGNAL feature builder ──────────────────────────────────────────
def feat_MY_SIGNAL(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Computes MY_SIGNAL columns on OHLCV DataFrame."""
    n   = params.get("lookback", 20)
    cl  = df["Close"].values
    out = pd.DataFrame(index=df.index)
    
    # ... compute indicator ...
    
    # VOTE: +1 long / -1 short / 0 no signal
    out["vote"] = np.where(signal_condition, 1, np.where(anti_condition, -1, 0))
    return out


# ── Register in ALGO_REGISTRY ──────────────────────────────────────────
ALGO_REGISTRY["MY_SIGNAL"] = {
    "bank":      "BOOM",          # BOOM | STRAT | LEGEND
    "name":      "MY SIGNAL",
    "stop_pct":  0.015,
    "hold_bars": 12,
    "feat_fn":   feat_MY_SIGNAL,
    "default_params": {"lookback": 20},
}
```

Also add to `compute_live_votes()` in the same file (one-liner in the loop).

---

## GATE 4 — VALIDATE (automated, ~10 min runtime)

Run the validation pipeline. All 4 must pass:

```bash
cd ds

# Step 1: IC test (Spearman, 14-day rolling)
.venv/bin/python ds_app/ic_monitor.py --signal MY_SIGNAL
# PASS if: any window shows IC > 0.003

# Step 2: IS/OOS t-stat (MRT-style)
cd ../MRT && ./target/release/mrt-processor discover
# PASS if: is_t.abs() > 2.0 AND oos_t.signum() == is_t.signum()

# Step 3: FDR gate
.venv/bin/python ds_app/signal_discovery.py --symbol TSLA --signal MY_SIGNAL
# PASS if: q_value < 0.05 (BH-corrected)

# Step 4: Walk-forward
.venv/bin/python ds_app/walkforward.py
# PASS if: signal lifecycle ≠ RETIRE AND regime IC > 0 in at least 1 regime
```

**Failure = stop.** Fix or discard. Never override the gate.

---

## GATE 5 — BENCHMARK (15 min)

Compare marginal Sharpe contribution and PCA redundancy:

```bash
cd ds

# Marginal Sharpe: does adding MY_SIGNAL improve stacked Sharpe?
.venv/bin/python ds_app/sharpe_ensemble.py --add-signal MY_SIGNAL
# PASS if: marginal Sharpe delta > +0.05

# PCA redundancy: is it correlated with existing signals?
.venv/bin/python ds_app/pca_signals.py --check MY_SIGNAL
# PASS if: loading on any existing PC < 0.70 (not a clone)
```

**If PCA loading > 0.70** → it's redundant with an existing signal.  
Replace the weaker of the two, not add both.

PADAWAN baseline Sharpe is **11.187**. New signal must not degrade it.

---

## GATE 6 — ROUTE (5 min)

Which regime(s) does this signal work in?

```python
# In ds/ds_app/sharpe_ensemble.py → SOFT_REGIME_MULT dict
"MY_SIGNAL": {
    "TRENDING":  1.5,   # strong in trend
    "BREAKOUT":  1.0,   # neutral
    "RANGING":   0.05,  # near-zero suppress
    "RISK-OFF":  0.05,  # suppress
},
```

**Rule:** derive from walkforward regime IC table. Never guess.  
**If regime IC is positive in all 4** → signal is ALIVE (no routing needed).  
**If regime IC is positive in 1-2** → signal is SPECIALIST (route aggressively).

---

## GATE 7 — PROMOTE

Once all 6 gates pass:

```
1. Add to ALGO_REGISTRY in algos_equities.py (or algos_crypto.py)
2. Add to SOFT_REGIME_MULT in sharpe_ensemble.py
3. Add visual panel in ControlRoomKnights.jsx → BANK_A/B/C arrays
4. Update SYSTEM-SPEC.md signal library table
5. Run: POST /v1/walkforward/run/ to regenerate lifecycle
6. Run: POST /v1/ic/halflife/run/ to set decay timer
7. Commit with message: "PROMOTE: MY_SIGNAL — OOS t=X.X PADAWAN delta=+0.XX"
```

The signal is now a JEDI Council member. It will be monitored daily for decay.

---

## PINE SCRIPT → SIGNAL TRANSLATION GUIDE

Most Pine indicators reduce to one of four signal types:

| Pine Pattern | Python translation | Example |
|---|---|---|
| `crossover(fast, slow)` | `(fast > slow) & (fast.shift(1) <= slow.shift(1))` | EMA crossover |
| `close > highest(close, n)[1]` | `cl > pd.Series(cl).shift(1).rolling(n).max()` | Breakout |
| `rsi(close, 14) < 30` | `RSI < 30` using `ta.rsi()` | Oversold |
| `squeeze = bb_width < kc_width` | `BB_width < KC_width` (both pandas_ta) | SQZPOP |

**Pine repaint risk:** if the indicator uses `security()` or `barstate.isrealtime`, it repaints.  
The Python translation must use only confirmed close prices (index -2 or earlier).

---

## MRT → JEDI INTEGRATION PATH

MRT already runs the discovery pipeline. Winners from `mrt_discovery.json` that pass FDR are ready to onboard directly — they've already passed Gates 4-5.

```bash
# See top FDR winners across all assets
cat ds/data/mrt_discovery.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
for sym in d['symbols'][:5]:
    for w in sym['winners'][:3]:
        print(f\"{sym['symbol']:8} {w['id']:15} is_t={w['is_t']:.2f} oos_t={w['oos_t']:.2f} q={w['q_value']:.3f}\")
"
```

Best MRT candidates to implement next:
- `REV_1` (mean reversion 1-bar) — OOS t consistent across assets
- `MOM_5v20` (momentum short vs long MA) — regime-specialist, TRENDING
- `RANGE20` (20-bar range position) — RANGING specialist

---

## DAILY HUNT — WHAT THE MACHINE DOES AUTOMATICALLY

See `daily_hunt.sh`. Every morning at 6am ET:

```
1. MRT discover    → finds new FDR winners (all 20 symbols, rayon 10-core)
2. signal_discovery → runs 500+ candidates, BH FDR (Python multiprocessing 10-core)
3. walkforward     → re-validates all existing signals (lifecycle update)
4. gate_search     → finds new veto gates that improve Sharpe
5. PCA + ensemble  → re-ranks signals, updates SOFT_REGIME_MULT candidates
```

Output: `ds/data/hunt_report.json` — ranked list of new candidates sorted by OOS t-stat.

**The machine hunts. You decide what gets promoted.**

---

## LEGEND TRADER ONBOARDING CHEAT SHEET

| Trader | Method | Key condition | Python hook |
|---|---|---|---|
| Minervini | VCP | 3 tight bases, vol contraction | ATR declining over 3 windows |
| Weinstein | Stage 2 | Price > 30W MA rising | `close > EMA(close, 150)` |
| ICT | FVG | Imbalance between candles | `high[i-2] < low[i]` (gap) |
| O'Neil | Cup & Handle | 40%+ vol on breakout | RVOL > 1.4 + new 52W high |
| Stockbee | EP | Gap up 3× avg vol + news | RVOL > 3.0 on open |
| Wyckoff | Spring | Undercut + vol spike + recovery | Price < range_low then reversal |

All reduce to: **binary vote from OHLCV + volume.** No news, no sentiment needed for the gate.

---

*Protocol version: 1.0 · 2026-04-19*
*Gatekeepers: IC test, FDR, OOS t-stat, PADAWAN Sharpe floor*
*"The library survives by replacing itself." — MRT-RENTECH-ALIGNMENT*
