# M3D — Clean Fintech Trading Platform

## START HERE
This is a clean rebuild using **Palantir Blueprint React** for the UI.
Reference source: `M4D-REF-TEMP/` (do not delete; used for algo logic reference).

### Naming (avoid confusion)
- **M3D site** — React app in **`site/`** (Blueprint), Vite dev **:5500** (`http://127.0.0.1:5500/`). Dashboard home = **`/`**; RenTech / MRT lab = **`/mrt`**.
- **M3D stack** — Workspace + Rust `api`/`engine`, `ds/`, launchers (`go3d.sh`, `goa.sh`, …).

## STACK
| Layer | Tech | Port |
|-------|------|------|
| M3D site | React 18 + Vite + Blueprint (`site/`) | :5500 (dev) |
| API | Rust Axum | :3030 |
| Engine | Rust (500-asset processor, 5m loop) | — |
| DS | Python Django | :8000 |

## LAUNCH
```bash
./go.sh          # all services
./go.sh site     # frontend only
./go.sh api      # rust api only
./go.sh ds       # django only
./go.sh engine   # rust engine only
./go.sh build    # production build
```

## DIRECTORY LAYOUT
```
M3D/
├── site/          React + Blueprint frontend
│   └── src/
│       ├── pages/         Dashboard, Trader, AutoTrader, Backtest, DataLab
│       ├── pages/mobile/  MobileDashboard, MobileTrader, MobileBacktest
│       ├── components/    PulseHero, CouncilMatrix, LiveChart, OrderPanel...
│       ├── api/           TanStack Query hooks → :3030
│       ├── hooks/         useWebSocket, useMediaQuery
│       └── types/         TypeScript interfaces
├── api/           Rust Axum :3030
│   └── src/
│       ├── routes/        council, algo_day, assets, backtest, health
│       ├── ws/            WebSocket /ws/algo
│       └── state.rs       AppState (reads engine/data/algo_day.json)
├── engine/        Rust 500-asset processor
│   └── src/
│       ├── fetcher.rs     Binance public OHLCV
│       ├── processor.rs   Algo scoring (TREND/MOM/VOL/ATR_BREAK/COMPOSITE)
│       └── store.rs       SQLite output
├── ds/            Python Django :8000
│   └── ds_app/
│       ├── backtest.py    backtesting.py engine
│       ├── signals.py     signal generation (pandas-ta)
│       ├── optimizer.py   grid-search optimizer
│       └── data_fetch.py  yfinance + ccxt
├── Cargo.toml     Rust workspace (api + engine)
├── go.sh          Dev launcher
└── CLAUDE.md      ← you are here
```

## KEY DATA FLOW
```
Binance API → engine (every 5m) → engine/data/algo_day.json
                                          ↓
                              api reads + serves /v1/*
                                          ↓
                              site polls /v1/council, /v1/algo-day
                                          ↓
                              Blueprint UI renders PulseHero + CouncilMatrix
```

## THE 27 ALGOS (SSOT: M4D-REF-TEMP/spec-kit/data/council-algos.v1.json)
| Bank | IDs | Theme |
|------|-----|-------|
| BOOM (A) | NS CI BQ CC WH SA HK GO EF | Entry precision |
| STRAT (B) | 8E VT MS DP WS RV HL AI VK | Structure |
| LEGEND (C) | SE IC WN CA TF RT MM OR DV | Swing/1-6M |
| META | JEDI | Sum of all 27 |

## MOBILE STRATEGY
Blueprint is NOT mobile-first. Mobile handled by:
1. `/m/` route prefix → mobile page variants
2. `useMediaQuery('(max-width: 768px)')` hook for adaptive components
3. Fixed bottom tab bar (5 tabs) instead of sidebar nav
4. Vertical flex column layout instead of grid
5. Min 44px touch targets via `.mobile-touch` CSS class

## TRUST ORDER (for AI iterations)
1. `spec-kit/data/council-algos.v1.json` — algo SSOT
2. `api/src/models.rs` — data contracts
3. `site/src/types/index.ts` — frontend types
4. Everything else derives from above

## BUILD ARTIFACTS
- `site/dist/` → served by API at `/` (production)
- `engine/data/algo_day.json` → live algo snapshot
- `engine/data/algo_state.db` → SQLite history
- `ds/data/ds.db` → Django SQLite

## API ENDPOINTS
```
GET  /health                → { status, version }
GET  /v1/council            → CouncilSnapshot (jedi_score, regime, 27 votes)
GET  /v1/algo-day           → AlgoDaySnapshot (per-asset scores)
GET  /v1/assets             → Vec<AssetSummary> (500 tracked)
GET  /v1/votes?algo_id=XX   → Vec<VoteRecord>
GET  /v1/backtest?...       → BacktestResult (proxied to DS)
POST /v1/reload             → triggers engine run
WS   /ws/algo               → live CouncilUpdate stream

# Django DS (direct or via API proxy)
GET  /v1/audit/order-intent/?broker=all|alpaca|ibkr&limit=50&cycle_id=…  → DS (Rust api proxies; set M3D_DS_BASE if not http://127.0.0.1:8000)
GET  /v1/backtest/?asset=X&algo=Y&from=Z&to=W
POST /v1/backtest/run/
GET  /v1/signals/?asset=X
GET  /v1/assets/screen/
```
