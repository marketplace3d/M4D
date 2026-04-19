"""
ds_app/liquidations.py — Binance Liquidation Stream

Source: wss://fstream.binance.com/ws/!forceOrder@arr  (all USDT perp symbols)
Run:   python ds_app/liquidations.py daemon            (long-running process)

Signal logic:
  Binance forceOrder side field:
    BUY  = short position was liquidated → shorts squeezed → bullish pressure
    SELL = long position was liquidated  → longs stopped   → bearish pressure

Pressure window: last 30 minutes per symbol (sliding, configurable)

get_liq_pressure(symbol):
  SHORT_LIQ_DOMINANT  (bullish_ratio > 0.65) → 1.15× — shorts squeezed, buy pressure
  LONG_LIQ_DOMINANT   (bullish_ratio < 0.35) → 0.85× — longs liquidated, fragile
  CLIMAX              (total_usd > CLIMAX_USD) → 0.65× — chaos, reduce size
  NEUTRAL             → 1.0×

Endpoints: GET /v1/liq/   POST /v1/liq/refresh/
"""
from __future__ import annotations

import json
import logging
import sqlite3
import sys
import time
from pathlib import Path

log = logging.getLogger("liquidations")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
DB_PATH  = _DS_ROOT / "data" / "liquidations.db"

WINDOW_SEC  = 1800     # 30-min rolling window
CLIMAX_USD  = 5_000_000  # $5M total liq in window = climax
MIN_USD     = 10_000   # ignore tiny liquidations < $10k


def _init_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS liquidations (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            ts       INTEGER NOT NULL,
            symbol   TEXT    NOT NULL,
            side     TEXT    NOT NULL,  -- BUY=short_liq, SELL=long_liq
            qty      REAL    NOT NULL,
            price    REAL    NOT NULL,
            usd      REAL    NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_liq_ts_sym ON liquidations(ts, symbol)")
    conn.commit()
    return conn


def _insert(conn: sqlite3.Connection, ts: int, symbol: str, side: str,
            qty: float, price: float, usd: float) -> None:
    if usd < MIN_USD:
        return
    conn.execute(
        "INSERT INTO liquidations (ts,symbol,side,qty,price,usd) VALUES (?,?,?,?,?,?)",
        (ts, symbol, side, qty, price, usd),
    )
    conn.commit()


def _prune(conn: sqlite3.Connection) -> None:
    cutoff = int(time.time()) - WINDOW_SEC * 4
    conn.execute("DELETE FROM liquidations WHERE ts < ?", (cutoff,))
    conn.commit()


def get_liq_pressure(
    symbol: str,
    window_sec: int = WINDOW_SEC,
) -> dict:
    """Returns liq pressure signal for one symbol. 1.0 mult if no data."""
    if not DB_PATH.exists():
        return {"symbol": symbol, "signal": "NO_DATA", "mult": 1.0}
    try:
        conn = sqlite3.connect(str(DB_PATH))
        since = int(time.time()) - window_sec
        rows = conn.execute(
            "SELECT side, usd FROM liquidations WHERE symbol=? AND ts>=?",
            (symbol.upper().replace("/", ""), since),
        ).fetchall()
        conn.close()
    except Exception:
        return {"symbol": symbol, "signal": "ERROR", "mult": 1.0}

    if not rows:
        return {"symbol": symbol, "signal": "QUIET", "mult": 1.0}

    buy_usd  = sum(r[1] for r in rows if r[0] == "BUY")   # short liquidations
    sell_usd = sum(r[1] for r in rows if r[0] == "SELL")  # long liquidations
    total_usd = buy_usd + sell_usd

    if total_usd < 50_000:  # too little to matter
        return {"symbol": symbol, "signal": "QUIET", "mult": 1.0,
                "buy_usd": buy_usd, "sell_usd": sell_usd}

    # Climax: both sides getting wiped → chaos
    if total_usd >= CLIMAX_USD:
        return {"symbol": symbol, "signal": "CLIMAX", "mult": 0.65,
                "buy_usd": buy_usd, "sell_usd": sell_usd, "total_usd": total_usd}

    bullish_ratio = buy_usd / total_usd if total_usd > 0 else 0.5

    if bullish_ratio >= 0.65:
        signal, mult = "SHORT_LIQ_DOMINANT", 1.15
    elif bullish_ratio <= 0.35:
        signal, mult = "LONG_LIQ_DOMINANT", 0.85
    else:
        signal, mult = "NEUTRAL", 1.0

    return {
        "symbol":       symbol,
        "signal":       signal,
        "mult":         mult,
        "bullish_ratio": round(bullish_ratio, 3),
        "buy_usd":      round(buy_usd, 0),
        "sell_usd":     round(sell_usd, 0),
        "total_usd":    round(total_usd, 0),
        "window_min":   window_sec // 60,
    }


def get_liq_mult(symbol: str) -> float:
    return get_liq_pressure(symbol).get("mult", 1.0)


def liq_summary(top_n: int = 20) -> dict:
    """Return recent liquidation summary across all symbols."""
    if not DB_PATH.exists():
        return {"ok": False, "error": "no DB"}
    try:
        conn = sqlite3.connect(str(DB_PATH))
        since = int(time.time()) - WINDOW_SEC
        rows = conn.execute(
            """SELECT symbol, side, SUM(usd), COUNT(*) FROM liquidations
               WHERE ts>=? GROUP BY symbol, side ORDER BY SUM(usd) DESC""",
            (since,),
        ).fetchall()
        total_count = conn.execute(
            "SELECT COUNT(*) FROM liquidations WHERE ts>=?", (since,)
        ).fetchone()[0]
        conn.close()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    by_sym: dict[str, dict] = {}
    for sym, side, usd_sum, cnt in rows:
        if sym not in by_sym:
            by_sym[sym] = {"symbol": sym, "buy_usd": 0.0, "sell_usd": 0.0, "count": 0}
        if side == "BUY":
            by_sym[sym]["buy_usd"] = round(usd_sum, 0)
        else:
            by_sym[sym]["sell_usd"] = round(usd_sum, 0)
        by_sym[sym]["count"] += cnt

    for sym_data in by_sym.values():
        total = sym_data["buy_usd"] + sym_data["sell_usd"]
        sym_data["total_usd"] = round(total, 0)
        sym_data["bullish_ratio"] = round(sym_data["buy_usd"] / total, 3) if total else 0.5

    top = sorted(by_sym.values(), key=lambda x: x["total_usd"], reverse=True)[:top_n]

    return {
        "ok":          True,
        "ts":          int(time.time()),
        "window_min":  WINDOW_SEC // 60,
        "total_events": total_count,
        "top_symbols": top,
    }


# ── WebSocket daemon ──────────────────────────────────────────────────────────

def _run_daemon() -> None:
    try:
        import websocket
    except ImportError:
        print("pip install websocket-client")
        sys.exit(1)

    conn = _init_db()
    WS_URL = "wss://fstream.binance.com/ws/!forceOrder@arr"
    prune_counter = 0

    def on_message(ws, msg):
        nonlocal prune_counter
        try:
            outer = json.loads(msg)
            ev = outer.get("o", outer)  # forceOrder wraps in {"e":..., "o": {...}}
            if not ev:
                return
            symbol   = ev.get("s", "")
            side     = ev.get("S", "")     # BUY or SELL
            qty      = float(ev.get("q", 0))
            price    = float(ev.get("ap", ev.get("p", 0)))  # avg price or price
            ts       = int(ev.get("T", time.time() * 1000)) // 1000
            usd      = qty * price
            if symbol and side and usd > 0:
                _insert(conn, ts, symbol, side, qty, price, usd)
                if usd > 500_000:
                    log.warning("LARGE LIQ %s %s $%.0f", symbol, side, usd)
            prune_counter += 1
            if prune_counter >= 500:
                _prune(conn)
                prune_counter = 0
        except Exception as exc:
            log.debug("parse error: %s", exc)

    def on_error(ws, err):
        log.error("WS error: %s", err)

    def on_close(ws, code, msg):
        log.warning("WS closed %s — reconnecting in 5s", code)

    def on_open(ws):
        log.info("Liquidation stream connected")

    while True:
        try:
            ws = websocket.WebSocketApp(
                WS_URL,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
                on_open=on_open,
            )
            ws.run_forever(ping_interval=30, ping_timeout=10)
        except Exception as exc:
            log.error("daemon crash: %s — restart in 10s", exc)
        time.sleep(10)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if len(sys.argv) > 1 and sys.argv[1] == "daemon":
        log.info("Starting liquidation daemon → %s", DB_PATH)
        _run_daemon()
    else:
        report = liq_summary()
        print(json.dumps(report, indent=2))
        if len(sys.argv) > 1:
            sym = sys.argv[1].upper()
            p = get_liq_pressure(sym)
            print(f"\n{sym}: {p['signal']}  mult={p.get('mult', 1.0):.2f}")
