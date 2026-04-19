"""
ds_app/signals.py — Signal generation for all 7 algo families.

Each algo produces a vote {-1, 0, +1}, a float score, and a reason string.
The signal registry maps algo IDs (as used in API calls) to their computation
functions, so views can request any subset.

Algo IDs aligned with M3D council registry:
  TREND   = EMA Ribbon Stack (CC / Celtic Cross family)
  BOOM    = Darvas / Squeeze breakout (BOOM family)
  MS      = Market Shift / CHoCH+BOS
  VK      = Volkov Keltner breakout
  WH      = Wolfhound acceleration
  EF      = Emerald Flow (MFI cross)
  WN      = Weinstein Stage 2
"""
from __future__ import annotations

import logging
import math
from typing import Callable

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ── shared low-level helpers ──────────────────────────────────────────────────

def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _atr(high: pd.Series, low: pd.Series, close: pd.Series,
         fast: int = 14, base: int = 50) -> tuple[pd.Series, pd.Series]:
    """Wilder-style two-span ATR gate."""
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


def _safe_float(x) -> float:
    try:
        v = float(x)
        return v if math.isfinite(v) else 0.0
    except Exception:
        return 0.0


def _latest_bool(series: pd.Series) -> bool:
    """Return the most recent non-NaN boolean value from a series."""
    clean = series.dropna()
    if clean.empty:
        return False
    return bool(clean.iloc[-1])


def _vote_from_bool(signal: bool) -> int:
    return 1 if signal else 0


# ── signal function signature ─────────────────────────────────────────────────
# Each function: (df: pd.DataFrame) -> dict with keys: vote, score, reason


def _signal_trend(df: pd.DataFrame) -> dict:
    """
    TREND / CC (EMA Ribbon Stack):
    Bullish: all EMAs stacked 8>21>34>55>89 + price above EMA8 + fresh cross + ATR gate.
    Vote: +1 if all conditions met, 0 otherwise (no short signal from this family).
    """
    c = df["Close"]
    h, l = df["High"], df["Low"]
    e8  = _ema(c, 8)
    e21 = _ema(c, 21)
    e34 = _ema(c, 34)
    e55 = _ema(c, 55)
    e89 = _ema(c, 89)

    full_stack = (e8 > e21) & (e21 > e34) & (e34 > e55) & (e55 > e89)
    above_fast = c > e8
    fresh_cross = (c.shift(1) < e8.shift(1)) & (c >= e8)
    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > atr_base

    entry = (full_stack & fresh_cross & atr_gate).fillna(False)
    fire = _latest_bool(entry)

    # Score: proportion of conditions met on latest bar
    conds = [
        _latest_bool(full_stack),
        _latest_bool(above_fast),
        _latest_bool(atr_gate),
    ]
    score = sum(conds) / len(conds)

    reasons = []
    if _latest_bool(full_stack):
        reasons.append("EMA 8>21>34>55>89 fully stacked")
    if _latest_bool(fresh_cross):
        reasons.append("fresh EMA8 cross")
    if not _latest_bool(atr_gate):
        reasons.append("ATR gate not met")

    return {
        "vote": 1 if fire else 0,
        "score": round(score, 4),
        "reason": "; ".join(reasons) if reasons else "no stack signal",
    }


def _signal_boom(df: pd.DataFrame) -> dict:
    """
    BOOM (Darvas/Squeeze breakout):
    Bullish: BB inside KC (squeeze), then release, Darvas box breakout, rvol > 1.3, trend (EMA50).
    Vote: +1 if entry condition, -1 if deeply below EMA50 with vol contraction.
    """
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]

    # Squeeze: BB inside KC
    basis = c.rolling(20).mean()
    dev = c.rolling(20).std(ddof=0) * 2.0
    tr_s = (h - l).abs()
    avg_range = tr_s.ewm(span=20, adjust=False).mean()
    ema20 = _ema(c, 20)
    upper_kc = ema20 + avg_range * 2.0
    lower_kc = ema20 - avg_range * 2.0
    squeeze = ((basis + dev) < upper_kc) & ((basis - dev) > lower_kc)
    release = (~squeeze) & squeeze.shift(1, fill_value=False)

    # Darvas breakout
    box_high = h.shift(1).rolling(20).max()
    breakout = h > box_high

    rvol = _rvol(v)
    vol_ok = rvol > 1.3
    trend = c > _ema(c, 50)

    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > atr_base

    entry = (release & breakout & vol_ok & trend & atr_gate).fillna(False)
    fire = _latest_bool(entry)

    # Bearish: deeply below EMA50 + vol low
    bear = (c < _ema(c, 50) * 0.97) & (rvol < 0.7)
    bear_fire = _latest_bool(bear.fillna(False))

    vote = 1 if fire else (-1 if bear_fire else 0)
    score = _safe_float(rvol.iloc[-1]) if len(rvol) > 0 else 0.0
    score = min(score, 3.0) / 3.0  # normalise to 0–1

    reasons = []
    if _latest_bool(squeeze):
        reasons.append("currently in squeeze")
    if _latest_bool(release):
        reasons.append("squeeze release")
    if _latest_bool(breakout):
        reasons.append("Darvas breakout")
    if not _latest_bool(trend):
        reasons.append("below EMA50")

    return {
        "vote": vote,
        "score": round(score, 4),
        "reason": "; ".join(reasons) if reasons else "no boom signal",
    }


def _signal_ms(df: pd.DataFrame) -> dict:
    """
    MS — Market Shift (CHoCH / Break of Structure):
    Bullish BOS: close breaks above rolling swing high + volume confirmation.
    Bearish: close breaks below rolling swing low + vol.
    """
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    lb = 10
    prior_swing_high = h.shift(1).rolling(lb).max()
    prior_swing_low  = l.shift(1).rolling(lb).min()

    bos_bull = c > prior_swing_high
    bos_bear = c < prior_swing_low

    vol_ok = _rvol(v) >= 1.2
    trend = c > _ema(c, 50)
    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > atr_base

    bull_entry = (bos_bull & vol_ok & trend & atr_gate).fillna(False)
    bear_entry = (bos_bear & vol_ok & (~trend) & atr_gate).fillna(False)

    fire_bull = _latest_bool(bull_entry)
    fire_bear = _latest_bool(bear_entry)

    vote = 1 if fire_bull else (-1 if fire_bear else 0)
    score = _safe_float(_rvol(v).iloc[-1]) / 3.0 if len(v) > 0 else 0.0
    score = min(score, 1.0)

    return {
        "vote": vote,
        "score": round(score, 4),
        "reason": (
            "BOS bull: close > swing high + vol surge" if fire_bull else
            "BOS bear: close < swing low + vol surge" if fire_bear else
            "no structure break"
        ),
    }


def _signal_vk(df: pd.DataFrame) -> dict:
    """
    VK — Volkov Keltner Channel Breakout:
    Bull: close > upper KC band + volume surge + ATR gate.
    Bear: close < lower KC band + vol surge.
    """
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    span = 20
    ema_mid = _ema(c, span)
    atr_fast, atr_base = _atr(h, l, c)
    kc_upper = ema_mid + atr_fast * 2.0
    kc_lower = ema_mid - atr_fast * 2.0

    vol_surge = _rvol(v) >= 1.5
    atr_gate = atr_fast > atr_base

    bull = (c > kc_upper) & vol_surge & atr_gate
    bear = (c < kc_lower) & vol_surge & atr_gate

    fire_bull = _latest_bool(bull.fillna(False))
    fire_bear = _latest_bool(bear.fillna(False))

    vote = 1 if fire_bull else (-1 if fire_bear else 0)
    rvol_val = _safe_float(_rvol(v).iloc[-1]) if len(v) > 0 else 0.0
    score = min(rvol_val / 3.0, 1.0)

    return {
        "vote": vote,
        "score": round(score, 4),
        "reason": (
            "KC bull breakout + vol surge" if fire_bull else
            "KC bear breakdown + vol surge" if fire_bear else
            "inside KC channel"
        ),
    }


def _signal_wh(df: pd.DataFrame) -> dict:
    """
    WH — Wolfhound (Acceleration + Range Expansion):
    3 consecutive bars with increasing positive move (close-open) + expanding range + trend.
    """
    c, h, l = df["Close"], df["High"], df["Low"]
    move = c - df["Open"]
    bar_range = h - l
    accel_bars = 3

    accel = pd.Series(True, index=df.index)
    for k in range(accel_bars):
        accel = accel & (move.shift(k) > move.shift(k + 1)) & (move.shift(k) > 0)
    range_expand = bar_range > bar_range.shift(1)
    trend = c > _ema(c, 50)
    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > atr_base

    entry = (accel & range_expand & trend & atr_gate).fillna(False)
    fire = _latest_bool(entry)

    score = 1.0 if fire else 0.0
    return {
        "vote": 1 if fire else 0,
        "score": round(score, 4),
        "reason": (
            "3-bar acceleration + expanding range + trend"
            if fire else "no acceleration pattern"
        ),
    }


def _signal_ef(df: pd.DataFrame) -> dict:
    """
    EF — Emerald Flow (MFI cross):
    Bull: MFI(14) crosses above 50. Bear: MFI crosses below 50.
    Divergence bonus: price lower low + MFI higher low.
    """
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    mfi = _mfi(h, l, c, v, 14)
    cross_up   = (mfi.shift(1) < 50) & (mfi >= 50)
    cross_down = (mfi.shift(1) > 50) & (mfi <= 50)

    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > atr_base

    bull = (cross_up & atr_gate).fillna(False)
    bear = (cross_down & atr_gate).fillna(False)

    fire_bull = _latest_bool(bull)
    fire_bear = _latest_bool(bear)

    vote = 1 if fire_bull else (-1 if fire_bear else 0)
    mfi_val = _safe_float(mfi.iloc[-1]) if len(mfi) > 0 else 50.0
    # Score: distance from neutral 50, normalised to 0–1
    score = abs(mfi_val - 50.0) / 50.0

    return {
        "vote": vote,
        "score": round(score, 4),
        "reason": (
            f"MFI cross up (MFI={mfi_val:.1f})" if fire_bull else
            f"MFI cross down (MFI={mfi_val:.1f})" if fire_bear else
            f"MFI neutral ({mfi_val:.1f})"
        ),
    }


def _signal_wn(df: pd.DataFrame) -> dict:
    """
    WN — Weinstein Stage 2:
    6-month base + price breaks above 30W (150-bar daily) MA + vol expansion.
    """
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    if len(c) < 150:
        return {"vote": 0, "score": 0.0, "reason": "insufficient bars for Stage2 (need 150+)"}

    ma = c.rolling(150).mean()
    breaks_above = (c.shift(1) < ma.shift(1)) & (c >= ma)
    vol_surge = _rvol(v) >= 1.5
    ma_slope_positive = (ma - ma.shift(60)) > 0

    atr_fast, atr_base = _atr(h, l, c)
    atr_gate = atr_fast > (atr_base * 0.8)

    entry = (breaks_above & vol_surge & ma_slope_positive & atr_gate).fillna(False)
    fire = _latest_bool(entry)

    # Bearish: price breaks below 150MA + vol
    bear = ((c.shift(1) > ma.shift(1)) & (c < ma) & vol_surge).fillna(False)
    fire_bear = _latest_bool(bear)

    vote = 1 if fire else (-1 if fire_bear else 0)
    score = 1.0 if fire else (0.3 if _latest_bool(c > ma) else 0.0)

    return {
        "vote": vote,
        "score": round(score, 4),
        "reason": (
            "Stage2 breakout: flat base + MA150 break + vol" if fire else
            "Stage2 breakdown below MA150" if fire_bear else
            "Stage2: in base or no breakout"
        ),
    }


# ── SIGNAL REGISTRY ───────────────────────────────────────────────────────────

SIGNAL_REGISTRY: dict[str, dict] = {
    "TREND": {
        "fn": _signal_trend,
        "description": "EMA 8/21/34/55/89 full bullish stack + fresh cross + ATR gate",
        "family": "CC",
    },
    "BOOM": {
        "fn": _signal_boom,
        "description": "Darvas/Squeeze breakout: BB inside KC → release → Darvas high break + rvol + trend",
        "family": "BOOM",
    },
    "MS": {
        "fn": _signal_ms,
        "description": "CHoCH/BOS: close breaks swing high/low + vol confirmation + trend",
        "family": "MS",
    },
    "VK": {
        "fn": _signal_vk,
        "description": "Keltner channel breakout + volume surge + ATR gate",
        "family": "VK",
    },
    "WH": {
        "fn": _signal_wh,
        "description": "3-bar acceleration + expanding range + trend + ATR gate",
        "family": "WH",
    },
    "EF": {
        "fn": _signal_ef,
        "description": "MFI(14) cross above/below 50 + ATR gate",
        "family": "EF",
    },
    "WN": {
        "fn": _signal_wn,
        "description": "Weinstein Stage2: 150-bar MA breakout + flat base + vol expansion",
        "family": "WN",
    },
}

ALL_ALGO_IDS = list(SIGNAL_REGISTRY.keys())


def compute_signals(
    df: pd.DataFrame,
    algo_ids: list[str] | None = None,
) -> dict[str, dict]:
    """
    Compute signals for one or more algos given OHLCV DataFrame.

    Args:
        df:        OHLCV DataFrame (columns: Open, High, Low, Close, Volume).
        algo_ids:  List of algo IDs to compute (default: all registered algos).

    Returns:
        dict mapping algo_id → {"vote": -1|0|1, "score": float, "reason": str}
    """
    ids = algo_ids if algo_ids else ALL_ALGO_IDS
    results: dict[str, dict] = {}

    for algo_id in ids:
        algo_id_upper = algo_id.upper()
        if algo_id_upper not in SIGNAL_REGISTRY:
            logger.warning("Unknown algo_id '%s' — skipping", algo_id)
            results[algo_id_upper] = {"vote": 0, "score": 0.0, "reason": f"unknown algo: {algo_id}"}
            continue

        fn: Callable = SIGNAL_REGISTRY[algo_id_upper]["fn"]
        try:
            result = fn(df)
            results[algo_id_upper] = {
                "vote": int(result.get("vote", 0)),
                "score": float(result.get("score", 0.0)),
                "reason": str(result.get("reason", "")),
            }
        except Exception as exc:
            logger.exception("Signal error for %s: %s", algo_id_upper, exc)
            results[algo_id_upper] = {
                "vote": 0,
                "score": 0.0,
                "reason": f"error: {exc}",
            }

    return results


def jedi_score(signals: dict[str, dict]) -> int:
    """
    JEDI master score: sum of all algo votes.
    ±7 = directional signal; |sum| >= 12 = GO signal.
    """
    return sum(v.get("vote", 0) for v in signals.values())
