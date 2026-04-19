"""
ds_app/funding_signal.py — Funding Rate Signal (P2-A)

Converts live Binance perpetual funding rates into a trading signal.

SIGNAL LOGIC:
  VERY_NEGATIVE funding (< -0.03%/8h):  LONG signal — shorts are overloaded,
    funding reset is imminent, longs receive funding, market likely squeezed up.
  VERY_POSITIVE funding (> +0.05%/8h):  SHORT signal — longs are paying too much,
    over-leveraged market, correction risk.
  NEUTRAL zone: no signal.

EDGE:
  Funding rate extremes predict mean-reversion in 1-4h.
  This is ANTI-TREND (unlike most ensemble signals).
  Regime routing: RANGING / RISK-OFF (NOT TRENDING — funding signals fade in
  strong trends where funding stays extreme for days).

WEIGHT RECOMMENDATION:
  SOFT_REGIME_MULT["FUNDING"] = {RANGING: 1.5, RISK-OFF: 1.5, TRENDING: 0.2, BREAKOUT: 0.3}

OUTPUT:
  vote (+1/-1/0) + annualized funding rate + funding pressure score (0-1)

LIVE use: call get_funding_signal(symbol) every 8h (funding epoch).
  Cached in ds/data/funding_signals.json (refresh 5min before funding reset).
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import numpy as np

log = logging.getLogger("funding_signal")

_DS_ROOT   = Path(__file__).resolve().parent.parent
CACHE_PATH = _DS_ROOT / "data" / "funding_signals.json"
CACHE_TTL  = 60 * 60 * 4   # 4h cache (funding updates every 8h)

# Thresholds in per-8h fraction
LONG_THRESHOLD  = -0.0003   # < -0.03%/8h → shorts overloaded → LONG
SHORT_THRESHOLD =  0.0005   # > +0.05%/8h → longs overloaded → SHORT
ANNUALIZE_8H    = 3 * 365   # 3 fundings/day × 365

# Symbol map: futures.db short form → Binance perp symbol
PERP_MAP: dict[str, str] = {
    "BTC":   "BTC/USDT:USDT",
    "ETH":   "ETH/USDT:USDT",
    "SOL":   "SOL/USDT:USDT",
    "BNB":   "BNB/USDT:USDT",
    "ADA":   "ADA/USDT:USDT",
    "AVAX":  "AVAX/USDT:USDT",
    "DOGE":  "DOGE/USDT:USDT",
    "LINK":  "LINK/USDT:USDT",
    "MATIC": "MATIC/USDT:USDT",
    "UNI":   "UNI/USDT:USDT",
}


def _fetch_all_rates() -> dict[str, float]:
    """Pull live funding rates from Binance. Returns {short_sym: rate_per_8h}."""
    try:
        import ccxt
        ex = ccxt.binance({"enableRateLimit": True, "options": {"defaultType": "future"}})
        perp_syms = list(PERP_MAP.values())
        rates_raw = ex.fetch_funding_rates(perp_syms)
        result: dict[str, float] = {}
        for short_sym, perp_sym in PERP_MAP.items():
            data = rates_raw.get(perp_sym, {})
            rate = data.get("fundingRate")
            if rate is not None:
                result[short_sym] = float(rate)
        return result
    except Exception as exc:
        log.error("fetch_funding_rates: %s", exc)
        return {}


def _load_cache() -> dict:
    if not CACHE_PATH.exists():
        return {}
    try:
        data = json.loads(CACHE_PATH.read_text())
        if time.time() - data.get("ts", 0) < CACHE_TTL:
            return data
    except Exception:
        pass
    return {}


def _save_cache(data: dict):
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(data, indent=2))


def refresh_funding() -> dict:
    """Fetch live funding rates and cache. Returns full cache dict."""
    rates = _fetch_all_rates()
    signals: dict[str, dict] = {}
    for sym, rate in rates.items():
        annual = rate * ANNUALIZE_8H
        if rate < LONG_THRESHOLD:
            vote = 1
            label = "LONG_FUNDING"
        elif rate > SHORT_THRESHOLD:
            vote = -1
            label = "SHORT_FUNDING"
        else:
            vote = 0
            label = "NEUTRAL"
        # Pressure score: 0–1, how extreme the funding is
        pressure = min(abs(rate) / max(abs(SHORT_THRESHOLD), abs(LONG_THRESHOLD)) * 2, 1.0)
        signals[sym] = {
            "vote":         vote,
            "label":        label,
            "rate_8h":      round(rate, 6),
            "rate_annual":  round(annual * 100, 2),
            "pressure":     round(pressure, 3),
        }
        if vote != 0:
            log.info("  %s: funding=%+.4f%% → %s", sym, rate*100, label)

    data = {"ts": time.time(), "signals": signals}
    _save_cache(data)
    return data


def get_funding_signal(symbol: str) -> dict:
    """
    Returns funding signal dict for one symbol.
    Uses cache if fresh, otherwise fetches live.
    {vote, label, rate_8h, rate_annual, pressure}
    """
    cache = _load_cache()
    if cache and symbol in cache.get("signals", {}):
        return cache["signals"][symbol]
    # Cache miss or stale
    data = refresh_funding()
    return data.get("signals", {}).get(symbol, {
        "vote": 0, "label": "UNKNOWN", "rate_8h": 0.0, "rate_annual": 0.0, "pressure": 0.0,
    })


def get_all_signals() -> dict[str, dict]:
    """Returns all cached funding signals, refreshing if stale."""
    cache = _load_cache()
    if cache:
        return cache.get("signals", {})
    return refresh_funding().get("signals", {})


if __name__ == "__main__":
    print("Fetching funding rates...")
    data = refresh_funding()
    sigs = data.get("signals", {})
    for sym, s in sorted(sigs.items(), key=lambda x: abs(x[1]["rate_8h"]), reverse=True):
        bar = "█" * int(s["pressure"] * 10)
        print(f"  {sym:6s} {s['vote']:+d}  {s['rate_annual']:+6.2f}%/yr  {bar:10s}  {s['label']}")
