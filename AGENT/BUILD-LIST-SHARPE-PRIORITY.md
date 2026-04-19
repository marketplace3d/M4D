# BUILD LIST — SHARPE PRIORITY ORDER
*Baseline: gate-stacked OOS Sharpe = 15.862 · IS = 11.697 · PADAWAN floor = 11.187*
*Rule: only build if it adds an UNCORRELATED dimension. No OHLCV clones.*
*Source: walkforward_report.json + SIGNAL-RETIRE-RULE.md + AI-SUMMARY.MD*

---

## TIER 0 — FIX BEFORE BUILDING ANYTHING NEW

| # | Item | Why first | Effort |
|---|------|-----------|--------|
| 0A | **Fix ic_monitor retire logic** → use regime IC, not global IC | Prevents wrongly retiring 10 alive signals | 30 min |
| 0B | **Fix BREAKOUT ensemble routing** → suppress non-BREAKOUT signals to 0.05 weight during BREAKOUT regime | BREAKOUT = -15 Sharpe, this is the biggest single drag | 1 hr |
| 0C | **Wire MRT volatility regime → SOFT_REGIME_MULT multiplier** | MRT knows vol state (high/mid/low). High vol → reduce all sizes. Not wired. | 1 hr |

---

## TIER 1 — HIGH SHARPE IMPACT (independent signals, different source)

### T1-A: OBI Entry Gate  ★★★★★
**Estimated Sharpe delta: +2 to +4**
- Source: Live Binance L2 / Polygon NBBO — pure order flow, NO OHLCV correlation
- Already built: `obi_signal.py` fetches live OBI ratio
- Already partially wired: alpaca_paper.py cuts size 25% when OBI opposes direction
- **Missing:** OBI as hard gate (not just size cut). If OBI > +0.35 and direction = LONG → full size. If OBI < 0 and direction = LONG → HOLD, don't enter.
- **Missing:** OBI written to `signal_log.db` for backtest validation
- Files to touch: `obi_signal.py`, `signal_logger.py`, `alpaca_paper.py`

### T1-B: ICT Kill Zones (precise 30-min windows) ★★★★
**Estimated Sharpe delta: +1 to +2** (current hour_kills = blunt proxy)
- Current: 11 UTC hours killed (blunt 60-min blocks)
- Better: ICT session kill zones (30-min windows):
  ```
  ALIVE:  London open  07:00–09:00 UTC
  ALIVE:  NY open      13:30–14:30 UTC  
  ALIVE:  NY lunch     17:30–19:30 UTC (low-volume reversal zone)
  KILL:   London close 11:00–13:00 UTC
  KILL:   NY close     20:30–23:00 UTC
  KILL:   Asia dead    22:00–06:00 UTC
  KILL:   DR forming   13:30–14:00 UTC (wait for direction)
  ```
- gate_search already found hour_kills as #1 Sharpe contributor. Precision upgrade = free Sharpe.
- Files to touch: `alpaca_paper.py` HOUR_KILLS → `session_gate()` function

### T1-C: DR/IDR Target Levels ★★★★
**Estimated Sharpe delta: +1 to +2**
- DR = Daily Range (first 30-60min of session: ES 09:30–10:00 ET)
- IDR = Initial Daily Range (pre-market to open)
- These levels are support/resistance for rest of day — high probability target magnets
- Pine script exists: `APP-DOC/TARGET-LEVELS-ENERGY/DR-IDR.PINE`
- Python translation: simple — compute `dr_high`, `dr_low`, `idr_high`, `idr_low` from session bars
- Use as: **entry only within ±0.3% of DR level** = high-probability zone
- Add to `signal_log.db`: `dr_proximity_pct` (float — distance to nearest DR level)
- File to build: `ds_app/target_levels.py`

---

## TIER 2 — STRUCTURE SIGNALS (ICT/SMC — different from OHLCV trends)

### T2-A: Order Block Detection ★★★
**Estimated Sharpe delta: +0.5 to +1.5**
- OB = last bearish candle before bullish impulse (bullish OB) or reverse
- Pine: `APP-DOC/TARGET-LEVELS-ENERGY/SUPER ORDER BLOCKS.PINE`
- Python: 3-bar pattern — detect last down-close before 3-bar rally (>=1.5× ATR)
- Signal: `ob_bull_near` (within 0.5 ATR of bullish OB) / `ob_bear_near`
- NOT a directional signal — an ENERGY ZONE signal. Trade INTO OBs, not past them.
- Add as column to signal_log + use as size multiplier in alpaca_paper.py

### T2-B: Fair Value Gap Detection ★★★
**Estimated Sharpe delta: +0.5 to +1**
- FVG = gap between candle[i-2].high and candle[i].low (bullish) — price tends to fill
- Pine: `APP-DOC/TARGET-LEVELS-ENERGY/MTF-FVG.PINE` (MTF = multi-timeframe)
- Python: 1-line on 3 bars. `fvg_bull = high[i-2] < low[i]`
- Use as: entries that START from FVG zone are higher probability
- Add `fvg_bull`, `fvg_bear`, `fvg_proximity_pct` to signal_log

### T2-C: Liquidity Sweep Detection ★★★
**Estimated Sharpe delta: +0.5 to +1**
- Equal Highs/Equal Lows = liquidity pools (retail stops above/below)
- Sweep = price briefly exceeds EQH/EQL then reverses → institutional entry
- Pine: `APP-DOC/TARGET-LEVELS-ENERGY/LIQUIDITY THERMAL.PINE`
- Python: rolling N-bar window, detect within-bar sweep + close reversal
- Use as: LONG entry AFTER bullish sweep of EQL (price took stops then reversed up)
- Signal: `liq_sweep_bull`, `liq_sweep_bear` → +1/-1 vote

### T2-D: Opening Range (OR) Breakout ★★
**Estimated Sharpe delta: +0.5**
- OR = first 15 or 30 min bar range of session
- OR break = high-probability momentum signal (O'Neil, Minervini, Stockbee all use this)
- Pine: `APP-DOC/TARGET-LEVELS-ENERGY/OPENING-RANGE.PINE`
- Python: trivial — `or_high`, `or_low` from first N bars of session
- Signal: price closes above `or_high` → LONG vote; below `or_low` → SHORT

---

## TIER 3 — VOLUME STRUCTURE (institutional footprint)

### T3-A: Volume at Level / VWAP Deviation ★★★
**Estimated Sharpe delta: +0.5 to +1.5**
- VWAP = volume-weighted average price (reset daily)
- Price > VWAP = bullish bias for intraday; price < VWAP = bearish
- VWAP + 1/2 SD bands = natural institutional support/resistance
- NOT in any current signal. Pure volume-price relationship.
- Source: `APP-DOC/TARGET-LEVELS-ENERGY/VOLUME ORDERBOOK.PINE`
- Python: `cumsum(volume * close) / cumsum(volume)` reset at session open
- Signal: `vwap_bias` = +1 if close > VWAP, -1 if below

### T3-B: Volume Profile POC (Point of Control) ★★
**Estimated Sharpe delta: +0.3 to +0.7**
- POC = price level with highest volume traded (rolling 20-bar)
- Price returning to POC = magnet effect / mean reversion zone
- Complements RANGING regime signals (RSI, Stoch) with volume confirmation

### T3-C: MRT → JEDI Regime Bridge ★★
**Estimated Sharpe delta: +0.5**
- MRT computes vol regime (high_vol/mid_vol/low_vol) per symbol in Rust
- Current: MRT runs separately, output not fed to Python ensemble
- Fix: `mrt_snapshot.json` vol_regime → multiply EUPHORIA trigger threshold
  - high_vol + TRENDING → EUPHORIA eligible (fat pitch)
  - high_vol + RISK-OFF → PADAWAN forced (drawdown protection)
- File to touch: `alpaca_paper.py` score_symbol() — read mrt_snapshot.json

---

## TIER 4 — EXECUTION QUALITY (not Sharpe, but P&L)

### T4-A: HALO Human-Like Entries (ALREADY BUILT — review only)
- Random delay 0–3 bars, split entry (50%+50%), size jitter ±10%
- Purpose: avoid MM pattern detection on round-lot exact entries
- NOT for Sharpe. For slippage reduction + algo stealth.
- Status: ✓ wired in `halo_mode.py` → `alpaca_paper.py`

### T4-B: Delta Ops Kelly Sizing (ALREADY BUILT — review only)
- Kelly fraction by mode: PADAWAN=0.25×, NORMAL=1.0×, EUPHORIA=2.5×
- Scale-in on acceleration, scale-out on deceleration
- CIS exit: 2-of-5 signals flip → invalidation exit (not stop price)
- Re-entry after CIS: Sharpe 29.716 — this is the single biggest win-rate booster
- Status: ✓ wired in `delta_ops.py` → `alpaca_paper.py`

---

## REGIME TECH STATUS — RENTECH/MRT

| Component | Status | Gap |
|-----------|--------|-----|
| Python regime engine | ✓ WIRED — `assign_regimes()` price-based | none |
| SOFT_REGIME_MULT | ✓ WIRED — per-signal regime weights | BREAKOUT weights need fix |
| Walkforward regime IC | ✓ COMPUTED per fold | regime routing not yet tightened |
| MRT vol regime (Rust) | COMPUTED — not fed to Python | MRT → JEDI bridge missing |
| ICT kill zones | ✗ MISSING — blunt hour kills only | T1-B |
| Regime-specific Kelly | ✗ MISSING — same Kelly in all regimes | TRENDING → higher Kelly; RISK-OFF → PADAWAN |

---

## EXECUTION SEQUENCE

```
Week 1 (fix the bleeding):
  0A → fix ic_monitor             30 min
  0B → fix BREAKOUT routing       1 hr
  0C → wire MRT vol regime        1 hr

Week 2 (independent alpha):
  T1-A → OBI hard gate            2 hr
  T1-B → ICT kill zones           1 hr
  T1-C → DR/IDR levels            2 hr

Week 3 (structure signals):
  T2-A → Order Block detection    2 hr
  T2-B → FVG detection            1 hr
  T2-C → Liquidity sweep          2 hr

Week 4 (volume + MRT bridge):
  T3-A → VWAP deviation           1 hr
  T3-C → MRT → JEDI bridge        1 hr

Run full daily_hunt.sh after each tier. Re-validate Sharpe before next tier.
The machine will tell you if it worked.
```

---

## WHAT NOT TO BUILD

- More OHLCV trend signals (EMA crosses, MACD variants) — corr > 0.6, zero marginal Sharpe
- More RSI variants — already have RSI_CROSS + RSI_STRONG, same cluster
- Multi-timeframe OHLCV filters — same data, different window, still correlated
- Any signal that doesn't pass: `corr < 0.3 with existing council AND regime IC > 0`

---

*Version: 1.0 · 2026-04-19*
*Next run: daily_hunt.sh --quick after each fix to verify Sharpe didn't regress*
