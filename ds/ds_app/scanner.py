"""
scanner.py — Trade-Ideas style real-time scanner
Crypto: Binance public API (no auth)
Stocks: Alpaca paper/live API

Alert types:
  SURGE      rel_vol > 2.5 in last bar
  BREAKOUT   close > 20-bar high + vol confirm
  GAPPER     open gap > 1% vs prior close
  MOMENTUM   3 consecutive closes same direction + vol
  REVERSAL   RSI extreme (< 25 or > 75) + vol spike
  FUNDING    crypto only — extreme funding rate
"""
from __future__ import annotations

import os
import time
import pathlib
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from typing import Literal

import requests

logger = logging.getLogger(__name__)

# ── env ───────────────────────────────────────────────────────────────────────
def _load_env():
    env = pathlib.Path(__file__).parent.parent.parent / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                if k.strip() and v.strip() and k.strip() not in os.environ:
                    os.environ[k.strip()] = v.strip()

_load_env()

ALPACA_KEY    = os.environ.get("ALPACA_API_KEY", "")
ALPACA_SECRET = os.environ.get("ALPACA_SECRET_KEY", "")
ALPACA_URL    = os.environ.get("ALPACA_BASE_URL", "https://paper-api.alpaca.markets/v2")

# ── thresholds ────────────────────────────────────────────────────────────────
SURGE_VOL_MULT   = 2.5
BREAKOUT_BARS    = 20
GAP_PCT          = 0.01
MOMENTUM_BARS    = 3
RSI_OB           = 72
RSI_OS           = 28
MAX_WORKERS      = 12
TOP_N            = 50   # top N crypto symbols to scan

# ── data class ────────────────────────────────────────────────────────────────
@dataclass
class ScanAlert:
    symbol:     str
    market:     Literal["crypto", "stock"]
    alert_type: str          # SURGE | BREAKOUT | GAPPER | MOMENTUM | REVERSAL | FUNDING
    direction:  Literal["LONG", "SHORT", "NEUTRAL"]
    price:      float
    change_pct: float        # % change this bar
    rel_vol:    float        # volume / avg volume
    score:      float        # composite 0–1
    detail:     str = ""     # human readable reason
    ts:         int  = field(default_factory=lambda: int(time.time()))


# ══════════════════════════════════════════════════════════════════════════════
# CRYPTO — Binance
# ══════════════════════════════════════════════════════════════════════════════

BINANCE_REST = "https://api.binance.com"

def _binance_top_symbols(n: int = TOP_N) -> list[str]:
    """Top N USDT pairs by 24h quoteVolume."""
    try:
        r = requests.get(f"{BINANCE_REST}/api/v3/ticker/24hr", timeout=10)
        tickers = r.json()
        usdt = [t for t in tickers if t["symbol"].endswith("USDT")]
        usdt.sort(key=lambda x: float(x.get("quoteVolume", 0)), reverse=True)
        return [t["symbol"] for t in usdt[:n]]
    except Exception as e:
        logger.warning("binance top symbols: %s", e)
        return []

def _binance_klines(symbol: str, interval: str = "5m", limit: int = 30) -> list[dict]:
    try:
        r = requests.get(
            f"{BINANCE_REST}/api/v3/klines",
            params={"symbol": symbol, "interval": interval, "limit": limit},
            timeout=8,
        )
        rows = r.json()
        if not isinstance(rows, list):
            return []
        return [
            {
                "open":   float(row[1]),
                "high":   float(row[2]),
                "low":    float(row[3]),
                "close":  float(row[4]),
                "volume": float(row[5]),
            }
            for row in rows
        ]
    except Exception:
        return []

def _rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, period + 1):
        d = closes[-period + i] - closes[-period + i - 1]
        (gains if d > 0 else losses).append(abs(d))
    avg_gain = sum(gains) / period if gains else 0
    avg_loss = sum(losses) / period if losses else 1e-9
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def _scan_crypto_symbol(symbol: str) -> list[ScanAlert]:
    bars = _binance_klines(symbol, "5m", 30)
    if len(bars) < 22:
        return []

    closes  = [b["close"]  for b in bars]
    volumes = [b["volume"] for b in bars]
    cur     = bars[-1]
    prev    = bars[-2]

    vol_avg = sum(volumes[:-1]) / max(len(volumes) - 1, 1)
    rel_vol = cur["volume"] / max(vol_avg, 1e-9)
    chg     = (cur["close"] - prev["close"]) / max(prev["close"], 1e-9)
    rsi     = _rsi(closes)
    high20  = max(b["high"] for b in bars[-21:-1])
    low20   = min(b["low"]  for b in bars[-21:-1])

    alerts: list[ScanAlert] = []

    # SURGE
    if rel_vol >= SURGE_VOL_MULT:
        direction = "LONG" if chg > 0 else "SHORT"
        score = min(1.0, rel_vol / 5.0) * 0.6 + min(1.0, abs(chg) * 20) * 0.4
        alerts.append(ScanAlert(
            symbol=symbol, market="crypto", alert_type="SURGE",
            direction=direction, price=cur["close"], change_pct=round(chg * 100, 3),
            rel_vol=round(rel_vol, 2), score=round(score, 3),
            detail=f"vol {rel_vol:.1f}× avg",
        ))

    # BREAKOUT
    if cur["close"] > high20 and rel_vol > 1.4:
        score = min(1.0, rel_vol / 3.0) * 0.5 + min(1.0, (cur["close"] - high20) / high20 * 50) * 0.5
        alerts.append(ScanAlert(
            symbol=symbol, market="crypto", alert_type="BREAKOUT",
            direction="LONG", price=cur["close"], change_pct=round(chg * 100, 3),
            rel_vol=round(rel_vol, 2), score=round(score, 3),
            detail=f"above {BREAKOUT_BARS}-bar high {high20:.4f}",
        ))
    elif cur["close"] < low20 and rel_vol > 1.4:
        score = min(1.0, rel_vol / 3.0) * 0.5 + min(1.0, (low20 - cur["close"]) / low20 * 50) * 0.5
        alerts.append(ScanAlert(
            symbol=symbol, market="crypto", alert_type="BREAKOUT",
            direction="SHORT", price=cur["close"], change_pct=round(chg * 100, 3),
            rel_vol=round(rel_vol, 2), score=round(score, 3),
            detail=f"below {BREAKOUT_BARS}-bar low {low20:.4f}",
        ))

    # MOMENTUM — 3 consecutive same-direction closes + vol
    if len(closes) >= 4:
        last3 = [closes[-3] < closes[-2] < closes[-1],
                 closes[-3] > closes[-2] > closes[-1]]
        if last3[0] and rel_vol > 1.2:
            alerts.append(ScanAlert(
                symbol=symbol, market="crypto", alert_type="MOMENTUM",
                direction="LONG", price=cur["close"], change_pct=round(chg * 100, 3),
                rel_vol=round(rel_vol, 2), score=round(min(1, rel_vol / 3) * 0.7 + 0.3, 3),
                detail="3 consecutive up closes",
            ))
        elif last3[1] and rel_vol > 1.2:
            alerts.append(ScanAlert(
                symbol=symbol, market="crypto", alert_type="MOMENTUM",
                direction="SHORT", price=cur["close"], change_pct=round(chg * 100, 3),
                rel_vol=round(rel_vol, 2), score=round(min(1, rel_vol / 3) * 0.7 + 0.3, 3),
                detail="3 consecutive down closes",
            ))

    # REVERSAL
    if rsi <= RSI_OS and rel_vol > 1.5:
        alerts.append(ScanAlert(
            symbol=symbol, market="crypto", alert_type="REVERSAL",
            direction="LONG", price=cur["close"], change_pct=round(chg * 100, 3),
            rel_vol=round(rel_vol, 2), score=round((RSI_OS - rsi) / RSI_OS * 0.6 + min(1, rel_vol / 4) * 0.4, 3),
            detail=f"RSI oversold {rsi:.1f}",
        ))
    elif rsi >= RSI_OB and rel_vol > 1.5:
        alerts.append(ScanAlert(
            symbol=symbol, market="crypto", alert_type="REVERSAL",
            direction="SHORT", price=cur["close"], change_pct=round(chg * 100, 3),
            rel_vol=round(rel_vol, 2), score=round((rsi - RSI_OB) / (100 - RSI_OB) * 0.6 + min(1, rel_vol / 4) * 0.4, 3),
            detail=f"RSI overbought {rsi:.1f}",
        ))

    return alerts


def run_crypto_scan(symbols: list[str] | None = None) -> list[dict]:
    if symbols is None:
        symbols = _binance_top_symbols(TOP_N)
    alerts: list[ScanAlert] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(_scan_crypto_symbol, s): s for s in symbols}
        for f in as_completed(futures):
            try:
                alerts.extend(f.result())
            except Exception as e:
                logger.debug("scan error %s: %s", futures[f], e)
    alerts.sort(key=lambda a: a.score, reverse=True)
    return [asdict(a) for a in alerts]


# ══════════════════════════════════════════════════════════════════════════════
# STOCKS — Alpaca
# ══════════════════════════════════════════════════════════════════════════════

ALPACA_DATA = "https://data.alpaca.markets/v2"

_ALPACA_HEADERS = {
    "APCA-API-KEY-ID":     ALPACA_KEY,
    "APCA-API-SECRET-KEY": ALPACA_SECRET,
}

# Watchlist for stock scanner — expand as needed
STOCK_WATCHLIST = [
    "SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "TSLA", "META",
    "GOOGL", "AMZN", "AMD", "NFLX", "PLTR", "COIN", "HOOD",
    "MSTR", "SMCI", "ARM", "MARA", "RIOT",
]

def _alpaca_bars(symbols: list[str], timeframe: str = "5Min", limit: int = 30) -> dict[str, list[dict]]:
    """Fetch bars for multiple symbols in one request."""
    if not ALPACA_KEY:
        return {}
    try:
        r = requests.get(
            f"{ALPACA_DATA}/stocks/bars",
            headers=_ALPACA_HEADERS,
            params={
                "symbols":   ",".join(symbols),
                "timeframe": timeframe,
                "limit":     limit,
                "feed":      "iex",
            },
            timeout=12,
        )
        if r.status_code == 401:
            logger.warning("Alpaca key rejected — paper key may not have market data")
            return {}
        data = r.json()
        result = {}
        for sym, bars in data.get("bars", {}).items():
            result[sym] = [
                {"open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"], "volume": b["v"]}
                for b in bars
            ]
        return result
    except Exception as e:
        logger.warning("alpaca bars: %s", e)
        return {}

def _alpaca_snapshots(symbols: list[str]) -> dict[str, dict]:
    """Latest quote + daily bar for gap detection."""
    if not ALPACA_KEY:
        return {}
    try:
        r = requests.get(
            f"{ALPACA_DATA}/stocks/snapshots",
            headers=_ALPACA_HEADERS,
            params={"symbols": ",".join(symbols), "feed": "iex"},
            timeout=10,
        )
        return r.json() if r.status_code == 200 else {}
    except Exception:
        return {}

def _scan_stock_symbol(symbol: str, bars: list[dict], snap: dict | None) -> list[ScanAlert]:
    if len(bars) < 5:
        return []

    closes  = [b["close"]  for b in bars]
    volumes = [b["volume"] for b in bars]
    cur     = bars[-1]
    prev    = bars[-2]

    vol_avg = sum(volumes[:-1]) / max(len(volumes) - 1, 1)
    rel_vol = cur["volume"] / max(vol_avg, 1e-9)
    chg     = (cur["close"] - prev["close"]) / max(prev["close"], 1e-9)
    rsi     = _rsi(closes)
    high_n  = max(b["high"] for b in bars[:-1])
    low_n   = min(b["low"]  for b in bars[:-1])

    alerts: list[ScanAlert] = []

    # GAPPER — compare today's open to prev day close
    if snap:
        try:
            prev_close = snap.get("prevDailyBar", {}).get("c", 0)
            today_open = snap.get("dailyBar", {}).get("o", 0)
            if prev_close and today_open:
                gap = (today_open - prev_close) / prev_close
                if abs(gap) >= GAP_PCT:
                    alerts.append(ScanAlert(
                        symbol=symbol, market="stock", alert_type="GAPPER",
                        direction="LONG" if gap > 0 else "SHORT",
                        price=cur["close"], change_pct=round(gap * 100, 3),
                        rel_vol=round(rel_vol, 2),
                        score=round(min(1, abs(gap) * 20) * 0.7 + min(1, rel_vol / 3) * 0.3, 3),
                        detail=f"gap {gap*100:+.2f}% open vs prev close",
                    ))
        except Exception:
            pass

    # SURGE
    if rel_vol >= SURGE_VOL_MULT:
        direction = "LONG" if chg > 0 else "SHORT"
        score = min(1.0, rel_vol / 5.0) * 0.6 + min(1.0, abs(chg) * 20) * 0.4
        alerts.append(ScanAlert(
            symbol=symbol, market="stock", alert_type="SURGE",
            direction=direction, price=cur["close"], change_pct=round(chg * 100, 3),
            rel_vol=round(rel_vol, 2), score=round(score, 3),
            detail=f"vol {rel_vol:.1f}× avg",
        ))

    # BREAKOUT
    if cur["close"] > high_n and rel_vol > 1.3:
        alerts.append(ScanAlert(
            symbol=symbol, market="stock", alert_type="BREAKOUT",
            direction="LONG", price=cur["close"], change_pct=round(chg * 100, 3),
            rel_vol=round(rel_vol, 2), score=round(min(1, rel_vol / 3) * 0.6 + 0.4, 3),
            detail=f"new {len(bars)}-bar high",
        ))

    # REVERSAL
    if rsi <= RSI_OS and rel_vol > 1.4:
        alerts.append(ScanAlert(
            symbol=symbol, market="stock", alert_type="REVERSAL",
            direction="LONG", price=cur["close"], change_pct=round(chg * 100, 3),
            rel_vol=round(rel_vol, 2), score=round((RSI_OS - rsi) / RSI_OS * 0.7 + 0.3, 3),
            detail=f"RSI {rsi:.1f} oversold",
        ))
    elif rsi >= RSI_OB and rel_vol > 1.4:
        alerts.append(ScanAlert(
            symbol=symbol, market="stock", alert_type="REVERSAL",
            direction="SHORT", price=cur["close"], change_pct=round(chg * 100, 3),
            rel_vol=round(rel_vol, 2), score=round((rsi - RSI_OB) / (100 - RSI_OB) * 0.7 + 0.3, 3),
            detail=f"RSI {rsi:.1f} overbought",
        ))

    return alerts


def run_stock_scan(symbols: list[str] | None = None) -> list[dict]:
    if not ALPACA_KEY:
        return []
    syms = symbols or STOCK_WATCHLIST
    all_bars  = _alpaca_bars(syms)
    all_snaps = _alpaca_snapshots(syms)
    alerts: list[ScanAlert] = []
    for sym in syms:
        bars = all_bars.get(sym, [])
        snap = all_snaps.get(sym)
        try:
            alerts.extend(_scan_stock_symbol(sym, bars, snap))
        except Exception as e:
            logger.debug("stock scan %s: %s", sym, e)
    alerts.sort(key=lambda a: a.score, reverse=True)
    return [asdict(a) for a in alerts]


# ══════════════════════════════════════════════════════════════════════════════
# COMBINED
# ══════════════════════════════════════════════════════════════════════════════

def run_full_scan(crypto: bool = True, stocks: bool = False) -> dict:
    t0 = time.time()
    results: list[dict] = []
    if crypto:
        results.extend(run_crypto_scan())
    if stocks:
        results.extend(run_stock_scan())
    results.sort(key=lambda a: a["score"], reverse=True)

    by_type: dict[str, list] = {}
    for a in results:
        by_type.setdefault(a["alert_type"], []).append(a)

    return {
        "alerts":   results[:100],
        "by_type":  by_type,
        "counts": {k: len(v) for k, v in by_type.items()},
        "total":    len(results),
        "elapsed_ms": round((time.time() - t0) * 1000),
        "ts":       int(time.time()),
    }
