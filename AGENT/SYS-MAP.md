# SYS-MAP — M5D System Architecture
*Distilled 2026-04-24 · Source: AGENT1/SYSTEM-MAP.md + SYSTEM-SPEC.md*
*See SYSTEM-MAP.svg for visual layer diagram*

---

## ACTIVE SITES

| Site | Folder | Port | Purpose | Status |
|------|--------|------|---------|--------|
| **M5D** | `M5D/` | **:5556** | Co-trader · 4-page Palantir UI | ✅ NEW |
| M3D     | `site/` | :5500 | Test bots · MaxCogViz · research | ✅ RUNNING |
| M4D     | `M4D/`  | :5555 | Legacy oracle UI | KEEP/NO EXTEND |
| W3D/W4D | `W3D/`,`W4D/` | — | Hedge fund layer | SEPARATE |

Launch: `./go.sh` or `./go.sh all` (full stack **includes M5D :5556** + M4D :5555) · `./go.sh m5d` (M5D only) · `./go5d.sh` (M5D only) · `./go3d.sh` (M3D) · `./go.sh ds` (Django :8000)

---

## DATA FLOW

```
Binance REST/WS (free)
  500 USDT OHLCV 5m · 20 crypto 2yr history
          │
          ▼
 M3D ENGINE (Rust, 5m loop)          DS LAYER (Django :8000)
 engine/data/algo_day.json      ←──  ds/data/futures.db (4M rows)
 engine/data/algo_state.db           ds/data/signal_log.db (3.2M rows)
          │                               │
          ▼                               ▼
 M3D RUST API :3030                  DS ENDPOINTS
 /v1/council   → JEDI+regime+27      /v1/cross/report/
 /v1/algo-day  → per-asset scores    /v1/gate/report/
 /ws/algo       WS push 30s          /v1/delta/run/
                                     /v1/paper/status/
          │                               │
          └──────────────┬────────────────┘
                         ▼
                    M5D :5556
              4 pages · Palantir layout
              Left nav · Right rail always-on
```

---

## 18-LAYER ALPHA STACK (current state)

| Layer | What | Result |
|-------|------|--------|
| 0 | Raw OHLCV — futures.db 4M rows | DATA |
| 1 | 23 signals — signal_log.db 3.2M rows | SIGNALS |
| 2 | WorldQuant 4-gate → 23/27 survive | FILTER |
| 3 | Regime router (price EMA200+ATR) | +0.84 Sharpe |
| 4 | Star-Ray kill filter (hour/day gates) | +1.16 |
| 5 | XAIGROK activity gate (DEAD/SLOW/ALIVE/HOT) | GATE |
| 6 | Walk-forward 41 folds, OOS +5.35 | VALIDATED |
| 7 | PCA: 9 true dims of 23 | DEDUPED |
| 8 | Sharpe-weighted ensemble | +4.22 |
| 9 | Cross-asset 5 dims (BTC/ETH, alt_beta, DeFi, L1, corr) | CONTEXT |
| 10 | Regime-conditional IC — 18 specialists | IC AWARE |
| 11 | SOFT_REGIME_MULT matrix (thr=0.35) | 6.61 Sharpe |
| 12 | Trade quality gate 5 vetos | **15.86 stacked** |
| 13 | Delta Ops + HALO: EUPHORIA 19.83 · Re-entry 29.72 | EXECUTION |
| 14 | HMM posterior regime | SOFT |
| 15 | MTF confirmation 5m+1h | AGREE/OPPOSE |
| 16 | Alpaca + IBKR paper adapters | PAPER LIVE |
| 17 | IC decay monitor + half-life | LIFECYCLE |
| 18 | Cost model + OI + F&G + liquidations | LOT STACK |

---

## KEY NUMBERS (SSOT)

```
Stacked Sharpe:     15.86  (1,310 trades)
EUPHORIA:           19.83  (117 trades · 62.4% WR)
RE-ENTRY:           29.72  (87 trades — mostly untapped)
Cost-adjusted:      ~8-11  (0.30% round-trip haircut)
IOPT EUPHORIA:      21.7   (200 samples seed=42 · jedi_min=10 THE FIX)
IOPT MAX:           17.8   (jedi=8 + entry=0.35 + cis=1)
```

---

## LOT SIZING STACK (7 layers)
```
eff_lot = halo × mtf × cross_asset × capacity × oi × fear_greed × liquidations
  mtf:         AGREE=1.0 / NEUTRAL=0.75 / OPPOSE=0.50
  cross_asset: RISK_ON=1.20 / NEUTRAL=1.0 / RISK_OFF=0.70
  oi:          TREND_CONFIRM=1.15 / EXHAUSTION=0.70 / NEUTRAL=1.0
  fear_greed:  EXTREME_FEAR=1.25 / GREED=0.85 / EXTREME_GREED=0.65
```

---

## DS FILES — COMPLETE INVENTORY

| File | Purpose |
|------|---------|
| `delta_ops.py`      | PADAWAN/EUPHORIA/MAX sim · CIS · scale · re-entry · `--days N` |
| `iopt_search.py`    | Random 9-dim search · 200 samples · top-10 |
| `signals.py`        | 23 signal generation (pandas-ta) |
| `regime_engine.py`  | 4-state classifier (price-based EMA200+ATR) |
| `soft_score.py`     | Ensemble agreement p90=0.046 p99=0.224 |
| `walkforward.py`    | 41 folds · 90d/30d/2d embargo |
| `cross_asset.py`    | 5-dim composite → RISK_ON/OFF/NEUTRAL |
| `obi_signal.py`     | Binance L2 OBI (>0.35 = BID_HEAVY) |
| `funding_signal.py` | 4h cache funding rate pressure |
| `alpaca_paper.py`   | Full paper cycle → Alpaca |
| `ibkr_paper.py`     | ib_insync → TWS :7497 |
| `vwap_signal.py`    | Session VWAP deviation bands |
| `target_levels.py`  | DR/IDR ICT target levels |
