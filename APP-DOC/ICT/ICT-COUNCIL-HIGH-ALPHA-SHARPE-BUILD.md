# ICT Council High-Alpha / High-Sharpe Build

Purpose: turn ICT + liquidity/levels into a production-grade Council engine that maximizes risk-adjusted returns, not raw hit rate.

Scope: ICT/SMC features, liquidity draw system, confluence weighting, portfolio/risk controls, and a RenTech/WorldQuant-style research pipeline.

---

## 1) Design Principles

- Alpha comes from **orthogonal weak edges** combined, not one "perfect" signal.
- BOS/CHoCH is **confidence**, not primary trigger.
- Sentiment is **non-gating overlay** (small weight, capped impact).
- Optimize for **OOS Sharpe stability** and drawdown control, not in-sample win rate.
- Separate:
  - **Signal layer** (what to trade)
  - **Sizing layer** (how much to trade)
  - **Execution layer** (how to enter/exit)
  - **Portfolio layer** (how to combine).

---

## 2) Alpha Buckets To Combine

Use a Council with independent alpha buckets:

1. **Liquidity Draw Alpha**
   - PDH/PDL, PWH/PWL, EQH/EQL, session highs/lows, external range.
2. **Purge/Manipulation Alpha**
   - BSL/SSL sweep quality, Judas reversion profile, sweep velocity.
3. **Displacement Alpha**
   - Body/ATR, FVG width/quality, post-sweep impulse continuity.
4. **PD Array Alpha**
   - OB/FVG/VWAP/OTE alignment and proximity quality.
5. **Regime/Timing Alpha**
   - Killzone gating, off-hours decay, volatility regime switches.
6. **Flow/Confirmation Alpha**
   - CVD/OI delta alignment, SMT divergence, divergence expansion.

Target: each bucket should be mildly predictive alone; strong when combined.

---

## 3) Council Confluence Model

### 3.1 Weighted score

Base edge score:

`S_edge = 0.45*S_struct + 0.30*S_liq + 0.21*S_vol + 0.04*S_sent`

Where:
- `S_struct`: market structure + PD array quality
- `S_liq`: sweep quality + draw-on-liquidity validity
- `S_vol`: displacement strength + ATR regime quality
- `S_sent`: capped flow/sentiment alignment

Apply multipliers:
- `time_mult`: killzone boost / off-hours decay
- `risk_mult`: leverage and exposure constraints
- `div_mult`: divergence penalties

Final:

`S_final = clip(S_edge * time_mult * div_mult, 0, 100)`

### 3.2 Regime routing

- `TRENDING`: early set primary (higher R capture)
- `RANGING`: late/confirmed set only
- `VOLATILE`: both sets half-size + tighter kill switches

---

## 4) Sharpe Stack (What To Optimize)

Do not optimize single Sharpe. Optimize a composite quality score:

`Q = 0.30*SharpeStability + 0.25*DDQuality + 0.20*Expectancy + 0.15*Execution + 0.10*RegimeRobustness`

Components:
- **SharpeStability**: rolling 1M/3M Sharpe consistency
- **DDQuality**: max DD, DD duration, ulcer index
- **Expectancy**: avg R/trade, payoff ratio, hit-rate consistency
- **Execution**: slippage drift, fill quality, missed-entry cost
- **RegimeRobustness**: performance by session/regime, not just aggregate

Hard reject conditions:
- IS/OOS Sharpe decay > 50%
- OOS max DD > risk policy
- edge concentrated in one session only
- unstable performance after cost/slippage stress.

---

## 5) Research Loop (RenTech/WorldQuant Style)

### Stage A: Feature Lab
- Generate hundreds of candidate features from OHLCV + levels + flow.
- Rank by IC/IR and stability across rolling windows.
- Keep low-correlation features; drop redundant signals.

### Stage B: Strategy Factory
- Compose strategies from feature bundles (early/late/routing variants).
- Standardized backtest harness with identical costs and constraints.

### Stage C: Portfolio Construction
- Build Council vote from top independent strategies.
- Penalize correlation clusters.
- Allocate risk by predicted Sharpe stability and drawdown budget.

### Stage D: Walk-Forward + Stress
- Anchored WF (6m IS / 2m OOS) across multiple market regimes.
- Monte Carlo path reshuffle + parameter perturbation.
- Slippage/latency stress tests.

### Stage E: Deployment Governance
- Versioned configs, feature snapshots, model card per release.
- Auto kill-switches and exposure caps.
- Weekly review: feature drift, execution drift, capacity.

---

## 6) Data & Feature Schema (Minimum)

Core live features:
- `liq_draw_prox`, `liq_pool_type`, `eqh_eql_density`
- `purge_velocity`, `judas_reversion_pct`, `sweep_quality`
- `disp_score`, `fvg_width_atr`, `impulse_followthrough`
- `ob_prox_atr`, `vwap_dev_atr`, `ote_zone_flag`, `pd_confluence_n`
- `killzone_flag`, `session_id`, `offhours_decay_mult`
- `cvd_delta`, `oi_delta`, `smt_delta`, `divergence_expand_n`
- `edge_score_raw`, `edge_score_final`, `set_type`, `route_type`

Required outputs:
- `signal.direction`
- `signal.confidence`
- `entry_px/sl_px/tp1_px/tp2_px`
- `risk.kelly_fraction`, `risk.position_size`, `risk.max_loss`.

---

## 7) Execution + Risk Policy

- Quarter-Kelly cap as default.
- Session drawdown cap and daily hard stop.
- Max concurrent positions by profile.
- Mandatory invalidation:
  - FVG reclaim failure
  - Judas breach
  - divergence expansion
  - macro lock window.

Position sizing must shrink when:
- off-hours,
- weak confluence,
- rising slippage,
- unstable regime classification.

---

## 8) Build Plan (Practical)

### Phase 1 (1-2 weeks): Foundation
- Lock feature schema and data contracts.
- Implement score calculator + regime router.
- Add Council confluence panel and profile controls.

### Phase 2 (2-3 weeks): Backtest + Validation
- Unified backtest harness for early/late/routed sets.
- Composite quality score and report artifacts.
- Walk-forward + stress suite.

### Phase 3 (2 weeks): Portfolio Council
- Combine top strategies into vote-based Council.
- Correlation-aware risk allocation.
- Add deployment kill-switch telemetry.

### Phase 4 (ongoing): Iter-Opt
- Weekly parameter drift check.
- Monthly feature refresh (add/drop by OOS IC and stability).
- Strict release gates based on OOS metrics and DD policy.

---

## 9) KPI Targets

- OOS Sharpe: >= 1.2 baseline, >= 1.6 stretch
- OOS max DD: <= 12% baseline, <= 8% stretch
- Positive expectancy in all primary sessions
- IS/OOS Sharpe decay <= 35%
- Execution slippage within expected bands.

---

## 10) Immediate Next Implementation

1. Add profile selector + regime router controls to `ICT-SMC` page.
2. Persist confluence history + threshold alerts on `OBI`.
3. Build backtest report section with:
   - rolling Sharpe,
   - DD stack,
   - expectancy,
   - regime attribution,
   - composite quality score.
4. Gate live signals with kill-switch matrix before order routing.

