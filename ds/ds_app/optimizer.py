"""
ds_app/optimizer.py — Walk-forward parameter optimizer using vectorbt.

Runs thousands of param combinations in seconds via numpy/vectorbt array ops.
Anti-overfit design:
  - IS/OOS walk-forward split (default 75% IS / 25% OOS)
  - Min 10 trades gate on IS (rejects sparse combos)
  - Ranks by Sharpe (not return — Sharpe penalises drawdown naturally)
  - Reports OOS Sharpe for top IS combos — visible alpha decay warning

Usage:
    from ds_app.optimizer import optimize_algo
    result = optimize_algo("DON_BO", "BTC", "2021-01-01", "2024-01-01")
    # result["ranking"]  — list of top param combos with IS+OOS stats
    # result["best"]     — best param combo dict
"""
from __future__ import annotations

import itertools
import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .algos_crypto import ALGO_REGISTRY, build_features
from .data_fetch import fetch_ohlcv

logger = logging.getLogger(__name__)

# ── param grids per algo ──────────────────────────────────────────────────────
# Keep small: 2-3 params, 3-4 values each → max ~64 combos per algo via vectorbt
# For higher coverage use n_random instead.

PARAM_GRIDS: dict[str, dict[str, list]] = {
    "DON_BO":    {"n": [15, 20, 25, 30, 40], "exit_n": [7, 10, 15]},
    "BB_BREAK":  {"period": [15, 20, 25], "mult": [1.8, 2.0, 2.2, 2.5]},
    "KC_BREAK":  {"period": [15, 20, 25], "mult": [1.5, 2.0, 2.5, 3.0]},
    "SQZPOP":    {"length": [15, 20, 25, 30]},
    "ATR_EXP":   {"period": [10, 14, 20], "mult": [1.2, 1.5, 2.0]},
    "VOL_BO":    {"vol_n": [15, 20, 25], "vol_mult": [1.5, 2.0, 2.5, 3.0], "price_n": [7, 10, 15]},
    "CONSOL_BO": {"tight_n": [3, 5, 7], "expand_mult": [1.2, 1.5, 2.0]},
    "NEW_HIGH":  {"n": [15, 20, 30, 52], "exit_n": [7, 10, 15]},
    "RANGE_BO":  {"n": [7, 10, 15], "pct_thresh": [0.05, 0.08, 0.12]},
    "EMA_CROSS": {"fast": [7, 9, 12], "slow": [18, 21, 26, 34]},
    "EMA_STACK": {"fast": [7, 8, 10], "mid": [18, 21, 26], "slow": [50, 55, 63]},
    "MACD_CROSS":{"fast": [10, 12, 14], "slow": [22, 26, 30], "signal": [7, 9, 11]},
    "SUPERTREND":{"period": [7, 10, 14], "mult": [2.5, 3.0, 3.5, 4.0]},
    "ADX_TREND": {"period": [10, 14, 20], "thresh": [18, 20, 25]},
    "GOLDEN":    {"fast": [40, 50, 60], "slow": [180, 200, 220]},
    "PSAR":      {"step": [0.01, 0.02, 0.03], "max_step": [0.1, 0.2, 0.3]},
    "PULLBACK":  {"fast": [18, 21, 26], "slow": [50, 55, 63], "touch_pct": [0.5, 1.0, 2.0]},
    "TREND_SMA": {"sma_n": [30, 50, 70], "slope_n": [5, 10, 15]},
    "RSI_CROSS": {"period": [10, 14, 18]},
    "RSI_STRONG":{"period": [10, 14, 18], "threshold": [55, 60, 65], "ema_n": [18, 21, 26]},
    "ROC_MOM":   {"period": [7, 10, 14], "threshold": [2.0, 3.0, 5.0]},
    "VOL_SURGE": {"n": [15, 20, 25], "mult": [1.5, 2.0, 3.0]},
    "CONSEC_BULL":{"n_bars": [2, 3, 4]},
    "OBV_TREND": {"n": [15, 20, 30]},
    "STOCH_CROSS":{"k_period": [10, 14, 18], "d_period": [3, 5], "oversold": [20, 25, 30]},
    "MFI_CROSS": {"period": [10, 14, 18]},
    "CMF_POS":   {"period": [15, 20, 25], "threshold": [0.0, 0.05, 0.1]},
}


# ── simple vectorized backtest ────────────────────────────────────────────────

def _vectorized_backtest(
    close: np.ndarray,
    entries: np.ndarray,
    exits: np.ndarray,
    stop_pct: float,
    hold_bars: int,
) -> dict:
    """
    Pure numpy walk-forward single-pass backtest (long-only).
    Returns dict: {total_return, sharpe, max_dd, win_rate, n_trades}.
    """
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    equity_curve = [1.0]

    n = len(close)
    in_trade = False
    entry_price = 0.0
    hold_count = 0
    trades: list[float] = []

    for i in range(1, n):
        if in_trade:
            ret_since_entry = (close[i] - entry_price) / entry_price
            # stop loss
            if ret_since_entry <= -stop_pct / 100.0:
                pnl = ret_since_entry
                equity *= (1 + pnl)
                trades.append(pnl)
                in_trade = False
                hold_count = 0
            elif exits[i] or hold_count >= hold_bars:
                pnl = (close[i] - entry_price) / entry_price
                equity *= (1 + pnl)
                trades.append(pnl)
                in_trade = False
                hold_count = 0
            else:
                hold_count += 1
        else:
            if entries[i]:
                in_trade = True
                entry_price = close[i]
                hold_count = 0

        equity_curve.append(equity)
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak
        if dd > max_dd:
            max_dd = dd

    # Close any open trade at end
    if in_trade:
        pnl = (close[-1] - entry_price) / entry_price
        equity *= (1 + pnl)
        trades.append(pnl)

    n_trades = len(trades)
    if n_trades == 0:
        return {"total_return": 0.0, "sharpe": -99.0, "max_dd": 0.0, "win_rate": 0.0, "n_trades": 0}

    arr = np.array(trades)
    total_return = (equity - 1.0) * 100.0
    win_rate = float(np.mean(arr > 0)) * 100.0

    # Annualised Sharpe from trade returns
    if arr.std() > 0:
        sharpe = float(arr.mean() / arr.std() * math.sqrt(min(n_trades, 252)))
    else:
        sharpe = 0.0

    return {
        "total_return": round(total_return, 2),
        "sharpe": round(sharpe, 4),
        "max_dd": round(max_dd * 100, 2),
        "win_rate": round(win_rate, 2),
        "n_trades": n_trades,
    }


# ── vectorbt-accelerated grid search ─────────────────────────────────────────

def _vbt_grid_search(
    df: pd.DataFrame,
    algo_id: str,
    param_combos: list[dict],
    stop_pct: float,
    hold_bars: int,
) -> list[dict]:
    """
    Run param_combos through vectorbt if available, else fallback to numpy loop.
    Returns list of {params, stats} dicts.
    """
    try:
        import vectorbt as vbt
        return _vbt_search(df, algo_id, param_combos, stop_pct, hold_bars, vbt)
    except ImportError:
        logger.info("vectorbt not available — using numpy fallback for grid search")
        return _numpy_search(df, algo_id, param_combos, stop_pct, hold_bars)


def _vbt_search(df: pd.DataFrame, algo_id: str, param_combos: list[dict],
                stop_pct: float, hold_bars: int, vbt) -> list[dict]:
    """
    vectorbt-based search: build entry/exit signal matrices, run all combos in parallel.
    """
    close = df["Close"]
    results = []

    # Build signal arrays for all combos (vectorbt handles the rest)
    entries_list = []
    exits_list = []
    valid_combos = []

    for params in param_combos:
        try:
            feat = build_features(df, algo_id, params)
            entries_list.append(feat["entry"].values)
            exits_list.append(feat["exit_sig"].values)
            valid_combos.append(params)
        except Exception:
            continue

    if not entries_list:
        return []

    # Stack into matrices: shape (n_bars, n_combos)
    entries_mat = np.column_stack(entries_list)
    exits_mat = np.column_stack(exits_list)

    # vectorbt Portfolio from signals
    try:
        pf = vbt.Portfolio.from_signals(
            close=close,
            entries=pd.DataFrame(entries_mat, index=df.index),
            exits=pd.DataFrame(exits_mat, index=df.index),
            sl_stop=stop_pct / 100.0,
            init_cash=100_000,
            fees=0.001,
            freq="1D",
        )
        stats = pf.stats(silence_warnings=True)

        for i, params in enumerate(valid_combos):
            try:
                col = i if isinstance(stats.columns if hasattr(stats, "columns") else None, pd.Index) else i
                sr = float(pf.sharpe_ratio().iloc[i]) if hasattr(pf.sharpe_ratio(), "iloc") else float(pf.sharpe_ratio())
                tr = float(pf.total_return().iloc[i]) if hasattr(pf.total_return(), "iloc") else float(pf.total_return())
                nt = int(pf.trades.count().iloc[i]) if hasattr(pf.trades.count(), "iloc") else int(pf.trades.count())
                wr = float(pf.trades.win_rate().iloc[i]) * 100 if hasattr(pf.trades.win_rate(), "iloc") else float(pf.trades.win_rate()) * 100
                mdd = float(pf.max_drawdown().iloc[i]) * 100 if hasattr(pf.max_drawdown(), "iloc") else float(pf.max_drawdown()) * 100

                results.append({
                    "params": params,
                    "stats": {
                        "total_return": round(tr * 100, 2),
                        "sharpe": round(sr, 4) if math.isfinite(sr) else -99.0,
                        "max_dd": round(mdd, 2),
                        "win_rate": round(wr, 2),
                        "n_trades": nt,
                    }
                })
            except Exception:
                # Fall back to numpy for this combo
                close_arr = close.values
                stats_n = _vectorized_backtest(close_arr, entries_list[i], exits_list[i], stop_pct, hold_bars)
                results.append({"params": params, "stats": stats_n})
    except Exception as exc:
        logger.warning("vectorbt portfolio error (%s) — falling back to numpy", exc)
        return _numpy_search_from_arrays(valid_combos, entries_list, exits_list, close.values, stop_pct, hold_bars)

    return results


def _numpy_search(df: pd.DataFrame, algo_id: str, param_combos: list[dict],
                  stop_pct: float, hold_bars: int) -> list[dict]:
    close_arr = df["Close"].values
    results = []
    for params in param_combos:
        try:
            feat = build_features(df, algo_id, params)
            entries = feat["entry"].values.astype(bool)
            exits = feat["exit_sig"].values.astype(bool)
            stats = _vectorized_backtest(close_arr, entries, exits, stop_pct, hold_bars)
            results.append({"params": params, "stats": stats})
        except Exception:
            continue
    return results


def _numpy_search_from_arrays(combos, entries_list, exits_list, close_arr, stop_pct, hold_bars):
    results = []
    for i, params in enumerate(combos):
        stats = _vectorized_backtest(close_arr, entries_list[i], exits_list[i], stop_pct, hold_bars)
        results.append({"params": params, "stats": stats})
    return results


# ── walk-forward split ────────────────────────────────────────────────────────

def _split_df(df: pd.DataFrame, is_pct: float = 0.75) -> tuple[pd.DataFrame, pd.DataFrame]:
    split = int(len(df) * is_pct)
    return df.iloc[:split].copy(), df.iloc[split:].copy()


# ── main optimize function ────────────────────────────────────────────────────

@dataclass
class OptResult:
    algo_id: str
    asset: str
    start: str
    end: str
    is_end: str
    oos_start: str
    n_combos_tested: int
    ranking: list[dict] = field(default_factory=list)
    best: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "algo_id": self.algo_id,
            "asset": self.asset,
            "start": self.start,
            "end": self.end,
            "is_end": self.is_end,
            "oos_start": self.oos_start,
            "n_combos_tested": self.n_combos_tested,
            "ranking": self.ranking,
            "best": self.best,
        }


def optimize_algo(
    algo_id: str,
    asset: str,
    start: str,
    end: str,
    is_pct: float = 0.75,
    min_trades: int = 10,
    top_n: int = 10,
    custom_grid: dict | None = None,
) -> OptResult:
    """
    Walk-forward parameter optimization for a single algo.

    Args:
        algo_id:     One of the 27 ALGO_REGISTRY keys.
        asset:       Symbol, e.g. "BTC", "ETH", "AAPL".
        start:       Start date "YYYY-MM-DD".
        end:         End date "YYYY-MM-DD".
        is_pct:      Fraction of data for in-sample (default 0.75).
        min_trades:  Minimum IS trades for a combo to be ranked (default 10).
        top_n:       How many top combos to return (default 10).
        custom_grid: Override param grid for this run.

    Returns:
        OptResult with ranking (IS + OOS stats) and best combo.
    """
    algo_id = algo_id.upper()
    if algo_id not in ALGO_REGISTRY:
        raise ValueError(f"Unknown algo: {algo_id}")

    meta = ALGO_REGISTRY[algo_id]
    stop_pct = meta["stop_pct"]
    hold_bars = meta["hold_bars"]

    # Fetch data
    df = fetch_ohlcv(asset, start, end)
    if len(df) < 60:
        raise ValueError(f"Insufficient data: {len(df)} bars for {asset} {start}→{end}")

    # IS / OOS split
    is_df, oos_df = _split_df(df, is_pct)
    is_end = str(is_df.index[-1].date()) if hasattr(is_df.index[-1], 'date') else str(is_df.index[-1])[:10]
    oos_start = str(oos_df.index[0].date()) if hasattr(oos_df.index[0], 'date') else str(oos_df.index[0])[:10]

    # Build param combos
    grid = custom_grid or PARAM_GRIDS.get(algo_id, {})
    if not grid:
        # Single default run
        param_combos = [{}]
    else:
        keys = list(grid.keys())
        values = list(grid.values())
        param_combos = [dict(zip(keys, combo)) for combo in itertools.product(*values)]

    logger.info("Optimizing %s on %s: %d combos, IS=%d bars, OOS=%d bars",
                algo_id, asset, len(param_combos), len(is_df), len(oos_df))

    # IS grid search (vectorbt)
    is_results = _vbt_grid_search(is_df, algo_id, param_combos, stop_pct, hold_bars)

    # Filter: min trades gate
    is_results = [r for r in is_results if r["stats"]["n_trades"] >= min_trades]

    if not is_results:
        return OptResult(
            algo_id=algo_id, asset=asset, start=start, end=end,
            is_end=is_end, oos_start=oos_start,
            n_combos_tested=len(param_combos),
            ranking=[], best={},
        )

    # Sort by IS Sharpe
    is_results.sort(key=lambda x: x["stats"]["sharpe"], reverse=True)
    top_is = is_results[:top_n]

    # OOS validation on top IS combos
    ranking = []
    for r in top_is:
        try:
            oos_res = _numpy_search(oos_df, algo_id, [r["params"]], stop_pct, hold_bars)
            oos_stats = oos_res[0]["stats"] if oos_res else {"total_return": 0, "sharpe": -99, "max_dd": 0, "win_rate": 0, "n_trades": 0}
        except Exception:
            oos_stats = {"total_return": 0, "sharpe": -99, "max_dd": 0, "win_rate": 0, "n_trades": 0}

        # Alpha decay score: how much Sharpe degrades IS→OOS
        is_sr = r["stats"]["sharpe"]
        oos_sr = oos_stats["sharpe"]
        decay = is_sr - oos_sr  # lower = better

        ranking.append({
            "params": r["params"],
            "is_stats": r["stats"],
            "oos_stats": oos_stats,
            "sharpe_decay": round(decay, 4),
            "rank_score": round(
                r["stats"]["sharpe"] * 0.6 + oos_stats["sharpe"] * 0.4, 4
            ),
        })

    # Re-sort by rank_score (IS-weighted, OOS-penalised)
    ranking.sort(key=lambda x: x["rank_score"], reverse=True)
    best = ranking[0] if ranking else {}

    return OptResult(
        algo_id=algo_id,
        asset=asset,
        start=start,
        end=end,
        is_end=is_end,
        oos_start=oos_start,
        n_combos_tested=len(param_combos),
        ranking=ranking,
        best=best,
    )


def optimize_all_algos(
    asset: str,
    start: str,
    end: str,
    algo_ids: list[str] | None = None,
    **kwargs,
) -> dict[str, dict]:
    """
    Run optimize_algo for multiple algos. Returns dict keyed by algo_id.
    Pass algo_ids=None to run all 27.
    """
    ids = algo_ids or list(ALGO_REGISTRY.keys())
    results = {}
    for aid in ids:
        try:
            r = optimize_algo(aid, asset, start, end, **kwargs)
            results[aid] = r.to_dict()
        except Exception as exc:
            results[aid] = {"error": str(exc)}
    return results
