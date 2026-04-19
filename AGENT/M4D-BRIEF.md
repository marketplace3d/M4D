# M4D — Human Oracle Interface · Brief

**:5550 · React (rich, 4K visual) · M4D-REF-TEMP reference**

## Role in the System

M4D is the **human-facing oracle**. It takes the science from M3D's 27-algo council and the alpha from M2D's expert swarm, and presents it as intelligence the trader can act on immediately.

M4D answers 5 questions without the trader needing to dig:
1. **What is the market doing right now?** (regime + energy)
2. **What should I do?** (top 3 signals, direction, size)
3. **Why?** (which algos, which experts, what catalyst)
4. **What's the dissenting view?** (GHOST / BEAR HAWK perspective)
5. **When do I flatten everything?** (flatten triggers, circuit breakers)

---

## Key Features

### MaxCogViz — 12-Dimensional Oracle Radar
- 12 cognitive dimensions scored 0-100 by Grok (live X + web search)
- SVG radar chart rendered in React
- Ground slope = net bullish/bearish tilt across all dims
- Trade ideas, outlook, unknown unknowns from Grok
- History: `/v1/ai/maxcogviz/history/` (last 24 sessions)
- Multi-model: Grok (live) + [pending] Claude + Gemini adversarial

The 12 dimensions:
```
momentum · volatility · trend_strength · volume_pressure · sentiment
macro_risk · catalyst_energy · liquidity · correlation_risk
mean_reversion · regime_alignment · conviction
```

### Grok Pulse Feed
- 60s daemon (grok_pulse.py) polls xAI for market-moving events
- Gaming filter removes noise / coordinated social manipulation
- Trigger schema: ticker, direction, urgency (NOW/5MIN/1HR/EOD), confidence
- Pushed to frontend via `/v1/ai/pulse/`

### HALO Entry Scheduler
- Click signal → spread entry over N minutes (LCG distribution)
- Prevents market impact on entries
- Entry window: 1–30 minutes configurable
- Feeds to: [pending] Alpaca live execution

### Flatten Controls
- DAILY_HALT banner on portfolio drawdown > −2%
- POD KILL per-expert allocation shutdown
- CORRELATION unwind (flatten correlated longs)
- One-click full flatten → Alpaca close all [pending]

### PulseHero Orb
- Central visual: color + pulse speed reflects JEDI score
- BULL: green glow · BEAR: red pulse · NEUTRAL: amber · DEAD: grey/static
- X ORB (left satellite): Grok pulse activity
- JEDI ORB (right satellite): numeric score + strength ring

### WARRIORS / KNIGHTS
- `#warriors`: simplified signal strip (no persistent info)
- `#knights`: expandable intel panel, algo build specs, chip-driven

---

## Stack

```
M4D Site: /Volumes/AI/AI-4D/M3D/m4d-ds/ or M4D-REF-TEMP
  React + Vite
  Tailwind (NOT Blueprint — M4D has its own visual language)
  @xyflow/react (ReactFlow for FlowMaps Studio)
  Lightweight Charts (BOOM charts in pwa/)

M4D API: m4d-api/ — Rust Axum :3330 (independent Cargo crate)
M4D DS: m4d-ds/ — Django :8050 (miniconda Python)

IMPORTANT: m4d-api and m4d-engine are NOT in the Cargo workspace.
Launch: cd m4d-api && cargo run  (not cargo run -p m4d-api)
```

---

## Data Flow (M4D specific)

```
M3D Engine → algo_day.json → M3D API :3300
                                    │
                              M4D site proxies
                              /m4d-api → :3330
                              or reads :3300 directly

xAI Grok API → M3D DS :8800 → /v1/ai/maxcogviz/ → M4D MaxCogViz page
                             → /v1/ai/pulse/      → M4D PulseHero
```

---

## Visual Design Language

- Dark theme — NOT Blueprint. Rich gradients, glows, 4K-optimized.
- Orb metaphor: radial gradients, CSS keyframe pulses
- Bank colors: BOOM (amber) · STRAT (cyan) · LEGEND (purple)
- Energy levels: conviction rings, strength bars, glow intensity
- Terrain metaphor: ground slope for market tilt direction

---

## Pending / Next for M4D

1. **ANTHROPIC_API_KEY** — add to .env.local → enable Claude as 2nd MaxCogViz model
2. **GOOGLE_GEMINI_KEY** — add to .env.local → Gemini as 3rd adversarial model
3. **Expert Adversarial Swarm** in MaxCogViz:
   - BULL HAWK: long case
   - BEAR HAWK: short/hedge case
   - MACRO WATCHER: Fed/rates/DXY
   - QUANT: pure technical
   - DEVIL'S ADVOCATE: destroys consensus
4. **Alpaca live execution** — fund $1 → HALO → real fills
5. **HALO → Alpaca wiring** — entry_window_min LCG spread → Alpaca POST /orders
6. **Flatten button** → Alpaca POST /positions/{sym} DELETE
7. **FlowMaps Studio** (partially built in M4D) — ReactFlow system map interactive editor
