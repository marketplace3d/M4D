# M3D ORACLE PLAN
## Grok Pulse · Expert Swarm · Confidence-Filtered Triggers · HFT Near-Entry

> "Second place is zero. MAXCOGVIZ ALPHA to optimise every aspect."
> "Grok IS the news. It is the pulse."
> "We must visualise and algo act on it."
> "Define metadata triggers. Need HFT swarm for near-HFT trades (trigger entries)."
> "xAI confidence score — they know if something is being gamed and can see through it."

---

## API KEY

```
File:  M3D/.env.local
Key:   API_XAI_YODA_KEY=xai-njGsS...
Used:  ds/ds_app/views.py  →  os.environ.get("API_XAI_YODA_KEY")
All DS xAI calls use this single key (yoda, sitrep, vision, image, maxcogviz, pulse).
```

---

## 1. THE INSIGHT — WHAT WE DID NOT KNOW WE DID NOT KNOW

### What Grok actually is:
- **Live X/Twitter feed** — real-time, not delayed
- **Live web search** — hits news wires, filings, blogs in seconds
- **Source confidence scoring** — Grok can assess whether a site/account is being **gamed**
  - Coordinated pump campaigns on Reddit / Telegram
  - Fake news amplified on obscure sites
  - Astroturfed X accounts inflating a narrative
  - Wash-traded volume showing up as "whale move"
- **2M context window** — can hold entire watchlist + recent history in one call

### The xAI Confidence Score:
The Grok API returns source-level confidence. When we ask for triggers, we MUST:
1. Request a `source_confidence` (0–100) per trigger
2. Request `gaming_flags` — is this story being artificially amplified?
3. Weight our action size by `source_confidence`
4. Discard triggers where `gaming_detected: true`

**This is the real edge.** Retail sees the headline. We see whether the headline is real.

---

## 2. TRIGGER METADATA SCHEMA (SSOT)

Every actionable signal from the Oracle layer is an atomic **Trigger**.

```json
{
  "trigger_id": "uuid",
  "ts": "2026-04-04T12:34:56Z",
  "trigger_class": "CATALYST | REGIME_SHIFT | MOMENTUM | REVERSAL | MACRO_PRINT | WHALE | TWEET_STORM | REGULATORY",
  "urgency":       "NOW | 5MIN | 1HR | EOD | NEXT_SESSION",
  "direction":     "LONG | SHORT | HEDGE | HOLD | EXIT | REDUCE",
  "ticker":        "BTCUSDT | SPY | GLD | null (= market-wide)",
  "sector":        "CRYPTO | TECH | ENERGY | MACRO | null",
  "catalyst_type": "EARNINGS | FDA | M&A | MACRO_PRINT | TWEET_STORM | WHALE_MOVE | REGULATORY | GEOPOLITICAL | SUPPLY_CHAIN",
  "confidence":    85,
  "source_confidence": 92,
  "gaming_detected":   false,
  "gaming_flags":  [],
  "entry_window_min":  5,
  "target_pct":    2.5,
  "stop_pct":      1.2,
  "source":        "X_POST | NEWS_WIRE | CHAIN_DATA | MACRO_PRINT | FILING",
  "source_url":    "...",
  "raw_headline":  "SEC approves spot ETH ETF options — Bloomberg",
  "expert_votes":  { "BULL": 1, "BEAR": 0, "MACRO": 1, "QUANT": 1, "DEVIL": 0 },
  "dissent":       "DEVIL: ETF options require CFTC sign-off not yet confirmed",
  "halo_auto":     true
}
```

### Confidence weighting on position size:
| `source_confidence` | `gaming_detected` | Action |
|---------------------|-------------------|--------|
| ≥ 80 | false | Full trigger → HALO full size |
| 60–79 | false | Half size, manual confirm |
| < 60 | false | Alert only, no auto-entry |
| any | true | **DISCARD** — do not trade |

---

## 3. GROK PULSE DAEMON

**File:** `ds/grok_pulse.py`  
**Runs:** alongside Django, every 60 seconds  
**Key:** `API_XAI_YODA_KEY`

### Prompt (sent every 60s):
```
Search X (Twitter) and live news right now. I need the top actionable market triggers 
from the last 3 minutes only. 

For each trigger return:
- trigger_class: CATALYST|REGIME_SHIFT|MOMENTUM|REVERSAL|MACRO_PRINT|WHALE|TWEET_STORM|REGULATORY
- urgency: NOW|5MIN|1HR|EOD
- direction: LONG|SHORT|HEDGE|EXIT
- ticker: symbol or null for market-wide
- catalyst_type: EARNINGS|FDA|M&A|MACRO_PRINT|TWEET_STORM|WHALE_MOVE|REGULATORY|GEOPOLITICAL
- confidence: 0-100 (your confidence this moves price)
- source_confidence: 0-100 (your confidence the source is REAL, not gamed/coordinated)
- gaming_detected: true if you see coordinated amplification, fake accounts, or wash signals
- gaming_flags: list of reasons if gamed
- entry_window_min: how many minutes before this is priced in
- target_pct and stop_pct: estimated move size
- raw_headline: exact headline

Return ONLY JSON array. Return [] if nothing material in last 3 min.
Filter to these symbols: {watchlist}
```

### Output flow:
```
grok_pulse.py 
  → POST /v1/responses (Grok live search)
  → parse triggers[]
  → filter: gaming_detected=false AND source_confidence >= 60
  → broadcast via WebSocket /ws/pulse
  → if urgency=NOW: osascript notify (macOS desktop alert)
  → append to ds/data/pulse_history.json (rolling 24h)
```

---

## 4. EXPERT ADVERSARIAL SWARM

**5 Grok personas running in parallel (ThreadPoolExecutor)**

| # | Persona | System framing | What it finds |
|---|---------|----------------|---------------|
| 1 | BULL HAWK | "You are the most bullish analyst alive. Find every catalyst for upside." | Upside catalysts, accumulation signals |
| 2 | BEAR HAWK | "You are the most bearish analyst alive. Find every reason this fails." | Distribution signals, macro headwinds |
| 3 | MACRO WATCHER | "Fed, DXY, yields, EM flows, oil, gold only. Nothing else." | Rate/dollar regime |
| 4 | QUANT | "Pure technical and order flow. Ignore all narrative." | Price structure signals |
| 5 | DEVIL'S ADVOCATE | "Destroy the consensus. Find what everyone is missing. What is the unknown unknown?" | Blind spots, tail risks |

### Synthesis rules:
- 5/5 agree → `ORACLE` confidence, full size
- 4/5 agree → HIGH confidence
- 3/5 agree → MEDIUM, half size
- Split (2–3) → show dissent in UI, no auto-entry
- Devil's Advocate unique bear case → always surface as `unknown_unknown` field

---

## 5. MAXCOGVIZ v2 — ORACLE MODE

**Upgrade the 12-dim snapshot to a living intelligence document.**

### New fields added to schema:
```json
{
  // ... existing 12 dims ...
  "triggers": [...],           // atomic triggers from this run
  "expert_swarm": {            // 5-persona dissent map
    "BULL": { "score": 7, "key_point": "..." },
    "BEAR": { "score": -4, "key_point": "..." },
    "MACRO": { "score": 2, "key_point": "..." },
    "QUANT": { "score": 5, "key_point": "..." },
    "DEVIL": { "score": -6, "key_point": "..." }
  },
  "dissent_level": "LOW | MEDIUM | HIGH | SPLIT",
  "unknown_unknowns": [        // Devil's Advocate blind spots
    "Turkish lira collapse not priced into EM",
    "CFTC chair nomination blocked in Senate"
  ],
  "gaming_alerts": [           // signals Grok detected as gamed
    { "ticker": "XYZ", "flag": "coordinated X pump", "confidence": 89 }
  ],
  "oracle_posture": "PRESS | HOLD | REDUCE | HEDGE | CASH",
  "oracle_conviction": 0-100
}
```

### UI additions to MaxCogViz.tsx:
- **Swarm Dissent panel**: 5 expert bars (bull/bear/macro/quant/devil) with key points
- **Unknown Unknowns list**: red-highlighted blind spots
- **Gaming Alerts**: orange warning if Grok detected manipulation
- **Live Trigger feed**: real-time pulse triggers overlaid on radar

---

## 6. HALO JUMP AUTO-FEED

When `urgency=NOW` trigger arrives with `source_confidence ≥ 80` and `gaming_detected=false`:

1. Auto-populate HALO JUMP order schedule (existing LCG scheduler)
2. Set `side` from `direction` field
3. Set `slices` based on `confidence` (high conf = more slices = more committed)
4. Set `windowMin` from `entry_window_min`
5. Flash RED MIST + alarm if direction opposes current JEDI sign (bracket breach)
6. Log trigger_id with trade for IC feedback loop

---

## 7. IC FEEDBACK LOOP (Close the Oracle)

Track every trigger → observe actual price move → compute trigger alpha:

```python
trigger_alpha = {
  "trigger_id": "...",
  "entry_price": 45200,
  "price_5min":  45800,
  "price_1hr":   46100,
  "direction":   "LONG",
  "was_correct": true,
  "pnl_pct":     1.98,
  "catalyst_type": "M&A"
}
```

Feed back into weight optimizer:
- Catalyst types with high hit rate → boost confidence multiplier
- Sources with repeated gaming flags → auto-blacklist
- Persona (BULL/BEAR) win rates by regime → adjust swarm weights

---

## 8. PUSH NEWS — LOCAL AI ALERT

**No external service needed.** Everything via Grok Pulse Daemon:

```bash
# macOS desktop notification (osascript)
osascript -e 'display notification "BTC LONG — NOW — 85% conf" with title "M3D PULSE"'

# WebSocket push to browser (already have /ws/algo, add /ws/pulse)
# Browser shows toast notification in Hedge page

# Optional future: Telegram bot (POST to Telegram API, no server needed)
```

---

## 9. DATA POINTS WE CAN ACT ON (Ranked by Edge)

| Rank | Signal | Latency | Edge |
|------|--------|---------|------|
| 1 | X post from CEO/regulator | 0–30s | Price hasn't moved |
| 2 | Breaking news wire (Bloomberg/Reuters via Grok) | 30s–2min | Seconds advantage |
| 3 | Unusual options flow (Grok sourcing darkpool chatter) | 1–5min | Smart money |
| 4 | On-chain whale move (Grok via chain explorers) | 1–5min | Pre-move |
| 5 | Fed official comment (non-FOMC) | 5–15min | Macro shift |
| 6 | Macro print (CPI/jobs) | immediate | Binary event |
| 7 | MAXCOGVIZ regime shift (12-dim confluence) | hourly | Structural |
| 8 | JEDI score (27-algo vote) | 5min | Technical |
| 9 | OHLCV backtest signal | daily | Lagging |

---

## 10. BUILD ORDER

| Priority | Component | File | Status |
|----------|-----------|------|--------|
| 🔴 P0 | Grok Pulse Daemon | `ds/grok_pulse.py` | TODO |
| 🔴 P0 | WebSocket /ws/pulse | `ds/ds_app/consumers.py` | TODO |
| 🔴 P0 | Trigger schema (SSOT) | `spec-kit/data/trigger-schema.v1.json` | TODO |
| 🟡 P1 | MAXCOGVIZ v2 oracle mode | `ds/ds_app/views.py` → maxcogviz_alpha | TODO |
| 🟡 P1 | Expert swarm 5-persona | `ds/ds_app/views.py` | TODO |
| 🟡 P1 | MaxCogViz.tsx swarm panel | `site/src/pages/MaxCogViz.tsx` | TODO |
| 🟢 P2 | Trigger → HALO auto-feed | `site/src/pages/Hedge.tsx` | TODO |
| 🟢 P2 | Pulse feed panel in Hedge | `site/src/pages/Hedge.tsx` | TODO |
| 🟢 P2 | IC feedback loop | `ds/ds_app/views.py` | TODO |
| ⚪ P3 | AlgoWeights auto-refresh | `site/src/pages/AlgoWeights.tsx` | DONE (manual) |

---

---

## 11. ALL PULSES + PICTURES — VISUAL INTELLIGENCE LAYER

> "Not just pulse news. May need gen pictures to convey complex landscape. 3D someday maybe."

### What xAI Aurora gives us:
- **`POST /v1/ai/image/`** already built in DS — sends prompt → Aurora → returns URL
- Aurora is xAI's image generation model, accessed via same API key

### Pipeline: Grok describes → Aurora renders:
```
1. MAXCOGVIZ run completes → ground_slope + posture + top 3 dimensions
2. Auto-generate image prompt:
   "Market terrain: {ground_slope} slope, {posture} posture. 
    {dim1} at {score1}/10, {dim2} at {score2}/10. 
    Render as dramatic 3D terrain map / war room hologram. Dark palette."
3. POST to Aurora → image URL
4. Display in MaxCogViz.tsx alongside the radar — the VISUAL SITREP
```

### Pulse trigger images:
- For NOW urgency triggers → generate image: "Breaking: {catalyst_type} on {ticker}. {direction} signal. Render as war room alert."
- Show as thumbnail in PulseFeed row when expanded

### 3D future path:
- Data is already structured for 3D: 12 dims × score = 3D terrain mesh
- Three.js or Babylon.js: map 12 dim scores to terrain height field
- Ground slope = overall tilt of the mesh
- MAXCOGVIZ scores = vertex heights
- Real-time WebSocket → terrain morphs as scores update
- Already have the data contract in `trigger-schema.v1.json`

### What's built now:
| Component | Status |
|-----------|--------|
| `POST /v1/ai/image/` Aurora endpoint | ✅ DONE |
| `POST /v1/ai/vision/` chart vision | ✅ DONE |
| `POST /v1/ai/maxcogviz/` 12-dim data | ✅ DONE |
| Auto image from MAXCOGVIZ output | ⏳ TODO |
| Pulse trigger thumbnails | ⏳ TODO |
| 3D terrain viz (Three.js) | 📋 PLANNED |

---

## DOGMA TRASH LIST

| Dogma | Verdict | Replacement |
|-------|---------|-------------|
| OHLCV is the signal | TRASH | News catalyst timing IS the edge. OHLCV is the echo. |
| Single model consensus | TRASH | Adversarial swarm. Dissent is signal. |
| Daily timeframe | TRASH | Catalysts move in 1–15 min windows |
| Sentiment = 1 number | TRASH | velocity + breadth + source quality + recency decay |
| Equal algo weights | TRASH | MoE + regime × bank matrix |
| More algos = more edge | TRASH | Fewer, sharper, correctly weighted |
| All headlines are equal | TRASH | Gaming filter + source confidence first |
| We know what we don't know | TRASH | Devil's Advocate: `unknown_unknowns` field |

---

*Generated: 2026-04-04 — M3D Oracle Architecture*
