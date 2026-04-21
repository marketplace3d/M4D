# System Map — Data Flow + Architecture

## Full Data Flow (ASCII)

```
═══════════════════════════════════════════════════════════════════════
 DATA SOURCES
═══════════════════════════════════════════════════════════════════════

 Binance REST (free)          Databento GLBX.MDP3          Binance WS (free)
 500 USDT OHLCV 5m            ES/NQ/GC/CL/RTY/6E/SI        1m klines real-time
        │                     2yr historical                       │
        │                            │                             │
        ▼                            ▼                             ▼
 ┌─────────────────┐    ┌───────────────────────┐    ┌────────────────────┐
 │  M3D ENGINE     │    │  ds/data/futures.db   │    │  M3D API scanner   │
 │  Rust 5m loop  │    │  SQLite 1.24GB         │    │  api/src/scanner.rs│
 │  500 assets     │    │  11.9M bars            │    │  50 USDT, 60s      │
 │  27 algos       │    │  bars_1m + bars_5m     │    │  5 alert types     │
 └────────┬────────┘    └───────────┬───────────┘    └────────┬───────────┘
          │                         │                          │
          ▼                         │                          ▼
 engine/data/algo_day.json          │                  /ws/scanner (WS push)
 engine/data/algo_state.db          │                  /v1/scanner (REST)
          │                         │                          │
          ▼                         ▼                          │
 ┌─────────────────────────────────────────────────────────────────────┐
 │                     M3D RUST API  :3300                             │
 │                                                                     │
 │  /v1/council      CouncilSnapshot (regime, JEDI, 27 votes)         │
 │  /v1/algo-day     AlgoDaySnapshot (per-asset scores)               │
 │  /v1/assets       500 asset summaries                              │
 │  /ws/algo         WS push (30s or on reload)                       │
 │  /ws/scanner      WS push (60s, SURGE/BREAKOUT/MOM/REV/GAP)        │
 └──────────────────────────────┬──────────────────────────────────────┘
                                │
          ┌─────────────────────┼──────────────────────┐
          ▼                     ▼                       ▼
 ┌────────────────┐   ┌─────────────────┐   ┌─────────────────────┐
 │  M3D SITE      │   │  M2D (Svelte)   │   │  M4D SITE (React)   │
 │  M3D :5500     │   │  :5555          │   │  :5550              │
 │                │   │                 │   │                     │
 │ Dashboard      │   │ Alpha page      │   │ MaxCogViz radar     │
 │ Trader         │   │ TradeI (WS)     │   │ Grok pulse feed     │
 │ Backtest       │   │ Risk Gate UI    │   │ HALO entry          │
 │ Rank/Sharpe    │   │ Backtest        │   │ Flatten controls    │
 │ Hedge/Legend   │   │ XSocial         │   │ WARRIORS / KNIGHTS  │
 │ MaxCogViz      │   │                 │   │ PulseHero orb       │
 │ AlgoWeights    │   │                 │   │                     │
 └────────┬───────┘   └────────┬────────┘   └──────────┬──────────┘
          │                    │                        │
          └────────────────────┴────────────────────────┘
                                │
                                ▼
 ┌───────────────────────────────────────────────────────────────────┐
 │                    DJANGO DS  :8800                               │
 │                                                                   │
 │  27 algo council         /v1/rank/          /v1/backtest/         │
 │  vectorbt optimizer      /v1/optimize/      /v1/signals/          │
 │  Legend scanner          /v1/legend/        /v1/mtf/              │
 │  Risk Gate               /v1/risk/gate/     /v1/stat-arb/         │
 │  Grok Pulse daemon       /v1/ai/maxcogviz/  /v1/ai/pulse/         │
 │  Funding arb             /v1/funding/       /v1/bars/             │
 └───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                     xAI Grok API (real-time X + web)
                     [pending] Anthropic Claude API
                     [pending] Google Gemini API
```

---

## JEDI Score Flow

```
 27 algo votes (each: −1, 0, +1)
         │
         ▼
 JEDI = Σ(votes) / 27        range: −1.0 to +1.0
 Raw JEDI = Σ(votes)         range: −27 to +27

 Regime thresholds:
   JEDI_norm > 20   →  BULL
   JEDI_norm < −20  →  BEAR
   |JEDI_norm| ≤ 20 →  NEUTRAL
   conviction < 25% →  DEAD MARKET (do not trade)
```

---

## MoE Expert Weighting Flow

```
 5 Experts (Mixture of Experts):
   VECTOR     — price action / trend signal
   VOLATILITY — vol regime score
   GHOST      — Order Block + FVG [PENDING]
   ARB        — stat arb z-score [PENDING]
   PULSE      — Grok news catalyst (urgency + confidence)

 Each expert → alpha score (0..1) + confidence
         │
         ▼
 Gate weights (regime-dependent):
   BULL:    VECTOR 0.35, VOLATILITY 0.20, GHOST 0.20, ARB 0.15, PULSE 0.10
   BEAR:    VECTOR 0.20, VOLATILITY 0.30, GHOST 0.15, ARB 0.15, PULSE 0.20
   NEUTRAL: equal weights

 gated_alpha = Σ(expert_alpha × weight) × confidence_discount
```

---

## Risk Gate Flow (pre-trade)

```
 Trade signal arrives
         │
         ▼
 ┌────────────────────────────────┐
 │  1. DAILY_HALT check           │  portfolio drawdown > −2% → HALT ALL
 │  2. ALPHA_WEAK check           │  alpha < 0.40 OR confidence < 0.50 → REJECT
 │  3. POD_KILL check             │  expert drawdown > −3% → kill that pod
 │  4. CONCENTRATION check        │  position > 5% of portfolio → REJECT
 │  5. CORRELATION check          │  > 5 correlated longs open → FLAGGED
 │  6. VOL_FILTER check           │  asset vol too high for regime → FLAGGED
 └────────────────────────────────┘
         │
         ▼
 APPROVED → sized trade (conviction-scaled)
 FLAGGED  → show to human, await override
 REJECTED → blocked, reason logged
```

---

## Scanner Architecture (Rust, real threads)

```
 Binance REST 1m klines (50 USDT pairs)
         │
         ▼
 api/src/scanner.rs
   ├── tokio::spawn per 10-symbol chunk
   ├── 21-bar window per symbol
   └── 5 detectors per bar:
       SURGE    → rel_vol > 2.5x avg
       BREAKOUT → close > 20-bar high (or < low)
       MOMENTUM → 3 consecutive higher closes
       REVERSAL → RSI14 < 28 (OS) or > 72 (OB)
       GAP      → open vs prev_close > 1%
         │
         ▼
 ScannerState { alerts: Vec<ScannerAlert>, last_scan, symbols_scanned }
   broadcast → /ws/scanner (push every 60s)
   REST      → GET /v1/scanner (snapshot)
         │
         ▼
 M2D TradeI.svelte
   WebSocket → live alerts table
   Tab badges → count per type
   Score bar  → 0..100 Rust-computed
```

---

## MaxCogViz — 12 Cognitive Dimensions

```tsx
// TSX snippet: the 12 dimensions sent to Grok for oracle scoring
const DIMENSIONS = [
  "momentum",        // price velocity and direction
  "volatility",      // regime vol level and character
  "trend_strength",  // EMA alignment, ADX proxy
  "volume_pressure", // vol surge relative to average
  "sentiment",       // Grok X/Twitter real-time pulse
  "macro_risk",      // DXY, rates, macro prints
  "catalyst_energy", // live news catalyst urgency
  "liquidity",       // bid/ask depth proxy
  "correlation_risk",// inter-asset correlation load
  "mean_reversion",  // RSI + BB distance
  "regime_alignment",// algo council direction consensus
  "conviction",      // expert swarm agreement score
]
// Each scored 0-100 by Grok. Rendered as SVG radar.
// Ground slope = Σ(bullish dims) - Σ(bearish dims)
```

---

## Critical Component: JEDI Orb (TSX concept)

```tsx
// PulseHero orb — visual metaphor for council alignment
// Color: green (BULL) / red (BEAR) / amber (NEUTRAL) / grey (DEAD)
// Pulse animation speed ∝ |JEDI score|
// Satellite orbs: X ORB (left, Grok pulse) + JEDI ORB (right, score)

const orbColor = {
  BULL:    '#00d26a',
  BEAR:    '#ff3b3b',
  NEUTRAL: '#f5a623',
  DEAD:    '#4a5568',
}

const pulseSpeed = (jediNorm: number) =>
  `${Math.max(0.5, 3.0 - Math.abs(jediNorm) / 20)}s`

// Orb renders as SVG radial gradient + CSS keyframe pulse
// Strength ring = |jediNorm| / 27 → ring width 2px to 12px
```

---

## Data Contract — ScannerAlert (Rust → TypeScript)

```typescript
interface ScannerAlert {
  symbol: string        // "BTC" (USDT already stripped)
  market: "crypto" | "stock"
  alert_type: "SURGE" | "BREAKOUT" | "MOMENTUM" | "REVERSAL" | "GAP"
  direction: "LONG" | "SHORT"
  price: number
  change_pct: number    // % from prev close
  rel_vol: number       // current_vol / avg_vol (1.0 = average)
  score: number         // 0..100 (Rust computed, sort key)
  detail: string        // human readable: "3.2x avg vol"
  ts: number            // unix seconds
}

interface ScannerState {
  alerts: ScannerAlert[]
  last_scan: number     // unix seconds
  symbols_scanned: number
  error: string | null
}
```

---

## ReactFlow System Map (nodes for FlowMaps page)

```
Suggested nodes for ReactFlow / XYFlow visualization:

[Binance] → [M3D Engine] → [algo_day.json] → [M3D API :3300]
[Databento] → [futures.db] → [M3D DS :8800]
[Binance WS] → [Rust Scanner] → [/ws/scanner]
[M3D API] → [M3D site :5500]
[M3D API] → [M2D :5555]
[M3D API] → [M4D :5550]
[M3D DS] → [M3D Site]
[M3D DS] → [M2D]
[M3D DS] → [M4D]
[xAI Grok] → [M3D DS] → [MaxCogViz]
[Risk Gate] → [Trade Approval] → [HALO Entry]
[HALO Entry] → [Alpaca live (pending)]
```

---

## Related architecture diagrams

| Diagram | Path |
|---------|------|
| **This file (ASCII)** | [SYSTEM-MAP.md](SYSTEM-MAP.md) — operational data flow, ports, scanner, ReactFlow hints |
| **M4D alpha poster (metrics baked in)** | [SYSTEM-MAP.svg](SYSTEM-MAP.svg) — research snapshot; pair with [SYSTEM-SPEC.md](SYSTEM-SPEC.md) for numbers |
| **Governance / M3D→M4D→W4D layers** | [../APP-DOC/I-OPT-OOO/assets/iopt_ooo_system_layers.svg](../APP-DOC/I-OPT-OOO/assets/iopt_ooo_system_layers.svg) — institutional readiness, not backtest Sharpe |
| **BOOM Jedi council (build process)** | [AI-IN/boom_jedi_architecture.svg](AI-IN/boom_jedi_architecture.svg) · spec [AI-IN/ALGO-BUILD-PROCESS.TXT](AI-IN/ALGO-BUILD-PROCESS.TXT) |
| **Scale readiness (gaps, KPIs, runbook)** | [../APP-DOC/I-OPT-OOO/I-OPT-OOO-MASTER.MD](../APP-DOC/I-OPT-OOO/I-OPT-OOO-MASTER.MD) · [OPERATOR-RUNBOOK.MD](../APP-DOC/I-OPT-OOO/OPERATOR-RUNBOOK.MD) |
