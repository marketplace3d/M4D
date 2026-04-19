from __future__ import annotations

from itertools import islice, product
import math
from typing import Any

import numpy as np
import pandas as pd
import vectorbt as vbt

from .boom_backtest import (
    BOOM_DEFAULT_BENCH_SYMBOL,
    BOOM_LIQUID_UNIVERSE_DEFAULT,
    BoomParams,
    _boom_features,
    _darvas_breakout,
    _first_half_market_mask,
    _load_universe_frames,
    _rolling_squeeze,
    _rvol,
    boom_expansion_param_list,
)

# Coarse grids → ~1–5k combos before max_combos cap (11×9×14 = 1386).
VB_DEFAULT_SQUEEZE = tuple(range(10, 31, 2))
VB_DEFAULT_DARVAS = tuple(range(8, 25, 2))
VB_DEFAULT_RVOL = tuple(round(float(x), 3) for x in np.linspace(1.0, 2.0, 14))
VB_MAX_COMBOS_HARD = 50_000


def _vbt_freq_for_index(index: pd.Index) -> str:
    """vectorbt sharpe/drawdown need a Timedelta-like freq; pandas 'B' breaks Timedelta()."""
    if not isinstance(index, pd.DatetimeIndex) or len(index) < 2:
        return "1D"
    inferred = pd.infer_freq(index)
    if inferred is not None and inferred != "B":
        return str(inferred)
    delta = index[1] - index[0]
    sec = float(delta.total_seconds())
    if 120 <= sec <= 400:
        return "5min"
    if 400 < sec <= 1200:
        return "15min"
    if 1200 < sec <= 5400:
        return "1h"
    return "1D"


def _param_key(sq: int, dv: int, rv: float) -> str:
    return f"sq{sq}_dv{dv}_rv{int(round(float(rv) * 1000)):04d}"


def _atr_gate_series(df: pd.DataFrame, atr_mult: float) -> pd.Series:
    prev_close = df["Close"].shift(1)
    tr = pd.concat(
        [
            (df["High"] - df["Low"]).abs(),
            (df["High"] - prev_close).abs(),
            (df["Low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr_fast = tr.ewm(span=14, adjust=False).mean()
    atr_base = atr_fast.ewm(span=50, adjust=False).mean()
    return (atr_fast > (atr_base * float(atr_mult))).fillna(False)


def _ema13_exit_series(df: pd.DataFrame) -> pd.Series:
    ema13 = df["Close"].ewm(span=13, adjust=False).mean()
    prev_close = df["Close"].shift(1)
    return ((prev_close >= ema13.shift(1)) & (df["Close"] < ema13)).fillna(False)


def _build_entries_exits(
    df: pd.DataFrame,
    combos: list[tuple[int, int, float]],
    squeeze_m: dict[int, pd.Series],
    release_m: dict[int, pd.Series],
    rvol_s: pd.Series,
    trend: pd.Series,
    break_m: dict[int, pd.Series],
    atr_ok: pd.Series,
    fh: pd.Series,
    min_vote: int,
    init_cash: float,
    fees: float,
    sl_stop: float | None = None,
) -> tuple[Any, list[tuple[int, int, float]], list[str]]:
    """
    Pre-cast shared masks once; pre-allocate (n_bars, n_combos) bool matrix; build combo_specs
    and column names in the combo loop; one DataFrame from ndarray; 1-D exit Series for vbt.
    """
    # 1. Pre-cast shared masks once (avoids repeated casts per combo on long intraday bars).
    trend_i = trend.astype(np.int8)
    tr_i8 = np.asarray(trend_i, dtype=np.int8)
    tr_b = tr_i8.astype(bool, copy=False)
    atr_arr = atr_ok.to_numpy(dtype=bool, copy=False)
    fh_arr = fh.to_numpy(dtype=bool, copy=False)
    rvol_arr = rvol_s.to_numpy(dtype=np.float32, copy=False)
    close = df["Close"]
    idx = df.index

    sq_np = {k: v.to_numpy(dtype=np.int8, copy=False) for k, v in squeeze_m.items()}
    rel_np = {k: v.to_numpy(dtype=np.int8, copy=False) for k, v in release_m.items()}
    brk_np = {k: v.to_numpy(dtype=bool, copy=False) for k, v in break_m.items()}

    # 2. Pre-compute exit array once (same for every column).
    ex_arr = _ema13_exit_series(df).to_numpy(dtype=bool, copy=False)

    # 3. Pre-allocated entry matrix; one rv_hit per combo (vote + gate).
    n_bars = len(idx)
    n_combos = len(combos)
    entry_mat = np.empty((n_bars, n_combos), dtype=bool)
    combo_specs: list[tuple[int, int, float]] = []
    names: list[str] = []
    mv = int(min_vote)

    for j, (sq, dv, rv) in enumerate(combos):
        sq_i, dv_i = int(sq), int(dv)
        rv_f = float(rv)
        rv_hit = rvol_arr > np.float32(rv_f)
        vote = (
            sq_np[sq_i]
            + rel_np[sq_i]
            + rv_hit.astype(np.int8)
            + tr_i8 * np.int8(2)
        )
        entry_mat[:, j] = (
            brk_np[dv_i]
            & rv_hit
            & tr_b
            & (vote >= mv)
            & atr_arr
            & fh_arr
        )
        names.append(_param_key(sq_i, dv_i, rv_f))
        combo_specs.append((sq_i, dv_i, rv_f))

    # 4. Single DataFrame from ndarray; 5. broadcast exit as 1-D Series.
    entries = pd.DataFrame(entry_mat, index=idx, columns=names)
    exits = pd.Series(ex_arr, index=idx)
    kw: dict = dict(
        init_cash=init_cash,
        fees=fees,
        freq=_vbt_freq_for_index(close.index),
        broadcast_kwargs=dict(norm_colnames=True),
    )
    if sl_stop is not None and float(sl_stop) > 0:
        kw["sl_stop"] = float(sl_stop)
    pf = vbt.Portfolio.from_signals(close, entries, exits, **kw)
    return pf, combo_specs, names


def run_boom_darvas_vectorbt_grid(
    symbol: str,
    timeframe: str,
    period: str,
    *,
    squeeze_lens: tuple[int, ...] | list[int] = VB_DEFAULT_SQUEEZE,
    darvas_lookbacks: tuple[int, ...] | list[int] = VB_DEFAULT_DARVAS,
    rvol_thresholds: tuple[float, ...] | list[float] = VB_DEFAULT_RVOL,
    min_vote: int = 2,
    atr_mult: float = 0.0,
    first_half_only: bool = True,
    max_combos: int = 8_000,
    init_cash: float = 100_000.0,
    fees: float = 0.0015,
    sl_stop: float | None = 0.0065,
) -> dict:
    """
    Mass Darvas-style BOOM entry (aligned with `signal=darvas` masks in boom_backtest)
    over a Cartesian grid — vectorbt runs all columns in one shot.

    Exit: 13 EMA cross down (BOOM `ema13`). Optional `sl_stop` as fraction (>0), e.g.
    0.0065 ≈ 0.65% stop from entry. No breakeven lock (screening only).

    atr_mult: Wilder-style EWM TR gate (see boom_backtest). Default 0 = off for screening density.
    Tighten (e.g. 1.0–1.05) to align closer to /boom-backtest/ and reduce sparse symbols.
    min_vote defaults to 2 on /vectorbt-boom/ (BOOM sweep/visual often use 3).
    """
    max_combos = max(1, min(int(max_combos), VB_MAX_COMBOS_HARD))
    sym = symbol.strip().upper()
    frames, data_src = _load_universe_frames([sym], timeframe, period)
    if sym not in frames:
        raise ValueError(f"No bars for {sym} ({timeframe}/{period})")
    df = frames[sym]
    n = len(df)
    # ~120 covers EWM(50) trend + max grid lookbacks; Yahoo 6mo 1d is often ~125 bars.
    if n < 120:
        raise ValueError(f"Need more bars (got {n}); try longer period or daily.")

    rvol_s = _rvol(df["Volume"], 20).fillna(0.0)
    trend = (df["Close"] > df["Close"].ewm(span=50, adjust=False).mean()).fillna(False)
    am = float(atr_mult)
    atr_ok = (
        _atr_gate_series(df, am) if am > 0 else pd.Series(True, index=df.index)
    )
    fh = (
        _first_half_market_mask(df.index).fillna(False)
        if first_half_only
        else pd.Series(True, index=df.index)
    )

    uniq_sq = sorted({int(x) for x in squeeze_lens})
    uniq_dv = sorted({int(x) for x in darvas_lookbacks})
    squeeze_m: dict[int, pd.Series] = {}
    release_m: dict[int, pd.Series] = {}
    for L in uniq_sq:
        sq = _rolling_squeeze(df["Close"], df["High"], df["Low"], L).fillna(False)
        squeeze_m[L] = sq
        release_m[L] = (~sq) & sq.shift(1, fill_value=False)
    break_m: dict[int, pd.Series] = {
        d: _darvas_breakout(df["High"], d).fillna(False) for d in uniq_dv
    }

    combos = list(
        islice(
            product(squeeze_lens, darvas_lookbacks, rvol_thresholds),
            max_combos,
        )
    )
    if not combos:
        raise ValueError("Empty parameter grid")

    typed_combos = [(int(sq), int(dv), float(rv)) for sq, dv, rv in combos]
    pf, combo_specs, entry_names = _build_entries_exits(
        df,
        typed_combos,
        squeeze_m,
        release_m,
        rvol_s,
        trend,
        break_m,
        atr_ok,
        fh,
        int(min_vote),
        init_cash,
        fees,
        sl_stop,
    )

    ret = pf.total_return()
    sharpe = pf.sharpe_ratio()
    dd = pf.max_drawdown()
    trades_n = pf.trades.count()
    try:
        win_rate_obj = pf.trades.win_rate()
    except Exception:
        win_rate_obj = None

    rows: list[dict] = []
    for col, (sq_v, dv_v, rv_v) in zip(entry_names, combo_specs, strict=True):
        try:
            tr = int(trades_n[col])
        except Exception:
            tr = -1
        rpv = float(ret[col])
        spv = float(sharpe[col])
        ddv = float(dd[col])
        wr = 0.0
        if win_rate_obj is not None:
            try:
                w = float(win_rate_obj[col])
                wr = (w * 100.0) if w <= 1.0 else w
            except Exception:
                wr = 0.0
        if not math.isfinite(wr):
            wr = 0.0
        trp = float(rpv * 100.0) if math.isfinite(rpv) else 0.0
        mdd = float(abs(ddv) * 100.0) if math.isfinite(ddv) else 0.0
        rows.append(
            {
                "param": col,
                "squeeze_len": sq_v,
                "darvas_lookback": dv_v,
                "rvol_mult": rv_v,
                "total_return_pct": trp,
                "sharpe": float(spv) if math.isfinite(spv) else 0.0,
                "max_dd_pct": mdd,
                "win_rate_pct": wr,
                "trades": tr,
                "boom_rank_score": round(_boom_rank_from_metrics(trp, mdd, wr), 6),
                "calmar_proxy": round(_calmar_proxy_from_metrics(trp, mdd), 6),
            }
        )

    combos_with_trades = sum(1 for r in rows if int(r.get("trades", 0)) > 0)

    def _darvas_boom_sort_key(r: dict) -> tuple:
        b = _boom_rank_from_metrics(
            r["total_return_pct"], r["max_dd_pct"], r["win_rate_pct"]
        )
        tr = int(r.get("trades", 0))
        return (-b, tr <= 0, -tr)

    top_boom = sorted(rows, key=_darvas_boom_sort_key)[:30]

    def _sharpe_key(r: dict) -> tuple:
        # Prefer rows that actually traded; Sharpe/return on zero trades is noise.
        sp = float(r["sharpe"]) if math.isfinite(float(r["sharpe"])) else float("-inf")
        return (r["trades"] <= 0, -sp, -float(r["total_return_pct"]))

    def _ret_key(r: dict) -> tuple:
        sp = float(r["sharpe"]) if math.isfinite(float(r["sharpe"])) else float("-inf")
        return (r["trades"] <= 0, -float(r["total_return_pct"]), -sp)

    ranked_sharpe = sorted(rows, key=_sharpe_key)
    ranked_ret = sorted(rows, key=_ret_key)

    def _collapse_identical_metrics(ranked: list[dict], *, limit: int) -> list[dict]:
        """Merge rows that share SQ/DV and identical PnL stats (only RVOL grid differed)."""
        by_key: dict[tuple, dict] = {}
        order: list[tuple] = []
        for r in ranked:
            key = (
                int(r["squeeze_len"]),
                int(r["darvas_lookback"]),
                int(r["trades"]),
                round(float(r["total_return_pct"]), 6),
                round(float(r["sharpe"]), 6),
                round(float(r["max_dd_pct"]), 6),
            )
            if key not in by_key:
                by_key[key] = {"template": dict(r), "rvols": [float(r["rvol_mult"])]}
                order.append(key)
            else:
                by_key[key]["rvols"].append(float(r["rvol_mult"]))
        out: list[dict] = []
        for key in order:
            agg = by_key[key]
            rvs = sorted(agg["rvols"])
            row = dict(agg["template"])
            if len(rvs) == 1:
                row["rvol_display"] = f"{rvs[0]:.3f}"
            else:
                row["rvol_display"] = f"{rvs[0]:.3f}–{rvs[-1]:.3f} ({len(rvs)} RVOL levels)"
            row["rvol_mult"] = rvs[len(rvs) // 2]
            out.append(row)
            if len(out) >= limit:
                break
        return out

    top_sh = _collapse_identical_metrics(ranked_sharpe, limit=30)
    top_rt = _collapse_identical_metrics(ranked_ret, limit=30)

    return {
        "symbol": sym,
        "timeframe": timeframe,
        "period": period,
        "data_source": data_src,
        "bars": n,
        "grid_size": len(combos),
        "max_combos_applied": max_combos,
        "min_vote": int(min_vote),
        "atr_mult": float(atr_mult),
        "first_half_only": bool(first_half_only),
        "fees": float(fees),
        "sl_stop": None if sl_stop is None else float(sl_stop),
        "combos_with_trades": int(combos_with_trades),
        "note": (
            "vectorbt mass screen: Darvas-style BOOM entry + EMA13 exit (+ optional stop). "
            "Refine finalists with /boom-backtest/ or /boom-visual/ (backtesting.py)."
        ),
        "top_sharpe": top_sh,
        "top_return": top_rt,
        "top_boom": top_boom,
        "rank_note": (
            "top_sharpe/top_return: legacy sorts. top_boom: same composite as /boom-backtest/ "
            "(return − 0.35|DD| + 0.05·win_rate, percent units). calmar_proxy on each row is "
            "return% / max(DD%, 0.01) — not annualized."
        ),
    }


def _expansion_col_key(p: BoomParams) -> str:
    return (
        f"sq{p.squeeze_len}_dv{p.darvas_lookback}_rv{int(round(float(p.rvol_mult) * 1000)):04d}"
        f"_h{p.hold_bars}_{p.signal_source[:4]}_{p.exit_mode}"
    )


def _expansion_vbt_column_identity(
    p: BoomParams,
    exit_mode: str,
) -> tuple:
    """
    Key for vectorbt (entries, exits, sl_stop): many grid points are inert duplicates.

    arrows: entry = slingshot + ATR + first_half only (SQ/DV/RVOL/hold ignored on entry).
    darvas+ema13: exit ignores hold_bars; entry uses SQ/DV/RVOL not hold.
    """
    em = str(exit_mode).strip().lower()
    atr = round(float(p.atr_mult), 9)
    fh = bool(p.first_half_only)
    sl = round(float(p.stop_loss_pct), 9)
    sig = str(p.signal_source).strip().lower()
    if sig == "arrows":
        if em == "ema13":
            return ("ar", "e13", atr, fh, sl)
        return ("ar", "hb", atr, fh, sl, int(p.hold_bars))
    if em == "ema13":
        return (
            "dv",
            "e13",
            int(p.squeeze_len),
            int(p.darvas_lookback),
            round(float(p.rvol_mult), 6),
            atr,
            fh,
            sl,
        )
    return (
        "dv",
        "hb",
        int(p.squeeze_len),
        int(p.darvas_lookback),
        round(float(p.rvol_mult), 6),
        int(p.hold_bars),
        atr,
        fh,
        sl,
    )


def _collapse_expansion_top_rows(rows: list[dict]) -> list[dict]:
    """Merge top rows that only differ on SQ/DV/RVOL/hold but share identical PnL stats."""
    from collections import OrderedDict

    def _pid(r: dict) -> tuple:
        return (
            r["symbol"],
            round(float(r["return_pct"]), 6),
            round(float(r["win_rate_pct"]), 4),
            round(float(r["max_dd_pct"]), 6),
            int(r["trades"]),
            str(r["signal_source"]),
            str(r["exit_mode"]),
        )

    groups: "OrderedDict[tuple, list[dict]]" = OrderedDict()
    for r in rows:
        k = _pid(r)
        groups.setdefault(k, []).append(r)
    out: list[dict] = []
    for grp in groups.values():
        if len(grp) == 1:
            out.append(dict(grp[0]))
            continue
        base = dict(grp[0])
        sqs = sorted({int(x["squeeze_len"]) for x in grp})
        dvs = sorted({int(x["darvas_lookback"]) for x in grp})
        rvs = sorted({float(x["rvol_mult"]) for x in grp})
        hs = sorted({int(x["hold_bars"]) for x in grp})
        base["sq_display"] = (
            f"{sqs[0]}–{sqs[-1]} ({len(sqs)} values)" if len(sqs) > 1 else str(sqs[0])
        )
        base["dv_display"] = (
            f"{dvs[0]}–{dvs[-1]} ({len(dvs)} values)" if len(dvs) > 1 else str(dvs[0])
        )
        base["rvol_display"] = (
            f"{rvs[0]:.2f}–{rvs[-1]:.2f} ({len(rvs)} levels)"
            if len(rvs) > 1
            else f"{rvs[0]:.2f}"
        )
        base["hold_display"] = (
            f"{hs[0]}–{hs[-1]} ({len(hs)} holds)" if len(hs) > 1 else str(hs[0])
        )
        base["collapsed_from"] = len(grp)
        out.append(base)
    return out


def _holdbars_exit_signals(entries: pd.Series, hold: int) -> pd.Series:
    """Exit on bar `hold` bars after each entry (exclusive single position, like BOOM Strategy)."""
    e = entries.fillna(False).to_numpy(dtype=bool)
    n = len(e)
    ex = np.zeros(n, dtype=bool)
    h = max(1, int(hold))
    i = 0
    while i < n:
        if e[i]:
            j = min(i + h, n - 1)
            ex[j] = True
            i = j + 1
        else:
            i += 1
    return pd.Series(ex, index=entries.index)


def _finite_float_local(x) -> float:
    try:
        v = float(x)
        return v if math.isfinite(v) else 0.0
    except Exception:
        return 0.0


def _boom_rank_from_metrics(return_pct: float, max_dd_pct: float, win_rate_pct: float) -> float:
    """BOOM sweep composite (percent units): return − 0.35|DD| + 0.05·win_rate."""
    return (
        _finite_float_local(return_pct)
        - 0.35 * abs(_finite_float_local(max_dd_pct))
        + 0.05 * _finite_float_local(win_rate_pct)
    )


def _calmar_proxy_from_metrics(return_pct: float, max_dd_pct: float) -> float:
    """Return% / max(DD%, 0.01) — window Calmar-like, not annualized."""
    ret = _finite_float_local(return_pct)
    dd = max(_finite_float_local(max_dd_pct), 0.01)
    return ret / dd


def _boom_expansion_boom_score(r: dict) -> float:
    """Same composite as /boom-backtest/ ranking (percent units)."""
    return _boom_rank_from_metrics(
        r["return_pct"], r["max_dd_pct"], r["win_rate_pct"]
    )


def _boom_expansion_calmar_proxy(r: dict) -> float:
    return _calmar_proxy_from_metrics(r["return_pct"], r["max_dd_pct"])


def _expansion_rank_sort_key(rank_mode: str, r: dict) -> tuple:
    """Lower tuple sorts first; we negate so higher score wins.

    ``dead`` (no fills) is compared *before* score so rows with trades always rank
    above zero-trade rows when both appear in the pool (e.g. ``min_trades=0``).
    Otherwise return≈0 / DD≈0 gives boom_score≈0, which beat negative returns.
    """
    rm = str(rank_mode).strip().lower()
    tr = int(r.get("trades", 0))
    dead = tr <= 0
    if rm == "calmar":
        cp = _boom_expansion_calmar_proxy(r)
        ret = _finite_float_local(r["return_pct"])
        return (dead, -cp, -tr, -ret)
    s = _boom_expansion_boom_score(r)
    return (dead, -s, -tr)


def run_boom_expansion_vectorbt_grid(
    *,
    timeframe: str,
    period: str,
    liquid_scan: bool = False,
    wide_grid: bool = False,
    symbols_override: list[str] | None = None,
    bench_symbol: str | None = None,
    max_combos: int = 2_000,
    limit_top: int = 12,
    signal_source: str = "darvas",
    exit_mode: str = "ema13",
    atr_mult: float = 1.05,
    first_half_only: bool = False,
    break_even_offset_pct: float = 0.05,
    min_trades: int = 1,
    init_cash: float = 100_000.0,
    fees: float = 0.0015,
    rank_mode: str = "boom",
) -> dict:
    """
    Same Cartesian grids and entry masks as `run_boom_expansion_grid` / `_boom_features`,
    executed in one vectorbt `Portfolio.from_signals` per symbol (columns = param combos).

    Approximation vs backtesting.py BOOM: no `flat_eod`, no break-even stop lift (only fixed
    `sl_stop` from `stop_loss_pct`). Use `/boom-backtest/` when you need full exit stack parity.

    rank_mode: ``boom`` (default) = same score as boom-backtest sweep; ``calmar`` = sort by
    return_pct / max(max_dd_pct, 0.01) (Calmar-like on the window, not annualized).
    """
    max_combos = max(1, min(int(max_combos), VB_MAX_COMBOS_HARD))
    exit_mode = str(exit_mode).strip().lower()
    if exit_mode not in ("ema13", "holdbars"):
        exit_mode = "ema13"
    signal_source = str(signal_source).strip().lower()
    if signal_source not in ("arrows", "darvas"):
        signal_source = "darvas"

    if liquid_scan:
        if symbols_override:
            universe = [s.strip().upper() for s in symbols_override if s.strip()]
        else:
            universe = list(BOOM_LIQUID_UNIVERSE_DEFAULT)
        if not universe:
            universe = list(BOOM_LIQUID_UNIVERSE_DEFAULT)
    else:
        sym = (bench_symbol or BOOM_DEFAULT_BENCH_SYMBOL).strip().upper()
        universe = [sym]

    param_list = boom_expansion_param_list(
        liquid_scan=liquid_scan,
        wide_grid=wide_grid,
        signal_source=signal_source,
        atr_mult=float(atr_mult),
        first_half_only=bool(first_half_only),
        exit_mode=exit_mode,
        break_even_offset_pct=float(break_even_offset_pct),
    )
    params_slice = param_list[:max_combos]
    if not params_slice:
        raise ValueError("Empty BOOM expansion param list")

    rm = str(rank_mode).strip().lower()
    if rm not in ("boom", "calmar"):
        rm = "boom"

    frames, data_src = _load_universe_frames(universe, timeframe, period)
    rows: list[dict] = []
    for sym, df in frames.items():
        n = len(df)
        if n < 30:
            continue
        entry_cols: dict[str, pd.Series] = {}
        exit_cols: dict[str, pd.Series] = {}
        sl_fracs: dict[str, float] = {}
        identity_to_col: dict[tuple, str] = {}
        param_to_col: list[tuple[BoomParams, str]] = []
        for p in params_slice:
            ident = _expansion_vbt_column_identity(p, exit_mode)
            if ident not in identity_to_col:
                col = _expansion_col_key(p)
                identity_to_col[ident] = col
                feat = _boom_features(df, p)
                ent = feat["entry"].fillna(False)
                entry_cols[col] = ent
                if exit_mode == "holdbars":
                    exit_cols[col] = _holdbars_exit_signals(ent, p.hold_bars)
                else:
                    exit_cols[col] = feat["exit_ema13"].fillna(False)
                sl_fracs[col] = max(0.0, float(p.stop_loss_pct)) / 100.0
            param_to_col.append((p, identity_to_col[ident]))

        entries = pd.DataFrame(entry_cols, index=df.index)
        exits = pd.DataFrame(exit_cols, index=df.index)
        close = df["Close"]
        kw: dict = dict(init_cash=init_cash, fees=fees, freq=_vbt_freq_for_index(close.index))
        u_sl = {v for v in sl_fracs.values()}
        if len(u_sl) == 1:
            slv = next(iter(u_sl))
            if slv > 0:
                kw["sl_stop"] = slv
        else:
            sl_df = pd.DataFrame({c: sl_fracs[c] for c in entries.columns}, index=df.index)
            if sl_df.max().max() > 0:
                kw["sl_stop"] = sl_df

        pf = vbt.Portfolio.from_signals(close, entries, exits, **kw)
        ret = pf.total_return()
        dd = pf.max_drawdown()
        trades_n = pf.trades.count()
        try:
            win_rate_obj = pf.trades.win_rate()
        except Exception:
            win_rate_obj = None

        for p, col in param_to_col:
            try:
                tr = int(trades_n[col])
            except Exception:
                tr = -1
            rpv = float(ret[col])
            ddv = float(dd[col])
            wr = 0.0
            if win_rate_obj is not None:
                try:
                    w = float(win_rate_obj[col])
                    wr = (w * 100.0) if w <= 1.0 else w
                except Exception:
                    wr = 0.0
            if not math.isfinite(wr):
                wr = 0.0
            row = {
                "symbol": sym,
                "squeeze_len": p.squeeze_len,
                "darvas_lookback": p.darvas_lookback,
                "rvol_mult": float(p.rvol_mult),
                "hold_bars": p.hold_bars,
                "grok_x_weight": float(p.grok_x_weight),
                "min_vote": int(p.min_vote),
                "stop_loss_pct": float(p.stop_loss_pct),
                "signal_source": p.signal_source,
                "exit_mode": p.exit_mode,
                "break_even_offset_pct": float(p.break_even_offset_pct),
                "atr_mult": float(p.atr_mult),
                "first_half_only": bool(p.first_half_only),
                "return_pct": float(rpv * 100.0) if math.isfinite(rpv) else 0.0,
                "win_rate_pct": wr,
                "max_dd_pct": abs(float(ddv) * 100.0) if math.isfinite(ddv) else 0.0,
                "trades": tr,
                "param_key": col,
                "vbt_column": col,
            }
            row["boom_rank_score"] = round(_boom_expansion_boom_score(row), 6)
            row["calmar_proxy"] = round(_boom_expansion_calmar_proxy(row), 6)
            rows.append(row)

    meets_min = [r for r in rows if int(r.get("trades", 0)) >= int(min_trades)]
    rank_pool = meets_min if meets_min else rows
    ranked = sorted(rank_pool, key=lambda r: _expansion_rank_sort_key(rm, r))
    top = _collapse_expansion_top_rows(ranked)[: int(limit_top)]

    if signal_source == "arrows":
        inert_note = (
            "signal=arrows uses slingshot + ATR + first-half only; squeeze / Darvas / RVOL grid "
            "axes do not change the entry mask. "
        )
        if exit_mode == "ema13":
            inert_note += (
                "exit=ema13 ignores hold_bars — those columns are inert (duplicates are collapsed "
                "in the Top table; vectorbt runs one portfolio column per distinct signal)."
            )
        else:
            inert_note += "hold_bars affects only holdbars exits."
    elif exit_mode == "ema13":
        inert_note = (
            "exit=ema13 ignores hold_bars (only EMA cross + stop); duplicate holds share one vectorbt column."
        )
    else:
        inert_note = ""

    if liquid_scan:
        ds_label = "yfinance-movers" if symbols_override else "yfinance-liquid"
        if data_src == "synthetic":
            ds_label += "+synthetic"
        if symbols_override:
            ds_label += ":" + ",".join(sorted(frames.keys()))
    else:
        ds_label = (
            "synthetic-bench"
            if data_src == "synthetic"
            else f"yfinance-{universe[0].lower()}"
        )

    combos_with_trades = sum(1 for r in rows if int(r.get("trades", 0)) > 0)
    unique_vbt_cols = len({_expansion_vbt_column_identity(p, exit_mode) for p in params_slice})

    return {
        "engine": "vectorbt",
        "dataset": ds_label,
        "data_source": data_src,
        "timeframe": timeframe,
        "period": period,
        "liquid_scan": bool(liquid_scan),
        "wide_grid": bool(wide_grid),
        "symbols": sorted(frames.keys()),
        "signal_source": signal_source,
        "exit_mode": exit_mode,
        "atr_mult": float(atr_mult),
        "first_half_only": bool(first_half_only),
        "break_even_offset_pct": float(break_even_offset_pct),
        "min_trades": int(min_trades),
        "tested": len(rows),
        "param_sets": len(params_slice),
        "unique_signal_columns": int(unique_vbt_cols),
        "max_combos_applied": max_combos,
        "combos_with_trades": int(combos_with_trades),
        "top": top,
        "inert_axes_note": inert_note,
        "rank_mode": rm,
        "rank_note": (
            "boom: return_pct - 0.35*|max_dd_pct| + 0.05*win_rate_pct (matches boom-backtest). "
            "calmar: return_pct / max(max_dd_pct, 0.01) — window Calmar-like, not annualized."
        ),
        "note": (
            "vectorbt BOOM expansion: same entry masks as /boom-backtest/; exits = EMA13 or "
            "hold-bars + fixed sl_stop from stop_loss_pct. Not modeled: flat_eod, break-even stop lift."
        ),
    }
