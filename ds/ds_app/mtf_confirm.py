"""
ds_app/mtf_confirm.py — MTF Confirmation Layer (P1-C)

5m signal + 1h trend agreement filter.
When 1h SUPERTREND/EMA_STACK/ADX_TREND disagrees with 5m entry → reduce size.

DOCTRINE:
  Trend context from 1h overrides 5m momentum. A 5m long entry in a 1h downtrend
  is a counter-trend scalp — still tradeable but at reduced size.

SIZE MULTIPLIER:
  MTF_AGREE  (5m and 1h both bullish/bearish): 1.0× — full size
  MTF_NEUTRAL (1h flat / no strong trend):     0.75× — slight caution
  MTF_OPPOSE  (5m long + 1h bearish, or vice): 0.50× — half size

SIGNALS USED FOR 1H TREND:
  SUPERTREND · EMA_STACK · ADX_TREND (2+ required for conviction)

Live use: mtf_confirm() returns a multiplier the paper adapter applies to lot_fraction.
"""
from __future__ import annotations

import logging
import sqlite3
import sys
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd

log = logging.getLogger("mtf_confirm")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

FUTURES_DB = _DS_ROOT / "data" / "futures.db"

MTF_BARS_1H = 200         # how many 1h bars to load
BARS_PER_1H = 12          # 5m bars per 1h bar

_TREND_SIGS = ["SUPERTREND", "EMA_STACK", "ADX_TREND"]
MTFResult = Literal["AGREE", "NEUTRAL", "OPPOSE"]


def load_1h_bars(symbol: str, n: int = MTF_BARS_1H) -> pd.DataFrame | None:
    """Resample 5m bars to 1h from futures.db."""
    try:
        conn = sqlite3.connect(FUTURES_DB)
        df5 = pd.read_sql_query(
            f"SELECT ts, open, high, low, close, volume FROM bars_5m "
            f"WHERE symbol=? ORDER BY ts DESC LIMIT {n * BARS_PER_1H}",
            conn, params=(symbol,),
        )
        conn.close()
    except Exception as exc:
        log.error("load_1h_bars %s: %s", symbol, exc)
        return None

    if len(df5) < BARS_PER_1H * 5:
        return None

    df5 = df5.iloc[::-1].reset_index(drop=True)
    df5["ts_dt"] = pd.to_datetime(df5["ts"], unit="s", utc=True)
    df5 = df5.set_index("ts_dt")
    df1h = df5[["open","high","low","close","volume"]].resample("1h").agg({
        "open": "first", "high": "max", "low": "min",
        "close": "last",  "volume": "sum",
    }).dropna()
    df1h.columns = ["Open","High","Low","Close","Volume"]
    return df1h.reset_index(drop=True)


def _trend_vote_1h(df1h: pd.DataFrame) -> int:
    """Returns +1 (bullish), -1 (bearish), 0 (flat) from 1h trend signals."""
    from ds_app.algos_crypto import build_features
    votes = []
    for sig in _TREND_SIGS:
        try:
            feat = build_features(df1h, sig)
            if bool(feat["entry"].iloc[-1]):
                votes.append(1)
            elif bool(feat["exit_sig"].iloc[-1]):
                votes.append(-1)
            else:
                votes.append(0)
        except Exception:
            votes.append(0)
    total = sum(votes)
    if total >= 2:   return 1    # 2+ trend signals bullish
    if total <= -2:  return -1   # 2+ trend signals bearish
    return 0


def mtf_confirm(symbol: str, side_5m: str) -> tuple[MTFResult, float]:
    """
    Given a 5m entry signal (side_5m = 'buy' or 'sell'), returns:
      (MTFResult, size_multiplier)

    MTFResult:
      AGREE   → 1h agrees with 5m direction    → 1.0×
      NEUTRAL → 1h flat / weak                 → 0.75×
      OPPOSE  → 1h opposes 5m direction        → 0.50×
    """
    df1h = load_1h_bars(symbol)
    if df1h is None or len(df1h) < 50:
        return "NEUTRAL", 0.75

    vote_1h = _trend_vote_1h(df1h)

    direction_5m = 1 if side_5m == "buy" else -1

    if vote_1h == 0:
        return "NEUTRAL", 0.75
    if vote_1h == direction_5m:
        return "AGREE", 1.0
    return "OPPOSE", 0.50


def scan_all(symbols: list[str], side: str = "buy") -> dict[str, dict]:
    """Batch MTF confirmation for a list of symbols."""
    results = {}
    for sym in symbols:
        mtf, mult = mtf_confirm(sym, side)
        results[sym] = {"mtf": mtf, "size_mult": mult}
    return results


if __name__ == "__main__":
    import json, sys
    from ds_app.alpaca_paper import SYMBOL_MAP
    syms = list(SYMBOL_MAP.keys())[:5]
    print("MTF confirmation (buy side):")
    for sym in syms:
        mtf, mult = mtf_confirm(sym, "buy")
        print(f"  {sym:8s}  {mtf:7s}  size={mult:.2f}×")
