"""
ds_app/cost_model.py — Cost-Adjusted Sharpe (P1-D)

Applies realistic transaction costs to pristine backtest returns:
  slippage:  0.10% per trade  (market impact + half-spread on entry)
  commission: 0.05% per trade (exchange fees)
  total cost: 0.15% per round-trip (entry + exit)

Usage:
  cost_adjusted_sharpe(returns, n_trades) → float
  apply_costs(returns, trade_flags) → cost-adjusted return series
  report(raw_report) → report with cost-adjusted metrics appended

CRYPTO COST BENCHMARKS (2024-2025):
  Binance maker: 0.02-0.05%  taker: 0.04-0.08%
  Coinbase Advanced: 0.05-0.15%
  Slippage on BTC (spot, <$10k): ~0.05-0.15%
  Conservative 2-way estimate: 0.15-0.25%
  We use 0.15% (lower bound) — real-world will be higher.

COST HAIRCUT ESTIMATE (from session 2026-04-19):
  Pristine Sharpe 15.86 → real-world Sharpe ~6-10 (40-60% haircut).
  At 1,310 trades / 2yr = 655/yr: cost drag = 655 × 0.15% × 5% account = ~4.9% annual cost.
  This is the 'cost floor' — you must beat 4.9% return/year just to break even on costs.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

SLIPPAGE_PCT    = 0.0010   # 0.10% per trade entry
COMMISSION_PCT  = 0.0005   # 0.05% per trade entry
COST_PER_TRADE  = SLIPPAGE_PCT + COMMISSION_PCT   # one-way
ROUND_TRIP_COST = COST_PER_TRADE * 2              # entry + exit

ANNUAL_5M       = 252 * 288


def cost_adjusted_sharpe(
    raw_returns: np.ndarray,
    n_trades: int,
    annual: int = ANNUAL_5M,
    cost_per_rt: float = ROUND_TRIP_COST,
) -> dict:
    """
    Compute raw and cost-adjusted Sharpe.
    raw_returns: bar-level returns array (not per-trade)
    n_trades:    number of round-trips taken
    """
    r = raw_returns[~np.isnan(raw_returns)]
    if len(r) < 10:
        return {"error": "insufficient data"}

    # Total cost drag spread evenly across all bars
    n_bars  = len(r)
    total_cost = n_trades * cost_per_rt
    cost_per_bar = total_cost / n_bars if n_bars > 0 else 0.0

    r_adj = r - cost_per_bar

    def _sharpe(x: np.ndarray) -> float | None:
        sd = x.std(ddof=1)
        if sd == 0 or n_bars < 30:
            return None
        return round(float(x.mean() / sd * np.sqrt(annual)), 3)

    sharpe_raw  = _sharpe(r)
    sharpe_adj  = _sharpe(r_adj)
    haircut_pct = (
        round((1 - sharpe_adj / sharpe_raw) * 100, 1)
        if sharpe_raw and sharpe_adj else None
    )

    return {
        "n_trades":           n_trades,
        "n_bars":             n_bars,
        "cost_per_rt_pct":    round(cost_per_rt * 100, 3),
        "total_cost_pct":     round(total_cost * 100, 3),
        "sharpe_raw":         sharpe_raw,
        "sharpe_cost_adj":    sharpe_adj,
        "haircut_pct":        haircut_pct,
        "annual_cost_drag":   round(cost_per_bar * annual * 100, 3),
    }


def apply_costs(returns: np.ndarray, trade_flags: np.ndarray) -> np.ndarray:
    """
    Subtract one-way cost on each bar where a trade opens (trade_flags[i]==1).
    Returns cost-adjusted return series.
    """
    r_adj = returns.copy().astype(float)
    entry_mask = trade_flags.astype(bool)
    r_adj[entry_mask] -= COST_PER_TRADE
    # Also subtract on exits (approximate: shift mask by hold_bars → too complex, use RT at entry)
    r_adj[entry_mask] -= COST_PER_TRADE   # round-trip cost at entry bar
    return r_adj


def augment_report(report: dict) -> dict:
    """
    Takes any existing backtest report dict, reads n_trades and returns series,
    adds cost-adjusted metrics under 'cost_model' key.
    Tries to infer required fields from common report formats.
    """
    n_trades = (
        report.get("n_trades")
        or report.get("num_trades")
        or report.get("trades")
        or 0
    )
    if isinstance(n_trades, list):
        n_trades = len(n_trades)

    raw_sharpe = (
        report.get("sharpe")
        or report.get("sharpe_ratio")
        or report.get("oos_sharpe", {}).get("mean") if isinstance(report.get("oos_sharpe"), dict) else None
        or 0.0
    )

    cost = {
        "slippage_pct":   SLIPPAGE_PCT * 100,
        "commission_pct": COMMISSION_PCT * 100,
        "round_trip_pct": ROUND_TRIP_COST * 100,
        "n_trades":       n_trades,
        "note":           "Estimates only. Actual depends on size, liquidity, time of day.",
    }

    if raw_sharpe and n_trades:
        annual_bar = ANNUAL_5M
        n_bars_est = max(int(n_trades * 12), 1)  # assume avg 1h hold = 12 bars
        total_cost = n_trades * ROUND_TRIP_COST
        cost_per_bar = total_cost / n_bars_est
        sd_est = abs(raw_sharpe) / np.sqrt(annual_bar) if raw_sharpe else 0.001
        adj_mean  = (raw_sharpe * sd_est / np.sqrt(annual_bar)) - cost_per_bar
        if sd_est > 0:
            sharpe_adj = round(adj_mean / sd_est * np.sqrt(annual_bar), 3)
        else:
            sharpe_adj = None
        haircut = round((1 - sharpe_adj / raw_sharpe) * 100, 1) if sharpe_adj and raw_sharpe else None
        cost["sharpe_raw"]      = raw_sharpe
        cost["sharpe_cost_adj"] = sharpe_adj
        cost["haircut_pct"]     = haircut

    out = dict(report)
    out["cost_model"] = cost
    return out


if __name__ == "__main__":
    # Quick demo against delta_ops report
    _DS_ROOT = Path(__file__).resolve().parent.parent
    report_path = _DS_ROOT / "data" / "delta_ops_report.json"
    if report_path.exists():
        rep = json.loads(report_path.read_text())
        for mode in ["PADAWAN", "NORMAL", "EUPHORIA"]:
            m = rep.get("modes", {}).get(mode, {})
            sharpe = m.get("sharpe")
            n_trades = m.get("n_trades", 0)
            if sharpe and n_trades:
                total_cost_pct = n_trades * ROUND_TRIP_COST * 100
                print(f"{mode}: raw_sharpe={sharpe}  n_trades={n_trades}  "
                      f"total_cost={total_cost_pct:.2f}%  est_adj≈{sharpe*0.55:.2f}")
    else:
        # Synthetic demo
        rng = np.random.default_rng(42)
        ret = rng.normal(0.0002, 0.005, 100000)
        result = cost_adjusted_sharpe(ret, n_trades=1300)
        print(json.dumps(result, indent=2))
