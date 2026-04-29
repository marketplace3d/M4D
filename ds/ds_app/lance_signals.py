"""
ds_app/lance_signals.py — Lance Breitstein Mean-Reversion Rubric (LEGEND-C)

4-category EV scoring system:
  Category A (30%): Waterfall acceleration + magnitude from 20 SMA
  Category B (25%): Volume capitulation spike
  Category C (25%): Leg count + RSI despair (context/sentiment)
  Category D (20%): Order-flow proxy (vol-divergence)

Signal: v_LANCE_MR = 1 when score >= 75 AND price breaks prev-bar high
         (Right-Side-of-V entry gate — no catching falling knives)

Two interfaces:
  feat_LANCE_MR(df, params) — algos_crypto.py ALGO_REGISTRY pattern (Close/High/Low)
  add_lance_signals(df)     — walkforward/signal_log pattern (close/high/low)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# ── Hyperparameters ────────────────────────────────────────────────────────────
_MA_PERIOD     = 20
_RSI_PERIOD    = 14
_VOL_SPIKE_MUL = 2.5   # volume must be this × avg to score 1.0
_SCORE_A       = 75.0  # minimum score to fire (grade A)
_SCORE_APLUS   = 90.0  # pocket-aces threshold


# ── Core factor functions (numpy arrays) ──────────────────────────────────────

def _waterfall_score(close: np.ndarray, period: int = _MA_PERIOD) -> np.ndarray:
    """Rate-of-change + distance below 20 SMA in σ units. Range 0-1."""
    cl = pd.Series(close)
    sma = cl.rolling(period).mean().values
    std = cl.rolling(period).std().values

    roc5 = np.zeros(len(close))
    roc5[5:] = (close[5:] - close[:-5]) / (np.abs(close[:-5]) + 1e-9)
    roc_std = pd.Series(roc5).rolling(period).std().values
    roc_z   = np.where(roc_std > 1e-9, roc5 / roc_std, 0.0)

    bb_pct = np.where(std > 1e-9, (close - sma) / (2.0 * std + 1e-9), 0.0)

    roc_s  = np.clip(-roc_z / 3.0, 0.0, 1.0)   # negative ROC z-score normalised
    dist_s = np.clip(-bb_pct / 1.5, 0.0, 1.0)  # far below SMA
    return 0.5 * roc_s + 0.5 * dist_s


def _volume_capitulation(volume: np.ndarray, period: int = _MA_PERIOD) -> np.ndarray:
    """Volume spike vs rolling average. Score 1.0 at _VOL_SPIKE_MUL × avg."""
    avg = pd.Series(volume).rolling(period).mean().values
    ratio = np.where(avg > 0, volume / (avg + 1e-9), 1.0)
    return np.clip((ratio - 1.0) / (_VOL_SPIKE_MUL - 1.0), 0.0, 1.0)


def _leg_score(close: np.ndarray, max_legs: int = 4) -> np.ndarray:
    """Consecutive down-closes (legs). Score 1.0 at max_legs consecutive."""
    legs = np.zeros(len(close))
    for i in range(1, len(close)):
        legs[i] = legs[i - 1] + 1 if close[i] < close[i - 1] else 0
    return np.clip(legs / max_legs, 0.0, 1.0)


def _rsi_despair(close: np.ndarray, period: int = _RSI_PERIOD) -> np.ndarray:
    """RSI < 20 = maximum despair. Score 1.0 at RSI=10, 0 at RSI=35."""
    delta = np.diff(close, prepend=close[0])
    gain  = np.where(delta > 0, delta, 0.0)
    loss  = np.where(delta < 0, -delta, 0.0)
    avg_g = pd.Series(gain).ewm(span=period, adjust=False).mean().values
    avg_l = pd.Series(loss).ewm(span=period, adjust=False).mean().values
    rs    = np.where(avg_l > 1e-9, avg_g / avg_l, 0.0)
    rsi   = 100.0 - 100.0 / (1.0 + rs)
    return np.clip((35.0 - rsi) / 25.0, 0.0, 1.0)


def _orderflow_proxy(close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    """
    Proxy for delta divergence: volume spiking while price decel = absorption.
    roc1 normalised by its rolling std — if near zero while vol spikes = floor.
    """
    roc1 = np.zeros(len(close))
    roc1[1:] = (close[1:] - close[:-1]) / (np.abs(close[:-1]) + 1e-9)
    rvol = pd.Series(np.abs(roc1)).rolling(5).mean().values + 1e-9
    # Deceleration: abs(roc1) shrinking while volume high
    decel = np.clip(1.0 - np.abs(roc1) / rvol, 0.0, 1.0)
    v_spike = _volume_capitulation(volume)
    return 0.5 * decel + 0.5 * v_spike


def _rsv_gate(close: np.ndarray, high: np.ndarray) -> np.ndarray:
    """Right-Side-of-V: price breaks prior bar's high after waterfall."""
    prev_h = np.roll(high, 1)
    prev_h[0] = high[0]
    return (close > prev_h).astype(np.int8)


# ── Composite scorer ──────────────────────────────────────────────────────────

def lance_score_array(
    close: np.ndarray,
    high: np.ndarray,
    volume: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Returns (score 0-100, signal 0/1, grade str array).
    signal = 1 when score >= _SCORE_A AND RSV gate fires.
    """
    w_s   = _waterfall_score(close)
    v_s   = _volume_capitulation(volume)
    ctx_s = 0.6 * _leg_score(close) + 0.4 * _rsi_despair(close)
    of_s  = _orderflow_proxy(close, volume)

    score = np.nan_to_num(
        (w_s * 0.30 + v_s * 0.25 + ctx_s * 0.25 + of_s * 0.20) * 100.0,
        nan=0.0,
    )
    rsv   = _rsv_gate(close, high)
    sig   = ((score >= _SCORE_A) & (rsv == 1)).astype(np.int8)

    grade = np.where(score >= _SCORE_APLUS, "A+",
            np.where(score >= _SCORE_A,     "A",
            np.where(score >= 60.0,          "B", "C")))
    return score, sig, grade


# ── algos_crypto ALGO_REGISTRY interface ─────────────────────────────────────

def feat_LANCE_MR(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """
    Mean-reversion capitulation signal (Breitstein rubric).
    Fires on Right-Side-of-V after waterfall: score >= params.get('min_score', 75).
    """
    out   = df.copy()
    close = out["Close"].values.astype(float)
    high  = out["High"].values.astype(float)
    vol   = out["Volume"].values.astype(float) if "Volume" in out else np.ones(len(close))

    min_score = float(params.get("min_score", _SCORE_A))

    score, sig, grade = lance_score_array(close, high, vol)
    sig = ((score >= min_score) & (_rsv_gate(close, high) == 1)).astype(np.int8)

    out["entry"]       = sig.astype(bool)
    out["exit_sig"]    = (score < 30.0)        # mean-reversion complete when score collapses
    out["lance_score"] = np.round(score, 1)
    out["lance_grade"] = grade
    return out


# ── walkforward / signal_log interface ───────────────────────────────────────

def add_lance_signals(df: pd.DataFrame) -> pd.DataFrame:
    """
    Adds v_LANCE_MR, lance_score, lance_grade columns.
    Uses lowercase close/high/volume (signal_log schema).
    """
    close = df["close"].values.astype(float)
    high  = df["high"].values.astype(float)
    vol   = df["volume"].values.astype(float) if "volume" in df else np.ones(len(close))

    score, sig, grade = lance_score_array(close, high, vol)

    out = df.copy()
    out["v_LANCE_MR"]  = sig
    out["lance_score"] = np.round(score, 1)
    out["lance_grade"] = grade
    return out
