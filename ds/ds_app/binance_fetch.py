"""
binance_fetch.py — Pull crypto OHLCV history from Binance public API (no auth)
Stores to ds/data/futures.db — same schema as Databento futures bars.

Tables:
  bars_1m  — 1-minute bars (BTC, ETH, SOL, BNB, XRP)
  bars_5m  — 5-minute bars (top 20 symbols)

Usage:
  python -m ds_app.binance_fetch            # fetch all defaults
  python -m ds_app.binance_fetch --sym BTC  # single symbol, both timeframes
  python -m ds_app.binance_fetch --tf 5m    # 5m only
  python -m ds_app.binance_fetch --years 2  # history depth
  python -m ds_app.binance_fetch --stats    # show DB counts
"""
from __future__ import annotations

import argparse
import sqlite3
import time
import pathlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

import requests

DB_PATH = pathlib.Path(__file__).parent.parent / "data" / "futures.db"
BINANCE  = "https://api.binance.com/api/v3/klines"

# Top symbols — USDT pairs stored without suffix (BTC not BTCUSDT)
SYMBOLS_1M = ["BTC", "ETH", "SOL", "BNB", "XRP"]
SYMBOLS_5M = [
    "BTC", "ETH", "SOL", "BNB", "XRP",
    "ADA", "AVAX", "DOGE", "DOT", "LINK",
    "MATIC", "LTC", "UNI", "ATOM", "FIL",
    "ARB", "OP", "INJ", "TIA", "SUI",
]

BAR_LIMIT = 1000   # Binance max per call
RATE_DELAY = 0.12  # ~8 req/s — well under 1200/min limit


# ── DB helpers ────────────────────────────────────────────────────────────────
def _init_db(conn: sqlite3.Connection):
    for tf in ("1m", "5m"):
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS bars_{tf} (
                symbol  TEXT NOT NULL,
                ts      INTEGER NOT NULL,
                open    REAL NOT NULL,
                high    REAL NOT NULL,
                low     REAL NOT NULL,
                close   REAL NOT NULL,
                volume  REAL NOT NULL,
                PRIMARY KEY (symbol, ts)
            )
        """)
        conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{tf}_sym_ts ON bars_{tf}(symbol, ts)")
    conn.commit()


def _upsert(conn: sqlite3.Connection, table: str, rows: list[tuple]):
    conn.executemany(
        f"INSERT OR REPLACE INTO {table} (symbol,ts,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?)",
        rows,
    )
    conn.commit()


def _latest_ts(conn: sqlite3.Connection, table: str, symbol: str) -> int | None:
    row = conn.execute(
        f"SELECT MAX(ts) FROM {table} WHERE symbol=?", (symbol,)
    ).fetchone()
    return row[0] if row and row[0] else None


# ── Binance fetch (paginated) ─────────────────────────────────────────────────
def _fetch_klines(symbol_usdt: str, interval: str, start_ms: int, end_ms: int) -> list[tuple]:
    """Fetch all bars in [start_ms, end_ms] via paginated Binance klines."""
    rows = []
    cur = start_ms
    while cur < end_ms:
        try:
            r = requests.get(BINANCE, params={
                "symbol":    symbol_usdt,
                "interval":  interval,
                "startTime": cur,
                "endTime":   end_ms,
                "limit":     BAR_LIMIT,
            }, timeout=15)
            if r.status_code == 429:
                time.sleep(10)
                continue
            data = r.json()
            if not data or not isinstance(data, list):
                break
            for bar in data:
                rows.append((
                    int(bar[0]) // 1000,   # open_time ms → seconds
                    float(bar[1]),         # open
                    float(bar[2]),         # high
                    float(bar[3]),         # low
                    float(bar[4]),         # close
                    float(bar[5]),         # volume
                ))
            last_ts_ms = data[-1][0]
            if len(data) < BAR_LIMIT:
                break
            cur = last_ts_ms + 1
            time.sleep(RATE_DELAY)
        except Exception as e:
            print(f"    retry {symbol_usdt}: {e}")
            time.sleep(2)
    return rows


def fetch_symbol(
    sym: str,
    interval: str,
    years: int = 2,
    incremental: bool = True,
) -> int:
    symbol_usdt = sym.upper() + "USDT"
    table       = f"bars_{interval}"

    conn = sqlite3.connect(DB_PATH)
    _init_db(conn)

    end_ms   = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = int((datetime.now(timezone.utc) - timedelta(days=365 * years)).timestamp() * 1000)

    if incremental:
        latest = _latest_ts(conn, table, sym.upper())
        if latest:
            # resume from last stored bar + 1 interval
            interval_ms = {"1m": 60_000, "5m": 300_000}.get(interval, 60_000)
            start_ms = (latest * 1000) + interval_ms

    raw = _fetch_klines(symbol_usdt, interval, start_ms, end_ms)
    if not raw:
        conn.close()
        return 0

    rows = [(sym.upper(), ts, o, h, l, c, v) for ts, o, h, l, c, v in raw]
    _upsert(conn, table, rows)
    conn.close()
    return len(rows)


# ── Batch fetch ───────────────────────────────────────────────────────────────
def fetch_all(
    symbols_1m: list[str] | None = None,
    symbols_5m: list[str] | None = None,
    years: int = 2,
    workers: int = 4,
) -> dict:
    s1m = [s.upper() for s in (symbols_1m or SYMBOLS_1M)]
    s5m = [s.upper() for s in (symbols_5m or SYMBOLS_5M)]

    conn = sqlite3.connect(DB_PATH)
    _init_db(conn)
    conn.close()

    total = 0
    jobs  = [(s, "1m") for s in s1m] + [(s, "5m") for s in s5m]

    print(f"\nBinance fetch — {years}yr history")
    print(f"1m symbols ({len(s1m)}): {s1m}")
    print(f"5m symbols ({len(s5m)}): {s5m}\n")

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fetch_symbol, sym, tf, years): (sym, tf) for sym, tf in jobs}
        for f in as_completed(futs):
            sym, tf = futs[f]
            try:
                n = f.result()
                total += n
                print(f"  {sym:6} {tf}  +{n:>9,} bars")
            except Exception as e:
                print(f"  {sym:6} {tf}  ERROR: {e}")

    print(f"\n✓ {total:,} crypto bars → {DB_PATH}")
    return {"bars": total}


# ── Stats ─────────────────────────────────────────────────────────────────────
def db_stats() -> None:
    if not DB_PATH.exists():
        print("No DB yet.")
        return
    conn = sqlite3.connect(DB_PATH)
    for tf in ("1m", "5m"):
        try:
            rows = conn.execute(f"""
                SELECT symbol, COUNT(*) as n, MIN(ts), MAX(ts)
                FROM bars_{tf} GROUP BY symbol ORDER BY symbol
            """).fetchall()
            if rows:
                print(f"\nbars_{tf}:")
                for sym, cnt, first, last in rows:
                    f = datetime.fromtimestamp(first, tz=timezone.utc).strftime("%Y-%m-%d")
                    l = datetime.fromtimestamp(last,  tz=timezone.utc).strftime("%Y-%m-%d")
                    print(f"  {sym:6}  {cnt:>9,} bars  {f} → {l}")
        except Exception:
            pass
    conn.close()


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sym",   nargs="*", help="symbols (default: all)")
    parser.add_argument("--tf",    choices=["1m","5m","both"], default="both")
    parser.add_argument("--years", type=int, default=2)
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()

    if args.stats:
        db_stats()
    else:
        syms = args.sym
        s1m = syms if args.tf in ("1m","both") else []
        s5m = syms if args.tf in ("5m","both") else []
        fetch_all(symbols_1m=s1m or None, symbols_5m=s5m or None, years=args.years)
        print()
        db_stats()
