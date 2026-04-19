"""
ds_app/oi_signal.py — Open Interest Signal

Binance perpetual futures OI from /fapi/v1/openInterest.
Tracks OI change rate to detect leveraged trend participation vs unwind.

OI interpretation:
  Price↑ + OI↑  → new longs entering = TREND CONFIRMATION (bullish fuel)
  Price↑ + OI↓  → shorts covering   = EXHAUSTION (squeeze end, fade signal)
  Price↓ + OI↑  → new shorts entering = TREND CONFIRMATION (bearish fuel)
  Price↓ + OI↓  → longs exiting    = CAPITULATION (may be near bottom)

Signals:
  TREND_CONFIRM  — price move + OI growth (participation building)
  EXHAUSTION     — price move + OI shrink (covering, not conviction)
  CAPITULATION   — price drop + OI drain (forced exits)
  NEUTRAL        — OI stable

Cache: 5-minute TTL (Binance updates OI every ~30s but we poll slowly)
Endpoint: GET /v1/oi/    POST /v1/oi/refresh/
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger("oi_signal")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent

CACHE_PATH = _DS_ROOT / "data" / "oi_signals.json"
CACHE_TTL  = 300   # 5 minutes

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT"]
DB_MAP  = {"BTCUSDT": "BTC", "ETHUSDT": "ETH", "SOLUSDT": "SOL",
           "BNBUSDT": "BNB", "DOGEUSDT": "DOGE"}

BASE_URL = "https://fapi.binance.com"


def _fetch_oi(symbol: str) -> dict[str, Any] | None:
    try:
        r = requests.get(f"{BASE_URL}/fapi/v1/openInterest",
                         params={"symbol": symbol}, timeout=8)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        log.warning("OI fetch %s: %s", symbol, exc)
        return None


def _fetch_price(symbol: str) -> float | None:
    try:
        r = requests.get(f"{BASE_URL}/fapi/v1/ticker/price",
                         params={"symbol": symbol}, timeout=8)
        r.raise_for_status()
        return float(r.json()["price"])
    except Exception:
        return None


def _load_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text())
    return {}


def _save_cache(data: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(data, indent=2))


def run(force: bool = False) -> dict:
    cache = _load_cache()
    age = time.time() - cache.get("ts", 0)
    if not force and age < CACHE_TTL and cache.get("signals"):
        cache["cached"] = True
        return cache

    signals: dict[str, dict] = {}
    prev_ois = cache.get("raw_oi", {})

    raw_oi: dict[str, float] = {}
    for bsym in SYMBOLS:
        db_sym = DB_MAP[bsym]
        oi_data = _fetch_oi(bsym)
        price   = _fetch_price(bsym)

        if oi_data is None or price is None:
            signals[db_sym] = {"signal": "UNKNOWN", "oi": None, "price": price}
            continue

        oi_now = float(oi_data.get("openInterest", 0))
        raw_oi[bsym] = oi_now
        oi_prev = prev_ois.get(bsym)

        if oi_prev is None or oi_prev == 0:
            signals[db_sym] = {
                "signal": "NEUTRAL", "oi": oi_now, "price": price,
                "oi_change_pct": None, "note": "first observation",
            }
            continue

        oi_chg_pct = (oi_now - oi_prev) / oi_prev
        price_prev = cache.get("raw_price", {}).get(bsym)
        price_chg  = (price / price_prev - 1) if price_prev else 0.0

        # OI threshold: >0.3% change is meaningful
        oi_growing  = oi_chg_pct > 0.003
        oi_shrinking = oi_chg_pct < -0.003
        price_up    = price_chg > 0.001
        price_down  = price_chg < -0.001

        if price_up and oi_growing:
            signal = "TREND_CONFIRM"
            note   = "longs entering — bullish fuel"
        elif price_down and oi_growing:
            signal = "TREND_CONFIRM"
            note   = "shorts entering — bearish fuel"
        elif price_up and oi_shrinking:
            signal = "EXHAUSTION"
            note   = "shorts covering — no new conviction"
        elif price_down and oi_shrinking:
            signal = "CAPITULATION"
            note   = "longs exiting — forced unwind"
        else:
            signal = "NEUTRAL"
            note   = "OI stable"

        # Size multiplier suggestion
        if signal == "TREND_CONFIRM":
            mult = 1.15   # OI confirms — boost slightly
        elif signal == "EXHAUSTION":
            mult = 0.70   # fade environment — reduce
        elif signal == "CAPITULATION":
            mult = 0.50   # extreme caution
        else:
            mult = 1.0

        signals[db_sym] = {
            "signal":        signal,
            "mult":          mult,
            "oi":            round(oi_now, 2),
            "oi_change_pct": round(oi_chg_pct * 100, 3),
            "price":         price,
            "price_change_pct": round(price_chg * 100, 3),
            "note":          note,
        }
        log.info("  %-6s %s (OI %+.3f%%  price %+.3f%%)",
                 db_sym, signal, oi_chg_pct * 100, price_chg * 100)

    report = {
        "ok":       True,
        "ts":       int(time.time()),
        "cached":   False,
        "signals":  signals,
        "raw_oi":   raw_oi,
        "raw_price": {bsym: _fetch_price(bsym) or 0 for bsym in SYMBOLS},
    }
    _save_cache(report)
    return report


def get_oi_mult(symbol: str) -> float:
    """Returns size multiplier for symbol from cached OI signal. 1.0 if unavailable."""
    cache = _load_cache()
    sig = cache.get("signals", {}).get(symbol)
    if not sig:
        return 1.0
    age = time.time() - cache.get("ts", 0)
    if age > CACHE_TTL * 2:   # stale → no adjustment
        return 1.0
    return sig.get("mult", 1.0)


if __name__ == "__main__":
    r = run(force=True)
    print(f"\n{'Symbol':8s} {'Signal':16s} {'OI Chg':>10s} {'Price Chg':>10s} {'Mult':>6s}  Note")
    print("-" * 70)
    for sym, s in r["signals"].items():
        if "oi_change_pct" in s and s["oi_change_pct"] is not None:
            print(f"  {sym:6s}  {s['signal']:14s}  {s['oi_change_pct']:+8.3f}%  "
                  f"{s['price_change_pct']:+8.3f}%  {s['mult']:4.2f}×  {s['note']}")
        else:
            print(f"  {sym:6s}  {s['signal']:14s}  {'N/A':>10s}  {'N/A':>10s}  1.00×")
