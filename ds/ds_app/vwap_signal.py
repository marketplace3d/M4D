"""
ds_app/vwap_signal.py — VWAP Deviation Signal (T3-A)

VWAP = cumulative(Volume × Close) / cumulative(Volume)
Reset at each session open (13:30 UTC = NY open).

SIGNAL:
  vwap_bias    = +1 (close > VWAP), -1 (close < VWAP), 0 (at VWAP)
  vwap_dev_pct = (close - VWAP) / VWAP × 100  (signed deviation %)
  vwap_band    = EXTREME_LONG | LONG_BIAS | VWAP_TAP | SHORT_BIAS | EXTREME_SHORT | AT_VWAP

EDGE:
  Zero correlation with OHLCV signals — pure volume-price relationship.
  Price returning to VWAP = mean-reversion setup (RANGING regime boost).
  Price extending away from VWAP = trend continuation (TRENDING/BREAKOUT boost).
  EXTREME deviation (>1.5%) = fade zone (potential reversal, reduce size).

ROUTING:
  vwap_bias aligns with entry direction → +10% size
  vwap_bias opposes direction AND dev >1.0% → -20% size (extended, don't chase)
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
FUTURES_DB = _DS_ROOT / "data" / "futures.db"

# UTC minutes for NY session open (13:30) — VWAP resets here
_SESSION_OPEN_MINS = 13 * 60 + 30

# Deviation bands
_EXTREME_THR = 1.50   # >1.5% dev = EXTREME
_STRONG_THR  = 0.75   # >0.75% = strong bias
_NEAR_THR    = 0.20   # <0.20% = AT_VWAP (mean-reversion zone)


def compute_vwap(df: pd.DataFrame) -> pd.DataFrame:
    """
    Adds VWAP columns to a 5m bar DataFrame.
    Required: ts, close, volume (or Close/Volume)
    """
    df = df.copy().sort_values("ts").reset_index(drop=True)

    col = {c.lower(): c for c in df.columns}
    c_col = col.get("close", "close")
    v_col = col.get("volume", "volume")
    ts_col = col.get("ts", "ts")

    closes  = df[c_col].values.astype(float)
    volumes = df[v_col].values.astype(float)
    tss     = df[ts_col].values.astype(int)
    n = len(df)

    vwap_arr    = np.full(n, np.nan)
    vwap_dev    = np.full(n, np.nan)
    vwap_bias   = np.zeros(n, dtype=int)
    vwap_band   = np.full(n, "AT_VWAP", dtype=object)

    cum_pv = 0.0
    cum_v  = 0.0
    prev_day = ""

    for i in range(n):
        from datetime import datetime, timezone
        dt  = datetime.fromtimestamp(int(tss[i]), tz=timezone.utc)
        day = dt.strftime("%Y-%m-%d")
        mins = dt.hour * 60 + dt.minute

        # Reset VWAP at session open each day
        if day != prev_day and mins >= _SESSION_OPEN_MINS:
            cum_pv = 0.0
            cum_v  = 0.0
            prev_day = day
        elif day != prev_day:
            prev_day = day

        vol = max(volumes[i], 0.0)
        cum_pv += closes[i] * vol
        cum_v  += vol

        if cum_v > 0:
            vwap = cum_pv / cum_v
            vwap_arr[i] = round(vwap, 6)
            dev = (closes[i] - vwap) / vwap * 100
            vwap_dev[i] = round(dev, 4)

            if abs(dev) < _NEAR_THR:
                vwap_bias[i] = 0
                vwap_band[i] = "AT_VWAP"
            elif dev > _EXTREME_THR:
                vwap_bias[i] = 1
                vwap_band[i] = "EXTREME_LONG"
            elif dev > _STRONG_THR:
                vwap_bias[i] = 1
                vwap_band[i] = "LONG_BIAS"
            elif dev > _NEAR_THR:
                vwap_bias[i] = 1
                vwap_band[i] = "VWAP_TAP"
            elif dev < -_EXTREME_THR:
                vwap_bias[i] = -1
                vwap_band[i] = "EXTREME_SHORT"
            elif dev < -_STRONG_THR:
                vwap_bias[i] = -1
                vwap_band[i] = "SHORT_BIAS"
            else:
                vwap_bias[i] = -1
                vwap_band[i] = "VWAP_TAP"

    df["vwap"]        = vwap_arr
    df["vwap_dev_pct"] = vwap_dev
    df["vwap_bias"]   = vwap_bias
    df["vwap_band"]   = vwap_band
    return df


def vwap_size_mult(vwap_bias: int, entry_side: str, dev_pct: float) -> float:
    """Size multiplier from VWAP alignment."""
    direction = 1 if entry_side == "buy" else -1
    if abs(dev_pct) > _EXTREME_THR:
        return 0.80      # extended — don't chase
    if vwap_bias == direction:
        return 1.10      # VWAP confirms direction
    if vwap_bias == -direction and abs(dev_pct) > _STRONG_THR:
        return 0.85      # opposing + extended
    return 1.0


def get_vwap_status(symbol: str) -> dict:
    """Live VWAP state for one symbol (last bar)."""
    if not FUTURES_DB.exists():
        return {}
    try:
        conn = sqlite3.connect(FUTURES_DB)
        rows = conn.execute(
            "SELECT ts, close, volume FROM bars_5m WHERE symbol=? ORDER BY ts DESC LIMIT 500",
            (symbol,),
        ).fetchall()
        conn.close()
        if not rows:
            return {}
        df = pd.DataFrame(rows, columns=["ts", "close", "volume"])
        df = compute_vwap(df)
        last = df.iloc[-1]
        return {
            "symbol":      symbol,
            "vwap":        round(float(last["vwap"]), 4) if not np.isnan(last["vwap"]) else None,
            "vwap_dev_pct": round(float(last["vwap_dev_pct"]), 4) if not np.isnan(last["vwap_dev_pct"]) else None,
            "vwap_bias":   int(last["vwap_bias"]),
            "vwap_band":   str(last["vwap_band"]),
        }
    except Exception:
        return {}
