"""
algo_signals.py — M4D signal library
=====================================
Seven independent signal families.  Each follows the same contract as
`_boom_features` in boom_backtest.py:

    _<name>_features(df: pd.DataFrame, p: <Name>Params) -> pd.DataFrame

Returns a copy of df with at minimum:
    entry       — bool Series, True = enter long this bar
    exit_ema13  — bool Series, True = close crosses below ema13 (universal exit)
    ema13       — float Series (reused by _make_strategy)

All Params are frozen dataclasses → hashable → safe as dict keys in grids.

Each signal has a companion sweep grid dict (axes to Cartesian-product over)
and a `<name>_run_one(df, p, symbol, flat_eod)` thin wrapper that calls
boom_backtest._make_strategy + backtesting.Backtest so Sword results are
identical in format to BOOM runs.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import product
from typing import Iterator

import numpy as np
import pandas as pd
from backtesting import Backtest

from .boom_backtest import _make_strategy, _rvol, _first_half_market_mask


# ── shared helpers ────────────────────────────────────────────────────────────

def _atr(high: pd.Series, low: pd.Series, close: pd.Series, fast: int = 14, base: int = 50):
    """Wilder-style two-span ATR gate (same as boom_backtest)."""
    prev = close.shift(1)
    tr = pd.concat([(high - low).abs(), (high - prev).abs(), (low - prev).abs()], axis=1).max(axis=1)
    atr_fast = tr.ewm(span=fast, adjust=False).mean()
    atr_base = atr_fast.ewm(span=base, adjust=False).mean()
    return atr_fast, atr_base


def _exit_ema13(close: pd.Series) -> tuple[pd.Series, pd.Series]:
    ema13 = close.ewm(span=13, adjust=False).mean()
    exit_sig = ((close.shift(1) >= ema13.shift(1)) & (close < ema13)).fillna(False)
    return ema13, exit_sig


def _run_one_signal(
    df: pd.DataFrame,
    feat: pd.DataFrame,
    p,
    symbol: str,
    flat_eod: bool,
) -> dict:
    """Generic Sword run for any features df.  p must have hold_bars, stop_loss_pct,
    exit_mode, break_even_offset_pct (use 0.05 default if not present)."""
    strat = _make_strategy(
        feat,
        p.hold_bars,
        p.stop_loss_pct,
        flat_eod,
        p.exit_mode,
        getattr(p, "break_even_offset_pct", 0.05),
    )
    bt = Backtest(df, strat, cash=100_000, commission=0.0015, spread=0.0008,
                  exclusive_orders=True, finalize_trades=True)
    stats = bt.run()
    return {
        "symbol": symbol,
        "return_pct": float(stats.get("Return [%]", 0.0)),
        "win_rate_pct": float(stats.get("Win Rate [%]", 0.0)),
        "max_dd_pct": abs(float(stats.get("Max. Drawdown [%]", 0.0))),
        "trades": int(stats.get("# Trades", 0)),
        "signal": type(p).__name__,
        **{k: getattr(p, k) for k in p.__dataclass_fields__},
    }


def boom_rank_score(row: dict) -> float:
    import math
    r = float(row.get("return_pct", 0.0) or 0.0)
    d = float(row.get("max_dd_pct", 0.0) or 0.0)
    w = float(row.get("win_rate_pct", 0.0) or 0.0)
    val = r - 0.35 * d + 0.05 * w
    return val if math.isfinite(val) else 0.0


# ══════════════════════════════════════════════════════════════════════════════
# 1.  EMA RIBBON STACK
#     Entry: all EMAs bullishly stacked (8 > 21 > 34 > 55 > 89) + price above
#     ema8 + fresh cross (prev close < ema8, curr close > ema8) + ATR gate.
#     Grid axes: fast_span, stack_spans (fixed), atr_mult, hold_bars.
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class EmaRibbonParams:
    fast_span: int = 8
    mid1_span: int = 21
    mid2_span: int = 34
    mid3_span: int = 55
    slow_span: int = 89
    require_fresh_cross: bool = True   # prev close < ema_fast; curr close > ema_fast
    atr_mult: float = 1.0
    hold_bars: int = 6
    stop_loss_pct: float = 0.7
    exit_mode: str = "ema13"
    break_even_offset_pct: float = 0.05

EMA_RIBBON_GRID = {
    "fast_span": [5, 8, 13],
    "atr_mult": [0.9, 1.0, 1.1],
    "hold_bars": [5, 8, 12],
    "stop_loss_pct": [0.6, 0.8],
}

def _ema_ribbon_features(df: pd.DataFrame, p: EmaRibbonParams) -> pd.DataFrame:
    out = df.copy()
    c = out["Close"]
    e_fast = c.ewm(span=p.fast_span, adjust=False).mean()
    e_m1   = c.ewm(span=p.mid1_span, adjust=False).mean()
    e_m2   = c.ewm(span=p.mid2_span, adjust=False).mean()
    e_m3   = c.ewm(span=p.mid3_span, adjust=False).mean()
    e_slow = c.ewm(span=p.slow_span, adjust=False).mean()

    full_stack = (e_fast > e_m1) & (e_m1 > e_m2) & (e_m2 > e_m3) & (e_m3 > e_slow)
    above_fast = c > e_fast

    if p.require_fresh_cross:
        fresh = (c.shift(1) < e_fast.shift(1)) & (c >= e_fast)
    else:
        fresh = above_fast

    atr_fast, atr_base = _atr(out["High"], out["Low"], c)
    atr_gate = atr_fast > (atr_base * p.atr_mult)

    out["entry"] = (full_stack & fresh & atr_gate).fillna(False)
    out["ema13"], out["exit_ema13"] = _exit_ema13(c)
    return out


def ema_ribbon_run_one(df: pd.DataFrame, p: EmaRibbonParams,
                       symbol: str = "SPY", flat_eod: bool = False) -> dict:
    return _run_one_signal(df, _ema_ribbon_features(df, p), p, symbol, flat_eod)


# ══════════════════════════════════════════════════════════════════════════════
# 2.  ORDER BLOCK + FAIR VALUE GAP  (ICT / CYBER-ICT)
#     Bullish OB: last down-candle before a 3-bar up-displacement.
#     FVG: gap between high[i-2] and low[i] on a bullish 3-bar sequence.
#     Entry: price returns into OB or FVG zone + 15m trend (ema50) + ATR gate.
#     Grid axes: ob_lookback, displacement_bars, return_tol_pct, atr_mult.
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class ObFvgParams:
    ob_lookback: int = 10           # bars back to search for qualifying OB
    displacement_bars: int = 3      # consecutive up bars after OB candle
    return_tol_pct: float = 0.3     # allow entry up to X% into OB body
    fvg_min_gap_pct: float = 0.05   # FVG must be >= X% of close
    use_fvg: bool = True
    use_ob: bool = True
    trend_span: int = 50
    atr_mult: float = 1.0
    hold_bars: int = 8
    stop_loss_pct: float = 0.8
    exit_mode: str = "holdbars"
    break_even_offset_pct: float = 0.05

OB_FVG_GRID = {
    "ob_lookback": [8, 12, 20],
    "displacement_bars": [2, 3, 4],
    "return_tol_pct": [0.2, 0.4, 0.6],
    "atr_mult": [0.9, 1.0, 1.1],
    "hold_bars": [5, 8, 12],
}

def _ob_fvg_features(df: pd.DataFrame, p: ObFvgParams) -> pd.DataFrame:
    out = df.copy()
    o, h, l, c, v = out["Open"], out["High"], out["Low"], out["Close"], out["Volume"]

    trend = (c > c.ewm(span=p.trend_span, adjust=False).mean()).fillna(False)
    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = (atr_fast > atr_base * p.atr_mult).fillna(False)

    n = len(out)
    ob_entry = np.zeros(n, dtype=bool)
    fvg_entry = np.zeros(n, dtype=bool)

    c_arr = c.values
    h_arr = h.values
    l_arr = l.values
    o_arr = o.values

    for i in range(p.ob_lookback + p.displacement_bars, n):
        # ── FVG: bullish gap between bar[i-2].high and bar[i].low ─────────────
        if p.use_fvg:
            # Standard 3-bar FVG: bar[i-2] high < bar[i] low  (gap exists)
            fvg_gap = l_arr[i] - h_arr[i - 2]
            if fvg_gap > 0:
                gap_pct = fvg_gap / c_arr[i] * 100
                if gap_pct >= p.fvg_min_gap_pct:
                    # Current bar "fills" into FVG from below: close <= fvg top
                    if c_arr[i] <= h_arr[i - 2] * (1 + p.return_tol_pct / 100):
                        fvg_entry[i] = True

        # ── OB: last down-candle before a displacement sequence ───────────────
        if p.use_ob:
            # Check for displacement: p.displacement_bars consecutive up bars ending at i-1
            displaced = all(
                c_arr[i - 1 - k] > o_arr[i - 1 - k]  # up candle
                for k in range(p.displacement_bars)
            )
            if displaced:
                # OB candle: last down candle before the displacement
                ob_idx = i - 1 - p.displacement_bars
                if ob_idx >= 0 and c_arr[ob_idx] < o_arr[ob_idx]:  # down candle
                    ob_high = o_arr[ob_idx]   # body top of bearish candle = open
                    ob_low  = c_arr[ob_idx]   # body bottom = close
                    ob_zone_top = ob_high * (1 + p.return_tol_pct / 100)
                    # Current bar retrace into OB zone
                    if ob_low <= c_arr[i] <= ob_zone_top:
                        ob_entry[i] = True

    signal = pd.Series(ob_entry | fvg_entry, index=out.index)
    out["entry"] = (signal & trend & atr_gate).fillna(False)
    out["ema13"], out["exit_ema13"] = _exit_ema13(c)
    return out


def ob_fvg_run_one(df: pd.DataFrame, p: ObFvgParams,
                   symbol: str = "SPY", flat_eod: bool = False) -> dict:
    return _run_one_signal(df, _ob_fvg_features(df, p), p, symbol, flat_eod)


# ══════════════════════════════════════════════════════════════════════════════
# 3.  KELTNER CHANNEL BREAKOUT + VOLUME SURGE
#     Entry: close > upper KC band + vol surge + ATR gate.
#     Grid axes: kc_span, kc_mult, vol_surge_mult, atr_mult, hold_bars.
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class KcBreakoutParams:
    kc_span: int = 20
    kc_mult: float = 2.0
    vol_surge_mult: float = 1.5    # vol / 20-bar mean
    atr_mult: float = 1.0
    hold_bars: int = 6
    stop_loss_pct: float = 0.8
    exit_mode: str = "ema13"
    break_even_offset_pct: float = 0.05

KC_BREAKOUT_GRID = {
    "kc_span": [14, 20, 30],
    "kc_mult": [1.5, 2.0, 2.5],
    "vol_surge_mult": [1.3, 1.5, 2.0],
    "atr_mult": [0.9, 1.0, 1.1],
    "hold_bars": [4, 6, 10],
}

def _kc_breakout_features(df: pd.DataFrame, p: KcBreakoutParams) -> pd.DataFrame:
    out = df.copy()
    c, h, l, v = out["Close"], out["High"], out["Low"], out["Volume"]

    ema_mid = c.ewm(span=p.kc_span, adjust=False).mean()
    atr_fast, atr_base = _atr(h, l, c)
    kc_upper = ema_mid + atr_fast * p.kc_mult

    vol_ratio = _rvol(v)
    vol_surge = vol_ratio >= p.vol_surge_mult

    above_kc = c > kc_upper
    atr_gate = atr_fast > (atr_base * p.atr_mult)

    out["entry"] = (above_kc & vol_surge & atr_gate).fillna(False)
    out["ema13"], out["exit_ema13"] = _exit_ema13(c)
    return out


def kc_breakout_run_one(df: pd.DataFrame, p: KcBreakoutParams,
                        symbol: str = "SPY", flat_eod: bool = False) -> dict:
    return _run_one_signal(df, _kc_breakout_features(df, p), p, symbol, flat_eod)


# ══════════════════════════════════════════════════════════════════════════════
# 4.  ACCELERATION + RANGE EXPANSION  (Wolfhound)
#     3 consecutive bars of increasing signed move (close-open) + range
#     expanding vs prior bar + trend + ATR gate.
#     Grid axes: accel_bars, require_range_expand, trend_ema, atr_mult.
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class AccelRangeParams:
    accel_bars: int = 3
    require_range_expand: bool = True
    trend_ema: int = 50
    atr_mult: float = 1.0
    hold_bars: int = 5
    stop_loss_pct: float = 0.7
    exit_mode: str = "holdbars"
    break_even_offset_pct: float = 0.05

ACCEL_RANGE_GRID = {
    "accel_bars": [2, 3, 4],
    "trend_ema": [30, 50, 100],
    "atr_mult": [0.9, 1.0, 1.1],
    "hold_bars": [4, 6, 8],
}

def _accel_range_features(df: pd.DataFrame, p: AccelRangeParams) -> pd.DataFrame:
    out = df.copy()
    c, h, l = out["Close"], out["High"], out["Low"]
    move = c - out["Open"]
    bar_range = h - l

    # All p.accel_bars consecutive moves must be positive and increasing
    accel = pd.Series(True, index=out.index)
    for k in range(p.accel_bars):
        accel = accel & (move.shift(k) > move.shift(k + 1)) & (move.shift(k) > 0)

    if p.require_range_expand:
        range_expand = bar_range > bar_range.shift(1)
        accel = accel & range_expand

    trend = (c > c.ewm(span=p.trend_ema, adjust=False).mean()).fillna(False)
    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > (atr_base * p.atr_mult)

    out["entry"] = (accel & trend & atr_gate).fillna(False)
    out["ema13"], out["exit_ema13"] = _exit_ema13(c)
    return out


def accel_range_run_one(df: pd.DataFrame, p: AccelRangeParams,
                        symbol: str = "SPY", flat_eod: bool = False) -> dict:
    return _run_one_signal(df, _accel_range_features(df, p), p, symbol, flat_eod)


# ══════════════════════════════════════════════════════════════════════════════
# 5.  MONEY FLOW INDEX CROSS  (Emerald Flow)
#     MFI(14) crosses above cross_level (default 50).
#     Divergence flag: price making lower low while MFI makes higher low = reversal.
#     Grid axes: mfi_len, cross_level, use_divergence, atr_mult.
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class MfiCrossParams:
    mfi_len: int = 14
    cross_level: float = 50.0
    use_divergence: bool = False    # if True, also fire on bullish divergence
    divergence_lookback: int = 10
    atr_mult: float = 1.0
    hold_bars: int = 6
    stop_loss_pct: float = 0.7
    exit_mode: str = "ema13"
    break_even_offset_pct: float = 0.05

MFI_CROSS_GRID = {
    "mfi_len": [10, 14, 20],
    "cross_level": [45.0, 50.0, 55.0],
    "atr_mult": [0.9, 1.0, 1.1],
    "hold_bars": [5, 8, 12],
}

def _mfi(high: pd.Series, low: pd.Series, close: pd.Series,
         volume: pd.Series, length: int) -> pd.Series:
    typical = (high + low + close) / 3
    raw_mf = typical * volume
    up = (typical > typical.shift(1)).fillna(False)
    pos_mf = raw_mf.where(up, 0.0).rolling(length).sum()
    neg_mf = raw_mf.where(~up, 0.0).rolling(length).sum()
    mfr = pos_mf / neg_mf.replace(0, np.nan)
    return (100 - 100 / (1 + mfr)).fillna(50.0)

def _mfi_cross_features(df: pd.DataFrame, p: MfiCrossParams) -> pd.DataFrame:
    out = df.copy()
    c, h, l, v = out["Close"], out["High"], out["Low"], out["Volume"]
    mfi = _mfi(h, l, c, v, p.mfi_len)

    # Cross: prev MFI < level, curr MFI >= level
    cross_up = (mfi.shift(1) < p.cross_level) & (mfi >= p.cross_level)

    divergence = pd.Series(False, index=out.index)
    if p.use_divergence:
        lb = p.divergence_lookback
        price_ll = c < c.rolling(lb).min().shift(1)       # price new low
        mfi_hl   = mfi > mfi.rolling(lb).min().shift(1)   # MFI not confirming
        divergence = (price_ll & mfi_hl).fillna(False)

    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > (atr_base * p.atr_mult)

    out["entry"] = ((cross_up | divergence) & atr_gate).fillna(False)
    out["ema13"], out["exit_ema13"] = _exit_ema13(c)
    return out


def mfi_cross_run_one(df: pd.DataFrame, p: MfiCrossParams,
                      symbol: str = "SPY", flat_eod: bool = False) -> dict:
    return _run_one_signal(df, _mfi_cross_features(df, p), p, symbol, flat_eod)


# ══════════════════════════════════════════════════════════════════════════════
# 6.  WEINSTEIN STAGE 2  (daily bars)
#     6-month base + price breaks above 30W (150d) MA + vol expansion.
#     Base = close held within base_range_pct of a flat MA for base_bars days.
#     Grid axes: ma_span, base_bars, base_range_pct, vol_surge_mult.
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class Stage2Params:
    ma_span: int = 150              # ~30 weeks on daily bars
    base_bars: int = 60             # min days in base (flat MA window)
    base_range_pct: float = 15.0    # max price oscillation in base as % of MA
    vol_surge_mult: float = 1.5
    atr_mult: float = 0.8           # looser gate for daily swing
    hold_bars: int = 20
    stop_loss_pct: float = 5.0
    exit_mode: str = "holdbars"
    break_even_offset_pct: float = 0.5

STAGE2_GRID = {
    "ma_span": [120, 150, 200],
    "base_bars": [40, 60, 90],
    "base_range_pct": [12.0, 15.0, 20.0],
    "vol_surge_mult": [1.3, 1.5, 2.0],
    "hold_bars": [15, 20, 30],
}

def _stage2_features(df: pd.DataFrame, p: Stage2Params) -> pd.DataFrame:
    out = df.copy()
    c, h, l, v = out["Close"], out["High"], out["Low"], out["Volume"]

    ma = c.rolling(p.ma_span).mean()
    ma_slope = (ma - ma.shift(p.base_bars)) / p.base_bars  # positive = uptrend resuming

    # Base condition: price within range_pct of MA for last base_bars
    price_dev = ((c - ma) / ma * 100).abs()
    in_base = price_dev.rolling(p.base_bars).max() < p.base_range_pct

    # Breakout: close crosses above MA (was below, now above)
    breaks_above = (c.shift(1) < ma.shift(1)) & (c >= ma)

    vol_ratio = _rvol(v)
    vol_surge = vol_ratio >= p.vol_surge_mult
    ma_rising = ma_slope > 0

    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > (atr_base * p.atr_mult)

    out["entry"] = (in_base.shift(1) & breaks_above & vol_surge & ma_rising & atr_gate).fillna(False)
    out["ema13"], out["exit_ema13"] = _exit_ema13(c)
    return out


def stage2_run_one(df: pd.DataFrame, p: Stage2Params,
                   symbol: str = "SPY", flat_eod: bool = False) -> dict:
    return _run_one_signal(df, _stage2_features(df, p), p, symbol, flat_eod)


# ══════════════════════════════════════════════════════════════════════════════
# 7.  CHANGE OF CHARACTER / BREAK OF STRUCTURE  (Market Shift / MS)
#     CHoCH: prior swing high broken + volume confirmation.
#     BOS: higher high after a sequence of higher lows.
#     Grid axes: swing_lookback, vol_confirm_mult, require_choch, atr_mult.
# ══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class ChocBosParams:
    swing_lookback: int = 10       # bars to identify swing high/low
    vol_confirm_mult: float = 1.2  # vol at break must be > mult × mean
    require_choch: bool = True     # require CHoCH (prior swing high broken), not just BOS
    trend_span: int = 50
    atr_mult: float = 1.0
    hold_bars: int = 6
    stop_loss_pct: float = 0.8
    exit_mode: str = "ema13"
    break_even_offset_pct: float = 0.05

CHOC_BOS_GRID = {
    "swing_lookback": [8, 10, 15, 20],
    "vol_confirm_mult": [1.1, 1.2, 1.5],
    "atr_mult": [0.9, 1.0, 1.1],
    "hold_bars": [5, 8, 12],
}

def _choc_bos_features(df: pd.DataFrame, p: ChocBosParams) -> pd.DataFrame:
    out = df.copy()
    c, h, l, v = out["Close"], out["High"], out["Low"], out["Volume"]

    lb = p.swing_lookback
    # Swing high: highest high over rolling window shifted by 1 (prior structure)
    prior_swing_high = h.shift(1).rolling(lb).max()
    # BOS: current close breaks above prior swing high
    bos = c > prior_swing_high

    if p.require_choch:
        # CHoCH: prior bar was bearish (close < open) → now break = character change
        prior_bearish = (c.shift(1) < out["Open"].shift(1)).fillna(False)
        signal = bos & prior_bearish
    else:
        signal = bos

    vol_confirm = _rvol(v) >= p.vol_confirm_mult
    trend = (c > c.ewm(span=p.trend_span, adjust=False).mean()).fillna(False)
    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > (atr_base * p.atr_mult)

    out["entry"] = (signal & vol_confirm & trend & atr_gate).fillna(False)
    out["ema13"], out["exit_ema13"] = _exit_ema13(c)
    return out


def choc_bos_run_one(df: pd.DataFrame, p: ChocBosParams,
                     symbol: str = "SPY", flat_eod: bool = False) -> dict:
    return _run_one_signal(df, _choc_bos_features(df, p), p, symbol, flat_eod)


# ══════════════════════════════════════════════════════════════════════════════
# REGISTRY — all signals, grids, run_one functions
# ══════════════════════════════════════════════════════════════════════════════

SIGNAL_REGISTRY: dict[str, dict] = {
    "ema_ribbon": {
        "params_cls": EmaRibbonParams,
        "features_fn": _ema_ribbon_features,
        "run_one_fn": ema_ribbon_run_one,
        "grid": EMA_RIBBON_GRID,
        "default_params": EmaRibbonParams(),
        "timeframe": "intraday",
        "description": "EMA 8/21/34/55/89 full bullish stack + fresh cross + ATR gate",
    },
    "ob_fvg": {
        "params_cls": ObFvgParams,
        "features_fn": _ob_fvg_features,
        "run_one_fn": ob_fvg_run_one,
        "grid": OB_FVG_GRID,
        "default_params": ObFvgParams(),
        "timeframe": "15m",
        "description": "Order Block + Fair Value Gap (ICT) with trend + ATR gate",
    },
    "kc_breakout": {
        "params_cls": KcBreakoutParams,
        "features_fn": _kc_breakout_features,
        "run_one_fn": kc_breakout_run_one,
        "grid": KC_BREAKOUT_GRID,
        "default_params": KcBreakoutParams(),
        "timeframe": "intraday",
        "description": "Keltner channel breakout + vol surge + ATR gate",
    },
    "accel_range": {
        "params_cls": AccelRangeParams,
        "features_fn": _accel_range_features,
        "run_one_fn": accel_range_run_one,
        "grid": ACCEL_RANGE_GRID,
        "default_params": AccelRangeParams(),
        "timeframe": "intraday",
        "description": "3-bar acceleration + expanding range + trend + ATR gate",
    },
    "mfi_cross": {
        "params_cls": MfiCrossParams,
        "features_fn": _mfi_cross_features,
        "run_one_fn": mfi_cross_run_one,
        "grid": MFI_CROSS_GRID,
        "default_params": MfiCrossParams(),
        "timeframe": "intraday",
        "description": "MFI cross above level 50 (+ optional divergence flag) + ATR gate",
    },
    "stage2": {
        "params_cls": Stage2Params,
        "features_fn": _stage2_features,
        "run_one_fn": stage2_run_one,
        "grid": STAGE2_GRID,
        "default_params": Stage2Params(),
        "timeframe": "1d",
        "description": "Weinstein Stage 2: flat-base breakout above 30W MA + vol expansion",
    },
    "choc_bos": {
        "params_cls": ChocBosParams,
        "features_fn": _choc_bos_features,
        "run_one_fn": choc_bos_run_one,
        "grid": CHOC_BOS_GRID,
        "default_params": ChocBosParams(),
        "timeframe": "intraday",
        "description": "CHoCH / Break of Structure + vol confirmation + trend + ATR gate",
    },
}


# ══════════════════════════════════════════════════════════════════════════════
# GRID RUNNER — sweep any signal over its grid, return ranked rows
# ══════════════════════════════════════════════════════════════════════════════

def run_signal_grid(
    signal_name: str,
    df: pd.DataFrame,
    symbol: str = "SPY",
    flat_eod: bool = False,
    min_trades: int = 5,
    grid_overrides: dict | None = None,
) -> list[dict]:
    """
    Cartesian sweep over SIGNAL_REGISTRY[signal_name]['grid'].
    Returns list of result dicts sorted by boom_rank_score descending.

    grid_overrides: replace any axis values, e.g. {"hold_bars": [4, 8]}.
    """
    reg = SIGNAL_REGISTRY[signal_name]
    params_cls = reg["params_cls"]
    run_fn = reg["run_one_fn"]
    grid = {**reg["grid"], **(grid_overrides or {})}

    keys = list(grid.keys())
    combos = list(product(*[grid[k] for k in keys]))

    rows = []
    default_p = reg["default_params"]
    for combo in combos:
        overrides = dict(zip(keys, combo))
        # Build params: start from defaults, apply grid overrides
        fields = {f: getattr(default_p, f) for f in default_p.__dataclass_fields__}
        fields.update(overrides)
        p = params_cls(**fields)
        result = run_fn(df, p, symbol=symbol, flat_eod=flat_eod)
        result["boom_rank_score"] = boom_rank_score(result)
        rows.append(result)

    eligible = [r for r in rows if r["trades"] >= min_trades]
    pool = eligible if eligible else rows
    pool.sort(key=lambda r: r["boom_rank_score"], reverse=True)
    return pool


def grid_combo_count(signal_name: str, grid_overrides: dict | None = None) -> int:
    reg = SIGNAL_REGISTRY[signal_name]
    grid = {**reg["grid"], **(grid_overrides or {})}
    n = 1
    for v in grid.values():
        n *= len(v)
    return n
