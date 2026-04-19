"""
ds_app/ob_signal.py — Order Block + FVG Detection (T2-A, T2-B)

ORDER BLOCK (ICT Super OB method, from ICT-01_order_block.pine):
  Bull OB = last DOWN candle before an UP candle that closes ABOVE prior high
            body size >= ob_min_atr × ATR14
  Bear OB = last UP candle before a DOWN candle that closes BELOW prior low
            body size >= ob_min_atr × ATR14

  Active OB: price re-enters the OB zone (not yet mitigated by close beyond OB)
  INST OB: vol_exp + FVG created on displacement bar + kill-zone timing → score ≥70

FAIR VALUE GAP (T2-B, one-liner per MTF-FVG.PINE):
  Bull FVG: high[i-2] < low[i]   — gap left above, price likely returns to fill
  Bear FVG: low[i-2]  > high[i]  — gap left below

PPDD (Post-sweep OB — highest conviction):
  Bull PPDD: bull OB formed AFTER liquidity sweep of a recent swing low
  Bear PPDD: bear OB formed AFTER liquidity sweep of a recent swing high

CORRELATION:
  Zero correlation with EMA/RSI/squeeze signals — pure price structure.
  OB = institutional order flow memory zone, NOT trend/momentum.

OUTPUTS (per bar):
  ob_bull_near   — 1 if price is inside an active unmitigated Bull OB zone
  ob_bear_near   — 1 if price is inside an active unmitigated Bear OB zone
  ob_inst_score  — INST score of the nearest active OB (0 if none)
  fvg_bull       — 1 if a bull FVG was created on this bar
  fvg_bear       — 1 if a bear FVG was created on this bar
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ── Parameters (match Pine defaults) ──────────────────────────────────────────
OB_MIN_ATR  = 0.3    # OB body must be ≥ 0.3 × ATR14
OB_MAX_AGE  = 80     # bars before an OB expires (decays)
OB_MAX_KEEP = 6      # max simultaneous active OBs per side

# Kill zone hours (UTC) for INST scoring
_KZ_HOURS = {3, 4, 9, 10, 13, 14}


def _atr14(h: pd.Series, l: pd.Series, c: pd.Series) -> pd.Series:
    prev = c.shift(1)
    tr = pd.concat([(h - l).abs(), (h - prev).abs(), (l - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(span=14, adjust=False).mean()


def _vol_expanded(v: pd.Series, mult: float = 1.3, win: int = 20) -> pd.Series:
    return (v > v.rolling(win).mean() * mult).fillna(False)


def _in_kill_zone(ts: pd.Series) -> pd.Series:
    hours = pd.to_datetime(ts, unit="s", utc=True).dt.hour
    return hours.isin(_KZ_HOURS)


def _inst_score(vol_exp: bool, fvg: bool, in_kz: bool) -> int:
    return min(100, 30 + (20 if vol_exp else 0) + 25 + (15 if fvg else 0) + (10 if in_kz else 0))


# ── Vectorized OB + FVG detection ─────────────────────────────────────────────
def compute_ob_signals(df: pd.DataFrame) -> pd.DataFrame:
    """
    Adds OB and FVG columns to a 5m bar DataFrame.
    Required: ts, open, high, low, close, volume
    Expected column names: lowercase (open/high/low/close/volume or Open/High/Low/Close/Volume).
    """
    df = df.copy()

    # Normalise column names
    col_map = {c.lower(): c for c in df.columns}
    o = df[col_map.get("open",   "open")].values.astype(float)
    h = df[col_map.get("high",   "high")].values.astype(float)
    l = df[col_map.get("low",    "low")].values.astype(float)
    c = df[col_map.get("close",  "close")].values.astype(float)
    v = df[col_map.get("volume", "volume")].values.astype(float)
    ts_col = col_map.get("ts", "ts")

    n   = len(df)
    atr = _atr14(pd.Series(h), pd.Series(l), pd.Series(c)).values
    vol_exp_arr = _vol_expanded(pd.Series(v)).values
    kz_arr      = _in_kill_zone(df[ts_col]).values

    # ── FVG (one-bar vectorized) ───────────────────────────────────────────────
    fvg_bull = np.zeros(n, dtype=int)
    fvg_bear = np.zeros(n, dtype=int)
    for i in range(2, n):
        if h[i - 2] < l[i]:
            fvg_bull[i] = 1
        if l[i - 2] > h[i]:
            fvg_bear[i] = 1

    # ── OB detection ──────────────────────────────────────────────────────────
    # Bar i: signal bar | Bar i-1: OB candidate bar
    bull_ob_formed = np.zeros(n, dtype=bool)
    bear_ob_formed = np.zeros(n, dtype=bool)
    ob_bull_top    = np.zeros(n, dtype=float)
    ob_bull_bot    = np.zeros(n, dtype=float)
    ob_bear_top    = np.zeros(n, dtype=float)
    ob_bear_bot    = np.zeros(n, dtype=float)
    ob_bull_score  = np.zeros(n, dtype=int)
    ob_bear_score  = np.zeros(n, dtype=int)

    for i in range(1, n):
        body_prev = abs(o[i - 1] - c[i - 1])
        atr_prev  = atr[i - 1] if not np.isnan(atr[i - 1]) else 0.0

        # Bull OB: bar[i-1] is down, bar[i] is up closing above bar[i-1].high
        if (c[i - 1] < o[i - 1] and           # bar[i-1] bearish
                c[i] > o[i] and                # bar[i] bullish
                c[i] > h[i - 1] and            # closes above prior high
                body_prev >= OB_MIN_ATR * atr_prev):
            bull_ob_formed[i] = True
            ob_bull_top[i]    = max(o[i - 1], c[i - 1])
            ob_bull_bot[i]    = min(o[i - 1], c[i - 1])
            ob_bull_score[i]  = _inst_score(
                bool(vol_exp_arr[i]), bool(fvg_bull[i]), bool(kz_arr[i])
            )

        # Bear OB: bar[i-1] is up, bar[i] is down closing below bar[i-1].low
        if (c[i - 1] > o[i - 1] and           # bar[i-1] bullish
                c[i] < o[i] and                # bar[i] bearish
                c[i] < l[i - 1] and            # closes below prior low
                body_prev >= OB_MIN_ATR * atr_prev):
            bear_ob_formed[i] = True
            ob_bear_top[i]    = max(o[i - 1], c[i - 1])
            ob_bear_bot[i]    = min(o[i - 1], c[i - 1])
            ob_bear_score[i]  = _inst_score(
                bool(vol_exp_arr[i]), bool(fvg_bear[i]), bool(kz_arr[i])
            )

    # ── Active OB zones: stateful forward scan ─────────────────────────────────
    ob_bull_near  = np.zeros(n, dtype=int)
    ob_bear_near  = np.zeros(n, dtype=int)
    ob_inst_score = np.zeros(n, dtype=int)

    # Ring buffer of active OBs: (top, bot, formed_bar, score)
    active_bulls: list[tuple] = []
    active_bears: list[tuple] = []

    for i in range(n):
        price = c[i]
        atr_i = atr[i] if not np.isnan(atr[i]) else 0.0

        # Register new OBs
        if bull_ob_formed[i]:
            active_bulls.append((ob_bull_top[i], ob_bull_bot[i], i, ob_bull_score[i]))
            if len(active_bulls) > OB_MAX_KEEP:
                active_bulls.pop(0)
        if bear_ob_formed[i]:
            active_bears.append((ob_bear_top[i], ob_bear_bot[i], i, ob_bear_score[i]))
            if len(active_bears) > OB_MAX_KEEP:
                active_bears.pop(0)

        # Purge mitigated / expired bull OBs, check if price is inside
        next_bulls = []
        for (top, bot, formed, score) in active_bulls:
            age = i - formed
            if price < bot:
                continue           # mitigated (closed below OB = invalidated)
            if age > OB_MAX_AGE:
                continue           # expired
            next_bulls.append((top, bot, formed, score))
            if bot <= price <= top + 0.5 * atr_i:
                ob_bull_near[i] = 1
                ob_inst_score[i] = max(ob_inst_score[i], score)
        active_bulls = next_bulls

        # Purge mitigated / expired bear OBs
        next_bears = []
        for (top, bot, formed, score) in active_bears:
            age = i - formed
            if price > top:
                continue           # mitigated (closed above OB = invalidated)
            if age > OB_MAX_AGE:
                continue           # expired
            next_bears.append((top, bot, formed, score))
            if bot - 0.5 * atr_i <= price <= top:
                ob_bear_near[i] = 1
                ob_inst_score[i] = max(ob_inst_score[i], score)
        active_bears = next_bears

    df["ob_bull_near"]  = ob_bull_near
    df["ob_bear_near"]  = ob_bear_near
    df["ob_inst_score"] = ob_inst_score
    df["fvg_bull"]      = fvg_bull
    df["fvg_bear"]      = fvg_bear
    return df


# ── Live snapshot for one symbol ──────────────────────────────────────────────
def get_ob_status(symbol: str) -> dict:
    """
    Run OB/FVG detection on last 500 bars from futures.db.
    Returns active OB state for current bar.
    """
    from pathlib import Path
    import sqlite3
    futures_db = Path(__file__).resolve().parent.parent / "data" / "futures.db"
    if not futures_db.exists():
        return {}
    try:
        conn = sqlite3.connect(futures_db)
        rows = conn.execute(
            "SELECT ts, open, high, low, close, volume FROM bars_5m "
            "WHERE symbol=? ORDER BY ts DESC LIMIT 500", (symbol,)
        ).fetchall()
        conn.close()
        df = pd.DataFrame(rows, columns=["ts","open","high","low","close","volume"])
        df = compute_ob_signals(df)
        last = df.iloc[-1]
        return {
            "symbol":        symbol,
            "ob_bull_near":  int(last["ob_bull_near"]),
            "ob_bear_near":  int(last["ob_bear_near"]),
            "ob_inst_score": int(last["ob_inst_score"]),
            "fvg_bull":      int(last["fvg_bull"]),
            "fvg_bear":      int(last["fvg_bear"]),
        }
    except Exception:
        return {}
