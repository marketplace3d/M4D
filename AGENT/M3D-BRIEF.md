# M3D — Algo Science Layer · Brief

**:5500 · React 18 + Vite + Palantir Blueprint dark**

**Naming:** The React app in **`site/`** is the **M3D site** (Vite **:5500**). **`/`** = council **Dashboard**; **`/mrt`** = RenTech / MRT lab. **M3D** in this doc also means the engine/API/DS stack behind the science layer.

## Role in the System

M3D is the **competing algo council machine**. It runs and presents the science behind every trade signal. The council of 27 algos competes continuously — the winners with best IS/OOS Sharpe get higher MoE weights.

M3D can operate standalone. The DS and API layers are the engine. The **site** on **:5500** is the cockpit—**`/`** = dashboard; **`/mrt`** = RenTech page. **`/legacy27`** redirects to **`/`** (bookmarks).

---

## The Council — 27 Algos, 3 Banks

```
Bank A — BOOM (Entry precision):
  NS  Night Shift      CI  Channel Impulse    BQ  Breakout Qualifier
  CC  Candle Confirm   WH  Wyckoff Hook       SA  Support Attack
  HK  Hook Knife       GO  Gap & Go           EF  EMA Fan

Bank B — STRAT (Structure / trend):
  8E  8 EMA            VT  Velocity Trend     MS  Momentum Squeeze
  DP  Dual Pullback    WS  Wave Structure     RV  Range Vault
  HL  Higher Low       AI  ATR Impulse        VK  Volume Kickstart

Bank C — LEGEND (Swing / 1-6M):
  SE  Sector Emerge    IC  Institutional Cluster  WN  Wyckoff Nudge
  CA  Candle Anatomy   TF  Time Fractal       RT  Relative Thrust
  MM  Market Maker     OR  Opening Range      DV  Divergence Vote

JEDI: sum of all 27 votes, range −27 to +27
```

Every algo outputs: vote (−1, 0, +1) + strength (0..1) per asset per 5m bar.

---

## Pages

| Route | Name | Purpose |
|-------|------|---------|
| `/` | Dashboard | JEDI council speedometer, regime, top movers (default home) |
| `/mrt` | MRTMonitor | RenTech-style MRT lab |
| `/rentech` | MRTMonitor | Same as `/mrt` |
| `/legacy27` | — | Redirects to `/` |
| `/trader` | Trader | Per-asset signal breakdown |
| `/autotrader` | AutoTrader | Auto execution controls (WIP) |
| `/backtest` | Backtest | backtesting.py per-trade detail |
| `/legends` | LegendScanner | 9 legendary methods × 40 stocks |
| `/rank` | Rank | 27 × N algo×asset Sharpe leaderboard |
| `/sharpe` | Sharpe | Sharpe table visualization |
| `/hedge` | Hedge | WIZZO AI cockpit, SURGERS, SEAL TEAM 6, HALO |
| `/maxcogviz` | MaxCogViz | 12-dim Grok oracle radar |
| `/weights` | AlgoWeights | MoE weight bars, regime×bank matrix |
| `/tradei` | TradeI | Scanner (now duplicated — primary is M2D) |

---

## Architecture

```
M3D Rust Engine (5m loop)
  fetcher.rs → Binance 500 assets → processor.rs indicators → algos/mod.rs 27 votes
  → engine/data/algo_day.json → api/state.rs (30s reload) → /v1/council, /v1/algo-day
  → engine/data/algo_state.db (history)

M3D Rust API :3300
  api/src/scanner.rs → Binance 1m klines (50 USDT) → 5 detectors → /ws/scanner

M3D DS :8800 (python3.11, ds/.venv)
  algos_crypto.py → same 27 algos in Python (for backtest.py compatibility)
  backtest.py → backtesting.py wrapper (per-trade detail)
  optimizer.py → vectorbt grid search, IS/OOS 75/25 walk-forward
  rank: 27 × N combos, rank_score = IS_sharpe×0.6 + OOS_sharpe×0.4
  grok_pulse.py (daemon) → xAI Grok 60s poll → /v1/ai/pulse/

M3D site (`site/`) :5500
  Proxy /v1 → :3300 (Rust API)
  Proxy /ds  → :8800 (Django DS)
```

---

## Key Data Files

| File | Contents | Updated |
|------|----------|---------|
| `engine/data/algo_day.json` | Live 500-asset scores | Every 5m by engine |
| `engine/data/algo_state.db` | Historical scores | Continuous |
| `ds/data/futures.db` | 11.9M bars (Databento + Binance) | Static (manual refresh) |
| `.env.local` | All API keys | Manual |

---

## Science Standards (what makes a valid algo)

1. IS Sharpe > 1.0 (in-sample, 75% of window)
2. OOS Sharpe > 0.7 (out-of-sample, 25% of window)
3. Minimum 15 trades per test window
4. No look-ahead bias — bar-close entries only
5. 5 rolling walk-forward windows before promotion
6. rank_score = IS × 0.6 + OOS × 0.4 (used in Rank leaderboard)

An algo that fails OOS consistently gets demoted weight in MoE. It does not get deleted — it competes.

---

## Pending / Next for M3D

1. **GHOST expert** — Order Block + Fair Value Gap detection in `engine/src/algos/mod.rs`
2. **ARB wiring** — `ds/ds_app/stat_arb.py` → MoE `computeAlpha()` in site
3. **Futures backtest** — use `ds/data/futures.db` bars_1m for ES/NQ backtests
4. **AlgoWeights page** — regime×bank matrix needs wiring to live MoE output
5. **AutoTrader page** — execution controls, approval queue
