# Awareness Atlas — Where Everything Lives

Read after `README.md`. Full index in one pass.

---

## Trust Hierarchy (highest first)

1. `DOCS/DATA-SOURCES.md` — data contracts, costs, API limits
2. `api/src/models.rs` — data shapes served to frontends (Rust source of truth)
3. `site/src/types/index.ts` — M3D frontend TypeScript types
4. `AGENT/COUNCIL.md` — 27 algo definitions (human-readable SSOT)
5. `M4D-REF-TEMP/DOCS/data/council-algos.v1.json` — machine SSOT for algo IDs/banks
6. Code — if it disagrees with the above, fix the code and update the spec

**Do not derive algo logic from UI code.** Always trace back to COUNCIL.md or council-algos.v1.json.

---

## Repository Layout

```
M3D/                          ← workspace root
├── AGENT/                    ← you are here — AI builder hub
├── CLAUDE.md                 ← project-level AI constraints (read every session)
├── Cargo.toml                ← workspace: ["api", "engine"] only
│
├── api/                      ← Rust Axum :3300
│   └── src/
│       ├── main.rs           ← routes, WS, background tasks
│       ├── scanner.rs        ← Rust real-time scanner (50 USDT, 60s, real threads)
│       ├── routes/           ← council, algo_day, assets, backtest, scanner, health
│       ├── ws/               ← algo.rs (council WS), scanner.rs (scanner WS)
│       └── state.rs          ← AppState: council, algo_day, scanner, broadcast channels
│
├── engine/                   ← Rust 500-asset processor (5m loop)
│   └── src/
│       ├── fetcher.rs        ← Binance public klines REST
│       ├── processor.rs      ← Indicators (EMA, MACD, BB, RSI, ATR, VolMA)
│       ├── algos/mod.rs      ← all 27 algo votes inline
│       └── store.rs          ← SQLite output
│
├── site/                     ← M3D React (Blueprint) :5500 — `/` dashboard; `/mrt` RenTech lab
│   └── src/
│       ├── pages/            ← Dashboard, Trader, AutoTrader, Backtest, LegendScanner,
│       │                        Rank, Sharpe, Hedge, MaxCogViz, AlgoWeights, TradeI
│       ├── components/       ← PulseHero, CouncilMatrix, LiveChart, OrderPanel...
│       ├── api/              ← TanStack Query hooks → :3300 / :8800
│       └── types/index.ts    ← TypeScript interfaces (trust these)
│
├── ds/                       ← Python Django DS :8800
│   ├── .venv/                ← python3.11 venv (NOT venv/, NOT conda)
│   ├── ds_app/
│   │   ├── algos_crypto.py   ← 27 algo implementations (pandas, numpy)
│   │   ├── backtest.py       ← backtesting.py engine wrapper
│   │   ├── optimizer.py      ← vectorbt grid search + IS/OOS
│   │   ├── signals.py        ← signal generation (numpy/pandas only — no pandas-ta)
│   │   ├── legend_algos.py   ← 9 legendary trader scanning methods
│   │   ├── mtf.py            ← multi-timeframe EMA+RSI scoring
│   │   ├── risk_gate.py      ← 6 pre-trade checks → APPROVED/FLAGGED/REJECTED
│   │   ├── scanner.py        ← Python scanner (crypto fallback, Alpaca disabled)
│   │   ├── stat_arb.py       ← z-score pairs, half-life, cointegration
│   │   ├── funding.py        ← Binance perpetual funding rate arb
│   │   ├── views.py          ← all Django views (loads .env.local at import)
│   │   └── urls.py           ← all URL patterns
│   ├── data/
│   │   └── futures.db        ← 1.24GB SQLite, 11.9M bars (Databento + Binance)
│   └── grok_pulse.py         ← 60s Grok poll daemon, gaming filter, macOS notify
│
├── M2D/                      ← Svelte 4 + Tailwind :5555
│   └── src/
│       ├── routes/           ← Dashboard, Alpha, TradeI, XSocial, Backtest, Rank
│       └── lib/api.js        ← all fetch/post helpers
│
├── m4d-api/                  ← M4D Rust API :3330 (INDEPENDENT — not in Cargo workspace)
├── m4d-engine/               ← M4D Rust engine (INDEPENDENT)
├── m4d-ds/                   ← M4D Django :8050 (miniconda)
├── M4D-REF-TEMP/             ← Reference only. DO NOT DELETE.
│
├── engine/data/
│   ├── algo_day.json         ← live snapshot (written by engine, read by API)
│   └── algo_state.db         ← SQLite history
│
├── .env.local                ← ALL API keys (never commit)
├── go.sh / go3d.sh           ← M3D launcher
├── go4d.sh                   ← M4D launcher (cd into crate dirs, NOT -p)
├── goa.sh                    ← all 3 sites launcher
└── DOCS/                     ← DATA-SOURCES.md, chat logs, specs
```

---

## Ports

| Site | Port | Stack |
|------|------|-------|
| M3D site (`site/`) | :5500 | React 18 + Vite + Blueprint — dashboard `/`; RenTech `/mrt` |
| M3D API | :3300 | Rust Axum |
| M3D DS | :8800 | Python Django (ds/.venv) |
| M2D | :5555 | Svelte 4 + Tailwind |
| M4D site | :5550 | React (rich, 4K visual) |
| M4D API | :3330 | Rust Axum (independent crate) |
| M4D DS | :8050 | Python Django (miniconda) |

---

## API Endpoints — M3D Rust (:3300)

```
GET  /health           → { status, version }
GET  /v1/council       → CouncilSnapshot (jedi_score, regime, 27 votes)
GET  /v1/algo-day      → AlgoDaySnapshot (per-asset scores)
GET  /v1/assets        → Vec<AssetSummary> (500 tracked)
GET  /v1/votes         → Vec<VoteRecord> (by algo_id)
GET  /v1/scanner       → ScannerState (flat alerts[], last_scan, symbols_scanned)
POST /v1/reload        → trigger disk reload
WS   /ws/algo          → CouncilUpdate push (30s or on change)
WS   /ws/scanner       → ScannerAlert[] push (every 60s, Rust real threads)
```

## API Endpoints — Django DS (:8800)

```
GET  /v1/algos/              27 algo definitions
GET  /v1/backtest/           backtesting.py per-trade detail
POST /v1/backtest/run/       run backtest
GET  /v1/optimize/           vectorbt grid search
GET  /v1/rank/               27×N algo×asset ranker
GET  /v1/signals/            signal generation
GET  /v1/legend/scan/        40-stock legendary scanner
GET  /v1/legend/<sym>/       per-symbol legend signal
GET  /v1/mtf/<sym>/          multi-timeframe scoring
GET  /v1/jedi/               JEDI composite
GET  /v1/risk/gate/          Risk Gate status
POST /v1/risk/gate/          run gate on signals
GET  /v1/scanner/            Python scanner (crypto only)
GET  /v1/funding/            Binance funding arb rates
GET  /v1/stat-arb/           stat arb pairs
GET  /v1/bars/symbols/       futures.db symbol list
GET  /v1/bars/query/         query bars from futures.db
GET  /v1/ai/maxcogviz/       12-dim oracle radar (Grok+Claude+Gemini)
GET  /v1/ai/maxcogviz/history/
GET  /v1/ai/pulse/           latest Grok triggers
POST /v1/ai/pulse/run/       on-demand pulse run
GET  /v1/ai/advice/ /yoda/ /sitrep/  AI endpoints
```

---

## Data Sources

| Source | Data | Cost | Status |
|--------|------|------|--------|
| Binance REST | 500 crypto OHLCV, 5m | Free | ✓ live |
| Binance WS | 1m klines (scanner) | Free | ✓ Rust scanner |
| Databento GLBX.MDP3 | ES/NQ/GC/CL/RTY/6E/SI 1m futures | Pay-per-use ~$0.10/sym/30d | ✓ 2yr downloaded |
| Binance history | BTC/ETH/SOL/BNB/XRP 1m + 20sym 5m | Free | ✓ 2yr downloaded |
| xAI Grok | Real-time X + web search | API key | ✓ grok-4.20-reasoning |
| Massive (Polygon.io) | Currencies Starter $49/mo | $49/mo | ⬜ sign up needed |
| Alpaca | US stocks IEX WS real-tick | $1 deposit | ⬜ fund live account |
| Anthropic Claude | Multi-model MaxCogViz | API key missing | ⬜ need key |
| Google Gemini | Multi-model MaxCogViz | API key missing | ⬜ need key |

---

## Critical Gotchas (do not re-learn these)

1. **M4D Rust crates NOT in Cargo workspace** — rusqlite version conflict. Use `cd m4d-api && cargo run`, never `cargo run -p m4d-api`.
2. **pandas-ta is dead** — repo deleted from GitHub, not on PyPI. NOT used anywhere in the codebase. Removed from requirements.txt.
3. **Svelte class: slash syntax broken** — `class:bg-green-950/15={cond}` fails at parse. Use inline ternary: `class="{cond ? 'bg-green-950/15' : ''}"`.
4. **Databento fixed-point prices** — `f/1e9 if f>1_000_000 else f`. Use yesterday as end date.
5. **Alpaca paper key 401 on data** — paper account has no market data subscription. Stocks scanner disabled until live account funded.
6. **xAI Grok API** — uses `/v1/responses` endpoint with `input` field, NOT `/v1/chat/completions`.
7. **DS venv is at `ds/.venv`** — not `venv/`, not conda. python3.11.
8. **backtesting, yfinance, ccxt, vectorbt** — must be in ds/.venv. Missing = Rank/Legend/Optimize all fail with "No module named" error.
9. **JEDI score** — −27 to +27 continuous, NOT binary. Read like a speedometer.
10. **M2D WS proxy** — vite.config.js proxies `/ws/*` → `ws://localhost:3030` (check: should be 3300 for M3D API).
