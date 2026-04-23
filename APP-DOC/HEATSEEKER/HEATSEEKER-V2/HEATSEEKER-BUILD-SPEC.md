# HEATSEEKER v2 — Build Spec + Alpha Recording System

## GOAL
On-chart heat layer showing:
1. Glowing numbered price target levels (gas/fire colored)
2. Left signal rail — 10 individual direction signals
3. JEDI composite arrow — direction + strength visual
4. High-alpha signal recording for all assets

---

## ON-CHART LAYER (LiveChart HEAT toggle)

### Target Levels (TVLW createPriceLine)
| Badge | Level | Color |
|-------|-------|-------|
| ② T2 | Extension | FIRE=#ff6b00 / GAS=#00d4ff / CALM=#60a5fa |
| ① T1 | Primary   | same, full brightness |
| ◎    | Entry     | dim white dotted |
| ⊗ STOP | Invalidation | always #f97316 orange |

Line colors driven by `targetHeat`:
- **FIRE** (score >75): fire orange `#ff6b00` — strongest glow
- **GAS**  (score >50): plasma blue `#00d4ff` — medium glow
- **CALM** (score ≤50): steel blue `#60a5fa` — dim

### Gas/Fire Glow Primitive
Canvas primitive (useMediaCoordinateSpace) draws radial gradient bands at each price level.
- Gradient: direction color (lo) → heat color (hi) → direction color (lo)
- shadowBlur: FIRE=18, GAS=14, CALM=8

### Left Signal Rail
10 dots + labels, absolute left edge of chart:
```
MTF  VWAP  EMA  ST  ADX  MACD  RSI  CVD  IMB  SWP
```
- GREEN glow = BULL signal
- RED glow = BEAR signal
- Dark grey = neutral

### JEDI Arrow (bottom-right)
- SVG arrow, CSS rotation
- Score < 15 OR NEUTRAL → horizontal, BLUE CALM, opacity 0.45
- Score 15–90 → tilts 0°→75° (BULL up-right, BEAR down-right)
- Score > 90 → capped at 75° (user spec: MAX AT 90%)
- **15% over-EMA threshold**: if `abs((close-ema21)/ema21) > 0.15` → overEmaBoost=1.2x applied to alpha score
- Colors: FIRE → heat orange + direction color; GAS → plasma + direction; CALM → blue
- Spring animation: `cubic-bezier(0.34, 1.56, 0.64, 1)` transition

---

## COMPOSITE SCORE ENGINE

### Vote System (10 signals)
Each signal returns BULL/BEAR/NEUTRAL vote:
- MTF: multi-timeframe EMA surrogates (≥2/3 aligned)
- VWAP: close above/below VWAP
- EMA: EMA21 > EMA55 + slope
- ST: SuperTrend direction (factor 3.0, len 10)
- ADX: DI+ > DI- with ADX > 20
- MACD: histogram positive + rising
- RSI: 50–80 = bull, 20–50 = bear
- CVD: cumulative delta ROC direction
- IMB: volume imbalance ratio
- SWP: wick sweep + CVD confirmation

### Alpha Composite (user patch)
```ts
overEmaBoost = abs((close - ema21) / ema21) > 0.15 ? 1.2 : 1.0
aiVoteAlpha  = mtfBullCount === 3 ? +30 : mtfBearCount === 3 ? -30 : 0
imbAlpha     = imbRatio > 1.5 ? +15 : imbRatio < 0.66 ? -15 : 0
energyAlpha  = (cvdRoc / 1_000_000) * 10
rawAlpha     = (aiVoteAlpha + imbAlpha + energyAlpha) * overEmaBoost * todBoost
finalScore   = min(max(blend(composite, abs(rawAlpha)) * (1 - decayPenalty), 0), 90)
```

Score capped at 90 — "MAX AT 90%"

### targetHeat
```ts
targetHeat = score > 75 ? 'FIRE' : score > 50 ? 'GAS' : 'CALM'
```

---

## HIGH ALPHA RECORDING SYSTEM (TODO)

### Goal
Record every signal trigger across all tracked assets with full state snapshot.
Identify which algo combinations produce highest alpha (returns).

### Schema (per signal)
```ts
interface AlphaRecord {
  ts:          number        // Unix timestamp
  symbol:      string        // e.g. 'BTCUSDT', 'SPX', 'EURUSD'
  tf:          string        // '5m', '1h', etc.
  direction:   'BULL'|'BEAR'
  score:       number        // 0–90
  targetHeat:  TargetHeat    // FIRE|GAS|CALM
  entry:       number
  tgt1:        number
  tgt2:        number
  stop:        number
  signals:     string[]      // which of the 10 fired (bull direction)
  // filled in post-trade
  outcome?:    'HIT_T1'|'HIT_T2'|'STOPPED'|'EXPIRED'
  pnlPct?:     number
  peakScore?:  number
}
```

### Storage Options
1. **SQLite via engine** — append-only `heat_signals.db` table, engine writes on each 5m loop
2. **DS Django endpoint** — `POST /v1/heat/record/` persists + `/v1/heat/history/?symbol=X`
3. **Local JSON** — simple fallback, `engine/data/heat_signals.json`

### Recording Trigger
- Score crosses above 50 (GAS threshold) from below → record
- Score crosses above 75 (FIRE threshold) → update record to FIRE
- Direction flip → close old record + open new

### Alpha Review UI (future `/heat` page)
- Table of all AlphaRecords sorted by score desc
- Hit rate % by heat level (FIRE vs GAS)
- Best performing signal combinations
- Asset heatmap — which symbols fire most FIRE signals

---

## FILES

| File | Purpose |
|------|---------|
| `site/src/components/indicators/heatseekerMath.ts` | Composite engine |
| `site/src/components/indicators/heatseekerPrimitive.ts` | Gas/fire glow canvas primitive |
| `site/src/components/LiveChart.tsx` | HEAT pill toggle, price lines, overlays |
| `APP-DOC/HEATSEEKER-V2/HeatSeekerV2.tsx` | Reference implementation |
| `APP-DOC/HEATSEEKER-V2/HEATSEEKER_v2.pine` | Pine Script reference |

## KNOWN ISSUES / DEBUG
- If HEAT shows "HEAT ERR — check console": open devtools → see `[HeatSeeker]` log
- SPX / stock symbols: DS backend must be running (`./go.sh ds`)
- Volume=0 on index symbols (SPX, DJI): CVD will be flat, energyAlpha ≈ 0 → lower score → likely CALM
- Score on indices will trend CALM unless strong MTF alignment + imbalance fires

---

# MASTER-TRADER VETERAN OVERRIDE — POSSIBLE ALPHA INPUTS v2
*20+ years floor + prop + HFT desk alpha. Ranked by real P&L edge (not backtest). Ordered: TREND DIRECTION → STRENGTH → ENERGY → regime filter → adverse move control → continuation probability.*

**Protocol:** Add ONE per iteration. Score 30–50 live signals. Only keep if it reduces bad fades AND improves continuation quality. Tuned for cumulative level-volume acceptance + dirBias + PDH/PDL/OR + MTF confluence core.

**Current implemented:** inputs 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20 (partial — see `heatseekerMath.ts`)

---

## BLOCK A — 20 QUANT/TECHNICAL ALPHA INPUTS
*Ranked strictly by predictive power. Implement directly in `heatseekerMath.ts` or Pine.*

| # | Name | Alpha Rank | Status | Implementation Note |
|---|------|-----------|--------|---------------------|
| 1 | **HTF MTF Structure Confluence Score** | ★★★★★ | TODO | BOS/CHOCH alignment Daily/4H/1H — multiplies dirBias only when 3+ TFs show same break-of-structure. Highest alpha directional filter. |
| 2 | **Volume Profile POC/VAH/VAL Acceptance at PDH/PDL/OR** | ★★★★★ | TODO | Fixed-range session VP. Rank levels by % volume in ATR band around POC first, then VAH/VAL. |
| 3 | **CVD Absorption at Key Levels** | ★★★★★ | DONE (partial) | Delta divergence vs price at PDH/PDL/OR = absorption signal. Strongest energy predictor. Expand: track delta at specific price bands not just global. |
| 4 | **FVG + OB Confluence with Volume Retest Count** | ★★★★☆ | DONE (partial) | Only count FVGs overlapping institutional OB + ≥2 volume-accepted retouches. Currently FVG is binary — add retouch counter. |
| 5 | **Liquidity Sweep + Immediate Reversal Delta** | ★★★★☆ | DONE (partial) | Wick + CVD flip = stop-hunt then institutional entry. sweepBullCVD/sweepBearCVD exist — refine with immediate next-bar CVD confirmation. |
| 6 | **IDR/DR Expansion Ratio + STD Filter** | ★★★★☆ | DONE (partial) | Range vs historical daily/weekly std. `idrZ` exists — add weekly std comparison. |
| 7 | **ADX(14) + DI+/DI- Strength Multiplier** | ★★★★☆ | DONE | Only allow signals when ADX > 25 and DI confirms bias. Currently threshold=20 — raise to 25 for trend signals. |
| 8 | **Session Power-Hour Volume Weight** | ★★★☆☆ | DONE (partial) | NY open 9:30–11:00 + London overlap `todBoost`. Expand: add London open (3:00–5:00 UTC) boost. |
| 9 | **VWAP Deviation + SD Bands** | ★★★☆☆ | DONE | Price rejection/acceptance vs session VWAP. `vwapExtended` flag exists — integrate as directional penalty. |
| 10 | **Imbalance Threshold (bid/ask proxy)** | ★★★☆☆ | DONE | >1.5 ratio at level = strong directional energy. Currently imbRatioThresh=1.5. |
| 11 | **SuperTrend (10,3) Persistence Filter** | ★★★☆☆ | DONE | Only take signals in SuperTrend flip direction. Flip detection (prev vs current dir) not yet coded — add. |
| 12 | **RVOL vs 20-day Avg at Level** | ★★★☆☆ | DONE | >2.0 RVOL = institutional confirmation. `rvolMin` currently 1.2 — add separate FIRE threshold at 2.0. |
| 13 | **Hurst Exponent for Trend Persistence** | ★★★☆☆ | DONE | >0.55 = trending regime multiplier. `hurstEst` in engine. |
| 14 | **EMA21/55 Slope Delta Normalized by ATR** | ★★★☆☆ | DONE (partial) | `emaSlope` exists but not ATR-normalized. Divide by curAtr for dimensionless acceleration. |
| 15 | **Retouch Decay Counter** | ★★★☆☆ | DONE (partial) | `decayPenalty` from touchCount. Expand: exponential decay vs linear. |
| 16 | **Volatility Percentile (ATR14 vs 100-bar)** | ★★☆☆☆ | DONE | `volPctRank` in engine. |
| 17 | **Time-of-Day Decay Curve** | ★★☆☆☆ | DONE | `todBoost` with power-hour/late-session multipliers. |
| 18 | **MACD Histogram Divergence at Key Levels** | ★★☆☆☆ | DONE (partial) | `macdBullHidDiv` / `macdBearHidDiv` exist — weight hidden div as continuation, regular as reversal filter. |
| 19 | **RSI(14) Momentum Exhaustion** | ★★☆☆☆ | DONE | >80 or <20 = fade probability spike. `rsiExhaust` penalizes qualMult. |
| 20 | **Range Expansion % vs Prior 5 Days** | ★★☆☆☆ | DONE (partial) | `rangeExp` compares to 5-bar avg. Extend to 5-day avg for daily filters. |

### IMMEDIATE V2 NEXT BUILD — Block A Priority
**Add #1 (HTF MTF Structure — full BOS/CHOCH):** weight 0.4 into composite.
Currently uses EMA surrogates for MTF. Replace with proper structure:
```ts
// BOS: higher high (bull) or lower low (bear) on HTF close
// CHOCH: first opposing structure break after trend
htfBOS_1D = cur.close > highest(highs, 20, daily) ? 'BULL' : ...
// Weight: if 3 TFs agree BOS direction → mtfConfluence = 1.0 else 0.5
```

---

## BLOCK B — 20 AI/LLM ALPHA INPUTS
*Prompt-derived or model-output features fed as additional council vote weights into composite score. Generated via API call or manual prompt at session open.*

| # | Name | Alpha Rank | Model | Implementation Note |
|---|------|-----------|-------|---------------------|
| 1 | **Multi-Model Regime Consensus** | ★★★★★ | Jedi+Claude+Grok+Gemini | All 4 classify BULL/NEUTRAL/BEAR + confidence %. Use only when ≥3 agree. Highest alpha filter. → `POST /v1/council` already returns JEDI aggregate. **Expand to external models.** |
| 2 | **Narrative Shift Probability** | ★★★★★ | Grok (xAI) | Reads order flow + news + futures premium; outputs % chance of regime flip next 2H. → Add as async score modifier. |
| 3 | **Cross-Asset Correlation Anomaly** | ★★★★☆ | Claude | Detects ES/NQ diverging from DXY/10Y/Gold/BTC; flags hidden institutional rotation. → Feed as bearish/bullish energy modifier. |
| 4 | **Probabilistic Edge Matrix** | ★★★★☆ | Gemini | 0–100% continuation probability for current PDH/PDL/OR level given MTF + volume context. → Replace static `confPts` ceiling with dynamic probability. |
| 5 | **Sentiment-Adjusted Volume Impact** | ★★★☆☆ | Jedi | Parses real-time news/flow for absorption language; boosts CVD score when institutional buying detected. |
| 6 | **Anomaly Detection on Price-Volume** | ★★★☆☆ | Grok | Flags when price moves against CVD acceptance (hidden distribution). → Add as `hiddenDistribution` penalty on bullVotes. |
| 7 | **LLM-Derived Liquidity Pool Map** | ★★★☆☆ | Any | Models predict next major liquidity level beyond PDH/PDL (sweep targets). → Feed as T2/T3 target override. |
| 8 | **Multi-Model Divergence Consensus** | ★★★☆☆ | All 4 | All 4 AIs scan for hidden/regular div on RSI/MACD at level. → Weight MACD signal #18. |
| 9 | **Narrative Momentum Score** | ★★★☆☆ | Claude | Tracks speed of narrative shift (risk-on → risk-off). → Modifies `todBoost`. |
| 10 | **Synthetic OB Validation** | ★★★☆☆ | Gemini | AI confirms FVG/OB aligns with historical institutional behavior. → Boolean multiplier on fvgWithVol. |
| 11 | **Energy Decay Forecast** | ★★☆☆☆ | Jedi | Predicts bars until momentum exhausts based on similar setups. → Feeds `decayPenalty`. |
| 12 | **Cross-TF Narrative Alignment** | ★★☆☆☆ | Grok | 1H story matches Daily story → prevents fakeouts. → Adds to `mtfAligned` weight. |
| 13 | **Probabilistic Adverse Excursion Estimate** | ★★☆☆☆ | All | Expected stop distance for setup. → Dynamic `stopMult` instead of fixed 1.0. |
| 14 | **Regime Persistence Forecast** | ★★☆☆☆ | Claude | % chance current regime lasts >4H. → Scales `qualMult`. |
| 15 | **Alt Data Sentiment Blend** | ★★☆☆☆ | Gemini+Grok | Reddit/X/news sentiment weighted against price action. → External feed. |
| 16 | **Counter-Trend Trap Probability** | ★★☆☆☆ | Any | AI flags when retail piles into obvious direction (fade setup). → Inverts signal when high. |
| 17 | **HTF Structure Narrative Summary** | ★★☆☆☆ | Any | Concise LLM output of HTF bias to weight MTF score. → Pre-session prompt at open. |
| 18 | **Volatility Regime Classifier** | ★★☆☆☆ | Any | AI classifies vol as expansion/contraction/mean-reversion. → Gates `rangeExp`. |
| 19 | **Micro-Story Shift Detection** | ★★☆☆☆ | Grok | Detects intra-hour narrative changes via headline velocity. → Real-time modifier. |
| 20 | **Council Confidence Delta** | ★★☆☆☆ | Any | Diff between current and prior 15-min AI consensus (momentum of confidence). → `dirBiasRaw` velocity signal. |

### IMMEDIATE V2 NEXT BUILD — Block B Priority
**Add #1 (Multi-Model Regime Consensus) — hook into existing `/v1/council`:**
```ts
// M3D already has 27-algo JEDI council → treat as AI ensemble vote
// Map JEDI jedi_score → aiRegimeWeight:
const aiRegimeWeight = jediScore > 60 ? 1.3 : jediScore > 40 ? 1.0 : 0.7
composite *= aiRegimeWeight
```

---

## COMBINED V2 FIRST ITERATION
*Highest alpha injection without breaking modularity:*

| Step | Action | Expected Edge |
|------|--------|--------------|
| 1 | Implement `htfBOS` proper structure (replace EMA surrogates) | +15–20% direction accuracy |
| 2 | Wire JEDI score from `/v1/council` as `aiRegimeWeight` multiplier | +10% false signal reduction |
| 3 | Raise RVOL fire threshold: rvolVal > 2.0 → FIRE forced regardless of score | Catches institutional sweeps |
| 4 | ATR-normalize emaSlope: `emaSlope / curAtr` | Dimensionless across all assets |
| 5 | Run 30 signals on ES/NQ 5m, log with Change Log Template | Validation gate |

**HUNTING ALPHA. EXECUTING. NEXT.**
