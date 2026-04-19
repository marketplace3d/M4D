"""
ds_app/obi_signal.py — Order Book Imbalance Signal (P2-B)

Fetches Binance L2 orderbook snapshot (20 levels) and computes OBI ratio.
OBI = (bid_volume - ask_volume) / (bid_volume + ask_volume)

SIGNAL LOGIC:
  OBI > +0.35 (bid-heavy): LONG signal — buyers dominating, likely squeeze up
  OBI < -0.35 (ask-heavy): SHORT signal — sellers dominating
  Neutral zone: no signal

WEIGHTED OBI:
  Levels closer to mid weighted higher (price-proximity weighting).
  Avoids contamination from large walls far from market price.

REGIME ROUTING:
  Works in ALL regimes — OBI is a real-time microstructure signal.
  SOFT_REGIME_MULT["OBI"] = {TRENDING: 0.8, RANGING: 1.2, BREAKOUT: 1.5, RISK-OFF: 1.2}
  Boost in BREAKOUT — order book clears (imbalance resolves fast = price move).

EDGE:
  DOM imbalance at 20-level depth predicts 1-5m price direction.
  Used as pre-trade filter: only enter if OBI aligns with signal direction.
  NOT a standalone signal — requires JEDI conviction ≥ 4 to be actionable.

LIVE:
  Cached 30s (Binance public API, no auth).
  On order entry: check OBI alignment. If opposite → delay 1 bar (HALO integration).
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import requests

log = logging.getLogger("obi_signal")

_DS_ROOT   = Path(__file__).resolve().parent.parent
CACHE_PATH = _DS_ROOT / "data" / "obi_signals.json"
CACHE_TTL  = 30   # seconds

BINANCE_L2 = "https://api.binance.com/api/v3/depth"
DEPTH      = 20

OBI_LONG_THR  =  0.35
OBI_SHORT_THR = -0.35

# futures.db symbol → Binance spot symbol (for orderbook)
SPOT_MAP: dict[str, str] = {
    "BTC":   "BTCUSDT",
    "ETH":   "ETHUSDT",
    "SOL":   "SOLUSDT",
    "BNB":   "BNBUSDT",
    "ADA":   "ADAUSDT",
    "AVAX":  "AVAXUSDT",
    "DOGE":  "DOGEUSDT",
    "LINK":  "LINKUSDT",
    "MATIC": "MATICUSDT",
    "UNI":   "UNIUSDT",
}

_cache: dict[str, dict] = {}
_cache_ts: float = 0.0


def _fetch_l2(binance_sym: str) -> dict | None:
    try:
        r = requests.get(BINANCE_L2, params={"symbol": binance_sym, "limit": DEPTH}, timeout=5)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        log.error("L2 fetch %s: %s", binance_sym, exc)
        return None


def _compute_obi(bids: list, asks: list) -> float:
    """Weighted OBI: levels closer to mid weighted by inverse distance rank."""
    n = min(len(bids), len(asks), DEPTH)
    bid_vol = ask_vol = 0.0
    for i in range(n):
        w = (n - i) / n   # closest level = weight 1.0, furthest = 1/n
        bid_vol += float(bids[i][1]) * w
        ask_vol += float(asks[i][1]) * w
    total = bid_vol + ask_vol
    if total == 0:
        return 0.0
    return round((bid_vol - ask_vol) / total, 4)


def get_obi(symbol: str) -> dict:
    """Returns OBI signal dict for one symbol (cached 30s)."""
    global _cache, _cache_ts
    now = time.time()

    if now - _cache_ts < CACHE_TTL and symbol in _cache:
        return _cache[symbol]

    binance_sym = SPOT_MAP.get(symbol)
    if not binance_sym:
        return {"vote": 0, "obi": 0.0, "label": "NO_MAP", "symbol": symbol}

    data = _fetch_l2(binance_sym)
    if data is None:
        return {"vote": 0, "obi": 0.0, "label": "ERROR", "symbol": symbol}

    obi = _compute_obi(data.get("bids", []), data.get("asks", []))
    if obi > OBI_LONG_THR:
        vote, label = 1, "BID_HEAVY"
    elif obi < OBI_SHORT_THR:
        vote, label = -1, "ASK_HEAVY"
    else:
        vote, label = 0, "BALANCED"

    result = {"vote": vote, "obi": obi, "label": label, "symbol": symbol}
    _cache[symbol] = result
    _cache_ts = now
    return result


def get_all_obi(symbols: list[str] | None = None) -> dict[str, dict]:
    """Batch OBI for multiple symbols."""
    if symbols is None:
        symbols = list(SPOT_MAP.keys())
    return {sym: get_obi(sym) for sym in symbols}


def obi_aligns(obi_vote: int, entry_side: str) -> bool:
    """Returns True if OBI supports the intended entry direction."""
    direction = 1 if entry_side == "buy" else -1
    return obi_vote == 0 or obi_vote == direction


if __name__ == "__main__":
    print("Live OBI scan:")
    syms = list(SPOT_MAP.keys())[:5]
    for sym in syms:
        s = get_obi(sym)
        bar = "█" * int(abs(s["obi"]) * 20)
        sign = "BID" if s["obi"] > 0 else "ASK"
        print(f"  {sym:6s}  OBI={s['obi']:+.3f}  {bar:20s}  {s['label']}")
