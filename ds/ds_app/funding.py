"""
Funding Rate Scanner — crypto perp funding arb (small account edge, 4/4 models agree).
Counterparty: retail longs paying to hold leverage.

Pulls live funding rates from Binance + Bybit via ccxt.
Returns per-asset: rate, annualized %, direction, cross-exchange spread.
"""
from __future__ import annotations
import time, logging, concurrent.futures
from typing import Optional

log = logging.getLogger("funding")

EXCHANGES = ["binance", "bybit"]
RATE_THRESHOLD = 0.0001   # 0.01% per 8h = entry threshold
ANNUALIZE = 3 * 365       # 3 funding periods/day × 365

TOP_N = 50  # top assets by funding magnitude to return

def _fetch_exchange_funding(exchange_id: str) -> dict[str, float]:
    """Returns {symbol: funding_rate} for one exchange."""
    try:
        import ccxt
        ex = getattr(ccxt, exchange_id)({"enableRateLimit": True})
        markets = ex.load_markets()
        swap_symbols = [s for s, m in markets.items()
                        if m.get("swap") and m.get("quote") == "USDT" and m.get("active")]
        if not swap_symbols:
            return {}

        # Binance: fetch_funding_rates bulk; Bybit: same
        try:
            rates = ex.fetch_funding_rates(swap_symbols[:200])
        except Exception:
            # Fallback: individual fetches (slow)
            rates = {}
            for sym in swap_symbols[:50]:
                try:
                    r = ex.fetch_funding_rate(sym)
                    rates[sym] = r
                except Exception:
                    pass

        result = {}
        for sym, data in rates.items():
            if isinstance(data, dict):
                rate = data.get("fundingRate") or data.get("funding_rate")
            else:
                rate = None
            if rate is not None:
                # Normalise symbol → BASE (strip /USDT:USDT etc)
                base = sym.split("/")[0].split(":")[0]
                result[base + "USDT"] = float(rate)

        return result
    except Exception as e:
        log.warning(f"[funding] {exchange_id} failed: {e}")
        return {}

def run_funding_scan() -> dict:
    """Parallel fetch from all exchanges, compute cross-exchange spread."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        futures = {ex.submit(_fetch_exchange_funding, exid): exid for exid in EXCHANGES}
        by_exchange: dict[str, dict] = {}
        for f in concurrent.futures.as_completed(futures):
            exid = futures[f]
            by_exchange[exid] = f.result()

    # Merge: per-symbol entry
    all_symbols = set()
    for rates in by_exchange.values():
        all_symbols.update(rates.keys())

    rows = []
    for sym in all_symbols:
        rates = {ex: by_exchange[ex].get(sym) for ex in EXCHANGES}
        valid = {ex: r for ex, r in rates.items() if r is not None}
        if not valid:
            continue

        avg_rate = sum(valid.values()) / len(valid)
        annualized = avg_rate * ANNUALIZE * 100  # %

        # Cross-exchange spread
        spread = None
        if len(valid) == 2:
            vals = list(valid.values())
            spread = round((vals[0] - vals[1]) * ANNUALIZE * 100, 2)

        rows.append({
            "symbol":       sym,
            "avg_rate":     round(avg_rate, 6),
            "annualized_pct": round(annualized, 2),
            "direction":    "LONG_SPOT_SHORT_PERP" if avg_rate > 0 else "SHORT_SPOT_LONG_PERP",
            "signal":       abs(avg_rate) >= RATE_THRESHOLD,
            "strong":       abs(avg_rate) >= RATE_THRESHOLD * 3,
            "cross_spread_pct": spread,
            "by_exchange":  {ex: round(r, 6) for ex, r in valid.items()},
        })

    rows.sort(key=lambda x: abs(x["avg_rate"]), reverse=True)
    signals = [r for r in rows if r["signal"]]

    return {
        "rows":            rows[:TOP_N],
        "signals":         signals[:20],
        "active_signals":  len(signals),
        "threshold_pct":   round(RATE_THRESHOLD * ANNUALIZE * 100, 2),
        "ts":              int(time.time()),
    }
