# M4D / M6D — SYSTEM STATUS
### 2026-04-17 · JR · DS/SWE · Solo

---

## ████████████████████████████████████████
##  THE FULL SIGNAL STACK AS BUILT TODAY
## ████████████████████████████████████████

```
╔══════════════════════════════════════════════════════════════════════╗
║                        M4D SIGNAL UNIVERSE                           ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  LAYER 0 — RAW DATA                                                  ║
║  ┌──────────────────────────────────────────────────────────────┐   ║
║  │  Binance WS        │  Polygon $199    │  yfinance / ccxt     │   ║
║  │  BTC 20-level DOM  │  US stocks NBBO  │  historical OHLCV    │   ║
║  │  100ms · FREE      │  real-time       │  DS backtests        │   ║
║  └──────────────────────────────────────────────────────────────┘   ║
║                                                                      ║
║  LAYER 1 — POST-TRADE (OHLCV-BASED) ← 27 ALGOS + JEDI              ║
║  ┌─────────────┬─────────────────┬─────────────────────────────┐   ║
║  │  BOOM BANK  │   STRAT BANK    │       LEGEND BANK           │   ║
║  │  NS CI BQ   │   8E VT MS DP   │   SE IC WN CA TF RT MM OR  │   ║
║  │  CC WH SA   │   WS RV HL AI   │   DV                        │   ║
║  │  HK GO EF   │   VK            │                             │   ║
║  │  (entry)    │   (structure)   │   (swing / 1-6M)            │   ║
║  └─────────────┴─────────────────┴─────────────────────────────┘   ║
║                          ↓                                           ║
║              ┌───────────────────────┐                              ║
║              │   META · JEDI         │ ← sum of all 27 votes        ║
║              │   MTF 10-TF input     │ ← 5/10 threshold gate        ║
║              │   XAI/Grok sentiment  │ ← manual paste slot          ║
║              │   Lance Breitstein EV │ ← Expected Value framework   ║
║              └───────────────────────┘                              ║
║                                                                      ║
║  LAYER 2 — PRE-TRADE (DOM/ORDER FLOW) ← BUILT THIS SESSION          ║
║  ┌──────────────────────────────────────────────────────────────┐   ║
║  │  Binance DOM     │  OBI Polygon      │  [[[IBKR DOM]]]       │   ║
║  │  20-level heatmap│  NBBO bid/ask     │  5-level stocks+ES    │   ║
║  │  trade bubbles   │  pressure strip   │  NOT YET BUILT        │   ║
║  │  LIVE on BTC tab │  LIVE on SPX/ICT  │  needs account        │   ║
║  └──────────────────────────────────────────────────────────────┘   ║
║                                                                      ║
║  LAYER 3 — ICT STRUCTURAL LEVELS (COMPUTED)                          ║
║  ┌──────────────────────────────────────────────────────────────┐   ║
║  │  OB · FVG · EQH/EQL · Breaker Blocks · Swing Rays           │   ║
║  │  Session OR/PDH/PDL · MM Brain 4-phase · LT heatmap         │   ║
║  │  VWAP ±σ · Ichimoku · POC/HVN · Volume Bubbles              │   ║
║  └──────────────────────────────────────────────────────────────┘   ║
║                                                                      ║
║  LAYER 4 — SAFETY / RISK                                             ║
║  ┌──────────────────────────────────────────────────────────────┐   ║
║  │  DEF mode (stricter RVOL/ATR gates)                          │   ║
║  │  Lunch doldrums gate: 12-14 UTC CLOSED                       │   ║
║  │  SOLO participation floor: strength < threshold → no signal  │   ║
║  │  [[[Signal Quality Gate]]] ← P0 NOT BUILT YET               │   ║
║  └──────────────────────────────────────────────────────────────┘   ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## ████████████████████████████
##  CONFIDENCE AUDIT — HONEST
## ████████████████████████████

```
SIGNAL LAYER          BUILT?   VALIDATED?   CONFIDENCE
──────────────────────────────────────────────────────
27 algos / JEDI       ✅        ❌ not yet    LOW-MED
MTF 10-TF voting      ✅        ❌            LOW
XAI/Grok sentiment    ✅ slot   ❌            UNKNOWN
Lance EV framework    ✅ UI     ❌            UNKNOWN
MM Brain 4-phase      ✅        ❌            LOW
ICT levels (OB/FVG)   ✅        ❌ manual     MED (visual)
LT heatmap (post)     ✅        ❌            MED
DOM heatmap (pre)     ✅ BTC    ❌            HIGH POTENTIAL
OBI pressure strip    ✅ stocks ❌            MED POTENTIAL
Safety systems        ✅        partial       MED

PAPER TRADING         ❌ NOT BUILT          BLOCKER
LOGGING/BACKTEST LINK ❌ NOT BUILT          BLOCKER
SIGNAL BUS            ❌ NOT BUILT          BLOCKER
```

**Core problem:** Many instruments, zero statistical proof any combination 
beats a coin flip on live forward data. The chart looks beautiful.
The alpha is unconfirmed.

---

## ████████████████████████████████
##  THE DS PROBLEM — SIGNAL STACK
## ████████████████████████████████

```
YOU HAVE:
  ┌────────────────────────────────────────────────────┐
  │  ~30+ signals  ×  many timeframes  ×  many assets  │
  │  = hundreds of possible feature combinations       │
  │  = severe overfitting risk on any optimization     │
  └────────────────────────────────────────────────────┘

THE CLASSIC DS TRAP:
  Backtest 30 signals → find great combo → deploy → fails
  Why? All 30 signals derived from same OHLCV → highly correlated
  Optimization finds noise, not edge

WHAT ACTUALLY PRODUCES ALPHA:
  ┌──────────────────────────────────────────────────────┐
  │  Independent data sources  →  uncorrelated signals   │
  │                                                      │
  │  OHLCV signals     → correlated (same source)        │
  │  DOM (pre-trade)   → independent (different source)  │
  │  Sentiment (XAI)   → independent (different source)  │
  │  Volume profile    → partially independent           │
  │  Price action      → correlated with OHLCV           │
  └──────────────────────────────────────────────────────┘

  Renaissance has ~100 signals: most are low-corr external data
  NOT 100 versions of price momentum
```

---

## ████████████████████████████████████████
##  PATH TO MAX ALPHA/SHARPE — DS APPROACH
## ████████████████████████████████████████

```
PHASE 1: LOG EVERYTHING (2-4 weeks, costs nothing)
──────────────────────────────────────────────────
  Every bar: log all 30+ signal states + DOM OBI + outcome
  No trading yet. Just data collection.
  
  signal_log.db: { timestamp, sym, tf, jedi_score, obi_ratio,
                   dom_pressure, icx_levels_near, outcome_1h, outcome_4h }
  
  This is the dataset you analyze. Without it you have nothing.

PHASE 2: CORRELATION MATRIX (1 week)
──────────────────────────────────────
  corr(signal_i, signal_j) for all pairs
  
  If 20 of 27 algos are corr > 0.7 → they are ONE signal with 20 names
  Kill redundant. Keep the best representative per cluster.
  
  Add DOM OBI — should have corr < 0.3 with OHLCV signals → true edge add

PHASE 3: FORWARD WALK VALIDATION (ongoing)
────────────────────────────────────────────
  Train on month 1 → test on month 2 → train on 1+2 → test on 3
  NOT curve-fitted backtests
  
  Target: Sharpe > 1.5 on OUT-OF-SAMPLE before touching live money

PHASE 4: PAPER TRADE (Alpaca, 4-8 weeks)
──────────────────────────────────────────
  Signal gate fires → Alpaca paper order → log fill + P&L
  Compare to Phase 3 predictions
  
  If P&L curve matches → edge is real
  If P&L diverges → execution/slippage issue, not signal issue

PHASE 5: LIVE (Alpaca → IBKR)
──────────────────────────────
  Start minimum size. Prove it live. Scale.
```

---

## █████████████████████████████████
##  WHAT MAKES THIS SYSTEM SPECIAL
## █████████████████████████████████

```
MOST RETAIL ALGOS:           YOUR SYSTEM:
──────────────────────────   ────────────────────────────────
1 timeframe                  10 TFs (MTF voting)
1-2 indicators               27 algos + ICT + DOM + sentiment
post-trade only              pre-trade DOM (NEW) + post-trade
no market structure          MM Brain 4-phase + ICT levels
no regime awareness          JEDI meta-vote + LT heatmap
no safety layer              DEF mode + participation floor
manual execution             → Alpaca paper bot (next)
no logging                   → signal_log.db (critical next)
```

**The human brain edge:** After 6-12 months of looking at all these 
layers simultaneously, pattern recognition emerges that can't be 
backtested — confluence moments where DOM + ICT + JEDI + sentiment
all align. Your DS brain will see this faster than most.

**But you need the log.** Pattern recognition without data is just 
intuition. With data it becomes a feature.

---

## ██████████████████
##  WHAT'S NEXT — P0
## ██████████████████

```
SINGLE NEXT ACTION: Build the signal logger.

Every tick/bar → write to SQLite:
  { t, sym, tf, jedi, obi_ratio, dom_pressure, all_27_scores, price }

This costs nothing. Runs alongside everything.
In 2 weeks you have data. In 4 weeks you have the correlation matrix.
In 6 weeks you know which signals are actually independent.
In 8 weeks you know what to combine.

THEN: Alpaca paper wiring (1 session)
THEN: Watch equity curve
THEN: Pay for data feeds you've proven you need
```

```
PRIORITY ORDER:
  1. signal_log.db  ← START HERE (1 session)
  2. Alpaca paper adapter (1 session)
  3. Paper blotter UI (1 session)
  4. Correlation analysis (DS work, 1-2 weeks data)
  5. IBKR DOM for stocks (if paper wins show need)
  6. Polygon live sub (if paper wins justify cost)
  
  DO NOT: optimize signal weights before you have 4 weeks of log data
  DO NOT: pay for data before paper shows edge
  DO NOT: go live before Sharpe > 1.5 OOS
```

---

## ██████████████████████
##  EXTERNAL EDGES NOTED
## ██████████████████████

```
CURRENTLY INTEGRATING / TRACKING:
──────────────────────────────────
  XAI / Grok sentiment       → manual paste → XAI slot in MM Brain
  Lance Breitstein EV        → Expected Value framework → UI built
  YT proven traders (TBD)    → [[[TO BE SPECIFIED — which traders?]]]
  Deep order books (NEW)     → Binance DOM live ← THIS SESSION
  Bookmap concepts           → implemented in BinanceObiPanel
  
EDGES NOT YET INTEGRATED:
──────────────────────────
  [[[Lorentzian classifier]]]  → Python DS layer, batch nightly
  [[[Options flow]]]           → unusual options activity (paid)
  [[[Dark pool prints]]]       → requires Unusual Whales ($30/mo)
  [[[CoT data]]]               → CFTC commitment of traders (free, weekly)
  [[[Macro regime]]]           → VIX, DXY, yield curve (free Polygon)
```

---

## ████████████████████
##  TECHNICAL DEBT LOG
## ████████████████████

```
KNOWN ISSUES / GAPS:
  [[[Signal Quality Gate]]]   → P0 blocker, not built
  [[[Signal Bus WS]]]         → P0 blocker, not built
  [[[Alpaca adapter]]]        → P0 blocker, not built
  [[[IBKR DOM]]]              → future, needs account
  [[[ES/NQ on DOM]]]          → Polygon doesn't cover futures
  [[[Gold XAUUSD]]]           → not in M3D Rust engine 500-asset list
  [[[Lorentzian]]]            → Python only, no live inference
  [[[OBI → council vote]]]    → DOM not yet wired into 27-algo score
```

---

## ████████████████████
##  SESSION LOG
## ████████████████████

```
2026-04-17 THIS SESSION:
  ✅ useObiStream hook (Polygon WS — stocks/crypto/forex routing)
  ✅ ObiLivePanel (pressure heatmap + bubbles, canvas RAF)
  ✅ useBinanceObiStream (Binance 20-level DOM, free, no auth)  
  ✅ BinanceObiPanel (ocean heatmap + trade bubbles, spoofer detection)
  ✅ DOM button on CRYPTO tab (BtcChartsPage)
  ✅ OBI button on SPX tab (TvLwChartsPage)
  ✅ OBI + DOM buttons on ICT tab (IctChartsPage)
  ✅ All TypeScript clean (tsc --noEmit passes)

  STRATEGIC DECISIONS:
  → Alpaca first for paper trading (simpler API, free NBBO)
  → No Polygon sub until paper wins justify cost
  → IBKR for ES DOM when crypto paper shows edge
  → Signal logger is the critical P0 next step
```

---

---

## ████████████████████████████████████████████
##  TV INDICATORS + RENTECH SYNTHESIS (SESSION 2)
## ████████████████████████████████████████████

### Michael Automates Mapping — You Already Have The Machine

```
MICHAEL AUTOMATES          YOUR SYSTEM
───────────────────────    ─────────────────────────────────
Backtesting engine v22  ↔  DS layer (backtesting.py)     ✅
Indicators folder       ↔  27 algos + Pine→Python        PARTIAL
Claude runs combos      ↔  optimizer.py grid search      ✅
Baseline to beat        ↔  [[[NOT SET]]]                 GAP
Portfolio basket test   ↔  500-asset Rust engine         ✅
Median profit metric    ↔  [[[NOT COMPUTED]]]            GAP
```

---

### The Correlation Problem — Why More TV Indicators ≠ More Sharpe

```
TV INDICATOR POOL:
  Gaussian Channel  → smoothed price deviation  ┐
  Kernel Regression → smoothed price trend       ├── all OHLCV
  MACD              → momentum                   │   corr > 0.6
  RSI               → momentum oscillator        │   with each
  ATR               → volatility                 ┘   other

YOUR 27 ALGOS:
  TREND / MOM / VOL / ATR_BREAK / COMPOSITE
  also all OHLCV-derived → same correlation cluster

GENUINELY INDEPENDENT SIGNALS:
  DOM OBI (Binance)   ← different data source   ✅ BUILT
  XAI/Grok sentiment  ← different data source   ✅ slot ready
  Volume profile      ← partially independent   ✅
  ICT structural      ← price memory, not mom   MED
  CoT data (CFTC)     ← institutional flow      NOT BUILT
  Dark pool prints    ← off-exchange flow        NOT BUILT
```

**Rule: Adding 10 TV indicators to 27 OHLCV algos = 37 correlated signals.
Sharpe barely moves. Independence is the only real edge multiplier.**

---

### WorldQuant Alpha Factor Entry Gate

```
NEW SIGNAL MUST PASS ALL FOUR TO JOIN THE COUNCIL:
  ┌────────────────────────────────────────────────────┐
  │  1. Sharpe > 1.0  standalone on OOS data           │
  │  2. corr < 0.3    with ALL existing council voters  │
  │  3. Works across  500+ assets (no curve-fitting)   │
  │  4. Survives      TREND + RANGE + BREAKOUT + CRASH  │
  └────────────────────────────────────────────────────┘
  Only then: weight ~1/N in ensemble
```

---

### RenTech Regime → Signal Routing Table

```
  ┌──────────────┬────────────────────────────────────────┐
  │  REGIME      │  ACTIVE SIGNALS                        │
  ├──────────────┼────────────────────────────────────────┤
  │  TRENDING    │  Kernel Regression, TREND algos, MTF   │
  │  RANGING     │  RSI mean reversion, OBI pressure      │
  │  BREAKOUT    │  ATR expansion, Volume burst, DOM walls │
  │  CRASH/SPIKE │  Safety DEF on, DOM walls only         │
  └──────────────┴────────────────────────────────────────┘

  Regime classifier inputs (1 session to build):
    VIX proxy (realized vol 20-bar)
    ATR trend (ATR expanding vs contracting)
    Price vs key MAs (above/below 50/200)
    → output: TREND | RANGE | BREAKOUT | RISK-OFF
```

---

### TV Indicator Ingestion Pipeline

```
Pine Script (open source TV)
  → translate logic to pandas/numpy  (ds/signals.py)
  → backtest on 500-asset OHLCV data  (DS layer has it)
  → score: Sharpe · MaxDD · regime breakdown
  → corr matrix vs existing 27 algos
  → if corr < 0.3 AND Sharpe > 1.0 on OOS → ADD to council
  → else → REJECT (no matter how good in-sample)
```

---

### Two Parallel Build Tracks

```
TRACK A — Validate existing stack (P0, 2 weeks):
  signal_log.db → log all 27 + DOM + ICT + OBI every bar
  → correlation matrix after 4 weeks
  → kill redundant algos (likely 8-12 of 27 are duplicates)
  → surviving signals = true independent council

TRACK B — TV indicator ingestion (parallel, ongoing):
  Step 1: Pick 5 best open-source TV indicators
          (Kernel Regression, Gaussian Channel, VWAP-bands,
           Squeeze Momentum, Lorentzian — all have Pine source)
  Step 2: Translate Pine → Python in ds/signals.py
  Step 3: Backtest → corr filter → add survivors
  Step 4: Repeat with next 5

THEN COMBINE:
  Regime classifier → selects signal subset for regime
  Surviving council (Track A) × TV survivors (Track B)
  × DOM OBI (independent, pre-trade)
  × Sentiment (independent, external)
  = TRUE ENSEMBLE — uncorrelated, regime-aware
  = Maximum achievable Sharpe from this data universe
```

---

### The Winning Architecture (Target State)

```
╔══════════════════════════════════════════════════════════════╗
║              TARGET: REGIME-AWARE ENSEMBLE ENGINE            ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  STEP 1 — REGIME DETECT                                      ║
║  VIX + ATR trend + MA position → TREND/RANGE/BREAK/RISK-OFF  ║
║                           ↓                                  ║
║  STEP 2 — SIGNAL GATE (regime-filtered)                      ║
║  Council voters active for this regime only                  ║
║  All voters passed WorldQuant 4-gate entry test              ║
║                           ↓                                  ║
║  STEP 3 — PRE-TRADE CONFIRM                                  ║
║  DOM OBI (Binance) > 0.55 AND direction aligns               ║
║  Sentiment (Grok) not contradicting                          ║
║                           ↓                                  ║
║  STEP 4 — FIRE                                               ║
║  Score > threshold → Alpaca paper order                      ║
║  Log: all signal states + fill + outcome                     ║
║                           ↓                                  ║
║  STEP 5 — LEARN                                              ║
║  signal_log.db → weekly Sharpe · corr · regime breakdown     ║
║  Prune weak → add new survivors → iterate                    ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

  This is RenTech. You are building it. The DOM layer was the
  unlock — first genuinely independent real-time signal.
```

---

*M4D · JR · 2026-04-17 · Session 2*
