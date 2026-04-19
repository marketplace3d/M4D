"""
algo_optimizer.py — Optuna TPE parameter search for M4D signals
================================================================
Replaces Cartesian grid sweeps with intelligent sampling.

Optuna TPE (Tree-structured Parzen Estimator) finds high-scoring
parameter regions ~10x faster than exhaustive grids by building a
probabilistic model of which regions are promising.

Same output contract as run_signal_grid() in algo_signals.py:
    list of result dicts sorted by boom_rank_score descending

Usage:
    from ds_app.algo_optimizer import optimize_signal
    results = optimize_signal("ob_fvg", df, symbol="NVDA", n_trials=80)

The interface layer (Django views, React, JSON shape) is unchanged.
Only the search engine is different.
"""

from __future__ import annotations

import logging
import warnings
from typing import Any

import optuna
import pandas as pd

from .algo_signals import SIGNAL_REGISTRY, boom_rank_score

# Suppress Optuna's verbose trial logs — we surface the top results ourselves
optuna.logging.set_verbosity(optuna.logging.WARNING)
logging.getLogger("optuna").setLevel(logging.WARNING)


# ── Search space definitions ───────────────────────────────────────────────
# Each entry maps param_name → (type, low, high, [step|choices])
# "int"   → suggest_int(name, low, high, step=step)
# "float" → suggest_float(name, low, high, step=step)  [step=None = continuous]
# "cat"   → suggest_categorical(name, choices)

SEARCH_SPACES: dict[str, dict[str, tuple]] = {
    "ema_ribbon": {
        "fast_span":        ("int",   3, 21, 1),
        "atr_mult":         ("float", 0.7, 1.5, None),
        "hold_bars":        ("int",   3, 20, 1),
        "stop_loss_pct":    ("float", 0.4, 1.5, None),
        "require_fresh_cross": ("cat", [True, False]),
    },
    "ob_fvg": {
        "ob_lookback":      ("int",   5, 30, 1),
        "displacement_bars":("int",   2, 6, 1),
        "return_tol_pct":   ("float", 0.1, 1.5, None),
        "fvg_min_gap_pct":  ("float", 0.01, 0.3, None),
        "use_fvg":          ("cat",   [True, False]),
        "use_ob":           ("cat",   [True, False]),
        "atr_mult":         ("float", 0.7, 1.4, None),
        "hold_bars":        ("int",   4, 20, 1),
    },
    "kc_breakout": {
        "kc_span":          ("int",   10, 40, 1),
        "kc_mult":          ("float", 1.2, 3.5, None),
        "vol_surge_mult":   ("float", 1.0, 2.5, None),
        "atr_mult":         ("float", 0.7, 1.4, None),
        "hold_bars":        ("int",   3, 15, 1),
    },
    "accel_range": {
        "accel_bars":       ("int",   2, 5, 1),
        "trend_ema":        ("int",   20, 150, 5),
        "atr_mult":         ("float", 0.7, 1.4, None),
        "hold_bars":        ("int",   3, 15, 1),
        "require_range_expand": ("cat", [True, False]),
    },
    "mfi_cross": {
        "mfi_len":          ("int",   7, 30, 1),
        "cross_level":      ("float", 35.0, 65.0, None),
        "atr_mult":         ("float", 0.7, 1.4, None),
        "hold_bars":        ("int",   4, 20, 1),
        "use_divergence":   ("cat",   [True, False]),
    },
    "stage2": {
        "ma_span":          ("int",   80, 250, 5),
        "base_bars":        ("int",   20, 120, 5),
        "base_range_pct":   ("float", 5.0, 30.0, None),
        "vol_surge_mult":   ("float", 1.1, 2.5, None),
        "hold_bars":        ("int",   10, 40, 1),
    },
    "choc_bos": {
        "swing_lookback":   ("int",   5, 30, 1),
        "vol_confirm_mult": ("float", 1.0, 2.0, None),
        "atr_mult":         ("float", 0.7, 1.4, None),
        "hold_bars":        ("int",   4, 20, 1),
        "require_choch":    ("cat",   [True, False]),
    },
    # BOOM signals
    "darvas": {
        "squeeze_len":      ("int",   8, 30, 1),
        "darvas_lookback":  ("int",   5, 30, 1),
        "rvol_mult":        ("float", 1.0, 2.5, None),
        "hold_bars":        ("int",   2, 12, 1),
        "atr_mult":         ("float", 0.8, 1.3, None),
        "min_vote":         ("int",   2, 5, 1),
    },
    "arrows": {
        "squeeze_len":      ("int",   8, 30, 1),
        "hold_bars":        ("int",   2, 12, 1),
        "atr_mult":         ("float", 0.8, 1.3, None),
    },
    # JEDI-00 master ensemble signal (5m/60d Optuna target; validated on 1m)
    # Key design constraint: COUNCIL VOTE ALIGNMENT is primary, but too strict
    # filters leave <5 trades/symbol → Optuna needs to find the sweet spot.
    # Session params tunable so we can loosen the window if trades are too rare.
    # iter-01: added vol-weighted decel, Friday scalar, ATR slope axes.
    "jedi_00": {
        "min_agree":            ("int",   1, 3, 1),      # 1=loose, 3=strict alignment
        "accel_bars":           ("int",   2, 3, 1),
        "atr_mult":             ("float", 0.5, 1.3, None),  # loosened to 0.5 to generate trades
        "decel_window":         ("int",   1, 3, 1),
        "decel_thresh":         ("float", 0.15, 0.6, None),
        "hold_bars":            ("int",   5, 20, 1),
        "stop_loss_pct":        ("float", 0.2, 0.8, None),
        "profit_target_pct":    ("float", 0.2, 1.0, None),
        "kelly_base_fraction":  ("float", 0.03, 0.15, None),
        "require_range_expand": ("cat",   [True, False]),
        "exit_mode":            ("cat",   ["ema13", "holdbars"]),
        # Session / doldrums search axes — "OPT THIS" directive
        # 780=13:00, 810=13:30, 840=14:00, 870=14:30 ET (minutes since midnight)
        "session_cutoff_et":    ("cat",   [780, 810, 840, 870]),
        "friday_ok":            ("cat",   [True, False]),
        # iter-01: Volume-Weighted Decel axes
        "decel_require_volume": ("cat",   [True, False]),
        "decel_volume_pct_of_entry": ("float", 0.3, 0.8, None),
        # iter-01: Friday Gap-Risk Scalar (only sampled when friday_ok=True)
        "friday_kelly_scalar":  ("float", 0.5, 1.0, None),
        # iter-01: ATR Slope blow-off filter
        "atr_slope_thresh":     ("float", 0.08, 0.25, None),
        "atr_slope_stop_mult":  ("float", 1.0, 1.5, None),
    },
}


def _suggest_params(trial: optuna.Trial, signal_name: str) -> dict[str, Any]:
    """Build a param dict from Optuna trial suggestions."""
    space = SEARCH_SPACES.get(signal_name, {})
    params: dict[str, Any] = {}
    for name, spec in space.items():
        kind = spec[0]
        if kind == "int":
            _, lo, hi, step = spec
            params[name] = trial.suggest_int(name, lo, hi, step=step or 1)
        elif kind == "float":
            _, lo, hi, step = spec
            if step is None:
                params[name] = trial.suggest_float(name, lo, hi)
            else:
                params[name] = trial.suggest_float(name, lo, hi, step=step)
        elif kind == "cat":
            _, choices = spec[0], spec[1]
            params[name] = trial.suggest_categorical(name, choices)
    return params


def _objective_jedi(
    trial: optuna.Trial,
    df: pd.DataFrame,
    symbol: str,
    flat_eod: bool,
    min_trades: int,
) -> float:
    """Optuna objective for JEDI-00 signal."""
    from .jedi_signal import JediParams, jedi_run_one

    suggested = _suggest_params(trial, "jedi_00")
    default_p = JediParams()
    fields = {f: getattr(default_p, f) for f in default_p.__dataclass_fields__}
    fields.update(suggested)

    try:
        p = JediParams(**fields)
    except Exception:
        return -999.0

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            result = jedi_run_one(df, p, symbol=symbol, flat_eod=flat_eod)
    except Exception:
        return -999.0

    result.pop("_stats", None)
    if result.get("trades", 0) < min_trades:
        return -500.0

    score = boom_rank_score(result)
    trial.set_user_attr("trades", result.get("trades", 0))
    trial.set_user_attr("return_pct", result.get("return_pct", 0.0))
    trial.set_user_attr("win_rate_pct", result.get("win_rate_pct", 0.0))
    trial.set_user_attr("max_dd_pct", result.get("max_dd_pct", 0.0))
    return score


def _objective_algo_signal(
    trial: optuna.Trial,
    signal_name: str,
    df: pd.DataFrame,
    symbol: str,
    flat_eod: bool,
    min_trades: int,
) -> float:
    """Optuna objective for SIGNAL_REGISTRY signals."""
    if signal_name == "jedi_00":
        return _objective_jedi(trial, df, symbol, flat_eod, min_trades)

    reg = SIGNAL_REGISTRY[signal_name]
    suggested = _suggest_params(trial, signal_name)
    default_p = reg["default_params"]
    fields = {f: getattr(default_p, f) for f in default_p.__dataclass_fields__}
    fields.update(suggested)

    try:
        p = reg["params_cls"](**fields)
    except Exception:
        return -999.0

    try:
        feat = reg["features_fn"](df, p)
    except Exception:
        return -999.0

    from .boom_backtest import _make_strategy
    from backtesting import Backtest

    try:
        strat = _make_strategy(
            feat, p.hold_bars, p.stop_loss_pct, flat_eod,
            p.exit_mode, getattr(p, "break_even_offset_pct", 0.05),
        )
        bt = Backtest(df, strat, cash=100_000, commission=0.0015, spread=0.0008,
                      exclusive_orders=True, finalize_trades=True)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            stats = bt.run()
    except Exception:
        return -999.0

    result = {
        "return_pct": float(stats.get("Return [%]", 0.0) or 0.0),
        "win_rate_pct": float(stats.get("Win Rate [%]", 0.0) or 0.0),
        "max_dd_pct": abs(float(stats.get("Max. Drawdown [%]", 0.0) or 0.0)),
        "trades": int(stats.get("# Trades", 0) or 0),
    }

    if result["trades"] < min_trades:
        return -500.0  # not enough trades — penalise, don't prune

    score = boom_rank_score(result)
    # Store extras for later retrieval
    trial.set_user_attr("trades", result["trades"])
    trial.set_user_attr("return_pct", result["return_pct"])
    trial.set_user_attr("win_rate_pct", result["win_rate_pct"])
    trial.set_user_attr("max_dd_pct", result["max_dd_pct"])
    return score


def optimize_signal(
    signal_name: str,
    df: pd.DataFrame,
    symbol: str = "SPY",
    flat_eod: bool = False,
    n_trials: int = 80,
    min_trades: int = 5,
    timeout: float | None = 60.0,
    n_top: int = 20,
) -> list[dict]:
    """
    Optuna TPE search over SEARCH_SPACES[signal_name].

    Returns list of result dicts sorted by boom_rank_score descending.
    Same shape as run_signal_grid() — drop-in replacement.

    n_trials:  max number of Optuna trials (default 80 — usually sufficient)
    timeout:   max wall-clock seconds (None = unlimited)
    """
    if signal_name not in SEARCH_SPACES:
        raise ValueError(f"No search space defined for '{signal_name}'. Valid: {list(SEARCH_SPACES)}")

    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=42, n_startup_trials=10),
        pruner=optuna.pruners.NopPruner(),
    )

    objective = lambda trial: _objective_algo_signal(
        trial, signal_name, df, symbol, flat_eod, min_trades
    )

    study.optimize(objective, n_trials=n_trials, timeout=timeout, show_progress_bar=False)

    # Reconstruct result rows from completed trials
    rows = []
    for t in study.trials:
        if t.state != optuna.trial.TrialState.COMPLETE:
            continue
        score = t.value if t.value is not None else -999.0
        row: dict = {
            "symbol": symbol,
            "signal": signal_name,
            "boom_rank_score": score,
            "trades": t.user_attrs.get("trades", 0),
            "return_pct": t.user_attrs.get("return_pct", 0.0),
            "win_rate_pct": t.user_attrs.get("win_rate_pct", 0.0),
            "max_dd_pct": t.user_attrs.get("max_dd_pct", 0.0),
            "trial_number": t.number,
            **t.params,
        }
        rows.append(row)

    rows.sort(key=lambda r: r["boom_rank_score"], reverse=True)
    return rows[:n_top]


def optimize_signal_multisymbol(
    signal_name: str,
    frames: dict[str, pd.DataFrame],
    flat_eod: bool = False,
    n_trials: int = 60,
    min_trades: int = 5,
    timeout: float | None = 90.0,
    n_top: int = 20,
) -> list[dict]:
    """
    Optimize across multiple symbols simultaneously.
    Objective = mean boom_rank_score across all symbols in frames.
    Promotes params that work broadly, not just on one ticker.
    """
    if signal_name not in SEARCH_SPACES:
        raise ValueError(f"No search space for '{signal_name}'")

    reg = SIGNAL_REGISTRY.get(signal_name)

    def multi_objective(trial: optuna.Trial) -> float:
        suggested = _suggest_params(trial, signal_name)
        scores = []
        total_trades = 0

        for sym, df in frames.items():
            if reg:
                default_p = reg["default_params"]
                fields = {f: getattr(default_p, f) for f in default_p.__dataclass_fields__}
                fields.update(suggested)
                try:
                    p = reg["params_cls"](**fields)
                    feat = reg["features_fn"](df, p)
                except Exception:
                    continue

                from .boom_backtest import _make_strategy
                from backtesting import Backtest
                try:
                    strat = _make_strategy(
                        feat, p.hold_bars, p.stop_loss_pct, flat_eod,
                        p.exit_mode, getattr(p, "break_even_offset_pct", 0.05),
                    )
                    bt = Backtest(df, strat, cash=100_000, commission=0.0015, spread=0.0008,
                                  exclusive_orders=True, finalize_trades=True)
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        stats = bt.run()
                    result = {
                        "return_pct": float(stats.get("Return [%]", 0.0) or 0.0),
                        "win_rate_pct": float(stats.get("Win Rate [%]", 0.0) or 0.0),
                        "max_dd_pct": abs(float(stats.get("Max. Drawdown [%]", 0.0) or 0.0)),
                        "trades": int(stats.get("# Trades", 0) or 0),
                    }
                    total_trades += result["trades"]
                    scores.append(boom_rank_score(result))
                except Exception:
                    continue

        if not scores or total_trades < min_trades * len(frames) // 2:
            return -500.0
        return sum(scores) / len(scores)

    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=42, n_startup_trials=8),
    )
    study.optimize(multi_objective, n_trials=n_trials, timeout=timeout, show_progress_bar=False)

    rows = []
    for t in study.trials:
        if t.state != optuna.trial.TrialState.COMPLETE:
            continue
        rows.append({
            "signal": signal_name,
            "symbols": list(frames.keys()),
            "boom_rank_score": t.value or -999.0,
            "trial_number": t.number,
            **t.params,
        })

    rows.sort(key=lambda r: r["boom_rank_score"], reverse=True)
    return rows[:n_top]


def importance_report(signal_name: str, df: pd.DataFrame, symbol: str = "SPY",
                      n_trials: int = 120, min_trades: int = 3) -> dict:
    """
    Run Optuna and return parameter importance scores.
    Tells you which params actually move the needle.
    """
    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=42, n_startup_trials=15),
    )
    objective = lambda trial: _objective_algo_signal(trial, signal_name, df, symbol, False, min_trades)
    study.optimize(objective, n_trials=n_trials, timeout=90.0, show_progress_bar=False)

    try:
        importance = optuna.importance.get_param_importances(study)
    except Exception:
        importance = {}

    completed = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
    best = study.best_trial if completed else None

    return {
        "signal": signal_name,
        "symbol": symbol,
        "n_trials": len(completed),
        "best_score": best.value if best else None,
        "best_params": best.params if best else {},
        "param_importance": dict(importance),
    }
