# Changelog — M3D / M2D / M4D tri-site system

Newest first.

## 2026-04-06

- **M3D site port** — Vite dev for `site/` restored to **:5500** (`http://127.0.0.1:5500/`). `goa.sh`: **M3D :5500 · M2D :5555 · M4D :5550**. (`site/vite.config.ts`, `go3d.sh`, `go.sh`, `goa.sh`, `gort.sh`, `go copy.sh`, `go4d.sh`, AGENT briefs.)
- **DS env** — `ds_app/views.py` + `xsocial.py` now load **`M3D/.env.local` then repo `.env.local`** (duplicate keys: root wins). Matches `API_XAI_YODA_KEY` in workspace `.env.local`.
- **Pulse daemon** — `ds/grok_pulse.py` handles empty/non-JSON xAI HTTP bodies; loads `API_XAI_YODA_KEY` from repo `.env.local` or `M3D/.env.local`. `go3d.sh` sources root `.env.local` for pulse. M3D site (Vite) on **:5500**.
- **MRT docs** — added `APPS/MRT-RENTECH-ALIGNMENT.md`: Simons/Medallion alignment audit, current vs target architecture, Kelly/regime guidance, current discovery winners, future candidate families, and AI-swarm research prompts.
- **MRT Signal Discovery Engine (Block II)** — `mrt-processor discover` now runs exhaustive feature family generation (lags, moving-return, vol, z-score + nonlinear transforms), evaluates IS/OOS t-stats against 1-bar forward return, applies Benjamini-Hochberg FDR (`MRT_FDR_ALPHA`, default 0.05), and writes `MRT/data/mrt_discovery.json` with per-symbol winners and q-values. `MRT/gort.sh discover` added.
- **`./gort.sh`** — single entry → `go3d.sh all` with **GORT_MRT=1**: builds/runs **mrt-processor** (best-effort) + **mrt-api :3340** alongside site/api/ds/engine; trap kills MRT on Ctrl+C. **`go3d.sh`** documents MRT port.
- **Dashboard** — “How algos trade and safety” card: 5m cadence, vote=signal vs execution, Kelly (Hedge/DS), `risk_gate` summary, self-tune links (Rank / Weights / MRT).
- **MRT UI (`/mrt`)** — Blueprint monitor: 4-signal radar, IS/OOS table, stats cards, TradingView Lightweight Charts (candles + equity + L/S/flat markers). `GET /v1/mrt/replay` in `mrt-api` (ensemble weights from snapshot IS t-stats). Vite proxy `/mrt-api` → :3340. MaxCogViz links to MRT.
- **MRT (`/MRT`)** — standalone Medallion/RenTech-style signal-library stack: `mrt-processor` (rayon parallel read of `ds/data/futures.db` bars_5m, IS/OOS t-stats vs 1-bar forward return, regime tertile from cross-sectional vol) + `mrt-api` Axum `:3340` (`/health`, `/v1/mrt/snapshot`, `/v1/mrt/futures/symbols`, `/v1/mrt/ds/meta`). Launcher: `MRT/gort.sh` (`process|api|all|build`).
- **AGENT folder rebuilt** — full tri-site onboarding. New: NORTH-STAR.md, SYSTEM-MAP.md, M2D-BRIEF.md, M3D-BRIEF.md, M4D-BRIEF.md, COUNCIL.md, SAFETY.md. README + AWARENESS + AGENTS all rewritten for M3D/M2D/M4D (removed M4D-only references).
- **Rust scanner** — api/src/scanner.rs: 50 USDT pairs, 1m klines, 5 detectors (SURGE/BREAKOUT/MOM/REV/GAP), 60s tokio loop, /ws/scanner WS + /v1/scanner REST. M2D TradeI.svelte switched from Python DS poll to Rust WS.
- **DS fixed** — backtesting, yfinance, ccxt, vectorbt, scipy, statsmodels installed in ds/.venv. pandas-ta removed from requirements.txt (repo deleted, not used in codebase).
- **Crypto DB complete** — BTC/ETH/SOL/BNB/XRP 1m (1.05M each) + 20 symbols 5m (210k each), 2024-04-06→2026-04-06, in ds/data/futures.db. Total 11.9M bars.

## 2026-03-31

- **BOOM backtest visuals + PDF clipsheet (`m4d-ds`)** — added image-based outputs to `/boom-backtest/` (Return vs Win Rate bar/line panel + Risk/Reward scatter) and embedded those visuals into `/boom-backtest.pdf` export. PDF now ships as a study-ready clip sheet (best setup, top configs, averages, visual charts).
- **BOOM realism controls (`m4d-ds/ds_app/boom_backtest.py`)** — added tighter execution realism: spread-based slippage approximation, `finalize_trades=True`, hard stop-loss parameter (`stop_loss_pct`), vote floor (`min_vote`), and optional flat-by-end-of-day behavior (`flat_eod`) for no-overnight mode.
- **Liquid universe scan mode (`/boom-backtest/?scan=1`)** — added multi-symbol yfinance scan presets for liquid names (SPY/QQQ/AAPL/MSFT/NVDA/AMZN/META/TSLA/AMD) plus timeframe/period routing (`tf`, `period`) and EOD flatten toggle (`eod`). UI now shows scan metadata (timeframe, period, symbols) and links to quick presets + matching PDF export query.
- **BOOM backtest: no chart “bubbles” in bench** — squeeze vote circles on LW charts stay a visual; Django backtest entries use only `signal=arrows` (SlingShot) or `signal=darvas`. Bubble confirmation and `bubble` query param removed from `/boom-backtest/` and PDF.

## 2026-03-30

- **MISSION Map Studio (`#flowmaps`)** — added editable React Flow conversion surface for both SVG system maps: `controlroom_review.svg` and `maxjedialpha_iteropt_map.svg`. New page `M4D/src/pages/FlowMapsStudioPage.tsx` parses SVG rect/text blocks into draggable nodes, maps arrow lines into edges, and ships with reset + map switcher; routed via `App.tsx`, `missionNavConfig.ts`, and `MissionHub.tsx`. Added dependency: `@xyflow/react`.
- **Lightweight Charts (BOOM / ES·SPY·EURUSD pane)** — `pwa/src/lib/boomChartBuild.ts` (MISSION `BoomLwChart` imports same module): **line overlays excluded from price autoscale** (`autoscaleInfoProvider` → null) so pan/zoom no longer squashes candles; **session level** drawing simplified (one dashed segment per level vs far/near split); **`lockVisibleTimeRangeOnResize: false`**; **`scaleMargins`** ~3% top/bottom; **`timeScale.rightOffset: 10`** (bar units) so the last bars clear the right price scale. **Pushed to `main`.**
- **MAXJEDIALPHA §8 + tasks:** Progress tracker, shipped vs partial vs future tests, 3-terminal smoke, `curl` probe; `MISSION_CONTROL_RUST_DATAFLOW_TASKS.md` adds **MAXJEDIALPHA verification** checklist. `ALPHA_HUNT` points to §8 for “how we test what’s real.”
- **Docs — AI Alpha Hunt:** `spec-kit/docs/ALPHA_HUNT_INPUTS_AND_LAYERS.md` — REGIME→FLOW→LEGEND→STRAT→BOOM→PORTFOLIO diagram, full 27 ID table, proposed layers backlog (velocity filter, DP/VT gate, MTF, sentiment, DXY, options/RS/events/vol), data sources, what not to add, critique of naive `bankBNet === bankCNet` GO gate. Linked from `CONTEXT.md` and `MAXJEDIALPHA.md`.
- **Docs — MAXJEDIALPHA:** `spec-kit/docs/MAXJEDIALPHA.md` — ASCII layer stack, mermaid traffic-light flow, formulas (conviction, Jedi sum, X-energy, execution weighted blend), constant matrix (what to change together), file map, iter-opt playbook. Linked from `CONTEXT.md` + `LIVE_DATA_ALGOS_VOTES_CHARTS.md`.
- **Jedi alignment constants:** `M4D/src/constants/jediAlignment.ts` — DEAD MARKET if conviction is under **25%**; X-energy bank weights **0.2 / 0.3 / 0.5** (BOOM/STRAT/LEGEND) match `algo-execution` `ALGO_EXEC_BANK_H_*`. `ControlRoomKnights.jsx` PulseHero imports these + direction/GO thresholds.
- **`tools/algo-execution` weighted consensus (default):** Per-bank −1…+1 scores (BOOM/STRAT/LEGEND tiers from `council-algos.v1.json`), tier weights (A=0.8, B=1.2, C=2.0), hierarchy blend (0.2/0.3/0.5), optional JEDI blend, strength bands (0.3/0.6), weak-lane notional scale. Legacy 6/9…15/27 available via `mode: "legacy"` or `ALGO_EXEC_DECISION_MODE=legacy`.
- **`m4d-api` Alpaca → MISSION WS bridge:** `GET /v1/ws/algo` WebSocket fans out `{type:"bar",bar:{…}}` for `useAlgoWS`. Env: `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, optional `M4D_ALPACA_WS_URL` (default Alpaca `v2/test` + `FAKEPACA`). Vite **`/m4d-api`** proxy now sets **`ws: true`**. Doc touch-up: `spec-kit/docs/ALPACA_PAPER_EXECUTION_AND_DATA_WS.md`, `m4d-api/README.md`.
- **Docs — Alpaca paper vs data WebSocket + Rust bridge plan:** `spec-kit/docs/ALPACA_PAPER_EXECUTION_AND_DATA_WS.md` (paper API vs `stream.data` WS, `v2/test` + `FAKEPACA`, subscription limits, target **parallel Rust** fan-in so the browser never holds Alpaca secrets). Linked from `CONTEXT.md`, `LIVE_DATA_ALGOS_VOTES_CHARTS.md`, and Phase 5 note in `MISSION_CONTROL_RUST_DATAFLOW_TASKS.md`.
- **KNIGHTS/WARRIORS split deepened (`M4D/src/`)**:
  - `#warriors` simplified (removed persistent info strip).
  - `#knights` now owns expandable chip-driven intel panel (default collapsed; standard chip click auto-opens).
  - Added full pseudocode feed in KNIGHTS via `M4D/src/data/algoBuildSpecs.ts` (generated from spec prose; runtime code remains outside `spec-kit/`).
  - Added KNIGHTS side satellites around existing PulseHero center orb: **X ORB** (left) + **JEDI ORB** (right), preserving center orb behavior/style.
- **Hash shortcuts for mobile/webview testing**: `#c` → charts, `#w` → warriors.

## 2026-03-29 (h)

- **Removed** **`agent/DAILY_PICKUP.md`** and doc links — simplicity.
- **MISSION MARKETS:** one **combined** Lightweight Charts pane per section (**`MiniLwCombined`**) — SPY+DIA+QQQ, EURUSD, GLD+SLV+BTC, mega caps on shared **% from overlap** scale; removed per-tile **`MiniLwSpark`**.

## 2026-03-29 (f)

- **`agent/AWARENESS.md`** — Awareness atlas: trust order (JSON → CONTEXT → tasks → code), table of surfaces (`MISSION`, `pwa`, `m4d-api`, engine, Django), spec doc index, workflow habits, optional ADR note, **fill-in table for Palantir / external data site** (repo URL, contracts). Read order: after **`AGENTS.md`**, before deep **`CONTEXT.md`**.

## 2026-03-29 (e) — consolidate into `agent/`

- **`agent/`** — Single hub: README, AGENTS, CHANGELOG, `sessions/`, `artifacts/`, **`starter/`** (former **`AUTO/`** contents: `CLAUDE.md`, `START-ENGINE*.md`). Cursor: **`@agent`**. Removed **`AUTO/`** to avoid duplicate trees.
- **Dotfiles dropped in starter:** `.START-ENGINE.md` → **`agent/starter/START-ENGINE.md`** (same body).

## 2026-03-29 (d)

- **`AUTO/`** — Temporary hub merging old AUTO files with assistant README (superseded by **`agent/`** in (e)).

## 2026-03-29 (c)–(a)

- Hub moved from `spec-kit/ai-session/` → `spec-kit/agent/` → repo root `agent/` → briefly `AUTO/`; **final: `agent/`**.

## Earlier 2026-03-29

- **MISSION MARKETS** hub, **bar cache** (`pwa/src/lib/fetchBars.ts`), typings / `pwa/.env.example`.
