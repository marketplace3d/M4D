# M3D/M2D — Session State & Restart Brief
_Last updated: 2026-04-05_

## WHAT EXISTS NOW (all built)

### M3D — Algo Science Platform (KEEP — Council/JEDI lives here)
- **Stack**: M3D React 18 + Blueprint + Vite :5500 | Rust Axum :3030 | Rust Engine | Django DS :8000
- **Launch**: `./go.sh` from `/Volumes/AI/AI-4D/M3D/`

#### Pages (site/src/pages/)
| File | What it does |
|------|-------------|
| Dashboard.tsx | Main cockpit |
| Hedge.tsx | PulseFeed (Grok triggers, 30s poll) + SurgersPanel |
| MaxCogViz.tsx | AI cognitive radar — fires Grok+Claude+Gemini, radar + diff sectors (arc ring bands, green=up/red=down vs prev fire) |
| AlgoWeights.tsx | MoE weight viz — regime×bank multipliers, JEDI gauge |
| TradeI.tsx | 500-asset JEDI + AI ideas from localStorage |
| Backtest.tsx | DS backtest runner |

#### Django DS endpoints (ds/ds_app/views.py + urls.py)
```
GET  /v1/ai/pulse/          → pulse_latest.json (30s cache check)
POST /v1/ai/pulse/run/      → trigger single scan
POST /v1/algo/weights/optimize/  → MoE weight calc
GET  /v1/ai/maxcogviz/      → fire Grok+Claude+Gemini synthesis
```

#### Grok Pulse daemon
- `ds/grok_pulse.py` — 60s poll, gaming filter, osascript notifications
- go.sh starts it alongside Django (PULSE_PID tracked)

#### Env loading
- `ds/ds_app/views.py` has `_load_env_local()` at import time
- Reads `/Volumes/AI/AI-4D/M3D/M3D/.env.local`
- Keys needed: `API_XAI_YODA_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GEMINI_KEY`

#### Docs folder: M3D/DOCS/ (was spec-kit/ — user renamed)
- DOCS/chats/TRADE-IDEAS-COM.MD — Holly scanner blueprint
- DOCS/chats/NEW-DIMENSIONS-TRADING.MD — Gemini MoE/PCA alpha blueprint

---

### M2D — Lean Alpha Machine (NEW 2026-04-05)
- **Location**: `/Volumes/AI/AI-4D/M2D/`
- **Stack**: Svelte 4 + Tailwind CSS dark navy
- **Launch**: `./go2d.sh` from `/Volumes/AI/AI-4D/`
- **Ports**: M2D dev :5200 | connects to M3D :3030 (Rust) + :8000 (Django)
- **Proxy**: `/api` → :3030, `/ds` → :8000, `/ws` → ws:3030

#### M2D IS NOT M3D — different philosophy
- M3D = JEDI council votes, 27 algos, science app
- M2D = MoE gating engine, 5 expert dimensions, real alpha, execution tool
- NO JEDI/bank votes in M2D

#### MoE Architecture (Gemini blueprint)
| Expert | Dimension | Sharpe target | Status |
|--------|-----------|---------------|--------|
| VECTOR | MTF Momentum (trend+mom from engine) | 1.4 | ✅ wired |
| VOLATILITY | Gamma/ATR squeeze | 1.9 | ✅ wired |
| GHOST | SMC Order Block/FVG (ICT) | 1.8 | [[[NOT BUILT]]] |
| ARB | Stat Arb Cointegration (BTC/ETH spread) | 3.0+ | [[[NOT BUILT]]] |
| PULSE | XAPI Sentiment Velocity (Grok) | 2.5 | partial |

Regime → gates weights:
- HIGH_VOL_NEWS → PULSE 70%
- MEAN_REVERSION → ARB 70%
- GAMMA_SQUEEZE → VOLATILITY 70%
- TREND → VECTOR 50% + GHOST 30%

FIRE threshold: |alpha| > 0.85

#### Pages
| File | Status |
|------|--------|
| Alpha.svelte | ✅ Regime banner + MoE weight panel + gated alpha table + FIRE indicator |
| TradeI.svelte | ✅ Trade-Ideas movers: volume surge / gainers / losers / gap scan |
| Signals.svelte | ✅ Holly EV scanner stub (needs /ds/v1/algo/holly/ built) |
| Pulse.svelte | ✅ Grok trigger feed, urgency filter, velocity signal |
| SMC.svelte | ✅ ICT OB→FVG strategy brief + build checklist |

#### lib/
- `moe.js` — detectRegime(), computeAlpha(), MOE_WEIGHTS constants
- `stores.js` — engineAssets, regime, moeWeights, alphaSignals, pulse
- `api.js` — fetch wrappers
- `ws.js` — WebSocket auto-reconnect store

---

## PENDING / TODO

### HIGH PRIORITY
1. **Holly scanner** `/ds/v1/algo/holly/` — see DOCS/chats/TRADE-IDEAS-COM.MD
   - Returns `{ top_algos, signals: {algo: rows} }`
   
2. **GHOST expert** — engine needs OB/FVG detection:
   - Order Block: last bull/bear candle before impulse
   - FVG: imbalance between candle[i-2].high and candle[i].low
   - Then wire to `/ds/v1/algo/smc/` → moe.js ghost signal

3. **ARB expert** — Django DS cointegration scanner:
   - BTC/ETH z-score, NVDA/AMD pairs
   - Wire to `/ds/v1/algo/stat-arb/` → moe.js arb signal

4. **Market Energy gate** in engine: `(volume/vol_ma20) * (atr/close)`

5. **ANTHROPIC_API_KEY + GOOGLE_GEMINI_KEY** in M3D/.env.local for multi-model MAXCOGVIZ

### MEDIUM
6. **PULSE expert velocity** — currently crude (count of NOW/HIGH triggers). Needs: sentiment acceleration (2nd derivative of trigger rate per asset)
7. **WebSocket push** replacing 15s polling in M2D Alpha page
8. **LUKE anomaly swatter** — normalize scores, detect anomalies (confirmed idea, deferred)

---

## GROK API (xAI) — IMPORTANT
```
POST https://api.x.ai/v1/responses
Body: { "model": "grok-4.20-reasoning", "input": prompt }
Auth: Bearer API_XAI_YODA_KEY
Response: output[*].content[*].text  ← parse this
NOT chat completions format
```
`source_confidence` and `gaming_detected` are PROMPT-REQUESTED fields, not native API.

---

## 27-ALGO COUNCIL (M3D only — not M2D)
| Bank | IDs |
|------|-----|
| BOOM (A) | NS CI BQ CC WH SA HK GO EF |
| STRAT (B) | 8E VT MS DP WS RV HL AI VK |
| LEGEND (C) | SE IC WN CA TF RT MM OR DV |
SSOT: DOCS/data/council-algos.v1.json

---

## KEY FILE LOCATIONS
```
/Volumes/AI/AI-4D/
  go2d.sh                    M2D launcher

/Volumes/AI/AI-4D/M3D/
  go.sh                      M3D full stack launcher
  ds/grok_pulse.py            Grok Pulse daemon
  ds/ds_app/views.py          Django views
  site/src/pages/MaxCogViz.tsx AI radar + diff sectors
  site/src/pages/Hedge.tsx    PulseFeed
  DOCS/SESSION-STATE.MD       ← this file
  DOCS/chats/TRADE-IDEAS-COM.MD
  DOCS/chats/NEW-DIMENSIONS-TRADING.MD

/Volumes/AI/AI-4D/M2D/
  src/lib/moe.js              MoE gating engine
  src/lib/stores.js           Svelte state
  src/routes/Alpha.svelte     Main alpha dashboard
  src/routes/TradeI.svelte    Movers surge table
  src/routes/SMC.svelte       ICT OB/FVG stub
  CLAUDE.md                   M2D session config
```
