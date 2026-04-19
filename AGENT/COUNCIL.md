# The Council — 27 Algo Signal SSOT

## Philosophy

27 algos compete continuously. The market crowns winners. Losers don't get deleted — they get lower MoE weight. Over time the regime sorts them: some shine in trends, some in chop, some catch reversals.

**Simple beats complex.** Every algo here: 1 signal family, 2-3 parameters, testable on OHLCV with no exotic data.

---

## JEDI — The Composite Signal

```
JEDI = Σ(all 27 votes) / 27   →  range −1.0 to +1.0
JEDI_raw = Σ(all 27 votes)    →  range −27 to +27

conviction = (|JEDI_raw| / 27) × 100%

Regime:
  JEDI_norm > 20   →  BULL       (trade with full size)
  JEDI_norm < −20  →  BEAR       (short or hedge)
  |JEDI_norm| ≤ 20 →  NEUTRAL    (reduce size 50%)
  conviction < 25% →  DEAD MARKET (no trades)
```

---

## Bank A — BOOM (Entry Precision)

| ID | Name | Signal Family | Key Params |
|----|------|--------------|-----------|
| NS | Night Shift | Off-hours gap + volume | gap_pct=0.5%, vol_mult=1.5 |
| CI | Channel Impulse | Keltner break + candle body | keltner_mult=2.0 |
| BQ | Breakout Qualifier | Volume-confirmed range break | lookback=20, vol_mult=2.0 |
| CC | Candle Confirm | Engulfing + inside bar combo | body_pct=0.6 |
| WH | Wyckoff Hook | Spring/upthrust at support | atr_mult=1.5 |
| SA | Support Attack | Price bounce at SMA50 | sma=50, bounce_pct=0.3% |
| HK | Hook Knife | EMA9 cross + acceleration | ema=9, accel_bars=3 |
| GO | Gap & Go | Gap open continuation | gap_pct=1.0%, hold_bars=5 |
| EF | EMA Fan | EMA9/21/50 fan alignment | cross_margin=0.1% |

---

## Bank B — STRAT (Structure / Trend)

| ID | Name | Signal Family | Key Params |
|----|------|--------------|-----------|
| 8E | 8 EMA | Price above/below EMA8 | ema=8, confirm_bars=2 |
| VT | Velocity Trend | Rate of change + trend | roc_period=14, threshold=2% |
| MS | Momentum Squeeze | Bollinger inside Keltner | bb_mult=2.0, kelt_mult=1.5 |
| DP | Dual Pullback | Two-leg pullback to EMA | ema=21, pullback_pct=1.5% |
| WS | Wave Structure | HH/HL or LL/LH sequence | lookback=10 |
| RV | Range Vault | Range expansion breakout | range_bars=20, mult=1.2 |
| HL | Higher Low | Pivot low sequence | pivot_bars=5 |
| AI | ATR Impulse | ATR-scaled momentum thrust | atr_period=14, mult=1.5 |
| VK | Volume Kickstart | Vol surge at trend start | vol_mult=2.0, confirm=2 |

---

## Bank C — LEGEND (Swing / 1-6M)

| ID | Name | Signal Family | Key Params |
|----|------|--------------|-----------|
| SE | Sector Emerge | Relative strength emergence | rs_period=20 |
| IC | Institutional Cluster | Price clustering at round levels | cluster_pct=0.5% |
| WN | Wyckoff Nudge | Accumulation phase detection | vol_decay=0.7 |
| CA | Candle Anatomy | Wick ratio + body analysis | wick_ratio=2.0 |
| TF | Time Fractal | Multi-timeframe alignment | mtf=[5m,1h,1d] |
| RT | Relative Thrust | Momentum vs sector avg | thrust_period=10 |
| MM | Market Maker | Liquidity sweep + reversal | sweep_pct=0.3% |
| OR | Opening Range | ORB break (15m opening range) | or_minutes=15 |
| DV | Divergence Vote | RSI/price divergence | rsi_period=14 |

---

## Vote Logic

Each algo returns: `vote ∈ {−1, 0, 1}` + `strength ∈ [0.0, 1.0]`

- `+1` = LONG signal
- `−1` = SHORT signal
- `0` = no signal / flat

The Rust engine computes all 27 for each of 500 assets every 5 minutes.
The Python DS computes the same 27 for backtesting (must stay in sync).

**Sync rule:** If you change an algo definition, update both `engine/src/algos/mod.rs` AND `ds/ds_app/algos_crypto.py`.

---

## Backtest Standards

| Metric | Minimum | Target |
|--------|---------|--------|
| IS Sharpe | > 1.0 | > 1.5 |
| OOS Sharpe | > 0.7 | > 1.2 |
| Win rate | > 50% | > 58% |
| Trades (IS) | > 15 | > 40 |
| Max Drawdown | < 20% | < 10% |
| rank_score | > 0.8 | > 1.2 |

`rank_score = IS_sharpe × 0.6 + OOS_sharpe × 0.4`

---

## MoE Weight Matrix (regime-dependent)

The council feeds into 5 experts. Expert weights shift by regime:

| Expert | BULL | BEAR | NEUTRAL | Notes |
|--------|------|------|---------|-------|
| VECTOR | 0.35 | 0.20 | 0.25 | Price action / trend |
| VOLATILITY | 0.20 | 0.30 | 0.25 | Vol regime |
| GHOST | 0.20 | 0.15 | 0.20 | OB + FVG [PENDING] |
| ARB | 0.15 | 0.15 | 0.20 | Stat arb z-score [PENDING] |
| PULSE | 0.10 | 0.20 | 0.10 | Grok catalyst |

Bank tier weights (within each expert):
- Bank A (BOOM): 0.8 — entry precision, shorter hold
- Bank B (STRAT): 1.2 — structure, medium hold
- Bank C (LEGEND): 2.0 — swing, 1-6 month
