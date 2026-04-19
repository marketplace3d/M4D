"""
databento_fetch.py — Pull CME futures history from Databento GLBX.MDP3
Symbols: ES, NQ, GC, CL, RTY (continuous front-month)
Stores to ds/data/futures.db SQLite — schema matches our scanner/backtest engines.

Usage:
  python -m ds_app.databento_fetch            # fetch all, last 2yr
  python -m ds_app.databento_fetch --years 5  # 5yr history
  python -m ds_app.databento_fetch --sym ES   # single symbol
  python -m ds_app.databento_fetch --cost     # estimate cost only, no download
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sqlite3
import time
from datetime import date, timedelta

DB_PATH = pathlib.Path(__file__).parent.parent / "data" / "futures.db"
DB_PATH.parent.mkdir(exist_ok=True)

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
DATABENTO_KEY = os.environ.get("DATABENTO_API_KEY", "")

SYMBOLS = {
    "ES":  "ES.c.0",    # S&P 500 E-mini
    "NQ":  "NQ.c.0",    # Nasdaq 100 E-mini
    "GC":  "GC.c.0",    # Gold
    "CL":  "CL.c.0",    # Crude Oil WTI
    "RTY": "RTY.c.0",   # Russell 2000
    "SI":  "SI.c.0",    # Silver
    "ZB":  "ZB.c.0",    # 30yr T-Bond
    "ZN":  "ZN.c.0",    # 10yr T-Note
}

SCHEMA   = "ohlcv-1m"   # 1-minute bars
DATASET  = "GLBX.MDP3"
STYPE    = "continuous"

# ── DB setup ──────────────────────────────────────────────────────────────────
def _init_db(conn: sqlite3.Connection):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bars_1m (
            symbol   TEXT NOT NULL,
            ts       INTEGER NOT NULL,   -- unix seconds UTC
            open     REAL NOT NULL,
            high     REAL NOT NULL,
            low      REAL NOT NULL,
            close    REAL NOT NULL,
            volume   INTEGER NOT NULL,
            PRIMARY KEY (symbol, ts)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_bars_sym_ts ON bars_1m(symbol, ts)")
    conn.commit()


def _upsert_bars(conn: sqlite3.Connection, symbol: str, rows: list[tuple]):
    conn.executemany(
        "INSERT OR REPLACE INTO bars_1m (symbol,ts,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?)",
        rows,
    )
    conn.commit()


# ── Fetch ─────────────────────────────────────────────────────────────────────
def fetch_symbol(
    sym_short: str,
    start: str,
    end: str,
    dry_run: bool = False,
) -> int:
    import databento as db

    sym_cont = SYMBOLS.get(sym_short.upper())
    if not sym_cont:
        print(f"  Unknown symbol: {sym_short}. Available: {list(SYMBOLS.keys())}")
        return 0

    client = db.Historical(DATABENTO_KEY)

    # Cost estimate first
    cost = client.metadata.get_cost(
        dataset=DATASET, symbols=[sym_cont], schema=SCHEMA,
        start=start, end=end, stype_in=STYPE,
    )
    print(f"  {sym_short:4} ({sym_cont})  {start} → {end}  est. cost: ${cost:.4f}")

    if dry_run:
        return 0

    t0 = time.time()
    data = client.timeseries.get_range(
        dataset=DATASET, symbols=[sym_cont], schema=SCHEMA,
        start=start, end=end, stype_in=STYPE,
    )

    df = data.to_df()
    if df.empty:
        print(f"  {sym_short}: no data returned")
        return 0

    # Databento OHLCV columns: open, high, low, close, volume; index = ts_event (ns)
    import pandas as pd
    rows = []
    for ts_val, row in df.iterrows():
        # ts_val is a pandas Timestamp (nanosecond precision)
        if isinstance(ts_val, pd.Timestamp):
            ts_sec = int(ts_val.timestamp())
        else:
            ts_sec = int(ts_val) // 1_000_000_000

        # Databento OHLCV prices: check if fixed-point (>1e6) or already float
        def _price(v):
            f = float(v)
            return f / 1e9 if f > 1_000_000 else f

        rows.append((
            sym_short,
            ts_sec,
            _price(row["open"]),
            _price(row["high"]),
            _price(row["low"]),
            _price(row["close"]),
            int(row["volume"]),
        ))

    conn = sqlite3.connect(DB_PATH)
    _init_db(conn)
    _upsert_bars(conn, sym_short, rows)
    conn.close()

    elapsed = time.time() - t0
    print(f"  {sym_short}: {len(rows):,} bars stored  ({elapsed:.1f}s)")
    return len(rows)


def fetch_all(
    symbols: list[str] | None = None,
    years: int = 2,
    dry_run: bool = False,
) -> dict:
    syms  = [s.upper() for s in symbols] if symbols else list(SYMBOLS.keys())[:5]
    end   = str(date.today() - timedelta(days=1))
    start = str(date.today() - timedelta(days=365 * years))

    print(f"\nDatabento fetch — {DATASET} — {start} → {end}")
    print(f"Symbols: {syms}  |  {'DRY RUN (cost only)' if dry_run else 'DOWNLOADING'}\n")

    total_bars = 0
    for sym in syms:
        try:
            n = fetch_symbol(sym, start, end, dry_run=dry_run)
            total_bars += n
        except Exception as e:
            print(f"  {sym}: ERROR — {e}")

    if not dry_run and total_bars:
        print(f"\n✓ {total_bars:,} bars total → {DB_PATH}")
    return {"bars": total_bars, "symbols": syms, "start": start, "end": end}


# ── Stats ─────────────────────────────────────────────────────────────────────
def db_stats() -> dict:
    if not DB_PATH.exists():
        return {"status": "no db"}
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("""
        SELECT symbol, COUNT(*) as bars,
               MIN(ts) as first, MAX(ts) as last
        FROM bars_1m GROUP BY symbol ORDER BY symbol
    """).fetchall()
    conn.close()
    result = {}
    for sym, cnt, first, last in rows:
        from datetime import datetime, timezone
        result[sym] = {
            "bars":  cnt,
            "from":  datetime.fromtimestamp(first, tz=timezone.utc).strftime("%Y-%m-%d"),
            "to":    datetime.fromtimestamp(last,  tz=timezone.utc).strftime("%Y-%m-%d"),
        }
    return result


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sym",   nargs="*", help="symbols to fetch (default: ES NQ GC CL RTY)")
    parser.add_argument("--years", type=int, default=2, help="years of history (default: 2)")
    parser.add_argument("--cost",  action="store_true", help="estimate cost only, no download")
    parser.add_argument("--stats", action="store_true", help="show DB stats")
    args = parser.parse_args()

    if not DATABENTO_KEY:
        print("ERROR: DATABENTO_API_KEY not set in .env.local")
        exit(1)

    if args.stats:
        stats = db_stats()
        if not stats:
            print("No data yet.")
        for sym, info in stats.items():
            print(f"  {sym:4}  {info['bars']:>8,} bars  {info['from']} → {info['to']}")
    else:
        fetch_all(symbols=args.sym, years=args.years, dry_run=args.cost)
