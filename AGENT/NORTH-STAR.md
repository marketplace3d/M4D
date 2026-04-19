# NORTH STAR — What We Are Building

## The Mission

Build a **near-hedge-fund intelligence system** operated by one person.

Three layers:
1. **Science** (M3D) — a council of 27 competing algos continuously scoring 500 crypto assets. Backtested. Ranked. Walk-forward validated. The engine of alpha.
2. **Signal Surface** (M2D) — gold-standard alpha visualization derived from big AI. Lean Svelte UI. Execution-grade. No noise.
3. **Oracle Interface** (M4D) — presents council output as human-readable intelligence. MaxCogViz radar. Grok real-time pulse. HALO jump entry scheduler. Full safety stack.

**Winning = max Sharpe, max capital preservation, actionable in real time by one trader.**

---

## Success Criteria — Measurable

| Dimension | Target | Status |
|-----------|--------|--------|
| Algo council coverage | 27 algos × 500 assets, 5m refresh | ✓ running |
| Backtest engine | IS/OOS walk-forward, vectorbt + backtesting.py | ✓ working |
| Historical DB | 2yr, 11.9M bars, futures + crypto | ✓ 2024→2026 |
| Real-time scanner | 50 USDT pairs, SURGE/BREAKOUT/MOM/REV/GAP, Rust WS | ✓ /ws/scanner |
| Risk gate | 6 checks before any trade approved | ✓ ds/ds_app/risk_gate.py |
| Oracle AI | Grok live pulse + MaxCogViz 12-dim radar | ✓ /v1/ai/maxcogviz |
| Stock real-tick | Alpaca IEX WS (fund $1 → real-time) | ⬜ pending |
| GHOST expert | Order Block + FVG in Rust engine | ⬜ pending |
| ARB expert | Stat arb wired into MoE computeAlpha() | ⬜ pending |
| Multi-model MaxCogViz | ANTHROPIC_API_KEY + GOOGLE_GEMINI_KEY needed | ⬜ pending |
| Flatten tech | Complex position unwinding on drawdown | ⬜ pending |

---

## The Alpha Stack (Bottom → Top)

```
RAW DATA
  Binance REST/WS  →  500 crypto OHLCV 5m (free, live)
  Databento        →  ES/NQ/GC/CL/RTY/6E/SI futures 1m (2yr history)
  Binance history  →  BTC/ETH/SOL/BNB/XRP 1m + 20 symbols 5m (2yr history)
  [pending] Alpaca →  US stock real-tick IEX WS

ALGO COUNCIL (M3D Engine — Rust, 500 assets, 5m loop)
  Bank A (BOOM)   9 algos — Entry precision
  Bank B (STRAT)  9 algos — Structure / trend
  Bank C (LEGEND) 9 algos — Swing / 1-6M
  JEDI = sum of all 27 votes (−27..+27 continuous score)

INTELLIGENCE (M3D DS — Python Django :8800)
  Rank: 27 × N backtest matrix (backtesting.py, IS/OOS)
  Optimize: vectorbt grid search with walk-forward
  Legend scan: 40 stocks × 9 legendary trader methods
  MTF scoring: 5m/15m/60m/1d EMA + RSI alignment
  Risk gate: 6 pre-trade checks → APPROVED / FLAGGED / REJECTED
  AI pulse: Grok 60s poll → gaming filter → trigger schema

MoE EXPERTS (Alpha weighting layer)
  VECTOR    — price action / trend
  VOLATILITY — vol regime scoring
  GHOST     — Order Block + FVG [PENDING]
  ARB       — statistical pair arbitrage [PENDING]
  PULSE     — Grok news catalyst detection

ORACLE OUTPUT (M4D :5550)
  MaxCogViz 12-dim radar  — Grok + Claude + Gemini parallel
  HALO entry scheduler    — LCG spread over entry_window_min
  Flatten controls        — POD kill, correlation unwind, daily halt
  Push alerts             — macOS notify, /ws/scanner WS stream
```

---

## North Star Metrics (trade performance)

| Metric | Floor | Gold |
|--------|-------|------|
| Sharpe (annual) | > 1.5 | > 2.5 |
| Max Drawdown | < 15% | < 8% |
| Win Rate | > 52% | > 60% |
| Avg R:R | > 1.5 | > 2.5 |
| Correlation to BTC | < 0.5 | < 0.3 |

---

## What "Gold Standard" Means Per Site

### M2D — Alpha Signal Surface
Gold = every signal shown to the human has:
- **Direction** (LONG / SHORT) with confidence %
- **Entry zone** (price + time window)
- **Risk gate status** (APPROVED ✓ / FLAGGED ⚑ / REJECTED ✗)
- **Source tracing** (which algo, which expert, which bank fired)
- Real-tick scanner alerts within 60 seconds of detection

### M3D — Algo Science
Gold = every algo has:
- IS Sharpe > 1.0 (in-sample), OOS Sharpe > 0.7 (out-of-sample)
- Min 15 trades in test window
- No look-ahead bias (strict bar-close entry only)
- Walk-forward validated on 5 rolling windows
- Rank score = IS_sharpe × 0.6 + OOS_sharpe × 0.4

### M4D — Human Oracle
Gold = the trader reads the screen and knows:
- **Regime** (BULL / BEAR / NEUTRAL / DEAD MARKET)
- **Top 3 actionable signals** with entry/stop/target
- **What not to do** (GHOST dissent, BEAR HAWK view)
- **How much size** (conviction-scaled, risk-gate approved)
- **When to exit** (flatten trigger conditions clearly displayed)

---

## Dogma to Reject

| Bad assumption | Truth |
|---------------|-------|
| OHLCV alone is the edge | Catalyst timing is the edge — news moves before price |
| Daily bars are enough | 1m / 5m bars required for scanner + HALO entries |
| Single model consensus | Echo chambers kill alpha — adversarial swarm mandatory |
| Equal algo weights | Regime-specific weights are provably different |
| Python is fine for signals | Python GIL is fake threads — Rust for sub-minute CPU-bound |
| Complex algos backtest better | Simple 1-signal, 2-3 param algos outperform consistently |

---

## The Trader UX Contract

The human trader must be able to:
1. Open M4D → understand market regime in < 5 seconds
2. See top 3 actionable signals with risk gate status
3. Approve or override entries with one click
4. Know exactly when the system says "flatten everything"
5. See the dissenting view (bear hawk / ghost / devil's advocate)

**If the interface requires explanation, it has failed.**
