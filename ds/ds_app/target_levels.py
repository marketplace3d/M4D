"""
ds_app/target_levels.py — Cumulative Significant Levels (T1-C)

LEVEL HIERARCHY (institutional memory, strongest to weakest):
  PWH/PWL  — previous week high/low   (weekly institutional range)
  PDH/PDL  — previous day high/low    (daily institutional range)
  DR_H/L   — daily range 13:30-14:30 UTC  (NY session opening hour)
  IDR_H/L  — initial DR 13:30-14:00 UTC   (first 30-min of NY open)

SIGNAL:
  nearest_sig_pct  — distance to closest of all tracked levels (% of price)
  nearest_sig_type — which level type is nearest (PDH, DR_H, etc.)
  level_stack      — count of levels within ±0.5% of price (stacked = high conviction)
  sig_zone         — STACKED | NEAR_PWH | NEAR_PWL | NEAR_PDH | NEAR_PDL |
                     NEAR_DR | NEAR_IDR | IDR_TRAP | DR_EXTEND | CLEAR

ENTRY LOGIC:
  STACKED (≥2 levels within ±0.5%)  → highest conviction zone, allow + boost size
  NEAR_PDH / NEAR_PDL / NEAR_DR     → allow entry
  IDR_TRAP                           → block (price coiling inside narrow range)
  CLEAR                              → neutral

EDGE:
  ICT: price treats all prior significant levels as magnets.
  PDH/PDL = most watched institutional S/R after daily close.
  Stacked zones (e.g. PDH + DR_H within 0.2%) = maximum institutional memory.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent

FUTURES_DB = _DS_ROOT / "data" / "futures.db"

# ── NY session UTC minute boundaries (5m bars aligned to bar open) ─────────────
_DR_START  = 13 * 60 + 30   # 13:30 UTC = 09:30 ET
_DR_END    = 14 * 60 + 30   # 14:30 UTC
_IDR_START = 13 * 60 + 30
_IDR_END   = 14 * 60         # 14:00 UTC = 10:00 ET

# ── Proximity thresholds ───────────────────────────────────────────────────────
_NEAR_DR   = 0.003   # ±0.3% → NEAR_DR / NEAR_IDR
_NEAR_PDH  = 0.004   # ±0.4% → NEAR_PDH / NEAR_PDL
_NEAR_PWH  = 0.005   # ±0.5% → NEAR_PWH / NEAR_PWL
_STACK_THR = 0.005   # ±0.5% — two+ levels within this = STACKED zone


# ── timestamp helpers ──────────────────────────────────────────────────────────
def _utc_mins(ts: int) -> int:
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return dt.hour * 60 + dt.minute

def _date_key(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")

def _week_key(ts: int) -> str:
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return f"{dt.isocalendar()[0]}-W{dt.isocalendar()[1]:02d}"


# ── per-day extreme aggregation ───────────────────────────────────────────────
def _day_extremes(tss: np.ndarray, highs: np.ndarray, lows: np.ndarray
                   ) -> tuple[dict[str, float], dict[str, float]]:
    day_h: dict[str, float] = {}
    day_l: dict[str, float] = {}
    for i in range(len(tss)):
        d = _date_key(int(tss[i]))
        day_h[d] = max(day_h.get(d, -1e18), float(highs[i]))
        day_l[d] = min(day_l.get(d, 1e18),  float(lows[i]))
    return day_h, day_l


def _week_extremes(tss: np.ndarray, highs: np.ndarray, lows: np.ndarray
                    ) -> tuple[dict[str, float], dict[str, float]]:
    wk_h: dict[str, float] = {}
    wk_l: dict[str, float] = {}
    for i in range(len(tss)):
        w = _week_key(int(tss[i]))
        wk_h[w] = max(wk_h.get(w, -1e18), float(highs[i]))
        wk_l[w] = min(wk_l.get(w, 1e18),  float(lows[i]))
    return wk_h, wk_l


# ── main vectorized computation ───────────────────────────────────────────────
def compute_dr_levels(df: pd.DataFrame) -> pd.DataFrame:
    """
    Adds all significant-level columns to a 5m bar DataFrame.

    Required input: ts, high, low, close
    Added columns:
      dr_high, dr_low, idr_high, idr_low   — NY session range levels
      pdh, pdl                              — previous day high/low
      pwh, pwl                              — previous week high/low
      dr_proximity_pct                      — distance to nearest DR level (%)
      nearest_sig_pct                       — distance to nearest of all levels (%)
      nearest_sig_type                      — which level type is nearest
      level_stack                           — # levels within ±0.5% of price
      sig_zone                              — zone classification
    """
    df = df.copy().sort_values("ts").reset_index(drop=True)
    n      = len(df)
    tss    = df["ts"].values.astype(int)
    highs  = df["high"].values.astype(float)
    lows   = df["low"].values.astype(float)
    closes = df["close"].values.astype(float)

    # ── DR / IDR ──────────────────────────────────────────────────────────────
    dr_h  = np.full(n, np.nan)
    dr_l  = np.full(n, np.nan)
    idr_h = np.full(n, np.nan)
    idr_l = np.full(n, np.nan)

    day_levels: dict[str, dict] = {}
    for i in range(n):
        m   = _utc_mins(tss[i])
        day = _date_key(tss[i])
        if day not in day_levels:
            day_levels[day] = {"dr_h": [], "dr_l": [], "idr_h": [], "idr_l": []}
        lv = day_levels[day]
        if _DR_START <= m < _DR_END:
            lv["dr_h"].append(highs[i]); lv["dr_l"].append(lows[i])
        if _IDR_START <= m < _IDR_END:
            lv["idr_h"].append(highs[i]); lv["idr_l"].append(lows[i])

    day_dr: dict[str, tuple] = {}
    for day, lv in day_levels.items():
        day_dr[day] = (
            max(lv["dr_h"])  if lv["dr_h"]  else np.nan,
            min(lv["dr_l"])  if lv["dr_l"]  else np.nan,
            max(lv["idr_h"]) if lv["idr_h"] else np.nan,
            min(lv["idr_l"]) if lv["idr_l"] else np.nan,
        )

    sorted_days = sorted(day_dr.keys())
    prev: tuple = (np.nan, np.nan, np.nan, np.nan)
    filled: dict[str, tuple] = {}
    for day in sorted_days:
        lv = day_dr[day]
        merged = tuple(lv[k] if not np.isnan(lv[k]) else prev[k] for k in range(4))
        filled[day] = merged
        if not np.isnan(lv[0]):
            prev = merged

    for i in range(n):
        day = _date_key(tss[i])
        if day in filled:
            dr_h[i], dr_l[i], idr_h[i], idr_l[i] = filled[day]

    # ── PDH / PDL ─────────────────────────────────────────────────────────────
    day_hi, day_lo = _day_extremes(tss, highs, lows)
    sorted_d = sorted(day_hi.keys())
    prev_day_hi: dict[str, float] = {}
    prev_day_lo: dict[str, float] = {}
    for k, day in enumerate(sorted_d):
        if k > 0:
            pd_ = sorted_d[k - 1]
            prev_day_hi[day] = day_hi[pd_]
            prev_day_lo[day] = day_lo[pd_]

    pdh_arr = np.full(n, np.nan)
    pdl_arr = np.full(n, np.nan)
    for i in range(n):
        d = _date_key(tss[i])
        if d in prev_day_hi:
            pdh_arr[i] = prev_day_hi[d]
            pdl_arr[i] = prev_day_lo[d]

    # ── PWH / PWL ─────────────────────────────────────────────────────────────
    wk_hi, wk_lo = _week_extremes(tss, highs, lows)
    sorted_w = sorted(wk_hi.keys())
    prev_wk_hi: dict[str, float] = {}
    prev_wk_lo: dict[str, float] = {}
    for k, wk in enumerate(sorted_w):
        if k > 0:
            pw = sorted_w[k - 1]
            prev_wk_hi[wk] = wk_hi[pw]
            prev_wk_lo[wk] = wk_lo[pw]

    pwh_arr = np.full(n, np.nan)
    pwl_arr = np.full(n, np.nan)
    for i in range(n):
        w = _week_key(tss[i])
        if w in prev_wk_hi:
            pwh_arr[i] = prev_wk_hi[w]
            pwl_arr[i] = prev_wk_lo[w]

    # ── Assign arrays to df ───────────────────────────────────────────────────
    df["dr_high"]  = dr_h
    df["dr_low"]   = dr_l
    df["idr_high"] = idr_h
    df["idr_low"]  = idr_l
    df["pdh"]      = pdh_arr
    df["pdl"]      = pdl_arr
    df["pwh"]      = pwh_arr
    df["pwl"]      = pwl_arr

    # ── Proximity, stack, zone ────────────────────────────────────────────────
    dr_prox         = np.full(n, np.nan)
    nearest_sig_pct = np.full(n, np.nan)
    nearest_sig_typ = np.full(n, "CLEAR", dtype=object)
    level_stack     = np.zeros(n, dtype=int)
    zones           = np.full(n, "CLEAR", dtype=object)

    for i in range(n):
        c = closes[i]
        if c == 0:
            continue

        level_map = {
            "DR_H":  dr_h[i],   "DR_L":  dr_l[i],
            "IDR_H": idr_h[i],  "IDR_L": idr_l[i],
            "PDH":   pdh_arr[i],"PDL":   pdl_arr[i],
            "PWH":   pwh_arr[i],"PWL":   pwl_arr[i],
        }
        valid = {k: v for k, v in level_map.items() if not np.isnan(v)}
        if not valid:
            continue

        dists = {k: abs(c - v) / c for k, v in valid.items()}

        # Nearest overall significant level
        nearest_t = min(dists, key=dists.get)
        nearest_p = dists[nearest_t] * 100
        nearest_sig_typ[i] = nearest_t
        nearest_sig_pct[i] = round(nearest_p, 4)

        # DR proximity (just DR_H / DR_L)
        dr_dists = [dists.get("DR_H", 1.0), dists.get("DR_L", 1.0)]
        dr_prox[i] = round(min(dr_dists) * 100, 4)

        # Stack: levels within ±_STACK_THR of price
        level_stack[i] = sum(1 for d in dists.values() if d <= _STACK_THR)

        # Zone classification (priority order)
        if level_stack[i] >= 2:
            zones[i] = "STACKED"
        elif not np.isnan(idr_h[i]) and idr_l[i] <= c <= idr_h[i]:
            zones[i] = "IDR_TRAP"
        elif dists.get("PWH", 1.0) <= _NEAR_PWH or dists.get("PWL", 1.0) <= _NEAR_PWH:
            zones[i] = "NEAR_PWH" if dists.get("PWH", 1.0) < dists.get("PWL", 1.0) else "NEAR_PWL"
        elif dists.get("PDH", 1.0) <= _NEAR_PDH or dists.get("PDL", 1.0) <= _NEAR_PDH:
            zones[i] = "NEAR_PDH" if dists.get("PDH", 1.0) < dists.get("PDL", 1.0) else "NEAR_PDL"
        elif dists.get("IDR_H", 1.0) <= _NEAR_DR or dists.get("IDR_L", 1.0) <= _NEAR_DR:
            zones[i] = "NEAR_IDR"
        elif dists.get("DR_H", 1.0) <= _NEAR_DR or dists.get("DR_L", 1.0) <= _NEAR_DR:
            zones[i] = "NEAR_DR"
        elif not np.isnan(dr_h[i]) and (c > dr_h[i] or c < dr_l[i]):
            zones[i] = "DR_EXTEND"

    df["dr_proximity_pct"]  = dr_prox
    df["nearest_sig_pct"]   = nearest_sig_pct
    df["nearest_sig_type"]  = nearest_sig_typ
    df["level_stack"]       = level_stack
    df["sig_zone"]          = zones
    return df


# ── Live snapshot for a single symbol ─────────────────────────────────────────
def get_current_levels(symbol: str) -> dict:
    """
    Pull the last 2000 5m bars from futures.db, compute all significant levels,
    return the most recent bar's level snapshot.
    """
    if not FUTURES_DB.exists():
        return {}
    try:
        conn = sqlite3.connect(FUTURES_DB)
        rows = conn.execute(
            "SELECT ts, high, low, close FROM bars_5m WHERE symbol=? ORDER BY ts DESC LIMIT 2000",
            (symbol,),
        ).fetchall()
        conn.close()
        if not rows:
            return {}
        df = pd.DataFrame(rows, columns=["ts", "high", "low", "close"])
        df = compute_dr_levels(df)
        last = df.iloc[-1]
        return {
            "dr_high":          _safe(last, "dr_high"),
            "dr_low":           _safe(last, "dr_low"),
            "idr_high":         _safe(last, "idr_high"),
            "idr_low":          _safe(last, "idr_low"),
            "pdh":              _safe(last, "pdh"),
            "pdl":              _safe(last, "pdl"),
            "pwh":              _safe(last, "pwh"),
            "pwl":              _safe(last, "pwl"),
            "price":            float(last["close"]),
            "dr_proximity_pct": _safe(last, "dr_proximity_pct"),
            "nearest_sig_pct":  _safe(last, "nearest_sig_pct"),
            "nearest_sig_type": str(last.get("nearest_sig_type", "CLEAR")),
            "level_stack":      int(last.get("level_stack", 0)),
            "sig_zone":         str(last.get("sig_zone", "CLEAR")),
        }
    except Exception:
        return {}


def _safe(row: pd.Series, col: str):
    v = row.get(col)
    if v is None:
        return None
    try:
        f = float(v)
        return None if np.isnan(f) else round(f, 6)
    except Exception:
        return str(v)


# ── Entry gate ────────────────────────────────────────────────────────────────
def dr_entry_allowed(symbol: str, strict: bool = False) -> tuple[bool, str]:
    """
    Returns (allowed, zone).
    strict=False: block only IDR_TRAP (chop zone)
    strict=True:  allow only STACKED, NEAR_PDH/PDL, NEAR_DR, NEAR_IDR
    """
    lvl = get_current_levels(symbol)
    if not lvl:
        return True, "NO_DATA"
    zone = lvl.get("sig_zone", "CLEAR")
    if strict:
        return zone in ("STACKED", "NEAR_PDH", "NEAR_PDL", "NEAR_DR", "NEAR_IDR", "NEAR_PWH", "NEAR_PWL"), zone
    return zone != "IDR_TRAP", zone


# ── Size multiplier from level stack ──────────────────────────────────────────
def level_stack_mult(symbol: str) -> float:
    """
    Returns size multiplier based on proximity to stacked institutional levels.
    STACKED → 1.20, NEAR_PWH/PDH → 1.10, NEAR_DR → 1.05, IDR_TRAP → 0.5, else 1.0
    """
    lvl = get_current_levels(symbol)
    if not lvl:
        return 1.0
    zone = lvl.get("sig_zone", "CLEAR")
    stack = lvl.get("level_stack", 0)
    if zone == "STACKED" or stack >= 3:
        return 1.20
    if zone in ("NEAR_PWH", "NEAR_PWL"):
        return 1.12
    if zone in ("NEAR_PDH", "NEAR_PDL"):
        return 1.08
    if zone in ("NEAR_DR", "NEAR_IDR"):
        return 1.05
    if zone == "IDR_TRAP":
        return 0.50
    return 1.0
