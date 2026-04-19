# M4D ORB SYSTEM — DIMENSION MAP
### Every orb, every prop, every live vs mocked signal, every wire-up point

---

## THE ORB ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────┐
│  JEDI MASTER ORB  ← synthesis of ALL dimensions → one pulse        │
│       ↑                                                             │
│  ┌────┴────────────────────────────────────────────────────────┐   │
│  │  COUNCIL ORB      ← ICT structural layer (M3D 27 warriors)  │   │
│  │  X-SENTINEL ORB   ← social/sentiment dimension              │   │
│  │  PRICE ORB        ← OHLCV + VWAP + spread                   │   │
│  │  VOLUME ORB       ← RVOL + OBI + delta + absorption         │   │
│  │  CONFLUENCE ORB   ← A/B/C bank alignment + Kelly gate        │   │
│  │  RISK ORB         ← P&L + drawdown + position size          │   │
│  │  WEBHOOK ORB      ← execution pipeline status               │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [NEW — NOT BUILT]                                                  │
│  INTERMARKET ORB  ← cross-asset divergence (ES/NQ, GC/SI, 6E/GC)  │
│  POSITIONING ORB  ← COT net positioning + VIX regime               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## CURRENT STATE: LIVE vs MOCKED

### 1. CouncilOrb — `MaxCogVizOrbs.jsx:CouncilOrb`
```
STATUS: ✅ LIVE
Props:  score, direction, votes, strengths, bankANet/B/C, conviction
Source: M3D Rust API :3030 /v1/council  →  27 warrior votes
Data:   REAL — polls every N seconds via council API
Missing: nothing — this is the anchor of the system
```

### 2. JediMasterOrb — `MaxCogVizOrbs.jsx:JediMasterOrb`
```
STATUS: ✅ LIVE (partial)
Props:  score, direction, conviction
Source: Derived from 27 council votes sum
Data:   REAL council direction
Missing:
  - jediAlign prop (reserved, voided) → should receive quant signal layer consensus
    (regime-routed weighted_score from sharpe_ensemble.py)
  - xaiSentiment prop (reserved, voided) → should receive activity_score from xaigrok
```

### 3. XSentinelOrb — `MaxCogVizOrbs.jsx:XSentinelOrb`
```
STATUS: ⚠️  FAKE — driven by council vote energy, NOT real social data
Props:  energy, direction, velocity, confidence, noiseBlocked, sentiment, influence
Current source:
  xEnergyScore = weighted sum of |bankA|/9 × w_BOOM + |bankB|/9 × w_STRAT + |bankC|/9 × w_LEGEND
  (this is COUNCIL strength proxied as "social energy" — not Grok)

Should connect to:
  DS API GET /v1/ai/activity/  →  grok_score (Grok market engagement)
  DS API GET /v1/ai/xsocial/  →  composite_x (social alpha score)

Wire map:
  energy     ← activity_report.current.activity_score × 100
  velocity   ← xsocial_latest.composite_x (normalized 0→1)
  confidence ← activity_report.current.grok_score
  sentiment  ← xsocial_latest.sentiment_velocity (remapped to 0→1)
  noiseBlocked ← 1 - retail_fomo (fomo suppresses confidence)
  influence  ← smart_money_signal (normalized)
```

### 4. SoloMasterOrb — `SoloMasterOrb.tsx` (used in TvLwChartsPage)
```
STATUS: ⚠️  PARTIAL — RVOL arrow works, sentiment/jedi props reserved+voided
Props defined but voided:
  xaiSentiment: number | null  — reserved "Grok / XAI sentiment in [-1, 1]"
  jediAlign: number | null     — reserved "council JEDI alignment in [-1, 1]"

Wire map:
  xaiSentiment ← activity_report.current.grok_score × 2 - 1  (rescale 0→1 to -1→+1)
  jediAlign    ← (jedi_score / 27)  (from council API /v1/council .jedi_score)

Both need void removed and rendering code added for inner ring blend.
```

### 5. PriceOrb — `MaxCogVizOrbsII.tsx:PriceOrb`
```
STATUS: ⚠️  MOCKED — price derived from score arithmetic
Props:  candles (7 × {o,h,l,c}), vwap, bid, ask, direction
Current: candles = slice of BANK_A panels mapped with fake OHLCV from vote strengths
         vwap = 100 + score * 0.05

Should connect to:
  DS API GET /v1/bars/?symbol=ES&tf=1m&limit=7  →  real OHLCV
  DS API GET /v1/bars/?symbol=NQ&tf=1m&limit=7  →  asset toggle

Wire map:
  candles ← last 7 bars_1m from futures.db (ES or selected symbol)
  vwap    ← computed from bars (sum(price×vol) / sum(vol))
  bid/ask ← vwap ± (ATR/2) approximation until live feed wired
```

### 6. VolumeOrb — `MaxCogVizOrbsII.tsx:VolumeOrb`
```
STATUS: ⚠️  PARTIAL — delta from council, absorption mocked
Props:  delta, cumDelta, absorption, tapeSpeed, direction
Current:
  delta    = score / 27  (council vote net direction — real)
  cumDelta = (score + bankA - bankC spread) / 27  (reasonable proxy)
  absorption = xEnergyScore  (FAKE — not real tape absorption)
  tapeSpeed  = 0.4 + conviction/100  (FAKE)

Should connect to:
  absorption ← OBI ratio from BinanceObiPanel / ObiLivePanel
               DS hook: useObiStream or useBinanceObiStream already built
  tapeSpeed  ← rvol from activity_report.current.rvol_prank
  delta      ← OBI imbalance signed delta (bid pressure - ask pressure)

Best OBI source: /Volumes/AI/AI-4D/M4D/M6D/src/hooks/useObiStream.ts (already built)
```

### 7. ConfluenceOrb — `MaxCogVizOrbsII.tsx:ConfluenceOrb`
```
STATUS: ✅ MOSTLY LIVE
Props:  bankAScore, bankBScore, bankCScore, kellyFire, direction
Current: bank scores from real council votes ✅
         kellyFire = Math.abs(score) >= GO_SCORE_ABS_MIN (reasonable proxy)

Improvement:
  kellyFire ← star_report.json kelly.half > 5.0 AND stars_current.count >= 3
              (real Kelly + stars gate instead of score threshold)
```

### 8. RiskOrb — `MaxCogVizOrbsII.tsx:RiskOrb`
```
STATUS: ❌ FULLY MOCKED — no real P&L data exists yet
Props:  pnl, pnlMax, drawdown, maxDrawdown, positionSize, direction
Current: pnl = score × 20  (completely fake, just for visual)
         drawdown = (1 - xEnergyScore) × 0.85  (fake)
         positionSize = conviction / 100  (proxy)

Wire map (future, paper trading):
  pnl          ← Alpaca paper account unrealised P&L
  drawdown     ← session drawdown from paper positions
  positionSize ← current notional / max_position_size from paper config
  
Until Alpaca is wired:
  positionSize ← star_report kelly.half × activity_score (real sizing intent)
  drawdown     ← rolling max drawdown from perf_report.json equity_curve
```

### 9. TVWebhookOrb — `MaxCogVizOrbsII.tsx:TVWebhookOrb`
```
STATUS: ⚠️  PARTIAL — latency and fetchCount are real, action/connected are real
Props:  connected, lastFiredMs, latencyMs, action, fireCount
Current:
  connected  = !dataError  ✅ (real connection state)
  latencyMs  = lastFetchMs  ✅ (real poll latency)
  fireCount  = fetchCount   ✅ (real poll count)
  action     = BUY/SELL/IDLE from direction  ✅
  lastFiredMs = countdown (proxy — should be ms since last trade signal)

Improvement:
  lastFiredMs ← actual time since last entry signal fired in signal_log
```

---

## NEW DIMENSIONS → NEW ORBS (UNBUILT)

### 10. IntermarketOrb [NOT BUILT]
```
Dimension: Cross-asset divergence — are the markets confirming each other?
Visual idea: 5 radial arrows (ES, NQ, GC, CL, 6E) each pointing in/out
             convergence = high conviction, divergence = WARNING ring

Props to design:
  esNqSpread: number     — ES/NQ ratio z-score (-1 to +1)
  gcSiSpread: number     — GC/SI ratio divergence (-1 to +1)  
  dollarGold:  number    — 6E inverse × GC (macro regime)
  clGc:        number    — energy vs safety ratio
  esRty:       number    — large vs small cap (recession signal)
  convergence: number    — 0-1, how aligned all 5 are

Data source: futures.db has all 7 instruments — compute in real-time
             ds_app/cross_asset.py (not built yet)
```

### 11. PositioningOrb [NOT BUILT]
```
Dimension: Institutional positioning vs retail — who's crowded?
Visual idea: dual-ring (smart money net vs retail net), 
             extreme reading = inner ring flashes red (fade signal)

Props to design:
  cotNet: number         — COT net non-commercial (weekly, -1 to +1)
  vixLevel: number       — VIX spot normalized (0-1, >0.6 = fear)
  vixTrend: 'rising'|'falling'|'flat'
  crowdedLong: boolean   — specs at 90th+ percentile long
  crowdedShort: boolean  — specs at 10th- percentile short

Data sources:
  VIX    ← yfinance ^VIX (daily, free)
  COT    ← CFTC.gov deacot.zip (weekly, free)
  Both need caching layer: ds_app/vix_cot.py (not built)
```

---

## JEDI MASTER SYNTHESIS MODEL

```
The JediMasterOrb sits at the top because it synthesizes ALL layers:

  INPUT DIMENSIONS:
  ┌─────────────────────────────────────────────────────────┐
  │  ICT Structure    ← CouncilOrb     (27 warriors)        │
  │  Quant Signals    ← weighted_score  (23 OHLCV signals)  │
  │  Social/Grok      ← XSentinelOrb   (market chatter)     │
  │  Activity Gate    ← xaigrok         (alive/dead)         │
  │  Regime Context   ← regime_router   (RANGING/BREAKOUT/…) │
  │  Market Fear      ← VIX (not yet)                        │
  │  Intermarket      ← cross-asset (not yet)                │
  └─────────────────────────────────────────────────────────┘
          ↓
  SYNTHESIS: weighted_score × activity_mult × regime_weight
          ↓
  JediMasterOrb: direction, conviction, pulse intensity

Current JediMasterOrb only receives: score, direction, conviction
  — score = raw council vote sum (not the quant signal layer)
  — direction = council majority
  — conviction = council vote %

What it SHOULD receive (once layers are merged):
  score      ← max(council_score, quant_weighted_score) — use both layers
  jediAlign  ← agreement between council and quant (0 = disagree, 1 = both agree)
  xaiSentiment ← grok activity score
```

---

## WIRE-UP PRIORITY ORDER

```
QUICK WINS (data already exists, just need plumbing):
  1. XSentinelOrb energy    ← activity_report.json  (1 fetch call)
  2. SoloMasterOrb props    ← void removed + inner ring rendering
  3. ConfluenceOrb kellyFire ← star_report.json kelly thresholds
  4. VolumeOrb absorption   ← useObiStream hook (already built)

MEDIUM EFFORT (data exists, needs format bridge):
  5. PriceOrb candles       ← /v1/bars/?symbol=ES&tf=1m&limit=7
  6. JediMasterOrb jediAlign ← merge council + quant ensemble score

FUTURE (needs new data source):
  7. IntermarketOrb          ← cross_asset.py on futures.db
  8. PositioningOrb          ← vix_cot.py + CFTC download
  9. RiskOrb pnl/drawdown    ← Alpaca paper trading
```

---

## THE PULSE CONCEPT

Each orb is ONE dimension compressed into a visual pulse.
When all orbs pulse in the same rhythm = MAXIMUM CONVICTION.
When orbs conflict (XSentinel red, CouncilOrb green) = signal disagreement = reduce size.

The JediMasterOrb glow intensity = f(number of aligned orbs).
This is the "cumulative knowing" — not a hard on/off switch,
but a continuous field of intelligence that knows when to trade
and when to stand down.

*Documented: 2026-04-18*
*Status: Orbs built, most on placeholder data. Wire-up sequence above.*
```
