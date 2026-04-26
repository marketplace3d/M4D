"""
liquidity_walls.py — Institutional Liquidity Wall Engine
=========================================================
Computes price levels where institutional volume concentrates:

  VAP / HVN:  Volume At Price binning → High Volume Nodes = buy/sell walls
  LVN:        Low Volume Nodes = price vacuums, fast-travel zones
  Swing pool: Equal-highs / equal-lows cluster density (stop pools)
  Premium/Discount: daily range midpoint classification

API:
  GET /v1/liquidity/walls/?symbol=ES&bars=500

Returns:
  {
    walls:    [{price, vol_rel, type, side, systems}],
    lvns:     [{price, vol_rel}],
    eq_pools: [{price, count, side, label}],
    pd_zone:  {mid, premium_above, cur_zone, pct_of_range},
    meta:     {symbol, n_bars, price_min, price_max, n_bins}
  }
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import TypedDict

import numpy as np

_DS_ROOT  = Path(__file__).resolve().parent.parent
SIGNAL_DB = _DS_ROOT / "data" / "signal_log.db"

N_BINS_DEFAULT  = 100
EQ_TOL_ATR_MULT = 0.18   # EQH/EQL grouping tolerance = 0.18 × ATR


# ── Types ─────────────────────────────────────────────────────────────────────

class Wall(TypedDict):
    price:    float
    vol_rel:  float      # volume / median  (≥1.5 = wall)
    type:     str        # "HVN" | "LVN"
    side:     str        # "ABOVE" | "BELOW" | "AT"
    systems:  list[str]  # coinciding structural labels e.g. ["PDH", "EQH"]


class EQPool(TypedDict):
    price:  float
    count:  int          # number of swing pivots within tolerance
    side:   str          # "ABOVE" | "BELOW"
    label:  str          # "EQH" | "EQL"


class PDZone(TypedDict):
    mid:           float
    premium_above: float  # price above which = premium
    cur_zone:      str    # "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM"
    pct_of_range:  float  # 0..1 where cur price sits in daily range


# ── VAP / HVN ─────────────────────────────────────────────────────────────────

def compute_vap(
    highs: np.ndarray,
    lows:  np.ndarray,
    closes: np.ndarray,
    volumes: np.ndarray,
    n_bins: int = N_BINS_DEFAULT,
) -> tuple[np.ndarray, np.ndarray, float]:
    """
    Returns (bin_prices, bin_volumes, median_vol).
    bin_prices: midpoint of each price bin.
    bin_volumes: total volume traded in each bin.
    Volume distributed across bins proportional to overlap with bar's H-L range.
    """
    p_min = float(lows.min())
    p_max = float(highs.max())
    rng   = p_max - p_min
    if rng <= 0 or n_bins < 2:
        return np.array([]), np.array([]), 0.0

    bin_sz = rng / n_bins
    vols   = np.zeros(n_bins, dtype=float)

    for h, l, v in zip(highs, lows, volumes):
        bar_range = max(h - l, bin_sz * 0.01)
        # find overlapping bins
        b_lo = max(0, int((l - p_min) / bin_sz))
        b_hi = min(n_bins - 1, int((h - p_min) / bin_sz))
        for bi in range(b_lo, b_hi + 1):
            bin_l = p_min + bi * bin_sz
            bin_h = bin_l + bin_sz
            overlap = min(h, bin_h) - max(l, bin_l)
            if overlap > 0:
                vols[bi] += v * (overlap / bar_range)

    bin_prices = p_min + (np.arange(n_bins) + 0.5) * bin_sz
    sorted_v   = np.sort(vols)
    median_v   = float(sorted_v[n_bins // 2])
    return bin_prices, vols, median_v


def extract_walls(
    bin_prices: np.ndarray,
    bin_vols:   np.ndarray,
    median_vol: float,
    cur_price:  float,
    hvn_thresh: float = 1.5,
    lvn_thresh: float = 0.4,
    merge_bins:  int  = 3,
) -> tuple[list[Wall], list[Wall]]:
    """
    Returns (hvn_walls, lvn_walls) — merged adjacent bins.
    HVN: vol ≥ hvn_thresh × median.
    LVN: vol ≤ lvn_thresh × median.
    """
    if median_vol <= 0 or not len(bin_prices):
        return [], []

    bin_sz = float(bin_prices[1] - bin_prices[0]) if len(bin_prices) > 1 else 1.0
    merge_dist = bin_sz * merge_bins

    def _to_walls(indices: np.ndarray, w_type: str) -> list[Wall]:
        if not len(indices):
            return []
        walls: list[Wall] = []
        cur_grp: list[int] = [int(indices[0])]
        for idx in indices[1:]:
            if bin_prices[idx] - bin_prices[cur_grp[-1]] <= merge_dist:
                cur_grp.append(int(idx))
            else:
                best = cur_grp[int(np.argmax(bin_vols[cur_grp]))]
                rel  = float(bin_vols[best]) / median_vol
                walls.append(Wall(
                    price   = float(bin_prices[best]),
                    vol_rel = round(rel, 2),
                    type    = w_type,
                    side    = "ABOVE" if bin_prices[best] > cur_price else "BELOW",
                    systems = [],
                ))
                cur_grp = [int(idx)]
        # flush last group
        best = cur_grp[int(np.argmax(bin_vols[cur_grp]))]
        rel  = float(bin_vols[best]) / median_vol
        walls.append(Wall(
            price   = float(bin_prices[best]),
            vol_rel = round(rel, 2),
            type    = w_type,
            side    = "ABOVE" if bin_prices[best] > cur_price else "BELOW",
            systems = [],
        ))
        return walls

    hvn_idx = np.where(bin_vols >= hvn_thresh * median_vol)[0]
    lvn_idx = np.where(bin_vols <= lvn_thresh * median_vol)[0]
    return _to_walls(hvn_idx, "HVN"), _to_walls(lvn_idx, "LVN")


# ── Equal-Highs / Equal-Lows pool detection ───────────────────────────────────

def compute_eq_pools(
    highs:  np.ndarray,
    lows:   np.ndarray,
    closes: np.ndarray,
    atr:    float,
    lookback: int = 100,
    min_count: int = 2,
) -> list[EQPool]:
    """
    Swing pivot clusters within ATR×0.18 tolerance.
    EQH = buy-side liquidity (stops above equal highs).
    EQL = sell-side liquidity (stops below equal lows).
    """
    tol = atr * EQ_TOL_ATR_MULT
    sl = highs[-lookback:], lows[-lookback:]
    cur = float(closes[-1])

    def _swing_highs(h: np.ndarray) -> list[float]:
        pts: list[float] = []
        for i in range(2, len(h) - 2):
            if h[i] >= h[i-1] and h[i] >= h[i-2] and h[i] >= h[i+1] and h[i] >= h[i+2]:
                pts.append(float(h[i]))
        return pts

    def _swing_lows(l: np.ndarray) -> list[float]:
        pts: list[float] = []
        for i in range(2, len(l) - 2):
            if l[i] <= l[i-1] and l[i] <= l[i-2] and l[i] <= l[i+1] and l[i] <= l[i+2]:
                pts.append(float(l[i]))
        return pts

    def _group(pts: list[float]) -> list[tuple[float, int]]:
        groups: list[list[float]] = []
        for p in pts:
            match = next((g for g in groups if abs(g[0] - p) <= tol), None)
            if match:
                match.append(p)
            else:
                groups.append([p])
        return [(sum(g) / len(g), len(g)) for g in groups if len(g) >= min_count]

    pools: list[EQPool] = []
    for price, count in _group(_swing_highs(sl[0])):
        pools.append(EQPool(price=round(price, 4), count=count,
                            side="ABOVE" if price > cur else "BELOW", label="EQH"))
    for price, count in _group(_swing_lows(sl[1])):
        pools.append(EQPool(price=round(price, 4), count=count,
                            side="ABOVE" if price > cur else "BELOW", label="EQL"))
    return sorted(pools, key=lambda p: abs(p["price"] - cur))


# ── Premium / Discount zone ────────────────────────────────────────────────────

def compute_pd_zone(pdh: float, pdl: float, cur: float) -> PDZone:
    """
    Previous day range premium/discount classification.
    Premium = above midpoint → BULL entries not allowed here (chasing).
    Discount = below midpoint → BEAR entries not allowed here.
    """
    if pdh <= 0 or pdl <= 0 or pdh <= pdl:
        return PDZone(mid=cur, premium_above=cur, cur_zone="UNKNOWN", pct_of_range=0.5)
    mid = (pdh + pdl) / 2.0
    rng = pdh - pdl
    pct = (cur - pdl) / rng if rng > 0 else 0.5
    if pct > 0.55:
        zone = "PREMIUM"
    elif pct < 0.45:
        zone = "DISCOUNT"
    else:
        zone = "EQUILIBRIUM"
    return PDZone(mid=round(mid, 4), premium_above=round(mid, 4),
                  cur_zone=zone, pct_of_range=round(pct, 4))


# ── T1 confluence check ────────────────────────────────────────────────────────

def t1_has_wall_confluence(
    t1_price:  float,
    walls:     list[Wall],
    eq_pools:  list[EQPool],
    atr:       float,
    tol_mult:  float = 0.3,
) -> tuple[bool, list[str]]:
    """
    True if T1 price is within tol_mult×ATR of a HVN wall or EQ pool.
    Returns (has_confluence, [matching_labels]).
    """
    tol = atr * tol_mult
    labels: list[str] = []
    for w in walls:
        if w["type"] == "HVN" and abs(w["price"] - t1_price) <= tol:
            labels.append(f"HVN@{w['price']:.1f}×{w['vol_rel']:.1f}")
    for p in eq_pools:
        if abs(p["price"] - t1_price) <= tol:
            labels.append(f"{p['label']}×{p['count']}")
    return bool(labels), labels


# ── OB displacement qualifier ─────────────────────────────────────────────────

def ob_is_displaced(
    bars_after_ob: np.ndarray,   # rows: [open, high, low, close] after OB candle
    atr:           float,
    displace_mult: float = 1.5,
    max_touches:   int   = 1,
    ob_high:       float = 0.0,
    ob_low:        float = 0.0,
    ob_dir:        str   = "BULL",
) -> bool:
    """
    OB is "Live" when:
    1. Displacement candle immediately after OB has range ≥ displace_mult × ATR.
    2. Price has touched back into the OB zone fewer than max_touches times.
    """
    if not len(bars_after_ob):
        return False

    # Condition 1: immediate displacement
    disp_bar   = bars_after_ob[0]
    disp_range = float(disp_bar[1] - disp_bar[2])  # high - low
    if disp_range < displace_mult * atr:
        return False

    # Condition 2: freshness — how many times has price entered the OB zone?
    touches = 0
    for bar in bars_after_ob[1:]:
        if ob_dir == "BULL" and bar[2] <= ob_high:  # low dipped back into OB
            touches += 1
        elif ob_dir == "BEAR" and bar[1] >= ob_low:  # high poked back into OB
            touches += 1
        if touches > max_touches:
            return False
    return True


# ── Main: load bars + compute all layers ──────────────────────────────────────

def run_for_symbol(
    symbol: str,
    n_bars: int = 500,
    n_bins: int = N_BINS_DEFAULT,
) -> dict:
    """
    Load last n_bars from signal_log.db for symbol, compute all wall layers.
    """
    conn = sqlite3.connect(SIGNAL_DB)
    rows = conn.execute(
        "SELECT ts, open, high, low, close, volume, atr_pct "
        "FROM signal_log WHERE symbol=? ORDER BY ts DESC LIMIT ?",
        (symbol, n_bars),
    ).fetchall()
    conn.close()

    if not rows:
        return {"ok": False, "error": f"No data for {symbol}"}

    rows = rows[::-1]  # chronological order
    arr  = np.array(rows, dtype=float)
    ts_a, open_a, high_a, low_a, close_a, vol_a, atr_pct_a = arr.T

    cur   = float(close_a[-1])
    atr   = float((atr_pct_a[-1] if atr_pct_a[-1] > 0 else 0.005) * cur)

    # ── VAP / HVN walls ────────────────────────────────────────────────────────
    bin_prices, bin_vols, median_v = compute_vap(high_a, low_a, close_a, vol_a, n_bins)
    hvn_walls, lvn_walls = extract_walls(bin_prices, bin_vols, median_v, cur)

    # ── EQ pools ───────────────────────────────────────────────────────────────
    eq_pools = compute_eq_pools(high_a, low_a, close_a, atr)

    # ── Annotate HVN walls that coincide with EQ pools ──────────────────────
    tol = atr * 0.3
    for w in hvn_walls:
        for p in eq_pools:
            if abs(w["price"] - p["price"]) <= tol:
                w["systems"].append(p["label"])

    # ── Premium / Discount (use last 100 bars day range) ───────────────────
    # Find PDH/PDL from yesterday's bars (naive: max/min of prior-session bars)
    pdh = float(high_a[-100:-1].max()) if len(high_a) > 1 else cur
    pdl = float(low_a[-100:-1].min())  if len(low_a)  > 1 else cur
    pd_zone = compute_pd_zone(pdh, pdl, cur)

    return {
        "ok":      True,
        "symbol":  symbol,
        "cur":     round(cur, 4),
        "atr":     round(atr, 4),
        "walls":   hvn_walls,
        "lvns":    lvn_walls,
        "eq_pools": eq_pools,
        "pd_zone": pd_zone,
        "meta": {
            "n_bars":    len(rows),
            "n_bins":    n_bins,
            "price_min": round(float(low_a.min()),  4),
            "price_max": round(float(high_a.max()), 4),
        },
    }


if __name__ == "__main__":
    import json, sys
    sym  = sys.argv[1] if len(sys.argv) > 1 else "ES"
    bars = int(sys.argv[2]) if len(sys.argv) > 2 else 500
    r    = run_for_symbol(sym, bars)
    print(json.dumps(r, indent=2))
