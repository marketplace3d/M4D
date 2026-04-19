# CLAUDE CODE AGENT — M4D ENGINE TUNING PLAN
### Paste this into Claude Code to run the full pipeline

---

## MISSION
Run the M4D signal stack against 2yr Polygon SQLite data.
Find which signals are independent. Find the optimal regime-filtered ensemble.
Output a paper trading config ready for Alpaca.

---

## CONTEXT — READ FIRST

```
Stack:        M4D / M6D · JR · DS/SWE · Solo
Data:         2yr Polygon OHLCV in SQLite (DS layer)
Engine:       Python Django DS :8000 (ds/backtesting.py, signals.py, optimizer.py)
Rust engine:  M3D api :3030 (500-asset processor)
Frontend:     M6D React :5173
Broker:       Alpaca (paper trading target)

Key files:
  ds/ds_app/backtesting.py      ← backtesting engine
  ds/ds_app/signals.py          ← signal generation (pandas-ta)
  ds/ds_app/optimizer.py        ← grid-search optimizer
  ds/data/ds.db                 ← SQLite with 2yr Polygon data
  engine/data/algo_day.json     ← live algo snapshot
  engine/data/algo_state.db     ← SQLite history
  spec-kit/data/council-algos.v1.json  ← 27 algo definitions (SSOT)
```

---

## PHASE 1 — SIGNAL LOGGER
**Goal:** Capture every signal state + outcome for correlation analysis.

```
Build: ds/ds_app/signal_logger.py

Schema (SQLite table: signal_log):
  id, timestamp, symbol, timeframe,
  jedi_score, obi_ratio, dom_pressure,
  algo_ns, algo_ci, algo_bq, algo_cc, algo_wh, algo_sa,  ← BOOM
  algo_hk, algo_go, algo_ef,
  algo_8e, algo_vt, algo_ms, algo_dp, algo_ws, algo_rv,  ← STRAT
  algo_hl, algo_ai, algo_vk,
  algo_se, algo_ic, algo_wn, algo_ca, algo_tf, algo_rt,  ← LEGEND
  algo_mm, algo_or, algo_dv,
  squeeze_state,         ← COILING | EXPANDING | FIRING
  killzone_active,       ← boolean
  rvol,
  icx_ob_near,          ← distance to nearest OB
  icx_fvg_near,         ← distance to nearest FVG
  icx_eqhl_near,        ← distance to EQH/EQL level
  price_open, price_high, price_low, price_close, volume,
  outcome_1h_pct,       ← % move 1h forward (for validation)
  outcome_4h_pct,
  outcome_1d_pct

Run against: all symbols in ds.db, all available history
Output: signal_log.db
```

---

## PHASE 2 — MEGA BACKTEST
**Goal:** Run all signals on 2yr Polygon data. Score each independently.

```
Build: ds/ds_app/mega_backtest.py

For each signal (27 algos + squeeze + killzone + RVOL + ICX levels):
  1. Generate signal series from historical data
  2. Backtest: long/short on signal cross, ATR-based stops
  3. Compute:
     - Total return %
     - Sharpe ratio (annualized)
     - Max drawdown %
     - Win rate %
     - Profit factor
     - Avg trade duration
     - Regime breakdown (trending/ranging/volatile)
  4. Apply WorldQuant 4-gate filter:
     - Sharpe > 1.0 on OOS (last 6mo = test, first 18mo = train)
     - Max drawdown < 25%
     - Works across min 20 symbols (not single-stock fit)
     - Positive in at least 3 of 4 regimes

Output: backtest_results.json
  { signal_id, sharpe, maxdd, winrate, regime_scores, passed_gate: bool }
```

---

## PHASE 3 — CORRELATION MATRIX
**Goal:** Find which signals are truly independent.

```
Build: ds/ds_app/correlate.py

Input: signal_log.db (from Phase 1) or backtest signal series
Method:
  - Pearson corr on signal values (not returns — raw signal)
  - Spearman corr on ranks (handles non-linear)
  - Cluster signals with corr > 0.6 → same cluster
  - Per cluster: keep highest standalone Sharpe, kill rest

Target output:
  CLUSTER 1 (trend/momentum): keep best 1 of ~12
  CLUSTER 2 (volatility):     keep Squeeze (slot 3)
  CLUSTER 3 (structure):      keep ICT OB/FVG (slot 4)
  CLUSTER 4 (timing):         keep Killzone (slot 5)
  CLUSTER 5 (participation):  keep RVOL (slot 6)
  INDEPENDENT: DOM OBI        keep (slot 7 — different source)

Output: correlation_matrix.png + surviving_signals.json
```

---

## PHASE 4 — REGIME CLASSIFIER
**Goal:** Build a regime detector that routes signals.

```
Build: ds/ds_app/regime.py

Inputs (all computable from OHLCV):
  - Realized volatility (20-bar rolling std of returns)
  - ATR slope (expanding vs contracting)
  - Price vs 50 EMA and 200 EMA (above/below)
  - ADX (trend strength, > 25 = trending)

Regimes:
  TRENDING:  ADX > 25, price > 50 EMA
  RANGING:   ADX < 20, price oscillating around 50 EMA
  BREAKOUT:  ATR expanding > 1.5x 20-bar avg, Squeeze firing
  RISK-OFF:  Realized vol > 2x 20-bar avg OR gap down > 2%

Signal routing per regime (from RenTech framework):
  TRENDING:  use TREND algos + Squeeze firing + MTF
  RANGING:   use mean-reversion + OBI pressure
  BREAKOUT:  use ATR expansion + Volume burst + DOM walls
  RISK-OFF:  Safety DEF only + DOM walls confirm

Output: regime_classifier.pkl (sklearn or pure numpy)
        regime_routing_table.json
```

---

## PHASE 5 — WALK-FORWARD VALIDATION
**Goal:** Prove edge on unseen data. No curve-fitting.

```
Method: expanding window walk-forward
  Window 1:  train mo 1-12,  test mo 13
  Window 2:  train mo 1-13,  test mo 14
  ...
  Window 12: train mo 1-23,  test mo 24

For each window:
  - Train: fit regime classifier on training period
  - Test:  run full ensemble (surviving signals × regime routing)
           on test period with NO parameter changes
  - Record: Sharpe, MaxDD, win rate per window

Pass criteria:
  - OOS Sharpe > 1.0 in at least 10 of 12 windows
  - No single window MaxDD > 15%
  - Median OOS Sharpe > 1.5

Output: walkforward_results.json + equity_curve.png
```

---

## PHASE 6 — PAPER TRADING CONFIG
**Goal:** Output a config Alpaca adapter can consume.

```
Build: ds/ds_app/paper_config.py

Output: paper_trading_config.json
{
  "surviving_signals": [...],        ← from Phase 3
  "regime_routing": {...},           ← from Phase 4
  "entry_rules": {
    "min_jedi_score": N,             ← tuned in backtest
    "killzone_required": true,
    "squeeze_state": "EXPANDING",    ← not COILING
    "obi_min_ratio": 0.55,           ← DOM confirm
    "rvol_min": 1.5
  },
  "risk": {
    "position_size_pct": 1.5,        ← % of account
    "max_positions": 5,
    "daily_dd_limit_pct": 3.0,
    "kill_after_loss_pct": 0.5       ← Justin Werlein rule
  },
  "universe": ["BTC", "ETH", "SPY", "QQQ", "AAPL", ...]
}
```

---

## PHASE 7 — ALPACA PAPER ADAPTER
**Goal:** Wire config to live paper orders.

```
Build: api/src/alpaca.rs (Rust module)

Flow:
  M3D engine fires signal
  → reads paper_trading_config.json
  → checks: killzone? squeeze state? obi_ratio? rvol?
  → if ALL gates pass → POST /v2/orders to Alpaca paper API
  → log to signal_log.db with fill price + outcome
  → blotter UI shows in TradeBotPage
```

---

## EXECUTION ORDER

```
START HERE (1 session each):
  □ Phase 1: signal_logger.py     ← run against ds.db, collect 2wk data
  □ Phase 2: mega_backtest.py     ← score all signals on 2yr history
  □ Phase 3: correlate.py         ← kill redundant, find survivors
  □ Phase 4: regime.py            ← build regime classifier
  □ Phase 5: walk_forward.py      ← prove OOS edge
  □ Phase 6: paper_config.json    ← output final config
  □ Phase 7: alpaca.rs            ← wire to paper trading

THEN WATCH THE EQUITY CURVE.
```

---

## THE SQUEEZE MOMENTUM SLOT (important note)

```
Squeeze Momentum earns Slot 3 (Volatility State) because:
  - Detects COILING (BB inside KC) = energy stored
  - FIRING = BB expands outside KC = breakout confirmed
  - DO NOT enter during COILING state
  - Enter only on FIRING with momentum histogram direction

This is the BOOM expansion confirmation you started with.
It was right. It stays. It's not one of the correlated OHLCV signals —
it measures a state (compression/expansion), not a direction.
```

---

## TRADER COUNCIL LOGIC GATES

```
Per documented council (EXPERT TRADER COUNCIL doc):

ICT / TTrades    → IF time IN [08:30-11:00 OR 13:30-16:00 EST] → OPEN
Marco Trades     → IF price sweeps HTF high/low AND rejects → INDUCEMENT
MentFX           → IF CHoCH occurs AND price in discount zone → STRUCTURE
Ali Khan         → IF volume spike AT liquidity grab level → PARTICIPATE
Moving Average   → IF price above 200 EMA → LONG BIAS only
Justin Werlein   → IF daily loss > 0.5% → KILL for 24h

These are GATES not signals. They filter, not generate.
A signal must pass the open gates to become an order.
```

---

---

## PHASE 8 — ZIPLINE PERFORMANCE CHARTS
**Goal:** Institutional-grade tear sheet in the M6D app and as Python report.

```
Build A: ds/ds_app/perf_report.py
  Reads signal_log.db + simulated equity curve.
  Outputs JSON: ds/data/perf_report.json

  Charts (all computed in Python, served as JSON to React):
  ┌─ KPI STRIP ─────────────────────────────────────────────────┐
  │  Total Return  │  Sharpe  │  Max DD  │  Win Rate  │  Calmar │
  └─────────────────────────────────────────────────────────────┘
  ┌─ LEFT ──────────────────┐ ┌─ CENTER ────────────────────────┐
  │ Equity curve + benchmark│ │ Monthly returns heatmap         │
  │ Underwater drawdown     │ │ Rolling Sharpe (30d/90d)        │
  └─────────────────────────┘ │ Regime overlay on equity curve  │
  ┌─ BOTTOM ────────────────┐ └─────────────────────────────────┘
  │ Trade distribution      │ ┌─ RIGHT ────────────────────────┐
  │ Correlation heatmap     │ │ Signal contribution waterfall  │
  └─────────────────────────┘ └─────────────────────────────────┘

Build B: M6D/src/pages/PerfChartsPage.tsx
  Route: /perf
  Fetches /v1/perf-report from M3D API.
  Renders: LightweightCharts equity curve + D3 heatmap + Canvas bar charts.

API endpoint:
  GET /v1/perf-report → PerfReport JSON
  (M3D api reads ds/data/perf_report.json)
```

---

## PHASE 9 — RANGING ENGINE (DOLDRUMS KILLER)
**Goal:** Separate trading machine for RANGING regime (74.5% of bars).

```
Data shows:
  RANGING = 74.5% of all bars
  Directional signals still work in RANGING (DON_BO 1.998, VOL_BO 2.124)
  BUT mean-revert / grid can harvest BOTH directions

Architecture:
  REGIME ROUTER (gate 0)
    │
    ├── TRENDING (0.0%)  → TREND_SMA | MACD_CROSS | CONSEC_BULL
    ├── RANGING  (74.5%) → Channel breakout signals (DON_BO, VOL_BO, KC_BREAK)
    │                      + optional GRID LAYER (buy grid below, sell grid above)
    ├── BREAKOUT (16.1%) → GOLDEN | DON_BO | OBV_TREND (highest signal quality)
    └── RISK-OFF  (9.5%) → SUPERTREND | DON_BO (Sharpe 4-5x normal)

Grid Layer (RANGING sub-engine):
  Activate when:  ADX < 20, ATR% < median, squeeze=1
  Grid spacing:   0.5 × ATR(14)
  Max layers:     3 (no martingale beyond 3 — hard limit)
  Exit trigger:   squeeze fires (SQZPOP entry = grid EXIT)
  Kill switch:    if price breaks N-bar range by > 1.5 ATR → exit all

NOTE: Grid/martingale is capital-intensive and has tail risk.
  Build ONLY after paper trading confirms directional edge first.
  No grid until Alpaca paper shows 30-day positive P&L.
```

---

## REGIME ROUTING TABLE (from live backtest data)

```
REGIME      BARS%   TOP SIGNALS              OOS SHARPE
────────────────────────────────────────────────────────
TRENDING    0.0%    TREND_SMA / MACD_CROSS   10.8 / 3.7  (tiny sample)
RANGING    74.5%    VOL_BO / DON_BO / KC_BREAK  2.1 / 2.0 / 1.9
BREAKOUT   16.1%    GOLDEN / DON_BO / OBV_TREND 3.4 / 2.0 / 1.6
RISK-OFF    9.5%    SUPERTREND / DON_BO         5.0 / 4.1

DON_BO is the UNIVERSAL SOLDIER — top 3 in ALL regimes.
SUPERTREND + TREND_SMA dominate in RISK-OFF (5.0 Sharpe).
GOLDEN fires rarely but is lethal in BREAKOUT (3.4 Sharpe).
```

---

## SIGNAL KILL LIST (correlation > 0.6)

```
KILLED:
  NEW_HIGH   → corr 0.86 with DON_BO  (same channel breakout family)
  RANGE_BO   → corr 0.86 with DON_BO  (same family)
  CONSOL_BO  → corr 0.86 with ATR_EXP (same expansion family)
  ROC_MOM    → Sharpe = -1.267 (broken signal, discard)

SURVIVORS: 23 signals — mostly independent at return-series level.
Most OHLCV signals are NOT as correlated as feared when measured
by WHEN they fire, not their raw OHLCV construction.
```

---

---

## PHASE 10 — XAIGROK ACTIVITY GATE (BUILT 2026-04-18)

```
Problem: Dead market = bad trades. Need a single gate signal: ALIVE / DEAD.
Solution: xaigrok_activity.py

Architecture:
  activity_score = 0.70 × tick_score + 0.30 × grok_score

  tick_score:
    - RVOL percentile rank vs 500-bar rolling window (per symbol)
    - ATR% percentile rank vs same window
    - tick_score = 0.60 × rvol_prank + 0.40 × atr_prank
    - Median across all tracked instruments → single number 0-1

  grok_score:
    - xAI Grok API query with X search enabled
    - Asks: "Rate current futures/equity market engagement 0-1"
    - Returns: {activity, status, rvol_proxy, reason}
    - Falls back gracefully to tick_score if API unavailable

Gate thresholds:
  DEAD  < 0.35  → gate CLOSED, size mult 0.0 (skip entries, exit sooner)
  SLOW  0.35-0.55 → gate OPEN, size mult 0.5 (half-size)
  ALIVE ≥ 0.55  → gate OPEN, size mult 1.0 (normal)
  HOT   ≥ 0.80  → gate OPEN, size mult 1.2 (bonus)

Historical validation:
  - Quintile test: split all signal_log bars by activity_score Q1-Q5
  - Expected: Q1 (dead) has lowest Sharpe, Q5 (hot) has highest
  - Scan optimal threshold: find best Sharpe vs % trades killed tradeoff
  - Output: activity_report.json

Integration:
  - Star-Ray page: new ACTIVITY tab (6th tab)
  - Live status badge in tab label: "◉ ACTIVITY · ALIVE"
  - Run button: "Full Run (Grok+Tick)" + "Tick Only (No Grok)"
  - Quintile table, hour-of-day activity profile bar chart
  - gate_from_report() helper → star_optimizer.py and walk_forward.py can import

API endpoints:
  GET  /v1/ai/activity/         → current score + gate status (fast, cached)
  GET  /v1/ai/activity/report/  → full historical quintile analysis
  POST /v1/ai/activity/run/     → trigger xaigrok_activity.py in background

CLI:
  python ds_app/xaigrok_activity.py                       # full run + Grok
  python ds_app/xaigrok_activity.py --no-grok             # tick-only (fast)
  python ds_app/xaigrok_activity.py --no-historical       # current score only
  python ds_app/xaigrok_activity.py --symbols ES NQ CL    # subset

Files:
  ds/ds_app/xaigrok_activity.py     ← engine
  ds/data/activity_report.json      ← output (served by API)
  M6D/src/pages/StarOptimizerPage.tsx ← ACTIVITY tab added (tab 6)
```

---

## ARCHITECTURE MAP — FULL SIGNAL STACK (2026-04-18)

```
LAYER 0: RAW DATA
  futures.db (bars_1m, bars_5m) — 8 futures instruments, 2yr history
      ↓
LAYER 1: SIGNAL GENERATION
  signal_logger.py → signal_log.db (3.2M rows, 27 algo votes per bar)
      ↓
LAYER 2: WORLDQUANT 4-GATE FILTER
  mega_backtest.py → surviving_signals.json (23 of 27 pass)
  correlate.py → kill list: NEW_HIGH, RANGE_BO, CONSOL_BO, ROC_MOM
      ↓
LAYER 3: REGIME ROUTER (biggest edge lever: +0.844 Sharpe)
  regime.py → regime_signal_map.json
  RISK-OFF: SUPERTREND(5.0) | TREND_SMA(4.1) | DON_BO(4.1)
  BREAKOUT: GOLDEN(3.4) | DON_BO(2.0) | OBV_TREND(1.6)
  RANGING:  VOL_BO(2.1)  | DON_BO(2.0) | KC_BREAK(1.9)
  TRENDING: TREND_SMA(10.8) [tiny sample]
      ↓
LAYER 4: STAR-RAY KILL FILTER (surgical time/quality gates)
  star_optimizer.py → star_report.json
  Hour kill: 20:00, 22:00, 23:00 UTC (+0.209 Sharpe)
  Day kill:  Thu, Sat, Sun         (+0.729 Sharpe)
  Kelly sizer: 0-5 stars → 0.2x–1.2x multiplier
  Pipeline: Baseline 1.36 → Regime 2.20 → +Hour 2.41 → +Day 3.14
      ↓
LAYER 5: XAIGROK ACTIVITY GATE (new — pre-entry market aliveness check)
  xaigrok_activity.py → activity_report.json
  tick_score (RVOL × ATR prank) × 0.70 + grok_score × 0.30
  DEAD < 0.35 → skip entry + exit sooner
  Quintile Q1 (dead) → lowest Sharpe → confirmed edge
      ↓
LAYER 6: WALK-FORWARD VALIDATION
  walk_forward.py → 8/12 windows pass, median Sharpe 1.56
      ↓
LAYER 7: PERFORMANCE REPORT
  perf_report.py → Sharpe 2.67, Sortino 3.46, Win Rate 53.4%

  LAYER 8: PCA — pca_signals.py → pca_report.json
    9 of 23 signals needed for 80% variance → MOSTLY INDEPENDENT but significant clustering
    NEW KILL CANDIDATES (return-corr > 0.90):
      VOL_SURGE (0.991 with VOL_BO)     → KILL — identical to VOL_BO
      KC_BREAK  (0.966 with VOL_BO)     → REVIEW — very close to VOL_BO
      BB_BREAK  (0.921 with KC_BREAK)   → REVIEW
      EMA_STACK (0.944 with VOL_BO)     → KILL — redundant expansion cluster
      RSI_STRONG (0.938 with KC_BREAK)  → REVIEW
    TRUE DIMENSIONS (conservative): ~9-12 (not 23)
    MEGA CLUSTER: VOL_BO, KC_BREAK, BB_BREAK, EMA_STACK, VOL_SURGE, RSI_STRONG,
                  TREND_SMA, OBV_TREND, PULLBACK, CMF_POS, CONSEC_BULL → all corr >0.60
    EXPANSION CLUSTER: SQZPOP + ATR_EXP (corr 0.764)

  LAYER 9: Sharpe-weighted ensemble — sharpe_ensemble.py → ensemble_report.json
    RESULT: equal-weight Sharpe=11.12 vs Sharpe-weighted=15.34  DELTA=+4.22
    VERDICT: WEIGHTED WINS — massive improvement
    Trade-off: 4,615 trades → 1,053 trades (high-conviction only)
    Mechanism: per-regime Sharpe-proportional weights → only take top-quality signal combos
    Best weighted threshold: 0.05 of weighted score

  LAYER 10: Cross-asset spreads — cross_asset.py → cross_asset_report.json
    5 dims: btc_eth_ratio · alt_beta · defi_momentum · l1_spread · btc_corr_break
    Current: composite +0.17 NEUTRAL · all 5 dims live on crypto DB

  LAYER 11: Walk-forward validation — walkforward.py → walkforward_report.json
    41 folds · 90d train · 30d test · 2d embargo
    VERDICT: PROMISING (4/5 RenTech gates) · OOS Sharpe +5.35 · IS/OOS 1.41
    FAILED GATE: oos_stability_ok (std too high — regime-dependent variance)

  LAYER 12: Regime-conditional IC — per-signal IC split by regime per fold
    RESULT: ZERO signals should retire. 18 are REGIME_SPECIALISTS.
    SUPERTREND: SPECIALIST in BREAKOUT (IC +0.025). NOT dead. Route correctly.
    ALIVE globally: ADX_TREND (+0.045) · GOLDEN (+0.005)
    PROBATION: VOL_SURGE · CONSEC_BULL (no regime positive yet)

  LAYER 13: Routed ensemble test
    Hard routing DEGRADES -1.07 (cuts 69% trades, loses diversification)
    FIX NEEDED: soft multipliers per regime, not binary on/off

PENDING LAYERS:
  LAYER 14: Soft regime weight matrix — multipliers 0.0–1.5 per signal per regime
  LAYER 15: Trade quality veto gate — squeeze/cloud/rvol/PDH-PDL pre-entry checks
  LAYER 16: HMM 3-state posterior regime (replace label with probability vector)
  LAYER 17: MTF confirmation (5m + 1h agreement)
  LAYER 18: Cost-adjusted Sharpe (0.10% slippage baked in)
  LAYER 19: Paper config + Alpaca adapter
```

---

## M4D / M6D ARCHITECTURE (confirmed 2026-04-18)

```
M6D  = main visual app (M4D dashboard, :5173)
       Pages: BtcCharts, FxCharts, IctCharts, ObiPage, TvLwCharts,
              StarOptimizerPage (STAR-RAY tab), ControlRoomKnights

M3D  = algo/bot site — enters M4D via ALGO button (top right)
       27 Council Warriors (NS/CI/BQ etc — ICT structural signals)
       Iframe overlay or route

TWO SIGNAL LAYERS (ADDITIVE, NOT COMPETING):
  M3D council: ICT structural (order flow, FVG, OB, PDH/PDL)
  DS quant:    OHLCV technical (DON_BO, VOL_BO, SUPERTREND etc)
  → Stack both: ICT structure confirms quant breakout = highest conviction
```

---

## ORB SYSTEM — DIMENSION-TO-ORB MAP (see ORB-DIMENSION-MAP.md)

```
9 ORBS EXIST IN UI:
  CouncilOrb     ✅ LIVE    — 27 warrior votes (ICT structural layer)
  JediMasterOrb  ⚠️  PARTIAL — council only, missing quant+xai props (voided)
  XSentinelOrb   ✅ WIRED   — fetches /v1/ai/activity/ every 60s · trend_label→direction
  SoloMasterOrb  ⚠️  PARTIAL — RVOL arrow works, xaiSentiment/jediAlign voided
  PriceOrb       ❌ MOCKED  — fake OHLCV derived from vote arithmetic
  VolumeOrb      ✅ WIRED   — useObiStream(symbol, POLYGON_KEY) · live OBI ratio
  ConfluenceOrb  ✅ LIVE    — A/B/C banks real, kellyFire is threshold proxy
  RiskOrb        ❌ MOCKED  — no real P&L, all derived from score×constant
  TVWebhookOrb   ✅ LIVE    — latency/count real, lastFiredMs is countdown proxy

2 ORBS DESIGNED BUT NOT BUILT:
  IntermarketOrb — BTC/ETH/SOL/BNB radial cross-asset momentum arrows
  PositioningOrb — funding rate + VIX analog (fear/greed dual ring)

REMAINING QUICK WINS:
  SoloMasterOrb ← void removed, jediAlign + xaiSentiment rendered
  ConfluenceOrb kellyFire ← star_report.json kelly thresholds exact
  RiskOrb ← paper trade P&L once Alpaca adapter built
```

## STAR OPTIMIZER PAGE — TAB INVENTORY (2026-04-19)
```
Tab 1: PIPELINE   — traffic lights · Kelly · stars
Tab 2: HOURS      — hour-of-day Sharpe heatmap
Tab 3: DAYS       — day-of-week analysis
Tab 4: SCALPER    — scalper mode stats
Tab 5: HYPERPARAMS — grid search results
Tab 6: ACTIVITY   — XAIGROK gate · sentiment trend sparkline
Tab 7: PCA DIMS   — variance bars · kill list · per-signal stats
Tab 8: ENSEMBLE   — equal vs Sharpe-weighted equity curves
Tab 9: CROSS-ASSET — 5 dims · regime dial · sparklines
Tab 10: WALK-FWD  — 41 folds · gates · regime · signal lifecycle grid
```

## KEY DESIGN DECISIONS (2026-04-19)
```
1. NEVER retire regime-specialist signals on global IC alone
   → Always check regime-conditional IC before retiring
   → 18/23 signals are specialists — remove routing bug, not signals

2. Hard regime routing DEGRADES ensemble (-1.07 Sharpe)
   → Use soft multipliers (0.0–1.5) not binary on/off
   → Regime weights already trained on correct-regime bars

3. Trade quality = veto layer ABOVE ensemble, not a signal
   → Squeeze/cloud/rvol/PDH-PDL check AFTER ensemble score computed
   → Each veto is independently testable and improvable

4. PADAWAN MODE = hard veto enforced + Kelly 0.25× + max 3 trades/day
   → Conservative mode for small accounts, Starship School testing

5. EUPHORIA = 2-3× Kelly when ALL: Jedi≥18 + RVOL>2 + HOT + RISK_ON + BUILDING
```

*Updated: 2026-04-19 · Sessions: XSentinelOrb/VolumeOrb wired · Cross-asset built · Walk-forward 41 folds · Regime-conditional IC · Signal lifecycle · TV Pine template · ALPHA-SEARCH-DAILY.md written*
*5 signal layers + 9 visual orbs. Most orbs on placeholder data. Wire-up order in ORB-DIMENSION-MAP.md*
