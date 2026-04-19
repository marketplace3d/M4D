"""
equity_bars.py — Bar loader for equities + CME futures.

Reads from:
  equities.db  bars_5m  → US stocks + ETFs + forex (yfinance, 60d rolling)
  equities.db  bars_1d  → US stocks + ETFs daily (yfinance, 5yr)
  futures.db   bars_1m  → CME futures (Databento, aggregated to 5m)

Refresh 5m equity bars (run weekly):
  python -m ds_app.equity_bars --refresh
"""
from __future__ import annotations

import pathlib
import sqlite3
from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd

_DS_ROOT    = pathlib.Path(__file__).resolve().parent.parent
EQUITIES_DB = _DS_ROOT / "data" / "equities.db"
FUTURES_DB  = _DS_ROOT / "data" / "futures.db"

# Universe for daily auto-refresh
EQUITY_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "V",
    "AMD", "SMCI", "ARM", "PLTR", "MSTR", "COIN", "SOFI", "RBLX",
    "SPY", "QQQ", "IWM", "GLD", "TLT", "XLK", "XLE", "ARKK",
    "EURUSD", "GBP",
]

CME_SYMBOLS = {"ES", "NQ", "GC", "CL", "RTY", "ZN", "ZB", "SI"}


def load_equity_bars(symbol: str, n: int = 500, interval: str = "5m") -> pd.DataFrame | None:
    """
    Load n bars for an equity symbol from equities.db.
    interval: '5m' (intraday, last 60d) or '1d' (daily, 5yr)
    Returns DataFrame with columns: ts, Open, High, Low, Close, Volume
    """
    table = "bars_5m" if interval == "5m" else "bars_1d"
    if not EQUITIES_DB.exists():
        return None
    try:
        conn = sqlite3.connect(EQUITIES_DB)
        df = pd.read_sql_query(
            f"SELECT ts, open, high, low, close, volume FROM {table} "
            f"WHERE symbol=? ORDER BY ts DESC LIMIT {n}",
            conn, params=(symbol.upper(),),
        )
        conn.close()
    except Exception:
        return None

    if len(df) < 50:
        return None
    df = df.iloc[::-1].reset_index(drop=True)
    df.columns = ["ts", "Open", "High", "Low", "Close", "Volume"]
    return df


def load_futures_bars(symbol: str, n: int = 500) -> pd.DataFrame | None:
    """
    Load n 5m-equivalent bars for a CME futures symbol.
    Aggregates 1m bars from futures.db into 5m OHLCV.
    """
    if not FUTURES_DB.exists():
        return None
    try:
        conn = sqlite3.connect(FUTURES_DB)
        # Pull 5× more 1m bars to aggregate to n 5m bars
        raw = pd.read_sql_query(
            "SELECT ts, open, high, low, close, volume FROM bars_1m "
            "WHERE symbol=? ORDER BY ts DESC LIMIT ?",
            conn, params=(symbol.upper(), n * 5),
        )
        conn.close()
    except Exception:
        return None

    if len(raw) < 50:
        return None

    raw = raw.iloc[::-1].reset_index(drop=True)
    raw["dt"] = pd.to_datetime(raw["ts"], unit="s", utc=True)
    raw = raw.set_index("dt")
    agg = raw.resample("5min").agg({
        "open":   "first",
        "high":   "max",
        "low":    "min",
        "close":  "last",
        "volume": "sum",
        "ts":     "first",
    }).dropna(subset=["open"])
    agg = agg.tail(n).reset_index(drop=True)
    agg.columns = ["Open", "High", "Low", "Close", "Volume", "ts"]
    return agg[["ts", "Open", "High", "Low", "Close", "Volume"]]


def load_bars_auto(symbol: str, n: int = 500) -> pd.DataFrame | None:
    """
    Auto-dispatch: CME futures → futures.db, stocks/ETFs/forex → equities.db.
    """
    sym = symbol.upper()
    if sym in CME_SYMBOLS:
        return load_futures_bars(sym, n)
    return load_equity_bars(sym, n, interval="5m")


def is_market_open(symbol: str) -> bool:
    """
    Returns True if trading is allowed for this symbol right now.
    - US equities: NYSE hours only (14:30–21:00 UTC, Mon–Fri)
    - CME futures: nearly 24hr but skip 21:00–22:00 UTC (daily settlement)
    - Forex (EURUSD, GBP): always open Mon–Fri
    """
    now = datetime.now(tz=timezone.utc)
    weekday = now.weekday()  # 0=Mon, 6=Sun
    hour = now.hour
    minute = now.minute
    sym = symbol.upper()

    if weekday >= 5:  # weekend
        return False

    if sym in CME_SYMBOLS:
        # Block daily CME settlement window
        return not (hour == 21 and minute < 30)

    if sym in ("EURUSD", "GBP", "JPYUSD"):
        return True  # forex = 24/5

    # US equity: 09:30–16:00 ET = 14:30–21:00 UTC (standard time offset)
    minutes_utc = hour * 60 + minute
    return 870 <= minutes_utc < 1260  # 14:30–21:00


def refresh_equity_bars(symbols: list[str] | None = None, verbose: bool = True) -> dict:
    """
    Refresh 5m bars for equity universe via yfinance.
    Pulls last 60d (yfinance limit for 5m).
    """
    import yfinance as yf

    syms = symbols or EQUITY_UNIVERSE
    yf_map = {s: (s + "=X" if s in ("EURUSD", "GBP") else s) for s in syms}

    conn = sqlite3.connect(EQUITIES_DB)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS bars_5m (
            symbol TEXT NOT NULL, ts INTEGER NOT NULL,
            open REAL, high REAL, low REAL, close REAL, volume INTEGER,
            PRIMARY KEY (symbol, ts));
        CREATE INDEX IF NOT EXISTS idx5 ON bars_5m(symbol, ts);
        CREATE TABLE IF NOT EXISTS bars_1d (
            symbol TEXT NOT NULL, ts INTEGER NOT NULL,
            open REAL, high REAL, low REAL, close REAL, volume INTEGER,
            PRIMARY KEY (symbol, ts));
        CREATE INDEX IF NOT EXISTS idx1d ON bars_1d(symbol, ts);
    """)
    conn.commit()

    results = {}
    for sym, yf_sym in yf_map.items():
        counts = {"5m": 0, "1d": 0}
        for interval, period, table in [("5m", "60d", "bars_5m"), ("1d", "5y", "bars_1d")]:
            try:
                df = yf.download(yf_sym, period=period, interval=interval,
                                 progress=False, auto_adjust=True)
                if df.empty:
                    continue
                df.columns = [c[0].lower() if isinstance(c, tuple) else c.lower()
                              for c in df.columns]
                rows = [
                    (sym, int(ts.timestamp()), float(r["open"]), float(r["high"]),
                     float(r["low"]), float(r["close"]), int(r.get("volume", 0) or 0))
                    for ts, r in df.iterrows()
                ]
                conn.executemany(f"INSERT OR REPLACE INTO {table} VALUES (?,?,?,?,?,?,?)", rows)
                conn.commit()
                counts[interval] = len(rows)
            except Exception as e:
                if verbose:
                    print(f"  {sym} {interval}: ERROR {e}")
        results[sym] = counts
        if verbose:
            print(f"  {sym:12} 5m={counts['5m']:,}  1d={counts['1d']:,}")

    conn.close()
    return results


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--refresh", action="store_true")
    p.add_argument("--sym",  default=None)
    p.add_argument("--info", action="store_true")
    args = p.parse_args()

    if args.refresh:
        syms = [args.sym.upper()] if args.sym else None
        print("Refreshing equity bars...")
        refresh_equity_bars(syms)
        print("Done")

    if args.info:
        for db, tables in [(EQUITIES_DB, ["bars_5m", "bars_1d"]), (FUTURES_DB, ["bars_1m"])]:
            if not db.exists():
                continue
            conn = sqlite3.connect(db)
            for tbl in tables:
                try:
                    rows = conn.execute(
                        f"SELECT symbol, COUNT(*), MIN(ts), MAX(ts) FROM {tbl} GROUP BY symbol"
                    ).fetchall()
                    print(f"\n{db.name} / {tbl}:")
                    for sym, cnt, first, last in rows:
                        f = datetime.fromtimestamp(first, tz=timezone.utc).strftime("%Y-%m-%d")
                        l = datetime.fromtimestamp(last,  tz=timezone.utc).strftime("%Y-%m-%d")
                        print(f"  {sym:12} {cnt:>8,} bars  {f} → {l}")
                except Exception:
                    pass
            conn.close()
