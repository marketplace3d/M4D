"""
ds_app/backtest.py — Backtesting engine.

Uses backtesting.py (the `backtesting` library) as the simulation engine.
Strategy logic is adapted from the M4D reference: boom_backtest.py _make_strategy
and algo_signals.py signal families.

Supported algo IDs (maps to entry logic):
    TREND  — EMA ribbon stack + fresh cross
    BOOM   — Darvas breakout + squeeze release + rvol + trend
    MS     — CHoCH / Break of Structure
    VK     — Keltner channel breakout + vol surge
    WH     — Wolfhound 3-bar acceleration
    EF     — MFI(14) cross 50
    WN     — Weinstein Stage 2 breakout
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Default backtest execution constants
_DEFAULT_CASH = 100_000
_DEFAULT_COMMISSION = 0.0015
_DEFAULT_SPREAD = 0.0008

# ── result dataclass ──────────────────────────────────────────────────────────


@dataclass
class BacktestResult:
    asset: str
    algo: str
    start: str
    end: str
    win_rate: float
    total_return: float
    sharpe: float
    max_drawdown: float
    num_trades: int
    equity_curve: list[float] = field(default_factory=list)
    trades: list[dict] = field(default_factory=list)
    params: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "asset": self.asset,
            "algo": self.algo,
            "start": self.start,
            "end": self.end,
            "win_rate": self.win_rate,
            "total_return": self.total_return,
            "sharpe": self.sharpe,
            "max_drawdown": self.max_drawdown,
            "num_trades": self.num_trades,
            "equity_curve": self.equity_curve,
            "trades": self.trades,
            "params": self.params,
        }


# ── low-level indicator helpers ───────────────────────────────────────────────

def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _atr(high: pd.Series, low: pd.Series, close: pd.Series,
         fast: int = 14, base: int = 50) -> tuple[pd.Series, pd.Series]:
    prev = close.shift(1)
    tr = pd.concat(
        [(high - low).abs(), (high - prev).abs(), (low - prev).abs()], axis=1
    ).max(axis=1)
    atr_fast = tr.ewm(span=fast, adjust=False).mean()
    atr_base = atr_fast.ewm(span=base, adjust=False).mean()
    return atr_fast, atr_base


def _rvol(volume: pd.Series, length: int = 20) -> pd.Series:
    return volume / volume.rolling(length).mean()


def _mfi(high: pd.Series, low: pd.Series, close: pd.Series,
         volume: pd.Series, length: int = 14) -> pd.Series:
    typical = (high + low + close) / 3
    raw_mf = typical * volume
    up = (typical > typical.shift(1)).fillna(False)
    pos_mf = raw_mf.where(up, 0.0).rolling(length).sum()
    neg_mf = raw_mf.where(~up, 0.0).rolling(length).sum()
    mfr = pos_mf / neg_mf.replace(0, np.nan)
    return (100 - 100 / (1 + mfr)).fillna(50.0)


def _ema13_exit(close: pd.Series) -> pd.Series:
    ema13 = _ema(close, 13)
    return ((close.shift(1) >= ema13.shift(1)) & (close < ema13)).fillna(False)


# ── feature builders — one per algo ──────────────────────────────────────────

def _features_trend(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """EMA Ribbon Stack entry."""
    out = df.copy()
    c, h, l = out["Close"], out["High"], out["Low"]

    fast_span = int(params.get("fast_span", 8))
    e_fast = _ema(c, fast_span)
    e_m1   = _ema(c, int(params.get("mid1_span", 21)))
    e_m2   = _ema(c, int(params.get("mid2_span", 34)))
    e_m3   = _ema(c, int(params.get("mid3_span", 55)))
    e_slow = _ema(c, int(params.get("slow_span", 89)))

    full_stack = (e_fast > e_m1) & (e_m1 > e_m2) & (e_m2 > e_m3) & (e_m3 > e_slow)
    fresh_cross = (c.shift(1) < e_fast.shift(1)) & (c >= e_fast)
    atr_fast, atr_base = _atr(h, l, c)
    atr_mult = float(params.get("atr_mult", 1.0))
    atr_gate = atr_fast > (atr_base * atr_mult)

    out["entry"] = (full_stack & fresh_cross & atr_gate).fillna(False)
    out["exit_ema13"] = _ema13_exit(c)
    return out


def _features_boom(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Darvas / Squeeze breakout entry (BOOM family)."""
    out = df.copy()
    c, h, l, v = out["Close"], out["High"], out["Low"], out["Volume"]

    sq_len = int(params.get("squeeze_len", 20))
    dv_lookback = int(params.get("darvas_lookback", 20))
    rvol_mult = float(params.get("rvol_mult", 1.3))
    min_vote = int(params.get("min_vote", 3))
    atr_mult = float(params.get("atr_mult", 1.05))

    # Squeeze: Bollinger inside Keltner
    basis = c.rolling(sq_len).mean()
    dev = c.rolling(sq_len).std(ddof=0) * 2.0
    ema_sq = _ema(c, sq_len)
    tr_sq = (h - l).abs()
    avg_range = tr_sq.ewm(span=sq_len, adjust=False).mean()
    upper_kc = ema_sq + avg_range * 2.0
    lower_kc = ema_sq - avg_range * 2.0
    squeeze = ((basis + dev) < upper_kc) & ((basis - dev) > lower_kc)
    release = (~squeeze) & squeeze.shift(1, fill_value=False)

    # Darvas breakout
    box_high = h.shift(1).rolling(dv_lookback).max()
    breakout = h > box_high

    rvol = _rvol(v)
    trend = c > _ema(c, 50)
    boom_vote = (
        squeeze.astype(int)
        + release.astype(int)
        + (rvol > rvol_mult).astype(int)
        + trend.astype(int) * 2
    )

    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > (atr_base * atr_mult)

    entry = (
        breakout & (rvol > rvol_mult) & trend & (boom_vote >= min_vote) & atr_gate
    ).fillna(False)
    out["entry"] = entry
    out["exit_ema13"] = _ema13_exit(c)
    return out


def _features_ms(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Market Shift / CHoCH / BOS entry."""
    out = df.copy()
    c, h, l, v = out["Close"], out["High"], out["Low"], out["Volume"]

    lb = int(params.get("swing_lookback", 10))
    vol_mult = float(params.get("vol_confirm_mult", 1.2))
    atr_mult = float(params.get("atr_mult", 1.0))

    prior_swing_high = h.shift(1).rolling(lb).max()
    bos = c > prior_swing_high
    prior_bearish = (c.shift(1) < out["Open"].shift(1)).fillna(False)
    signal = bos & prior_bearish

    vol_confirm = _rvol(v) >= vol_mult
    trend = c > _ema(c, 50)
    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > (atr_base * atr_mult)

    out["entry"] = (signal & vol_confirm & trend & atr_gate).fillna(False)
    out["exit_ema13"] = _ema13_exit(c)
    return out


def _features_vk(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Volkov Keltner Channel breakout entry."""
    out = df.copy()
    c, h, l, v = out["Close"], out["High"], out["Low"], out["Volume"]

    kc_span = int(params.get("kc_span", 20))
    kc_mult = float(params.get("kc_mult", 2.0))
    vol_surge_mult = float(params.get("vol_surge_mult", 1.5))
    atr_mult = float(params.get("atr_mult", 1.0))

    ema_mid = _ema(c, kc_span)
    atr_fast, atr_base = _atr(h, l, c)
    kc_upper = ema_mid + atr_fast * kc_mult

    vol_surge = _rvol(v) >= vol_surge_mult
    above_kc = c > kc_upper
    atr_gate = atr_fast > (atr_base * atr_mult)

    out["entry"] = (above_kc & vol_surge & atr_gate).fillna(False)
    out["exit_ema13"] = _ema13_exit(c)
    return out


def _features_wh(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Wolfhound acceleration entry."""
    out = df.copy()
    c, h, l = out["Close"], out["High"], out["Low"]

    accel_bars = int(params.get("accel_bars", 3))
    trend_ema = int(params.get("trend_ema", 50))
    atr_mult = float(params.get("atr_mult", 1.0))

    move = c - out["Open"]
    bar_range = h - l

    accel = pd.Series(True, index=out.index)
    for k in range(accel_bars):
        accel = accel & (move.shift(k) > move.shift(k + 1)) & (move.shift(k) > 0)
    range_expand = bar_range > bar_range.shift(1)
    trend = c > _ema(c, trend_ema)
    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > (atr_base * atr_mult)

    out["entry"] = (accel & range_expand & trend & atr_gate).fillna(False)
    out["exit_ema13"] = _ema13_exit(c)
    return out


def _features_ef(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Emerald Flow MFI cross entry."""
    out = df.copy()
    c, h, l, v = out["Close"], out["High"], out["Low"], out["Volume"]

    mfi_len = int(params.get("mfi_len", 14))
    cross_level = float(params.get("cross_level", 50.0))
    atr_mult = float(params.get("atr_mult", 1.0))

    mfi = _mfi(h, l, c, v, mfi_len)
    cross_up = (mfi.shift(1) < cross_level) & (mfi >= cross_level)
    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > (atr_base * atr_mult)

    out["entry"] = (cross_up & atr_gate).fillna(False)
    out["exit_ema13"] = _ema13_exit(c)
    return out


def _features_wn(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Weinstein Stage 2 entry."""
    out = df.copy()
    c, h, l, v = out["Close"], out["High"], out["Low"], out["Volume"]

    ma_span = int(params.get("ma_span", 150))
    base_bars = int(params.get("base_bars", 60))
    base_range_pct = float(params.get("base_range_pct", 15.0))
    vol_surge_mult = float(params.get("vol_surge_mult", 1.5))
    atr_mult = float(params.get("atr_mult", 0.8))

    if len(c) < ma_span:
        out["entry"] = pd.Series(False, index=out.index)
        out["exit_ema13"] = _ema13_exit(c)
        return out

    ma = c.rolling(ma_span).mean()
    ma_slope = (ma - ma.shift(base_bars)) / base_bars
    price_dev = ((c - ma) / ma * 100).abs()
    in_base = price_dev.rolling(base_bars).max() < base_range_pct
    breaks_above = (c.shift(1) < ma.shift(1)) & (c >= ma)
    vol_surge = _rvol(v) >= vol_surge_mult
    ma_rising = ma_slope > 0
    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > (atr_base * atr_mult)

    out["entry"] = (
        in_base.shift(1) & breaks_above & vol_surge & ma_rising & atr_gate
    ).fillna(False)
    out["exit_ema13"] = _ema13_exit(c)
    return out


# ── feature function registry ─────────────────────────────────────────────────

_FEATURE_BUILDERS: dict[str, Any] = {
    "TREND": _features_trend,
    "BOOM":  _features_boom,
    "MS":    _features_ms,
    "VK":    _features_vk,
    "WH":    _features_wh,
    "EF":    _features_ef,
    "WN":    _features_wn,
}

# Default hold_bars and stop_loss per algo
_ALGO_DEFAULTS: dict[str, dict] = {
    "TREND": {"hold_bars": 6,  "stop_loss_pct": 0.7,  "exit_mode": "ema13"},
    "BOOM":  {"hold_bars": 6,  "stop_loss_pct": 0.65, "exit_mode": "ema13"},
    "MS":    {"hold_bars": 6,  "stop_loss_pct": 0.8,  "exit_mode": "ema13"},
    "VK":    {"hold_bars": 6,  "stop_loss_pct": 0.8,  "exit_mode": "ema13"},
    "WH":    {"hold_bars": 5,  "stop_loss_pct": 0.7,  "exit_mode": "holdbars"},
    "EF":    {"hold_bars": 6,  "stop_loss_pct": 0.7,  "exit_mode": "ema13"},
    "WN":    {"hold_bars": 20, "stop_loss_pct": 5.0,  "exit_mode": "holdbars"},
}


# ── strategy factory ──────────────────────────────────────────────────────────

def _make_strategy(feat_df: pd.DataFrame, hold_bars: int, stop_loss_pct: float,
                   exit_mode: str, break_even_offset_pct: float = 0.05):
    """
    Build a backtesting.py Strategy class from a features DataFrame.

    feat_df must have columns 'entry' (bool) and 'exit_ema13' (bool).
    """
    from backtesting import Strategy

    class AlgoStrategy(Strategy):
        _feat = feat_df
        _hold = hold_bars
        _stop_loss_pct = stop_loss_pct
        _exit_mode = exit_mode
        _beo_pct = break_even_offset_pct

        def init(self):
            self._hold_for = 0
            self._entry_price = None
            self._break_even_armed = False

        def next(self):
            idx = len(self.data) - 1
            if idx < 0:
                return

            close_now = float(self.data.Close[-1])

            if self.position:
                # Stop loss check
                if self._entry_price is not None:
                    if close_now > self._entry_price:
                        self._break_even_armed = True

                    stop_px = self._entry_price * (1.0 - self._stop_loss_pct / 100.0)
                    if self._break_even_armed:
                        lock_px = self._entry_price * (1.0 + self._beo_pct / 100.0)
                        stop_px = max(stop_px, lock_px)

                    if close_now <= stop_px:
                        self.position.close()
                        self._hold_for = 0
                        self._entry_price = None
                        self._break_even_armed = False
                        return

                # EMA13 exit
                if self._exit_mode == "ema13":
                    try:
                        if bool(self._feat["exit_ema13"].iloc[idx]):
                            self.position.close()
                            self._hold_for = 0
                            self._entry_price = None
                            self._break_even_armed = False
                            return
                    except IndexError:
                        pass

                # Hold-bars exit
                self._hold_for += 1
                if self._exit_mode == "holdbars" and self._hold_for >= self._hold:
                    self.position.close()
                    self._hold_for = 0
                    self._entry_price = None
                    self._break_even_armed = False
                return

            # Entry
            try:
                if bool(self._feat["entry"].iloc[idx]):
                    self.buy()
                    self._hold_for = 0
                    self._entry_price = close_now
                    self._break_even_armed = False
            except IndexError:
                pass

    return AlgoStrategy


# ── main backtest runner ──────────────────────────────────────────────────────

def run_backtest(
    asset: str,
    algo: str,
    start: str,
    end: str,
    params: dict | None = None,
) -> BacktestResult:
    """
    Run a backtest for a given asset/algo over a date range.

    Args:
        asset:  Symbol, e.g. "BTC", "AAPL".
        algo:   Algo ID: "TREND", "BOOM", "MS", "VK", "WH", "EF", "WN".
        start:  Start date string "YYYY-MM-DD".
        end:    End date string "YYYY-MM-DD".
        params: Optional param overrides; merged with algo defaults.

    Returns:
        BacktestResult dataclass.

    Raises:
        ValueError: Unknown algo or insufficient data.
        ImportError: backtesting library not installed.
    """
    from backtesting import Backtest
    from .data_fetch import fetch_ohlcv

    algo_upper = algo.upper()
    if algo_upper not in _FEATURE_BUILDERS:
        raise ValueError(
            f"Unknown algo '{algo}'. Valid: {list(_FEATURE_BUILDERS.keys())}"
        )

    # Merge defaults with caller params
    defaults = dict(_ALGO_DEFAULTS.get(algo_upper, {}))
    if params:
        defaults.update(params)
    merged = defaults

    hold_bars = int(merged.get("hold_bars", 6))
    stop_loss_pct = float(merged.get("stop_loss_pct", 0.7))
    exit_mode = str(merged.get("exit_mode", "ema13"))
    break_even_offset_pct = float(merged.get("break_even_offset_pct", 0.05))

    # Fetch data
    df = fetch_ohlcv(asset, start, end)
    if df.empty or len(df) < 30:
        raise ValueError(f"Insufficient data for {asset} ({start}→{end}): {len(df)} bars")

    # Build features
    build_fn = _FEATURE_BUILDERS[algo_upper]
    feat_df = build_fn(df, merged)

    # Build strategy
    strategy_cls = _make_strategy(feat_df, hold_bars, stop_loss_pct, exit_mode, break_even_offset_pct)

    # Run backtest
    bt = Backtest(
        df,
        strategy_cls,
        cash=_DEFAULT_CASH,
        commission=_DEFAULT_COMMISSION,
        spread=_DEFAULT_SPREAD,
        exclusive_orders=True,
        finalize_trades=True,
    )
    stats = bt.run()

    # Extract metrics
    win_rate = _safe_stat(stats, "Win Rate [%]", 0.0)
    total_return = _safe_stat(stats, "Return [%]", 0.0)
    sharpe = _safe_stat(stats, "Sharpe Ratio", 0.0)
    max_dd = abs(_safe_stat(stats, "Max. Drawdown [%]", 0.0))
    num_trades = int(_safe_stat(stats, "# Trades", 0))

    # Equity curve
    try:
        equity_series = stats["_equity_curve"]["Equity"]
        equity_curve = [round(float(v), 2) for v in equity_series.tolist()]
    except Exception:
        equity_curve = []

    # Trade records
    trades = []
    try:
        trades_df = stats["_trades"]
        if trades_df is not None and not trades_df.empty:
            for _, row in trades_df.iterrows():
                trades.append({
                    "entry_time": str(row.get("EntryTime", "")),
                    "exit_time": str(row.get("ExitTime", "")),
                    "entry_price": _safe_float(row.get("EntryPrice")),
                    "exit_price": _safe_float(row.get("ExitPrice")),
                    "pnl": _safe_float(row.get("PnL")),
                    "return_pct": _safe_float(row.get("ReturnPct", 0.0)) * 100,
                    "size": _safe_float(row.get("Size")),
                })
    except Exception:
        pass

    return BacktestResult(
        asset=asset.upper(),
        algo=algo_upper,
        start=start,
        end=end,
        win_rate=round(float(win_rate), 2),
        total_return=round(float(total_return), 2),
        sharpe=round(float(sharpe), 4),
        max_drawdown=round(float(max_dd), 2),
        num_trades=num_trades,
        equity_curve=equity_curve,
        trades=trades,
        params=merged,
    )


def _safe_stat(stats, key: str, default=0.0):
    """Safely extract a scalar from backtesting stats Series."""
    try:
        v = stats[key]
        f = float(v)
        return f if math.isfinite(f) else default
    except Exception:
        return default


def _safe_float(x, default=0.0) -> float:
    try:
        v = float(x)
        return v if math.isfinite(v) else default
    except Exception:
        return default
