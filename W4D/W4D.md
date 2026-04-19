# W4D — WorldQuant-Style Quant HedgeFund
**Date:** 2026-04-07  
**Stack:** Python FastAPI :4040 | React Blueprint :4400  
**Launcher:** `./go4w.sh` from M4D root

---

## CURRENT DATA STATUS

| Mode | What Runs | Triggered By |
|------|-----------|--------------|
| **DEFAULT (War Room / Backtest / Signals / Attribution)** | **SYNTHETIC** — 100 fake equities, 756 days, regime-switching GBM | Any page load |
| **Live page** | **REAL** — futures.db (crypto/futures) | Manual trigger on `/live` page |

**Short answer: you are NOT on real data by default.**  
The real data pipeline (`data_live.py`) exists and is wired to `/v1/live/*` endpoints only.

---

## REAL DATA — futures.db

**Path:** `ds/data/futures.db`  
**Size:** ~12M bars total

| Table | Symbols | Date Range | Rows |
|-------|---------|------------|------|
| `bars_1m` | ES, NQ, RTY, CL, 6E, GC, SI + BTC/ETH/SOL/XRP/BNB | Apr 2024 → Apr 2026 | 8.2M |
| `bars_5m` | BTC ETH SOL XRP BNB ADA ARB ATOM AVAX DOGE DOT FIL INJ LINK LTC OP SUI TIA UNI | Apr 2024 → Apr 2026 | 4M |

**To run on real data:** Go to `/live` page → hit "Run Live Engine".  
Default preset: 10 crypto assets from `bars_5m`, start 2024-04-01.

---

## 12 ALPHA SIGNALS

| # | Name | Family | Logic |
|---|------|--------|-------|
| 1 | `ts_momentum` | momentum | 12-1 month return rank (Jegadeesh-Titman) |
| 2 | `cross_momentum` | momentum | 20-day return rank (fast momentum) |
| 3 | `reversal_1m` | momentum | -rank(21d ret) — contrarian |
| 4 | `stat_arb_zscore` | mean_rev | 20d rolling z-score of price |
| 5 | `vol_adjusted_mr` | mean_rev | MR signal scaled by inverse vol |
| 6 | `rsi_extremes` | mean_rev | RSI14 deviation from 50 |
| 7 | `ep_rank` | value | Earnings-to-Price rank (CS) |
| 8 | `bp_rank` | value | Book-to-Price rank (CS) |
| 9 | `composite_value` | value | Average of EP + BP rank |
| 10 | `roe_rank` | quality | Return-on-Equity rank |
| 11 | `earnings_surprise` | quality | Post-earnings drift proxy |
| 12 | `accruals` | quality | Sloan 1996: low accruals = quality |

**⚠ PROBLEM:** Signals 7–12 (value/quality) require fundamental data (EP, BP, ROE).  
On real futures/crypto, these are **synthetic proxies built from price/vol/momentum** — no actual fundamentals. IC will be near-zero for these signals on real data.

**Signals most likely to work on futures/crypto:** `ts_momentum`, `cross_momentum`, `stat_arb_zscore`, `vol_adjusted_mr`, `rsi_extremes`.

---

## WHY RETURNS MAY BE NEGATIVE / FLAT

1. **Value/quality signals have zero real edge on crypto** — 5 out of 12 signals are noise
2. **Transaction costs are high:** 5bps commission + 10bps spread + 5bps impact = 20bps/side = **40bps round-trip** — kills any weak IC signal
3. **63-day warmup** eats ~25% of a 256-day dataset before any trades
4. **Equity momentum lookbacks (252 days)** don't suit crypto (shorter regimes)
5. **Cross-sectional approach** needs N≥20 instruments to rank meaningfully

---

## WHAT WE NEED TO GET POSITIVE RETURNS

### Option A — Fix signals for real futures/crypto (correct path)
- [ ] **Futures-native signals**: roll yield, basis, term structure, open interest momentum
- [ ] **Crypto-specific signals**: funding rate momentum, on-chain volume, BTC dominance regime
- [ ] Reduce value/quality family weight OR disable for futures universe
- [ ] Tune momentum lookbacks: 5d, 20d, 63d for crypto (not 252d equity)
- [ ] Lower TC model: crypto spot is 3–5bps all-in, not 20bps

### Option B — Quick synthetic win (test the plumbing)
- Run default backtest (synthetic data, seed=42) — drift is +0.03%/day baked in
- If War Room shows negative NAV on synthetic, there's a signal pipeline bug

### Option C — Wire real data to main engine
- Replace `generate_universe()` in `main.py` with `load_daily()` from `data_live.py`
- Flip the default `_get_or_run` to use real data
- This makes War Room / Backtest / Attribution show real performance

---

## COMPONENTS — BUILT vs NOT BUILT

### ✅ BUILT

**Python Quant Engine (`W4D/quant/`)**
- `core.py` — math utils: cs_rank, winsorise, zscore, sharpe, max_drawdown, calmar
- `data.py` — synthetic universe generator (regime-switching GBM)
- `data_live.py` — real data loader from futures.db → Universe
- `signals.py` — 12 alpha signals (4 families)
- `ensemble.py` — RegimeClassifier + ICTracker + IC-weighted EnsembleCombiner + SignalPipeline
- `optimizer.py` — AlphaScaledOptimizer, MeanVarianceOptimizer, RiskParityOptimizer
- `risk.py` — RiskLimits, PreTradeChecker, RiskMonitor, CircuitBreaker
- `backtester.py` — event-driven sim with TC model, daily P&L, analytics
- `walkforward.py` — anchored expanding walk-forward with PBO calculation
- `attribution.py` — P&L decomposition by family/regime/long-short/TC
- `main.py` — wiring entry point
- `server.py` — FastAPI with 18 endpoints

**FastAPI Endpoints (:4040)**
- `/health` ✅
- `/v1/summary`, `/v1/nav`, `/v1/signals`, `/v1/regime`, `/v1/regime/dist` ✅
- `/v1/risk`, `/v1/weights`, `/v1/monthly`, `/v1/attribution` ✅
- `/v1/walkforward` ✅ (just fixed — pandas 3.0 compat)
- `/v1/live/info`, `/v1/live/run`, `/v1/live/nav`, `/v1/live/summary`, `/v1/live/signals` ✅

**React War Room (`W4D/site/src/`)**
- `WarRoom.tsx` — KPI strip, equity curve, regime gauge, signal board, risk gauge, weights table
- `Signals.tsx` — ICIR bar chart, family averages, regime multiplier table
- `Backtest.tsx` — perf summary, return distribution, monthly returns heatmap, walk-forward fold table
- `Attribution.tsx` — long/short/TC cards, family bar chart, regime pie chart (just fixed)
- `Live.tsx` — DB info panel, preset selector, run button, live equity curve, IC table

**Infrastructure**
- `go4w.sh` — launcher (quant :4040 + site :4400)
- `vite.config.ts` — proxy /v1 and /health → :4040
- TanStack Query with 30s refetch, Blueprint dark theme

### ❌ NOT BUILT

**Missing signals for real alpha**
- Roll yield / futures basis signal
- Funding rate signal (crypto)
- Open interest momentum
- COT (Commitment of Traders) positioning signal
- Volatility term structure (VIX-style)
- Cross-asset regime detector (BTC dominance, DXY, yields)

**Missing infrastructure**
- Real-time data feed (currently DB-only, no live WebSocket price feed)
- Order execution layer (no broker/exchange connection)
- Live P&L mark-to-market (not real-time, post-backtest only)
- Parameter optimization UI (no grid search / Bayesian tuner in UI)
- Alerts / drawdown notifications
- Position-level drill-down (only aggregate portfolio view)
- Signal correlation matrix page
- Factor exposure decomposition (BARRA-style)
- Benchmark comparison (vs BTC buy-and-hold, vs SPY)

**Data gaps**
- No tick data (only 1m/5m bars)
- No options data (no IV surface)
- No macro data (rates, econ calendar)
- No funding rates historical (Binance API needed)

---

## ARCHITECTURE SUMMARY

```
futures.db (12M bars)
    ↓ data_live.py
    ↓ resamples to daily OHLCV
    ↓
SignalPipeline
  ├── 12 AlphaSignal.compute() → (T×N) raw scores
  ├── RegimeClassifier → 5 regimes
  ├── ICTracker → decay-weighted ICIR per signal
  └── EnsembleCombiner → regime-scaled IC-weighted alpha
    ↓
Portfolio Optimizer (AlphaScaled | MVO | RiskParity)
    ↓
PreTradeChecker + CircuitBreaker
    ↓
Backtester.run() → fills, NAV, P&L
    ↓
PerformanceAnalytics → summary, monthly, attribution
    ↓
FastAPI :4040 → React War Room :4400
```

---

## KNOWN BUGS (as of 2026-04-07)

| Bug | Status | File |
|-----|--------|------|
| `reindex(method="ffill")` pandas 3.0 compat | ✅ FIXED | signals.py |
| Monthly endpoint `(year, _)` unpack error | ✅ FIXED | server.py |
| Attribution page white (ReferenceLine not imported) | ✅ FIXED | Attribution.tsx |
| spearmanr ConstantInputWarning | ✅ SUPPRESSED | ensemble.py |
| Walk-forward 500 — may still have other pandas 3.0 issues | 🔴 UNKNOWN | walkforward.py |

---

## IMMEDIATE NEXT PRIORITIES

1. **Verify synthetic backtest shows positive returns** — hit `/v1/run` and check War Room NAV
2. **Run live engine on crypto** — `/live` page → Run → verify `/v1/live/nav` returns data
3. **Fix walk-forward endpoint** — needs full traceback from a clean API restart
4. **Wire real data to main engine** — replace synthetic default with `bars_5m` crypto universe
5. **Add futures-native signals** — roll yield, funding rate, OI momentum
6. **Reduce TC model for crypto** — 5bps all-in, not 20bps
