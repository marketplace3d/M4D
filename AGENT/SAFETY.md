# Safety Stack — Risk Gate, Flatten Tech, Circuit Breakers

## Philosophy

The system is only as good as its worst day. Every alpha edge can be wiped by one unchecked trade.

**Safety runs before execution. Always. No exceptions.**

---

## Layer 1 — JEDI Dead Market Gate

Before any signal is surfaced to the trader:

```
conviction = (|JEDI_raw| / 27) × 100%

if conviction < 25%:
    status = DEAD MARKET
    action = NO TRADES (surface informational only)
    size_multiplier = 0.0
```

DEAD MARKET means the council is undecided. No edge = no trade.

---

## Layer 2 — Risk Gate (6 Checks)

Every signal passes through `ds/ds_app/risk_gate.py` before display or execution.

```python
MAX_DAILY_LOSS    = -0.02   # −2% portfolio → HALT ALL
MAX_POSITION_PCT  = 0.05    # 5% max per asset
POD_KILL_THRESH   = -0.03   # −3% expert drawdown → kill pod
MIN_ALPHA         = 0.40    # minimum alpha score to approve
MIN_CONFIDENCE    = 0.50    # minimum MoE confidence
MAX_CORRELATED    = 5       # max correlated longs open simultaneously
```

| Check | Condition | Result |
|-------|-----------|--------|
| DAILY_HALT | portfolio_pnl ≤ −2% | REJECTED (all trading stops) |
| ALPHA_WEAK | alpha < 0.40 OR confidence < 0.50 | REJECTED |
| POD_KILL | expert_drawdown ≤ −3% | REJECTED (that expert's signals blocked) |
| CONCENTRATION | new_position > 5% of portfolio | REJECTED |
| CORRELATION | correlated_longs > 5 | FLAGGED (human must approve) |
| VOL_FILTER | asset_vol > regime_threshold | FLAGGED |

**Output:** `GateResult(symbol, status, approved_size, reasons[], checks[])`
- `APPROVED` → trade with `approved_size`
- `FLAGGED` → show to human, await override
- `REJECTED` → blocked, no trade

---

## Layer 3 — Position Sizing (Conviction-Scaled)

```
base_size = portfolio_value × MAX_POSITION_PCT    # 5% max

conviction = |JEDI_raw| / 27                      # 0..1
confidence = moe_confidence                        # 0..1

approved_size = base_size × conviction × confidence × regime_multiplier

regime_multiplier:
  BULL:        1.0
  NEUTRAL:     0.5
  BEAR:        0.3 (short bias only)
  DEAD MARKET: 0.0
```

Never flat-size a trade. Conviction must inform size.

---

## Layer 4 — HALO Entry (Execution Safety)

HALO = Harmonic Algorithmic Limit Order (spread entry over time window)

```
entry_window_min = 5..30  (configurable per signal)
num_slices       = 5       (split into 5 sub-orders)
schedule         = LCG pseudorandom distribution  (not linear)

Benefits:
- Reduces market impact
- Masks the entry pattern
- Allows partial fill if signal weakens
```

If 3+ slices fill and the signal degrades (JEDI flips direction) → cancel remaining.

---

## Layer 5 — POD Kill Switch

Each MoE expert is a "pod" with its own allocation.

```
if pod_drawdown <= POD_KILL_THRESH (−3%):
    pod_status = KILLED
    pod_signals = blocked (show in Alpha page as REJECTED)
    pod_allocation = 0%

Pod recovers when:
    drawdown recovers above −1% AND
    3 consecutive winning signals
```

---

## Layer 6 — Daily Halt

```
if portfolio_daily_pnl <= MAX_DAILY_LOSS (−2%):
    DAILY_HALT = True
    ALL new signals → REJECTED
    Display: red HALT banner across all pages
    Existing positions: human decides to flatten or hold

DAILY_HALT resets at midnight UTC.
```

---

## Flatten Tech

### Partial Flatten — Correlation Unwind
When CORRELATION check triggers (> 5 correlated longs):
1. Identify which existing positions are in the correlated group
2. Rank by: lowest conviction × highest unrealized loss
3. Flag bottom 2 for closure (human approval or auto if DAILY_HALT)

### Full Flatten — Emergency
One-button in M4D UI → closes all open positions.
Implementation (pending Alpaca live):
```
DELETE /positions/{symbol} for all open positions
Cancel all pending HALO slices
Set DAILY_HALT = True for rest of session
Log: reason, positions closed, P&L realized
```

### Graduated Flatten — Drawdown Ladder
```
Portfolio drawdown:
  -1%:  reduce new position sizes by 50%
  -1.5%: no new positions, hold existing
  -2%:  DAILY_HALT, flatten all at human discretion
  -3%:  AUTO flatten (if auto-trading enabled)
```

---

## Safety Display Requirements (M4D / M2D)

Every page that shows signals must show:

1. **Regime strip** — current regime, JEDI score, conviction %
2. **HALT banner** — if DAILY_HALT = True, shown in red across top
3. **Gate status per signal** — ✓ / ⚑ / ✗ inline with every signal row
4. **Pod status** — each expert shows drawdown %, KILLED if applicable
5. **Daily P&L** — portfolio-level, updated continuously

**No signal may appear without its gate status visible.**
