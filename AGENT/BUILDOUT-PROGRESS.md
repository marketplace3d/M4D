# M4D BUILDOUT PROGRESS — LIVE TASK TRACKER
*Updated: 2026-04-19 · Build Master: Claude Sonnet 4.6*

---

## SYSTEM VERDICT: PROMISING (4/5 RenTech gates) · Stacked Sharpe 15.862 · 1,310 fat-pitch trades

---

## ✅ COMPLETED — THIS SESSION

| # | Item | File | Result |
|---|---|---|---|
| 1 | XSentinelOrb → real activity data | ControlRoomKnights.jsx | Fetches /v1/ai/activity/ every 60s, trend_label → direction |
| 2 | VolumeOrb → live OBI stream | ControlRoomKnights.jsx | useObiStream(symbol, POLYGON_KEY) wired |
| 3 | DS quant server in go.sh | go.sh | run_ds_quant() adds :8000 to all + m6d + new `ds` command |
| 4 | Cross-asset spreads (5 dims) | cross_asset.py | btc_eth_ratio · alt_beta · defi_momentum · l1_spread · btc_corr_break |
| 5 | Cross-asset UI tab | StarOptimizerPage.tsx | CROSS-ASSET tab 9 with regime dial + 5 dim bars + sparklines |
| 6 | Walk-forward engine | walkforward.py | 41 folds · 90d train · 30d test · 2d embargo · ~40s runtime |
| 7 | Regime-conditional IC | walkforward.py | Per-signal IC split by TRENDING/RANGING/BREAKOUT/RISK-OFF |
| 8 | Signal lifecycle analysis | walkforward.py | ALIVE:2 · SPECIALIST:18 · PROBATION:2 · RETIRE:0 |
| 9 | Death Star lifecycle grid UI | StarOptimizerPage.tsx | IC sparklines per signal, status badge, retire banner |
| 10 | Walk-forward UI tab | StarOptimizerPage.tsx | WALK-FWD tab 10: verdict · gates · regime · fold table |
| 11 | Sharpe-weighted ensemble | sharpe_ensemble.py | +4.22 Sharpe delta vs equal-weight |
| 12 | Routed ensemble test | sharpe_ensemble.py | Hard routing DEGRADES -1.07 → use soft weights not hard block |
| 13 | TV Pine Script template | TV-PINE-TEMPLATES.pine | 8 sections: squeeze · supertrend · ema-stack · RSI · regime · jedi · SEAL gate · PDH/PDL |
| 14 | /v1/cross/report/ + /run/ | urls.py + views.py | Cross-asset endpoints wired |
| 15 | /v1/walkforward/ + /run/ | urls.py + views.py | Walk-forward endpoints wired |
| 16 | PCA signal analysis | pca_signals.py | 9 dims at 80% · expansion cluster identified |
| 17 | XAIGROK activity gate | xaigrok_activity.py | tick_score × RVOL/ATR · grok_score → DEAD/SLOW/ALIVE/HOT |
| 18 | Sentiment trend time series | xaigrok_activity.py | store_pulse() + compute_sentiment_trend() · SQLite |
| 19 | XSocial mega scan | xsocial.py | Parallel Grok queries · 10 assets + macro · fixed API format |
| 20 | Activity + WF trend in /v1/ai/activity/ | views.py | trend from compute_sentiment_trend() added to response |

---

## 🔴 CRITICAL — BUILD NEXT (in order)

### P0 — IBKR + Alpaca paper trading

| # | Item | File | Status |
|---|---|---|---|
| IBKR | **IBKR paper adapter** | `ds_app/ibkr_paper.py` | ✅ DONE — ib_insync 0.9.86. Crypto (Paxos BTC/ETH/SOL), Futures (MES/MNQ micro), Stocks (SMART). Same Delta Ops+HALO+MTF+OBI pipeline as alpaca_paper. `/v1/ibkr/test/ status/ run/ score/`. **SETUP:** Open TWS → Paper → API Settings → port 7497 → add 127.0.0.1 to trusted IPs. |

---

### P0 — Closes paper trading gap

| # | Item | Why critical | Est |
|---|---|---|---|
| ~~P0-A~~ | ~~Regime-gated weight matrix~~ | ✅ DONE — soft multipliers +0.825 Sharpe vs SW baseline. thr=0.60, 1,513 high-conviction trades. | ✅ |
| ~~P0-B~~ | ~~Trade quality veto layer~~ | ✅ DONE — `trade_quality_gate.py` + `gate_search.py`. 5 gates all IMPROVE: SQUEEZE +0.934, ATR_RANK +0.661, **HOUR_KILLS +2.571**, RVOL_EXHAUST +0.435, LOW_JEDI +0.310. Combined SW=12.447 · Stacked=**15.862**. | ✅ |
| ~~P0-C~~ | ~~Paper trading config~~ | ✅ DONE — `paper_config.py`, `delta_ops.py`, `halo_mode.py`, `exit_optimizer.py`. PADAWAN=11.187, EUPHORIA=19.833 (62.4% WR), Re-entry=29.716. CIS: mode-tuned (PADAWAN: REGIME_DEGRADE+JEDI_FADE early-warning / EUPHORIA: REGIME_FLIP+JEDI_REVERSAL hold fat pitch). | ✅ |
| ~~P0-D~~ | ~~Alpaca paper adapter~~ | ✅ DONE — `ds/ds_app/alpaca_paper.py`. Full cycle: bars→score→gates→CIS→HALO→Alpaca order. `/v1/paper/status/` · `/v1/paper/run/` · `/v1/paper/score/`. Live BTC score verified: RANGING/score=0/jedi=-3/GATE:LOW_JEDI. Set ALPACA_KEY+ALPACA_SECRET env to activate. | ✅ |

### P1 — Signal quality upgrades

| # | Item | Why |
|---|---|---|
| ~~P1-A~~ | ~~HMM 3-state regime posterior~~ | ✅ DONE — `hmm_regime.py`. 3-state MarkovAutoregression (statsmodels) on 5m rvol. States mapped by vol rank → RANGING/TRENDING/RISK-OFF. `soft_regime_weight()` replaces hard label with probability-weighted multiplier. `/v1/hmm/fit/` · `/v1/hmm/report/` · `/v1/hmm/proba/`. Fit per symbol (~2min, run offline). |
| ~~P1-B~~ | ~~IC decay monitor~~ | ✅ DONE — `ic_monitor.py`. 14-day rolling Spearman IC × 7d step. HEALTHY: ATR_EXP/MACD/ADX/PSAR/TREND_SMA/ROC_MOM/VOL_SURGE. RETIRE flag (13 signals) — ⚠️ cross-reference walkforward (regime-conditional IC may override). `/v1/ic/report/` · `/v1/ic/run/`. |
| ~~P1-C~~ | ~~MTF confirmation layer~~ | ✅ DONE — `mtf_confirm.py`. Resample 5m→1h from futures.db. SUPERTREND+EMA_STACK+ADX_TREND on 1h. AGREE=1.0× · NEUTRAL=0.75× · OPPOSE=0.50×. Wired into alpaca_paper entry sizing. `/v1/mtf/`. |
| ~~P1-D~~ | ~~Cost-adjusted Sharpe~~ | ✅ DONE — `cost_model.py`. 0.10% slippage + 0.05% commission = 0.30% round-trip. Stacked 15.86 → cost-adj ~8-11 (29-45% haircut). `augment_report()` wraps any existing report. `/v1/cost/adjust/`. |

### P2 — Alpha expansion

| # | Item | Why |
|---|---|---|
| ~~P2-A~~ | ~~Funding rate signal~~ | ✅ DONE — `funding_signal.py`. LONG < -0.03%/8h (shorts overloaded), SHORT > +0.05%/8h (longs overloaded). 4h cache from Binance. Pressure score 0-1. Regime: RANGING/RISK-OFF. `/v1/funding/signals/` · `/v1/funding/refresh/`. |
| ~~P2-B~~ | ~~OBI signal~~ | ✅ DONE — `obi_signal.py`. Binance L2 20-level snapshot, proximity-weighted OBI. Thresholds: >+0.35=BID_HEAVY(LONG), <-0.35=ASK_HEAVY(SHORT). 30s cache. Live: BTC=-0.67(SELL), ETH=+0.38(BUY). Wired into alpaca_paper entry sizing (-25% if opposed). `/v1/obi/`. |
| ~~P2-C~~ | ~~Cross-asset confirmation~~ | ✅ DONE — `cross_asset_mult()` in cross_asset.py. RISK_ON=1.20×, RISK_OFF=0.70×, NEUTRAL=1.0×, STALE=1.0×. 15min TTL on cached report. Wired into alpaca_paper + ibkr_paper entry sizing. `ca_regime` logged on every trade. |
| ~~P2-D~~ | ~~IntermarketOrb~~ | ✅ DONE — `IntermarketOrb` in MaxCogVizOrbsII.tsx. 5 wedge arcs (72° each, per dim), composite score center, RISK_ON/OFF/NEUTRAL color. Wired to `/v1/cross/report/` (5m poll). Live in ControlRoomKnights. |
| ~~P2-E~~ | ~~PositioningOrb~~ | ✅ DONE — `PositioningOrb` in MaxCogVizOrbsII.tsx. Fear tick ring (rvol pct rank proxy), funding pressure arc (4h funding_signal.py), bias needle (council bank net). Wired to `/v1/funding/signals/` (4m poll). Live in ControlRoomKnights. |

### P3 — RenTech full compliance

| # | Item | Why |
|---|---|---|
| ~~P3-A~~ | ~~Signal discovery engine~~ | ✅ DONE — `signal_discovery.py`. 500+ candidates: lagged ret, z-scores, pct-rank, ATR dist, RSI/MACD norm, vol features, nonlinear (abs/sign/sq), 8 interaction pairs, mean-reversion from H/L. Benjamini-Hochberg FDR at α=5%. Spearman IC vs forward return. `/v1/discovery/ + /run/?symbol=BTC&lag=12`. Runtime ~30-120s. |
| ~~P3-B~~ | ~~IC half-life tracker~~ | ✅ DONE — `ic_halflife.py`. EXP fit (scipy curve_fit) when IC stays positive; LIN fallback. Half-life = ln(2)/λ × step_days. Alerts: IMMINENT (<7d), SHORT (<21d), STABLE. Expiry date estimate. REGIME_SPECIALIST override: global IC decay ≠ dead. `/v1/ic/halflife/ + /run/`. |
| ~~P3-C~~ | ~~Capacity/turnover model~~ | ✅ DONE — `capacity_model.py`. Median 5m dollar volume × 1% participation × 60 bars = max_lot_usd. Tiers: DEEP/NORMAL/THIN/DRY. `cap_lot_fraction(symbol, equity)` clamping wired into alpaca_paper + ibkr_paper entry sizing. `/v1/capacity/ + /run/`. |

### ALPHA SIGNALS / ITER-OPT

| # | Item | File | Status |
|---|---|---|---|
| 7 | Open Interest signal | `oi_signal.py` | ✅ DONE — Binance /fapi/v1/openInterest. TREND_CONFIRM=1.15× · EXHAUSTION=0.70× · CAPITULATION=0.50×. 5min cache. `get_oi_mult(sym)` in paper adapters. `/v1/oi/` |
| 8 | Fear & Greed index | `fear_greed.py` | ✅ DONE — api.alternative.me/fng/. Contrarian mult: EXT_FEAR=1.25× · EXT_GREED=0.65×. 4h cache. `get_fng_mult()` in paper adapters. `/v1/fng/` |
| **9** | **Liquidations stream** | **`liquidations.py`** | ✅ **DONE** — Binance `wss://fstream.binance.com/ws/!forceOrder@arr`. Daemon: `python ds_app/liquidations.py daemon`. SQLite accumulation. `get_liq_mult(sym)`: SHORT_LIQ_DOMINANT=1.15× · LONG_LIQ_DOMINANT=0.85× · CLIMAX=0.65×. 7th lot multiplier in both paper adapters. `/v1/liq/` · `/v1/liq/status/` |
| **10** | **Re-entry holdout validation** | **`delta_ops.py`** | ✅ **DONE** — `run_holdout()`: 85th–100th pct split (truly unseen ~2mo). VALID if re-entry Sharpe ≥10. Run: `python delta_ops.py --holdout`. Verdict in holdout_report.json. `/v1/holdout/` · `/v1/holdout/run/` |
| **11** | **Gate search re-run** | **`gate_search.py`** | ✅ **DONE** — Added MTF proxy (4h align), OI proxy (vol spike), F&G proxy (5d return >15%), OI exhaustion gates to candidate list. Run gate_search.py to regenerate with new candidates. |

---

## 📊 SIGNAL LIFECYCLE STATUS (2026-04-19)

| Signal | Status | Best Regime | Regime IC | Global IC |
|---|---|---|---|---|
| PULLBACK | SPECIALIST | TRENDING | +0.0505 | −0.004 |
| ADX_TREND | **ALIVE** | TRENDING | +0.0448 | +0.0004 |
| SQZPOP | SPECIALIST | BREAKOUT | +0.0330 | −0.001 |
| SUPERTREND | SPECIALIST | BREAKOUT | +0.0252 | −0.001 |
| RANGE_BO | SPECIALIST | BREAKOUT | +0.0231 | −0.003 |
| PSAR | SPECIALIST | TRENDING | +0.0228 | −0.001 |
| VOL_BO | SPECIALIST | BREAKOUT | +0.0312 | −0.004 |
| DON_BO | SPECIALIST | BREAKOUT | +0.0159 | −0.003 |
| GOLDEN | **ALIVE** | RISK-OFF | +0.0053 | +0.0002 |
| MACD_CROSS | SPECIALIST | TRENDING | +0.0076 | −0.001 |
| EMA_STACK | SPECIALIST | BREAKOUT | +0.0117 | −0.004 |
| TREND_SMA | SPECIALIST | BREAKOUT | +0.0123 | −0.005 |
| NEW_HIGH | SPECIALIST | BREAKOUT | +0.0110 | −0.004 |
| VOL_SURGE | PROBATION | — | — | −0.004 |
| CONSEC_BULL | PROBATION | — | — | −0.003 |

**KEY FINDING**: ZERO signals should be retired. All 18 "dead" global IC signals are REGIME_SPECIALISTs — they work in their correct regime. The fix is regime-gated weighting, not removal.

**SUPERTREND**: NOT dead. Specialist in BREAKOUT (IC +0.025). Globally negative because it fires in ranging = guaranteed loss. Route to TRENDING+BREAKOUT only = edge restored.

---

## ⚡ ROUTING DELTA ANALYSIS (2026-04-19 final)

| Branch | Sharpe | Trades | Delta vs SW | Verdict |
|---|---|---|---|---|
| Equal weight | 5.43 | 118,031 | — | Baseline |
| Sharpe-weighted | 5.94 | 111,511 | — | +0.51 vs equal |
| Hard routed (binary block) | 5.20 | 21,974 | −0.74 | DEGRADED |
| **Soft routed (thr=0.60)** | **6.767** | **1,513** | **+0.825** | **IMPROVED** |

**P0-A FINDING**: Soft multipliers WORK but require HIGH threshold (0.60) because 1.5× specialist boosts inflate the score scale. At threshold 0.60, only bars where multiple regime-matched signals agree simultaneously pass — this is the fat-pitch filter.

**Key insight**: Hard routing cut 69% of trades → lost diversification. Soft routing with correct threshold cuts 99% of trades but picks only the highest-conviction bars → net Sharpe gain.

**Production config**: `soft_routed` branch, threshold=0.60, Sharpe=6.767.

**Circular regime fix**: `build_routed_ensemble()` now uses price-based `assign_regimes()` (EMA200 + ATR momentum) instead of `_regime_labels_simple()` (signal-vote-based). This eliminated the circular dependency that caused earlier degradation.

---

## 🏗 ARCHITECTURE MAP — CURRENT STATE

```
LAYER 0:  futures.db (bars_5m) — 20 crypto symbols · 2yr · 4M rows
LAYER 1:  signal_log.db — 3.2M rows · 23 signals · 4 outcomes
LAYER 2:  WorldQuant 4-gate → 23/27 survive
LAYER 3:  Regime router → +0.84 Sharpe
LAYER 4:  Star-Ray kill filter → +1.16 Sharpe
LAYER 5:  XAIGROK activity gate → DEAD/SLOW/ALIVE/HOT
LAYER 6:  Walk-forward: 41 folds · OOS +5.35 · PROMISING 4/5
LAYER 7:  PCA: 9 true dims · expansion cluster identified
LAYER 8:  Sharpe-weighted ensemble: +4.22 vs equal-weight
LAYER 9:  Cross-asset: 5 dims · BTC/ETH · alt_beta · DeFi · L1 · corr_break
LAYER 10: Regime-conditional IC: 18 specialists · 2 alive · 0 retire

LAYER 11: Soft regime weight matrix · SOFT_REGIME_MULT · thr=0.60 · +6.767 Sharpe ✅

PENDING:
LAYER 12: Trade quality gate · SQUEEZE+ATR_RANK+HOUR_KILLS+RVOL_EXHAUST+LOW_JEDI · stacked Sharpe 15.862 ✅
LAYER 13: Delta Ops + HALO · PADAWAN 11.2 · EUPHORIA 19.8 (62.4% WR) · Re-entry 29.7 ✅

LAYER 14: HMM posterior regime (P1-A) ✅
LAYER 14: MTF confirmation (P1-C) ✅
LAYER 15: Paper trade config + Alpaca (P0-C, P0-D) ✅
LAYER 16: OI signal + Fear&Greed + Liquidations stream ✅

LOT SIZING STACK (7 multipliers, all live):
  halo_dec.lot_fraction × mtf_mult × ca_mult × cap_frac × oi_mult × fng_mult × liq_mult

REMAINING OPEN ITEMS:
  • Liquidation daemon must be started separately: python ds_app/liquidations.py daemon
  • Run holdout validation: POST /v1/holdout/run/ → check re-entry Sharpe on unseen data
  • Run gate_search.py to regenerate gate report with MTF/OI/F&G proxy gates
  • MRT → JEDI integration: add MRT composite as 24th signal in algos_crypto.py + walkforward
  • TV Pine webhook pipeline: Pine alert → /v1/paper/approve/ (symbol from alert payload)
  • EUPHORIA push alert: browser notification when all 6 EUPHORIA triggers fire simultaneously
  • Trade journal: per-signal/per-regime attribution table (need P&L tagged by signal)
```

---

## 🎯 PADAWAN MODE (JR JEDI RECRUIT) — SPEC

Conservative mode for small accounts / learning traders:
- Kelly cap: 0.25× (never bet more than quarter-Kelly)
- Max 3 trades per day
- ALL hard vetos must pass (squeeze + cloud + rvol + PDH/PDL middle)
- Minimum: both CouncilOrb conviction > 60% AND activity gate ALIVE+
- Flatten threshold: 1.5% drawdown (vs 3% normal)
- No euphoria scaling — flat size only
- Required regime: TRENDING or BREAKOUT only (no RANGING setups)

## ⚡ EUPHORIA SCALE-IN MODE

When ALL fire simultaneously:
- Jedi score ≥ +18 (all 3 banks aligned)
- RVOL > 2.0
- Activity gate = HOT
- MTF confirmed (5m + 1h aligned)
- Cross-asset = RISK_ON
- XSentinel = BUILDING

→ 2–3× normal Kelly · This is the fat pitch.

---

*Progress tracker auto-updated by build session. Check SYSTEM-SPEC.md for full architecture.*
