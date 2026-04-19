# GROK / CLAUDE / GEMINI — COMBINED PAYLOAD REFERENCE
## Every request + response in one page · 1-minute cadence

---

## ❓ IS `source_confidence` A NATIVE xAI API FIELD?

**No.** The xAI `/v1/responses` API does NOT return a `source_confidence` field.

The raw response structure is:
```json
{
  "id": "resp_...",
  "model": "grok-4.20-reasoning",
  "output": [{
    "type": "message",
    "content": [{
      "type": "output_text",
      "text": "...the model's response text..."
    }]
  }],
  "usage": {
    "input_tokens": 1240,
    "output_tokens": 892,
    "total_tokens": 2132
  }
}
```

`source_confidence`, `gaming_detected`, `gaming_flags` are **fields we instruct Grok to reason about and include in its structured JSON output text**. Grok's reasoning model evaluates source credibility (cross-referencing X posts, domains, timing patterns) and writes these values into the JSON it returns. They are model reasoning outputs — not API metadata.

---

## KEY LOCATION

```
File:    M3D/.env.local
Var:     API_XAI_YODA_KEY=xai-njGsS...
Loaded:  ds/ds_app/views.py at import time (_load_env_local)
         ds/grok_pulse.py at startup (_load_env)
         go.sh sources this file before starting all services
```

---

## API ENDPOINT

```
POST  https://api.x.ai/v1/responses
Auth: Authorization: Bearer {API_XAI_YODA_KEY}
```

---

## 1. MAXCOGVIZ ALPHA — MEGA INTEL (Hourly cadence, ~60s per run)

### REQUEST (POST /ds/v1/ai/maxcogviz/)

```json
{
  "jedi": 14,
  "regime": "BULL",
  "long_algos": 18,
  "short_algos": 5,
  "models": ["grok", "claude", "gemini"],
  "assets_snapshot": [
    {"symbol": "BTC", "jedi_score": 18},
    {"symbol": "ETH", "jedi_score": 12},
    {"symbol": "SOL", "jedi_score": 9}
  ],
  "council_votes": {
    "DON_BO": 1, "EMA_CROSS": 1, "RSI_CROSS": -1
  }
}
```

### GROK PROMPT (sent to all 3 models, same text)

```
You are MAXCOGVIZ ALPHA — the most advanced market intelligence system ever built.
Your purpose: synthesise ALL dimensions of global market force into one structured signal.

M3D SYSTEM STATE:
  JEDI master score: 14/27 | Regime: BULL
  Council: 18 LONG [...] / 5 SHORT [...]
  Surging assets: BTC(+18), ETH(+12)
  Crashing assets: none

ANALYZE THESE 12 DIMENSIONS WITH DEEP GRANULARITY:
1. MACRO SLOPE: Yield curve shape, DXY trajectory, real rates, credit spreads
2. MONEY FLOW: Smart money rotation — where is $10T+ institutional capital moving
3. GEOPOLITICAL: Active war zones, sanctions, Taiwan strait, supply chain chokepoints
4. PANDEMIC/BIOSECURITY: Disease surveillance, economic shutdown probability
5. ENERGY/COMMODITIES: Oil/gas/LNG, rare earth, food inflation, commodity supercycle
6. CENTRAL BANK: Fed pivot probability, ECB/BOJ/PBOC divergence, liquidity
7. CRYPTO NATIVE: BTC on-chain (MVRV, SOPR, exchange flows), ETF inflows, halving
8. SENTIMENT WAVE: Fear/greed across 1d/1w/1m
9. VELOCITY: Rate-of-change of ALL above — accelerating or decelerating
10. BLACK SWAN RADAR: Known unknowns, tail-risk, 3σ scenarios
11. TECH DISRUPTION: AI displacement, sector rotation, creative destruction
12. ALPHA SIGNAL: Synthesised across all 11 dimensions

Return ONLY valid minified JSON:
{schema — see below}
```

### RESPONSE SCHEMA (what each model returns)

```json
{
  "timestamp": "2026-04-04T12:00:00Z",
  "alpha_composite": 6.2,
  "confidence": 78,
  "posture": "RISK_ON",
  "ground_slope": "RISING",

  "dimensions": {
    "macro_slope":    {"score": 3.5, "direction": "UP",   "confidence": 72, "signal": "Yield curve re-steepening, DXY rolling over",  "horizon": "30d"},
    "money_flow":     {"score": 7.1, "direction": "UP",   "confidence": 85, "signal": "Institutions rotating into crypto ETFs",        "hot_sector": "CRYPTO"},
    "geopolitical":   {"score":-2.0, "direction": "FLAT", "confidence": 60, "signal": "Middle East contained, Taiwan stable",          "hotspot": "Middle East"},
    "pandemic":       {"score": 0.5, "direction": "FLAT", "confidence": 80, "signal": "No material biosecurity risk",                  },
    "energy":         {"score": 2.0, "direction": "UP",   "confidence": 65, "signal": "Oil stable, gas seasonal tailwind",            "key_commodity": "Brent"},
    "central_bank":   {"score": 4.0, "direction": "UP",   "confidence": 70, "signal": "Fed pause confirmed, rate cuts Q3 priced",     "key_event": "FOMC June"},
    "crypto_native":  {"score": 8.5, "direction": "UP",   "confidence": 88, "signal": "MVRV 2.4, exchange outflows accelerating",     "key_metric": "MVRV"},
    "sentiment_wave": {"score": 5.0, "direction": "UP",   "confidence": 75, "signal": "Fear/greed 68 rising, fear < price fall",      "fear_greed": 68},
    "velocity":       {"score": 4.5, "direction": "UP",   "confidence": 70, "signal": "All indicators accelerating simultaneously"},
    "black_swan":     {"score":-1.0, "direction": "FLAT", "confidence": 55, "signal": "Low immediate tail risk, watching CFTC",       "top_risk": "Unexpected CFTC enforcement action"},
    "tech_disruption":{"score": 3.0, "direction": "UP",   "confidence": 68, "signal": "AI capex cycle driving semis, rotation ongoing"},
    "alpha_signal":   {"score": 5.8, "direction": "UP",   "confidence": 76, "signal": "Macro, flow, crypto all aligned — RISK ON"}
  },

  "trade_ideas": [
    {"asset": "BTC",  "direction": "LONG",  "entry_condition": "Any 3% pullback to 84k zone", "target_pct": 15.0, "stop_pct": 6.0, "conviction": 82, "timeframe": "1w"},
    {"asset": "GLD",  "direction": "LONG",  "entry_condition": "DXY breaks below 102",        "target_pct": 8.0,  "stop_pct": 3.5, "conviction": 71, "timeframe": "1m"},
    {"asset": "NVDA", "direction": "SHORT", "entry_condition": "Failed breakout above ATH",   "target_pct": 12.0, "stop_pct": 4.0, "conviction": 58, "timeframe": "1w"}
  ],

  "outlook": {
    "30d":  {"bias": "BULL",    "key_catalyst": "ETF inflows + Fed pause confirmation",    "probability": 72},
    "90d":  {"bias": "BULL",    "key_catalyst": "Rate cut cycle begins Q3",                "probability": 65},
    "180d": {"bias": "NEUTRAL", "key_catalyst": "Election uncertainty + Q4 liquidity",     "probability": 50}
  },

  "m3d_alignment":     "CONFIRMED",
  "alignment_note":    "JEDI +14 aligns with macro slope and crypto_native — confluence strong.",
  "intelligence_brief": "4-6 sentence master synthesis...",
  "recommended_action": "Press BTC longs on any 3% dip. Hold 15% cash for black swan optionality."
}
```

### SYNTHESISED RESPONSE (after 3-model parallel run)

```json
{
  "ok": true,
  "synthesis": { /* averaged dimensions */ },
  "model_results": {
    "grok":   { /* grok's full JSON */ },
    "claude": { /* claude's full JSON */ },
    "gemini": { /* gemini's full JSON */ }
  },
  "errors": {},
  "models_succeeded": ["grok", "claude"],
  "timestamp": "2026-04-04T12:00:05Z"
}
```

---

## 2. GROK PULSE DAEMON — LIVE TRIGGER FEED (60s cadence)

### REQUEST (POST https://api.x.ai/v1/responses)

```json
{
  "model": "grok-4.20-reasoning",
  "input": "Search X (Twitter) and live news for the last 3 minutes only. Return JSON array of triggers: [{trigger_class, urgency, direction, ticker, confidence, source_confidence, gaming_detected, gaming_flags, entry_window_min, target_pct, stop_pct, source, raw_headline}]. Focus: BTC, ETH, SOL, SPY, GLD. Return [] if nothing material."
}
```

### RESPONSE (raw xAI format)

```json
{
  "model": "grok-4.20-reasoning",
  "output": [{
    "type": "message",
    "content": [{
      "type": "output_text",
      "text": "[{\"trigger_class\":\"CATALYST\",\"urgency\":\"NOW\",\"direction\":\"LONG\",\"ticker\":\"BTCUSDT\",\"confidence\":88,\"source_confidence\":91,\"gaming_detected\":false,\"gaming_flags\":[],\"entry_window_min\":5,\"target_pct\":3.2,\"stop_pct\":1.5,\"source\":\"NEWS_WIRE\",\"raw_headline\":\"BlackRock files for spot BTC options ETF — Bloomberg\"}]"
    }]
  }],
  "usage": {"input_tokens": 310, "output_tokens": 147, "total_tokens": 457}
}
```

### PARSED TRIGGER (after enrichment + gaming filter)

```json
{
  "trigger_id":        "uuid-...",
  "ts":                "2026-04-04T12:01:00Z",
  "trigger_class":     "CATALYST",
  "urgency":           "NOW",
  "direction":         "LONG",
  "ticker":            "BTCUSDT",
  "sector":            "CRYPTO",
  "catalyst_type":     "REGULATORY",
  "confidence":        88,
  "source_confidence": 91,
  "gaming_detected":   false,
  "gaming_flags":      [],
  "entry_window_min":  5,
  "target_pct":        3.2,
  "stop_pct":          1.5,
  "source":            "NEWS_WIRE",
  "raw_headline":      "BlackRock files for spot BTC options ETF — Bloomberg",
  "halo_auto":         true,
  "outcome":           null
}
```

**HALO auto-qualification:** `gaming_detected=false AND source_confidence≥80 AND confidence≥75 AND urgency∈{NOW,5MIN}`

**Gaming discard rule:** If `gaming_detected=true` → trigger is silently discarded, never reaches site.

---

## 3. SITREP — FULL MARKET SNAPSHOT (on-demand button)

### REQUEST (POST /ds/v1/ai/sitrep/)

```json
{
  "jedi": 14,
  "regime": "BULL",
  "long_algos": 18,
  "short_algos": 5,
  "surge_assets": ["BTC", "ETH", "SOL"],
  "falling_assets": ["DOGE"],
  "model": "grok-4.20-reasoning"
}
```

### GROK PROMPT

```
CLASSIFIED MARKET SITREP — {timestamp}
JEDI: +14 | Regime: BULL | Long: 18 | Short: 5
TIER 1 SURGE: BTC, ETH, SOL
TIER 4 FALLING: DOGE

Deliver a 5-point classified SITREP:
1. MACRO ENVIRONMENT: What is the macro doing RIGHT NOW
2. THREAT MATRIX: What could end this regime in next 30 days
3. OPPORTUNITY SURFACE: Top 3 highest conviction setups
4. HALO PROTOCOL: Stealth entry considerations
5. RECOMMENDED POSTURE: Specific allocation guidance
```

### RESPONSE

```json
{
  "ok": true,
  "sitrep": "1. MACRO ENVIRONMENT: Fed on hold, DXY rolling over...\n2. THREAT MATRIX...",
  "model": "grok-4.20-reasoning",
  "timestamp": "2026-04-04T12:00:00Z"
}
```

---

## 4. CHART VISION — SCREENSHOT ANALYSIS (on-demand)

### REQUEST (POST /ds/v1/ai/vision/)

```json
{
  "image_b64": "<base64 PNG from LWC chart.takeScreenshot()>",
  "symbol": "BTCUSDT",
  "timeframe": "1h",
  "jedi": 14,
  "regime": "BULL",
  "model": "grok-4.20-reasoning"
}
```

### GROK PROMPT STRUCTURE

```json
{
  "model": "grok-4.20-reasoning",
  "input": [
    {"role": "user", "content": [
      {"type": "image_url", "image_url": {"url": "data:image/png;base64,<b64>"}},
      {"type": "text", "text": "Analyse this BTCUSDT 1h chart..."}
    ]}
  ]
}
```

### RESPONSE

```json
{
  "ok": true,
  "analysis": "1. TREND: Strong uptrend...\n2. KEY LEVELS...",
  "symbol": "BTCUSDT",
  "timeframe": "1h"
}
```

---

## 5. ALGO WEIGHT OPTIMIZER (on-demand / after MAXCOGVIZ run)

### REQUEST (POST /ds/v1/algo/weights/optimize/)

```json
{
  "regime": "BULL",
  "council_votes":  {"DON_BO": 1, "EMA_CROSS": 1, "RSI_CROSS": -1},
  "council_scores": {"DON_BO": 0.82, "EMA_CROSS": 0.71, "RSI_CROSS": 0.60},
  "mcv_dimensions": {
    "macro_slope":   {"score": 3.5},
    "money_flow":    {"score": 7.1},
    "geopolitical":  {"score": -2.0},
    "black_swan":    {"score": -1.0},
    "velocity":      {"score": 4.5},
    "sentiment_wave":{"score": 5.0},
    "central_bank":  {"score": 4.0}
  }
}
```

### RESPONSE

```json
{
  "ok": true,
  "regime": "BULL",
  "method": "regime+mcv+moe",
  "bank_multipliers": {"A": 1.30, "B": 1.00, "C": 0.70},
  "equal_jedi":    12.0,
  "weighted_jedi": 15.4,
  "moe_jedi":      14.1,
  "jedi_delta":    3.4,
  "weights":     {"DON_BO": 0.05823, "EMA_CROSS": 0.04102, ...},
  "moe_weights": {"DON_BO": 0.04773, ...},
  "boosts":      [{"algo": "DON_BO", "factor": 1.58, "bank": "A", "reasons": ["regime=BULL bank=A ×1.30", "💰flow+7.1"]}],
  "suppressions":[{"algo": "CMF_POS", "factor": 0.61, "bank": "C", "reasons": ["regime=BULL bank=C ×0.70"]}],
  "algo_detail": [...],
  "timestamp": "2026-04-04T12:00:05Z"
}
```

---

## COMBINED 1-MINUTE INTELLIGENCE CYCLE

```
T+00s  Pulse daemon fires → Grok 3-min live search (60s poll)
T+15s  Pulse results arrive → gaming filter → site WebSocket push
T+20s  If NOW trigger: macOS notification + HALO pre-populate
T+30s  Site polls /ds/v1/ai/pulse/ → PulseFeed refreshes

T+00m  (hourly) MAXCOGVIZ fires → 3 parallel model calls
T+45s  Results synthesise → radar updates → ground slope
T+50s  Weight optimizer auto-runs with MCV dimensions
T+55s  AlgoWeights page updates → new JEDI weights live

User:  Press SITREP → 1 Grok call → 5-point classified brief
User:  Press 👁  → chart screenshot → vision analysis
User:  Press Q1-Q4 → Yoda strategic queries (31s rate limit)
```

---

## ERROR STATES

| Error | Cause | Fix |
|-------|-------|-----|
| `API_XAI_YODA_KEY not set` | Key not in env | Check `M3D/.env.local` — views.py now auto-loads at import |
| `ANTHROPIC_API_KEY not set` | Claude skipped | Add key to `M3D/.env.local` |
| `GOOGLE_GEMINI_KEY not set` | Gemini skipped | Add key to `M3D/.env.local` |
| `stale: true` in pulse | Daemon not running | `python ds/grok_pulse.py` or `./go.sh ds` |
| `gaming_detected: true` | Fake/coordinated signal | Discarded — correct behaviour |

---

*M3D Oracle Reference — 2026-04-04*
