"""
ds_app/capacity_model.py — Signal Capacity / Turnover Model (P3-C)

Per-symbol maximum position size based on crypto market liquidity.
Prevents oversizing in thin markets and caps slippage risk.

Method:
  1. Load last LOOKBACK_BARS 5m bars from futures.db per symbol
  2. Compute avg_volume (USD) = mean(close × volume) per bar
  3. Max notional = avg_volume × PARTICIPATION_CAP × 60 (per 5m bar → 60 bars/5h window)
  4. Also compute turnover_rate = avg trades per bar (volume / avg_trade_size proxy)

Outputs per symbol:
  max_lot_usd     — maximum safe USD notional per trade
  avg_volume_usd  — 5m average dollar volume
  participation   — implied market share at max_lot_usd
  liquidity_tier  — DEEP / NORMAL / THIN / DRY (for UI)

Also provides: cap_lot_fraction(symbol, equity) → max lot fraction of equity
(used by paper adapters to clamp lot sizing below liquidity ceiling)

Output: ds/data/capacity_report.json
Endpoint: GET /v1/capacity/   POST /v1/capacity/run/
"""
from __future__ import annotations

import json
import logging
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np

log = logging.getLogger("capacity_model")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent

FUTURES_DB   = _DS_ROOT / "data" / "futures.db"
CAPACITY_OUT = _DS_ROOT / "data" / "capacity_report.json"

# Participation cap: never exceed X% of average 5m bar dollar volume
PARTICIPATION_CAP = 0.01      # 1% of avg bar volume per trade
LOOKBACK_BARS     = 2016      # 7 days of 5m bars
SCALE_BARS        = 60        # number of bars in our 5h liquidity window

SYMBOLS = [
    "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX",
    "DOGE", "DOT", "LINK", "MATIC", "OP", "ARB", "UNI", "LTC",
]

# Liquidity tier thresholds (USD per trade)
TIER_DEEP   = 500_000     # > $500k: no constraint
TIER_NORMAL = 50_000      # > $50k
TIER_THIN   = 5_000       # > $5k
# < $5k → DRY


def _tier(max_usd: float) -> str:
    if max_usd >= TIER_DEEP:   return "DEEP"
    if max_usd >= TIER_NORMAL: return "NORMAL"
    if max_usd >= TIER_THIN:   return "THIN"
    return "DRY"


def compute_capacity(symbol: str, conn: sqlite3.Connection) -> dict:
    rows = conn.execute(
        "SELECT close, volume FROM bars_5m WHERE symbol=? ORDER BY ts DESC LIMIT ?",
        (symbol, LOOKBACK_BARS),
    ).fetchall()

    if len(rows) < 50:
        return {
            "symbol":         symbol,
            "error":          "insufficient bars",
            "max_lot_usd":    0.0,
            "avg_volume_usd": 0.0,
            "participation":  PARTICIPATION_CAP,
            "liquidity_tier": "DRY",
            "n_bars":         len(rows),
        }

    closes  = np.array([r[0] for r in rows], dtype=float)
    volumes = np.array([r[1] for r in rows], dtype=float)

    # Dollar volume per bar
    dv = closes * volumes
    avg_dv  = float(np.nanmean(dv))
    med_dv  = float(np.nanmedian(dv))

    # Use median (more robust to volume spikes) for conservative cap
    max_lot = med_dv * PARTICIPATION_CAP * SCALE_BARS
    max_lot = round(max_lot, 2)

    # Volume percentiles (for RVOL context)
    p25 = float(np.nanpercentile(dv, 25))
    p75 = float(np.nanpercentile(dv, 75))

    tier = _tier(max_lot)
    log.info("  %-8s tier=%-7s max_lot=$%,.0f  avg_dv=$%,.0f  median_dv=$%,.0f",
             symbol, tier, max_lot, avg_dv, med_dv)

    return {
        "symbol":             symbol,
        "max_lot_usd":        max_lot,
        "avg_volume_usd_5m":  round(avg_dv, 2),
        "med_volume_usd_5m":  round(med_dv, 2),
        "participation_cap":  PARTICIPATION_CAP,
        "scale_bars":         SCALE_BARS,
        "liquidity_tier":     tier,
        "vol_p25_usd":        round(p25, 2),
        "vol_p75_usd":        round(p75, 2),
        "n_bars":             len(rows),
    }


def run(symbols: list[str] | None = None) -> dict:
    syms = symbols or SYMBOLS
    conn = sqlite3.connect(FUTURES_DB)

    results: dict[str, dict] = {}
    for sym in syms:
        try:
            results[sym] = compute_capacity(sym, conn)
        except Exception as exc:
            log.warning("%s: %s", sym, exc)
            results[sym] = {"symbol": sym, "error": str(exc), "liquidity_tier": "DRY",
                            "max_lot_usd": 0.0}
    conn.close()

    # Summary
    by_tier: dict[str, list[str]] = {"DEEP": [], "NORMAL": [], "THIN": [], "DRY": []}
    for sym, r in results.items():
        by_tier[r["liquidity_tier"]].append(sym)

    report = {
        "generated_at":     __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "ts":               int(time.time()),
        "lookback_bars":    LOOKBACK_BARS,
        "participation_cap": PARTICIPATION_CAP,
        "by_tier":          by_tier,
        "symbols":          results,
    }
    CAPACITY_OUT.parent.mkdir(parents=True, exist_ok=True)
    CAPACITY_OUT.write_text(json.dumps(report, indent=2))
    log.info("Capacity report → %s", CAPACITY_OUT)
    return report


def load_latest() -> dict | None:
    if CAPACITY_OUT.exists():
        return json.loads(CAPACITY_OUT.read_text())
    return None


def cap_lot_fraction(symbol: str, equity: float, lot_pct: float = 0.05) -> float:
    """
    Returns max allowed lot fraction (0–1) for a given symbol and account equity.
    Clamps lot fraction so that (equity × lot_pct × lot_fraction) ≤ max_lot_usd.
    Returns 1.0 if no capacity data (no constraint).
    """
    report = load_latest()
    if not report:
        return 1.0
    sym_data = report.get("symbols", {}).get(symbol)
    if not sym_data or sym_data.get("liquidity_tier") == "DRY":
        return 0.0
    max_usd  = sym_data.get("max_lot_usd", 0)
    if max_usd <= 0 or equity <= 0 or lot_pct <= 0:
        return 1.0
    max_frac = max_usd / (equity * lot_pct)
    return round(min(max_frac, 1.0), 4)


if __name__ == "__main__":
    out = run()
    print(f"\n{'Symbol':10s} {'Tier':8s} {'MaxLot':>14s} {'AvgVol5m':>14s} {'MedVol5m':>14s}")
    print("-" * 65)
    for sym, r in sorted(out["symbols"].items(), key=lambda x: x[1].get("max_lot_usd", 0), reverse=True):
        ml  = f"${r.get('max_lot_usd', 0):>12,.0f}"
        av  = f"${r.get('avg_volume_usd_5m', 0):>12,.0f}"
        mv  = f"${r.get('med_volume_usd_5m', 0):>12,.0f}"
        print(f"  {sym:8s}  {r['liquidity_tier']:8s} {ml} {av} {mv}")
    print("\nBy tier:")
    for tier, syms in out["by_tier"].items():
        if syms: print(f"  {tier}: {', '.join(syms)}")
