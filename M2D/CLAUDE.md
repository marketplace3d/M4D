# M2D — Lean Trader Data Machine

## PURPOSE
M2D is the execution-grade trading UI. Lean, fast, dark. No Blueprint.
M3D = algo science (keep it). M4D = 4K visual polish (future). M2D = execution now.

## STACK
| Layer | Tech | Port |
|-------|------|------|
| Frontend | Svelte 4 + Tailwind CSS 3 | :5555 (dev) |
| Backend (shared) | M3D Rust Axum API | :3030 |
| DS (shared) | M3D Django DS | :8000 |

## LAUNCH
```bash
cd /Volumes/AI/AI-4D/M2D
npm run dev      # Svelte dev server :5555
# Backend = ./go.sh from M3D
```

## DIRECTORY
```
M2D/
├── src/
│   ├── routes/
│   │   ├── Dashboard.svelte    JEDI gauge, regime, bank votes, top movers
│   │   ├── Signals.svelte      Holly-style surge scanner (Trade-Ideas equiv)
│   │   ├── TradeI.svelte       500-asset JEDI table, bank vote breakdown
│   │   ├── MaxCogViz.svelte    AI cognitive radar (Grok+Claude+Gemini)
│   │   └── Pulse.svelte        Grok news trigger feed
│   ├── lib/
│   │   ├── api.js              fetch wrappers → /api (:3030) and /ds (:8000)
│   │   ├── ws.js               WebSocket /ws/algo auto-reconnect store
│   │   └── stores.js           Svelte writable/derived stores
│   ├── App.svelte              Layout + nav + data bootstrap
│   ├── app.css                 Tailwind + M2D component classes
│   └── main.js                 Entry point
├── vite.config.js              Proxy /api→:3030, /ds→:8000, /ws→ws:3030
├── tailwind.config.js          navy-950/900/800/700/600/500 palette
└── CLAUDE.md                   ← you are here
```

## VITE PROXY (dev)
- `/api/*` → `http://localhost:3030` (strips /api prefix)
- `/ds/*`  → `http://localhost:8000` (strips /ds prefix)
- `/ws/*`  → `ws://localhost:3030` (WebSocket passthrough)

## DESIGN RULES
- Dark navy: bg-navy-950 body, bg-navy-800 cards, border-navy-700
- Monospace font: JetBrains Mono
- Signal colors: green-400=LONG, red-400=SHORT, slate-500=FLAT
- Cyan glow: text-cyan-400 with glow CSS for headers
- No emoji in UI. No Blueprint. No TanStack Query.

## PAGES
| Page | Route key | Data source |
|------|-----------|-------------|
| Dashboard | dashboard | WS /ws/algo + /api/v1/council + /api/v1/assets |
| Signals | signals | /ds/v1/algo/holly/ (Holly scanner — needs wiring) |
| TradeI | tradei | /api/v1/algo-day or /api/v1/assets |
| MaxCogViz | maxcogviz | /ds/v1/ai/maxcogviz/ (POST) |
| Pulse | pulse | /ds/v1/ai/pulse/ (GET, 30s poll) |

## TODO — PENDING BACKEND WIRING
1. `/ds/v1/algo/holly/` — Holly scanner endpoint in Django DS
   - Returns: `{ top_algos: [{algo, expectancy, win_rate, trades}], signals: {algo_name: [rows]} }`
   - Reference: DOCS/chats/TRADE-IDEAS-COM.MD for full Holly algorithm

2. `/ds/v1/ai/maxcogviz/` — already exists in M3D DS, reuse

3. Market Energy gate in engine: `(volume/vol_ma20) * (atr/close)` — surface in TradeI

## TRUST ORDER
1. M3D api/src/models.rs — data shapes
2. M3D site/src/types/index.ts — TS reference
3. M2D lib/stores.js — Svelte state
