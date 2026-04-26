# ICT Council Python Implementation Skeleton

Purpose: provide a build-ready Python skeleton for the ICT/Liquidity Council system with clear module boundaries, function signatures, and data contracts.

---

## 1) Repository Layout

```text
ds/
  ict_council/
    __init__.py
    config.py
    schemas.py
    features.py
    signals.py
    routing.py
    portfolio.py
    risk.py
    execution.py
    backtest.py
    walkforward.py
    attribution.py
    report.py
    service.py
    tests/
      test_features.py
      test_signals.py
      test_risk.py
      test_backtest.py
```

---

## 2) Core Schemas (`schemas.py`)

Use dataclasses or Pydantic models.

```python
from dataclasses import dataclass
from typing import Literal, Optional

Direction = Literal["LONG", "SHORT", "FLAT"]
SetType = Literal["EARLY", "LATE", "NONE"]
Regime = Literal["TRENDING_BULL", "TRENDING_BEAR", "RANGING", "VOLATILE"]
Profile = Literal["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]

@dataclass
class FeatureRow:
    ts: int
    symbol: str
    timeframe: str
    price: float
    atr_14: float
    liq_draw_prox: float
    purge_velocity: float
    judas_flag: bool
    disp_score: float
    fvg_width_atr: float
    pd_confluence_n: int
    killzone_flag: bool
    offhours_decay_mult: float
    cvd_delta: float
    oi_delta: float
    smt_delta: float
    bos_flag: bool
    choch_flag: bool
    mss_flag: bool
    regime: Regime

@dataclass
class EdgeScore:
    struct_score: float
    liq_score: float
    vol_score: float
    sent_score: float
    raw: float
    final: float

@dataclass
class TradeSignal:
    ts: int
    symbol: str
    direction: Direction
    set_type: SetType
    confidence: float
    edge: EdgeScore
    entry_px: float
    sl_px: float
    tp1_px: float
    tp2_px: float
    reason: str
```

---

## 3) Config (`config.py`)

```python
from dataclasses import dataclass

@dataclass
class Weights:
    struct: float = 0.45
    liq: float = 0.30
    vol: float = 0.21
    sent: float = 0.04

@dataclass
class Thresholds:
    fire_early: float = 65.0
    fire_late: float = 70.0
    min_rr: float = 2.0
    bos_boost: float = 8.0

@dataclass
class RiskConfig:
    base_risk_pct: float = 0.01
    max_kelly_fraction: float = 0.25
    min_kelly_fraction: float = 0.005
    session_dd_cap: float = 0.025
    daily_loss_cap: float = 0.035
    max_concurrent: int = 2

@dataclass
class ICTCouncilConfig:
    weights: Weights = Weights()
    thresholds: Thresholds = Thresholds()
    risk: RiskConfig = RiskConfig()
```

---

## 4) Feature Engineering (`features.py`)

Functions:

```python
def compute_liquidity_features(df): ...
def compute_purge_features(df): ...
def compute_displacement_features(df): ...
def compute_pd_array_features(df): ...
def compute_flow_features(df): ...
def compute_time_features(df): ...
def compute_structure_features(df): ...
def build_feature_frame(df_1m, df_3m, levels_ctx) -> "pd.DataFrame": ...
```

Output columns must include all fields used by `FeatureRow`.

---

## 5) Signal Engine (`signals.py`)

### 5.1 Scoring

```python
def score_structure(row) -> float: ...
def score_liquidity(row) -> float: ...
def score_volatility(row) -> float: ...
def score_sentiment(row) -> float: ...

def compute_edge_score(row, cfg) -> EdgeScore:
    struct = score_structure(row)
    liq = score_liquidity(row)
    vol = score_volatility(row)
    sent = score_sentiment(row)
    raw = (
        cfg.weights.struct * struct
        + cfg.weights.liq * liq
        + cfg.weights.vol * vol
        + cfg.weights.sent * sent
    )
    mult = (1.25 if row.killzone_flag else row.offhours_decay_mult)
    final = max(0.0, min(100.0, raw * mult))
    return EdgeScore(struct, liq, vol, sent, raw, final)
```

### 5.2 Early/Late Logic

```python
def early_gate(row, edge, cfg) -> bool: ...
def late_gate(row, edge, cfg) -> bool: ...
def build_trade_levels(row, direction) -> tuple[float, float, float, float]: ...

def generate_signal(row, cfg) -> TradeSignal | None:
    edge = compute_edge_score(row, cfg)
    if early_gate(row, edge, cfg):
        ...
    if late_gate(row, edge, cfg):
        ...
    return None
```

---

## 6) Regime Router (`routing.py`)

```python
def route_set(regime: str) -> str:
    if regime in ("TRENDING_BULL", "TRENDING_BEAR"):
        return "EARLY_PRIMARY"
    if regime == "RANGING":
        return "LATE_ONLY"
    if regime == "VOLATILE":
        return "BOTH_HALF_SIZE"
    return "LATE_ONLY"
```

Use router output to gate signal type and sizing multipliers.

---

## 7) Risk + Kelly (`risk.py`)

```python
def kelly_fraction(p_win: float, avg_r: float) -> float:
    q = 1.0 - p_win
    b = max(avg_r, 1e-6)
    f = (p_win * b - q) / b
    return max(0.0, f)

def position_risk_usd(equity: float, p_win: float, avg_r: float, cfg) -> float:
    f = kelly_fraction(p_win, avg_r)
    f = min(cfg.risk.max_kelly_fraction, max(cfg.risk.min_kelly_fraction, f))
    return equity * cfg.risk.base_risk_pct * f

class SessionRiskGuard:
    def __init__(self, equity: float, cfg): ...
    def can_trade(self) -> tuple[bool, str]: ...
    def on_trade_close(self, pnl_usd: float): ...
```

---

## 8) Portfolio Council (`portfolio.py`)

Combine multiple strategy signals:

```python
def aggregate_votes(signals_by_model) -> dict:
    # direction tally + confidence weighted vote
    ...

def corr_penalty_matrix(returns_df) -> "pd.Series":
    # penalize cluster-correlated models
    ...

def allocate_risk(council_vote, model_quality, corr_penalty, total_risk_budget):
    ...
```

Target: avoid concentration in highly correlated ICT variants.

---

## 9) Execution Adapter (`execution.py`)

```python
class PaperBroker:
    def place_limit(self, symbol, side, qty, px): ...
    def place_stop(self, symbol, side, qty, stop_px): ...
    def place_take_profit(self, symbol, side, qty, tp_px): ...
```

Keep broker adapter swappable (`paper`, `alpaca`, `ibkr`).

---

## 10) Backtest Harness (`backtest.py`)

```python
def run_backtest(feature_df, cfg, profile="BALANCED") -> dict:
    # iterate bars, generate signals, apply risk guard, simulate fills/costs
    # output returns, trades, drawdowns, metrics
    ...
```

Metrics to return:
- Sharpe, Sortino, Calmar
- max drawdown, DD duration
- expectancy, avg R, win rate
- slippage/cost impact
- metrics by regime/session.

---

## 11) Walk-Forward (`walkforward.py`)

```python
def anchored_walkforward(df, cfg_grid, is_months=6, oos_months=2) -> dict:
    # optimize on IS, evaluate on OOS, roll forward
    ...
```

Accept model only if OOS meets gates:
- Sharpe >= threshold
- DD <= cap
- IS/OOS decay <= limit
- regime consistency checks pass.

---

## 12) Attribution (`attribution.py`)

Track contribution by factor bucket:

```python
def factor_attribution(trades_df) -> dict:
    # structure vs liquidity vs volatility vs sentiment contribution
    ...
```

This is critical for deciding when to retune weights.

---

## 13) Report Builder (`report.py`)

Generate JSON + HTML summary:

```python
def build_report(run_result, wf_result, attribution) -> dict: ...
def export_html(report, path): ...
```

Report sections:
- performance
- regime split
- kill-switch activations
- factor attribution
- parameter sensitivity.

---

## 14) Service Layer (`service.py`)

Endpoints to expose:
- `GET /v1/ict/features/`
- `GET /v1/ict/signal/`
- `POST /v1/ict/backtest/run/`
- `GET /v1/ict/report/`
- `POST /v1/ict/profile/set/`

Keep this independent from UI details.

---

## 15) Test Plan (`tests/`)

Minimum tests:
- Feature integrity (no NaN in required fields)
- Signal gating behavior (early vs late)
- Kelly limits enforced
- Kill-switch triggers close/halts correctly
- Backtest reproducibility under fixed seed
- Walk-forward acceptance gate correctness.

---

## 16) Build Order (Implementation Sequence)

1. `schemas.py`, `config.py`
2. `features.py`
3. `signals.py` + `routing.py`
4. `risk.py`
5. `backtest.py`
6. `walkforward.py`
7. `portfolio.py`
8. `report.py`
9. `service.py`
10. tests + CI gates.

---

## 17) Immediate TODO Stubs

Add TODOs with explicit signatures first, then fill incrementally:

```python
# TODO(features): implement compute_purge_features() with judas quality score
# TODO(signals): implement early_gate() with purge+displacement hard gates
# TODO(risk): implement SessionRiskGuard.can_trade() hard stop logic
# TODO(backtest): include fees + slippage + latency shock scenario
# TODO(walkforward): add IS/OOS decay calculation and reject gate
```

This keeps the team shipping without architecture drift.

