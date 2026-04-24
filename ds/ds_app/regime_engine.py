"""
ds_app/regime_engine.py — 7-Regime Classifier

Replaces the coarse 4-state (TRENDING/BREAKOUT/RANGING/RISK-OFF) system.
Rule-based with smoothing — no HMM fit required, sub-millisecond inference.

REGIMES (priority order — first match wins):
  RISK-OFF        crash ATR + negative momentum  OR  cross-asset crisis
  EXHAUSTION      ATR > 85th pct AND rvol > 85th pct  — climax, no new entries
  SQUEEZE         squeeze=True AND atr_rank < 38th pct — coiling, wait for release
  BREAKOUT        squeeze released ≤5 bars ago AND atr_velocity > 0 — highest-IC window
  TRENDING_STRONG atr_rank > 60th, rvol > 1.2×, ema8>ema21>ema50 (or inverse)
  TRENDING_WEAK   atr_rank > 38th OR ema-aligned but subdued vol
  RANGING         default — low ATR, low vol, no structure

USAGE:
  from ds_app.regime_engine import classify_live, classify_series, REGIMES

  regime = classify_live(df)                   # str — last-bar label
  series = classify_series(df)                 # pd.Series, same length as df
  snapshot = get_snapshot(df)                  # dict with confidence + transition flags
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# ── Canonical regime labels ────────────────────────────────────────────────────

RISK_OFF        = "RISK-OFF"
EXHAUSTION      = "EXHAUSTION"
SQUEEZE         = "SQUEEZE"
BREAKOUT        = "BREAKOUT"
TRENDING_STRONG = "TRENDING_STRONG"
TRENDING_WEAK   = "TRENDING_WEAK"
RANGING         = "RANGING"

REGIMES: list[str] = [
    RISK_OFF, EXHAUSTION, SQUEEZE, BREAKOUT,
    TRENDING_STRONG, TRENDING_WEAK, RANGING,
]

# Backward-compat alias: anything that was "TRENDING" maps to TRENDING_STRONG
LEGACY_MAP: dict[str, str] = {
    "TRENDING": TRENDING_STRONG,
    "RISK-OFF": RISK_OFF,
    "BREAKOUT": BREAKOUT,
    "RANGING":  RANGING,
}


# ── EWM helper (no pandas overhead for small arrays) ──────────────────────────

def _ewm(arr: np.ndarray, span: int) -> np.ndarray:
    alpha = 2.0 / (span + 1.0)
    out = np.empty_like(arr, dtype=float)
    out[0] = arr[0]
    for i in range(1, len(arr)):
        out[i] = alpha * arr[i] + (1.0 - alpha) * out[i - 1]
    return out


def _squeeze_bands(hi: np.ndarray, lo: np.ndarray, cl: np.ndarray,
                   bb_len: int = 20, bb_mult: float = 2.0,
                   kc_len: int = 20, kc_mult: float = 1.5) -> np.ndarray:
    """True where BB is inside KC (TTM Squeeze on/off)."""
    n = len(cl)
    mid = np.zeros(n)
    for i in range(bb_len - 1, n):
        mid[i] = cl[i - bb_len + 1: i + 1].mean()
    cl_s = pd.Series(cl)
    bb_std = cl_s.rolling(bb_len).std(ddof=0).fillna(0).values
    bb_upper = mid + bb_mult * bb_std
    bb_lower = mid - bb_mult * bb_std

    prev_c = np.concatenate([[cl[0]], cl[:-1]])
    tr = np.maximum(hi - lo, np.maximum(np.abs(hi - prev_c), np.abs(lo - prev_c)))
    atr_kc = _ewm(tr, kc_len)
    kc_upper = mid + kc_mult * atr_kc
    kc_lower = mid - kc_mult * atr_kc

    return (bb_upper < kc_upper) & (bb_lower > kc_lower)


# ── Single-bar classifier (live use) ──────────────────────────────────────────

def classify_live(df: pd.DataFrame) -> str:
    """Return regime label for the last bar of df. Requires ≥ 55 bars."""
    cl = df["Close"].values if "Close" in df.columns else df["close"].values
    hi = df["High"].values  if "High"  in df.columns else df["high"].values
    lo = df["Low"].values   if "Low"   in df.columns else df["low"].values
    n  = len(cl)
    if n < 55:
        return RANGING

    vol_col = "Volume" if "Volume" in df.columns else "volume"
    vol = df[vol_col].values.astype(float)

    # ATR (EWM-14)
    prev_c = np.concatenate([[cl[0]], cl[:-1]])
    tr  = np.maximum(hi - lo, np.maximum(np.abs(hi - prev_c), np.abs(lo - prev_c)))
    atr = _ewm(tr, 14)
    atr_rank = float(pd.Series(atr).rank(pct=True).iloc[-1])

    # RVOL
    vol_ma = pd.Series(vol).rolling(50).mean().bfill().values
    rvol   = vol / np.where(vol_ma > 0, vol_ma, 1.0)
    rvol_now  = float(rvol[-1])
    rvol_rank = float(pd.Series(rvol).rank(pct=True).iloc[-1])

    # Squeeze state
    if "squeeze" in df.columns:
        sqz_arr = df["squeeze"].fillna(False).values.astype(bool)
    else:
        sqz_arr = _squeeze_bands(hi, lo, cl)
    squeeze_now = bool(sqz_arr[-1])

    # Squeeze-release: squeeze was active ≤5 bars ago, now off
    lookback = min(6, n - 1)
    squeeze_released = bool(np.any(sqz_arr[-lookback - 1: -1]) and not squeeze_now)

    # ATR velocity (3-bar rate of change)
    atr_velocity = float((atr[-1] - atr[-4]) / max(atr[-4], 1e-9)) if n >= 4 else 0.0

    # EMA alignment (8 / 21 / 50)
    ema8  = _ewm(cl, 8)[-1]
    ema21 = _ewm(cl, 21)[-1]
    ema50 = _ewm(cl, 50)[-1]
    ema_aligned = bool((ema8 > ema21 > ema50) or (ema8 < ema21 < ema50))

    # 20-bar momentum
    mom20 = float((cl[-1] - cl[-21]) / cl[-21]) if n > 21 and cl[-21] != 0 else 0.0

    # ATR% for RISK-OFF (crash detection)
    atr_pct = atr / np.where(cl > 0, cl, 1.0)
    valid   = atr_pct[atr_pct > 0]
    atr_75  = float(np.percentile(valid, 75)) if len(valid) > 0 else 1e-4

    # ── Priority classification ────────────────────────────────────────────────
    if atr_pct[-1] > atr_75 * 1.3 and mom20 < -0.025:
        return RISK_OFF

    if atr_rank > 0.85 and rvol_rank > 0.85:
        return EXHAUSTION

    if squeeze_now and atr_rank < 0.38:
        return SQUEEZE

    if squeeze_released and atr_velocity > 0.015:
        return BREAKOUT

    if atr_rank > 0.60 and rvol_now > 1.2 and ema_aligned:
        return TRENDING_STRONG

    if (atr_rank > 0.38 and ema_aligned) or atr_rank > 0.52:
        return TRENDING_WEAK

    return RANGING


# ── Series classifier (walk-forward / signal_log annotation) ──────────────────

def classify_series(df: pd.DataFrame, smooth_window: int = 3) -> pd.Series:
    """
    Label every bar in df with a regime. Vectorized.
    smooth_window: majority vote over rolling window (reduces label flipping).
    """
    cl_col = "Close" if "Close" in df.columns else "close"
    hi_col = "High"  if "High"  in df.columns else "high"
    lo_col = "Low"   if "Low"   in df.columns else "low"
    vol_col = "Volume" if "Volume" in df.columns else "volume"

    cl  = df[cl_col].values.astype(float)
    hi  = df[hi_col].values.astype(float)
    lo  = df[lo_col].values.astype(float)
    vol = df[vol_col].values.astype(float)
    n   = len(cl)

    prev_c = np.concatenate([[cl[0]], cl[:-1]])
    tr  = np.maximum(hi - lo, np.maximum(np.abs(hi - prev_c), np.abs(lo - prev_c)))
    atr = _ewm(tr, 14)

    atr_rank_arr  = pd.Series(atr).rank(pct=True).values
    vol_ma        = pd.Series(vol).rolling(50, min_periods=1).mean().values
    rvol_arr      = vol / np.where(vol_ma > 0, vol_ma, 1.0)
    rvol_rank_arr = pd.Series(rvol_arr).rank(pct=True).values

    # Squeeze
    if "squeeze" in df.columns:
        sqz_arr = df["squeeze"].fillna(False).values.astype(bool)
    else:
        sqz_arr = _squeeze_bands(hi, lo, cl)

    sqz_shifted = np.concatenate([[False] * min(5, n), sqz_arr[:max(0, n - 5)]])
    # squeeze_released[i] = squeeze was on in [i-5..i-1] AND off at i
    sqz_window = np.zeros(n, dtype=bool)
    for lag in range(1, 6):
        if lag < n:
            sqz_window |= np.concatenate([[False] * lag, sqz_arr[:-lag]])
    squeeze_released = sqz_window & ~sqz_arr

    # ATR velocity (3-bar)
    atr_vel = np.zeros(n)
    for i in range(3, n):
        atr_vel[i] = (atr[i] - atr[i - 3]) / max(atr[i - 3], 1e-9)

    # EMA alignment
    ema8_arr  = _ewm(cl, 8)
    ema21_arr = _ewm(cl, 21)
    ema50_arr = _ewm(cl, 50)
    ema_aligned = ((ema8_arr > ema21_arr) & (ema21_arr > ema50_arr)) | \
                  ((ema8_arr < ema21_arr) & (ema21_arr < ema50_arr))

    # Momentum (20-bar)
    mom20 = np.zeros(n)
    for i in range(20, n):
        if cl[i - 20] != 0:
            mom20[i] = (cl[i] - cl[i - 20]) / cl[i - 20]

    # ATR% and rolling 75th pct baseline
    atr_pct = atr / np.where(cl > 0, cl, 1.0)
    atr_75_roll = pd.Series(atr_pct).rolling(200, min_periods=50).quantile(0.75).bfill().values

    # ── Vectorized priority assignment ────────────────────────────────────────
    labels = np.full(n, RANGING, dtype=object)

    labels[
        (atr_rank_arr > 0.38) & (ema_aligned) | (atr_rank_arr > 0.52)
    ] = TRENDING_WEAK

    labels[
        (atr_rank_arr > 0.60) & (rvol_arr > 1.2) & ema_aligned
    ] = TRENDING_STRONG

    labels[
        squeeze_released & (atr_vel > 0.015)
    ] = BREAKOUT

    labels[
        sqz_arr & (atr_rank_arr < 0.38)
    ] = SQUEEZE

    labels[
        (atr_rank_arr > 0.85) & (rvol_rank_arr > 0.85)
    ] = EXHAUSTION

    labels[
        (atr_pct > atr_75_roll * 1.3) & (mom20 < -0.025)
    ] = RISK_OFF

    # Smooth: majority vote over rolling window
    if smooth_window > 1:
        labels = _smooth_labels(labels, smooth_window)

    return pd.Series(labels, index=df.index)


def _smooth_labels(labels: np.ndarray, window: int) -> np.ndarray:
    """Replace each label with the most common label in its window."""
    out = labels.copy()
    half = window // 2
    n = len(labels)
    for i in range(n):
        start = max(0, i - half)
        end   = min(n, i + half + 1)
        window_vals = labels[start:end]
        vals, counts = np.unique(window_vals, return_counts=True)
        out[i] = vals[np.argmax(counts)]
    return out


# ── Live snapshot (used by /v1/regime/ endpoint) ──────────────────────────────

def get_snapshot(df: pd.DataFrame) -> dict:
    """
    Return regime label + diagnostic values + transition flags for the last bar.
    Useful for the AlphaSeek regime tab and PulsePage live display.
    """
    cl = df["Close"].values if "Close" in df.columns else df["close"].values
    hi = df["High"].values  if "High"  in df.columns else df["high"].values
    lo = df["Low"].values   if "Low"   in df.columns else df["low"].values
    n  = len(cl)

    vol_col = "Volume" if "Volume" in df.columns else "volume"
    vol = df[vol_col].values.astype(float)

    prev_c = np.concatenate([[cl[0]], cl[:-1]])
    tr  = np.maximum(hi - lo, np.maximum(np.abs(hi - prev_c), np.abs(lo - prev_c)))
    atr = _ewm(tr, 14)
    atr_rank = float(pd.Series(atr).rank(pct=True).iloc[-1])

    vol_ma   = pd.Series(vol).rolling(50).mean().bfill().values
    rvol     = vol / np.where(vol_ma > 0, vol_ma, 1.0)
    rvol_now = float(rvol[-1])
    rvol_rank = float(pd.Series(rvol).rank(pct=True).iloc[-1])

    if "squeeze" in df.columns:
        sqz_arr = df["squeeze"].fillna(False).values.astype(bool)
    else:
        sqz_arr = _squeeze_bands(hi, lo, cl)
    squeeze_now = bool(sqz_arr[-1])

    lookback = min(6, n - 1)
    squeeze_released = bool(np.any(sqz_arr[-lookback - 1: -1]) and not squeeze_now)
    atr_velocity = float((atr[-1] - atr[-4]) / max(atr[-4], 1e-9)) if n >= 4 else 0.0

    ema8  = _ewm(cl, 8)[-1]
    ema21 = _ewm(cl, 21)[-1]
    ema50 = _ewm(cl, 50)[-1]
    ema_aligned = bool((ema8 > ema21 > ema50) or (ema8 < ema21 < ema50))

    regime = classify_live(df)

    # Bars in current regime (look back until label changes)
    if n >= 10:
        past_labels = classify_series(df.tail(min(n, 200)))
        bars_in = 1
        for lbl in reversed(past_labels.values[:-1]):
            if lbl == regime:
                bars_in += 1
            else:
                break
    else:
        bars_in = 1

    # Transition risk: TRENDING_STRONG with low rvol or falling ATR = watch
    transition_risk = False
    if regime == TRENDING_STRONG and (rvol_now < 0.9 or atr_velocity < -0.03):
        transition_risk = True
    if regime == BREAKOUT and bars_in > 8:
        transition_risk = True  # BREAKOUT resolves quickly; stale = likely failed

    return {
        "regime":           regime,
        "bars_in_regime":   bars_in,
        "transition_risk":  transition_risk,
        "atr_rank":         round(atr_rank, 3),
        "rvol_now":         round(rvol_now, 3),
        "rvol_rank":        round(rvol_rank, 3),
        "squeeze_now":      squeeze_now,
        "squeeze_released": squeeze_released,
        "atr_velocity":     round(atr_velocity, 4),
        "ema_aligned":      ema_aligned,
    }
