"""
ds_app/fear_greed.py — Crypto Fear & Greed Index

Source: api.alternative.me/fng/ (free, no auth, daily update)
Value: 0–100   0=Extreme Fear, 100=Extreme Greed
Classification: Extreme Fear / Fear / Neutral / Greed / Extreme Greed

Usage as contrarian filter:
  Extreme Fear  (0-24)  → BUY bias — crowd is max pessimistic, edge is long
  Fear          (25-44) → slight long bias
  Neutral       (45-55) → no adjustment
  Greed         (56-74) → slight short/reduce bias
  Extreme Greed (75-100) → FADE — reduce size / no new longs

Size multiplier:
  Extreme Fear  → 1.25× (contrarian boost)
  Fear          → 1.10×
  Neutral       → 1.00×
  Greed         → 0.85×
  Extreme Greed → 0.65×

Cache: 4-hour TTL (value updates once per day)
Endpoint: GET /v1/fng/   POST /v1/fng/refresh/
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import requests

log = logging.getLogger("fear_greed")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
CACHE_PATH = _DS_ROOT / "data" / "fear_greed.json"
CACHE_TTL  = 14400   # 4 hours
API_URL    = "https://api.alternative.me/fng/?limit=3"


def _classify(value: int) -> tuple[str, float]:
    """Returns (label, size_multiplier)."""
    if value <= 24:  return "EXTREME_FEAR",  1.25
    if value <= 44:  return "FEAR",           1.10
    if value <= 55:  return "NEUTRAL",        1.00
    if value <= 74:  return "GREED",          0.85
    return               "EXTREME_GREED",   0.65


def run(force: bool = False) -> dict:
    if CACHE_PATH.exists():
        cache = json.loads(CACHE_PATH.read_text())
        if not force and time.time() - cache.get("ts", 0) < CACHE_TTL:
            cache["cached"] = True
            return cache

    try:
        r = requests.get(API_URL, timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        log.warning("Fear&Greed fetch failed: %s", exc)
        cache = json.loads(CACHE_PATH.read_text()) if CACHE_PATH.exists() else {}
        cache["error"] = str(exc)
        return cache

    entries = data.get("data", [])
    if not entries:
        return {"ok": False, "error": "Empty response"}

    today    = entries[0]
    value    = int(today["value"])
    label, mult = _classify(value)

    history = []
    for e in entries:
        v = int(e["value"])
        l, _ = _classify(v)
        history.append({"ts": int(e["timestamp"]), "value": v, "label": l,
                        "date": e.get("value_classification", l)})

    # Trend: is fear rising or falling?
    trend = "STABLE"
    if len(history) >= 2:
        delta = history[0]["value"] - history[1]["value"]
        if delta > 5:   trend = "GREED_BUILDING"
        elif delta < -5: trend = "FEAR_BUILDING"

    report = {
        "ok":         True,
        "ts":         int(time.time()),
        "cached":     False,
        "value":      value,
        "label":      label,
        "mult":       mult,
        "trend":      trend,
        "history":    history,
        "source":     "api.alternative.me/fng/",
    }
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(report, indent=2))
    log.info("Fear&Greed: %d (%s) mult=%.2f× trend=%s", value, label, mult, trend)
    return report


def get_fng_mult() -> float:
    """Returns size multiplier from cached F&G. 1.0 if stale/unavailable."""
    if not CACHE_PATH.exists():
        return 1.0
    try:
        cache = json.loads(CACHE_PATH.read_text())
        if time.time() - cache.get("ts", 0) > CACHE_TTL * 3:
            return 1.0
        return cache.get("mult", 1.0)
    except Exception:
        return 1.0


def load_latest() -> dict | None:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text())
    return None


if __name__ == "__main__":
    r = run(force=True)
    print(f"Fear & Greed: {r['value']} — {r['label']}")
    print(f"Multiplier:   {r['mult']}×")
    print(f"Trend:        {r['trend']}")
    hist_str = [f"{h['value']} ({h['label']})" for h in r['history']]
    print(f"History:      {hist_str}")
