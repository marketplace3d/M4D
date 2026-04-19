"""
data_live.py — Real data loader from futures.db

Source: /Volumes/AI/AI-4D/M4D/ds/data/futures.db
  bars_1m  — 8.2M rows: ES, NQ, RTY, CL, 6E, GC, SI + BTC/ETH/SOL/XRP/BNB
  bars_5m  — 4M rows:   BTC ETH SOL XRP BNB ADA ARB ATOM AVAX DOGE DOT
                         FIL INJ LINK LTC OP SUI TIA UNI (+ MATIC ~5m)

Produces Universe-compatible objects for the W4D engine.

API:
  load_daily(symbols, db_path, start, end, bar_table)
    → Universe with daily OHLCV, returns, forward returns, synthetic fundamentals

  load_intraday(symbols, db_path, freq, start, end)
    → IntraUniverse with OHLCV resampled to target frequency

  available_symbols(db_path)
    → {'1m': [...], '5m': [...]}

Universe note:
  The WorldQuant engine needs daily OHLCV. We resample the intraday bars
  to daily, compute returns, synthetic fundamentals (EP/BP/ROE proxies from
  price momentum and volatility), and forward returns.
"""
from __future__ import annotations
import sqlite3
import os
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
from data import Universe, SECTORS

# Default DB path — same machine, siblings in M4D repo
_DEFAULT_DB = os.path.join(
    os.path.dirname(__file__), "..", "..", "ds", "data", "futures.db"
)
_DEFAULT_DB = os.path.normpath(_DEFAULT_DB)


# ── Available symbols ─────────────────────────────────────────────────────

FUTURES_SYMBOLS = ["ES", "NQ", "RTY", "CL", "6E", "GC", "SI"]
CRYPTO_SYMBOLS_1M = ["BTC", "ETH", "SOL", "XRP", "BNB"]
CRYPTO_SYMBOLS_5M = [
    "BNB", "ADA", "ARB", "ATOM", "AVAX", "BTC", "DOGE", "DOT",
    "ETH", "FIL", "INJ", "LINK", "LTC", "OP", "SOL", "SUI",
    "TIA", "UNI", "XRP",
]

ALL_LIVE_SYMBOLS = sorted(set(FUTURES_SYMBOLS + CRYPTO_SYMBOLS_1M + CRYPTO_SYMBOLS_5M))

# Sector mapping for live symbols
_SECTOR_MAP: dict[str, str] = {
    "ES": "Equity", "NQ": "Equity", "RTY": "Equity",
    "CL": "Energy",
    "6E": "FX",
    "GC": "Metals", "SI": "Metals",
    "BTC": "Crypto_Large", "ETH": "Crypto_Large",
    "BNB": "Crypto_Large", "SOL": "Crypto_Large", "XRP": "Crypto_Large",
    "ADA": "Crypto_Mid", "ARB": "Crypto_Mid", "ATOM": "Crypto_Mid",
    "AVAX": "Crypto_Mid", "DOGE": "Crypto_Mid", "DOT": "Crypto_Mid",
    "FIL": "Crypto_Mid", "INJ": "Crypto_Mid", "LINK": "Crypto_Mid",
    "LTC": "Crypto_Mid", "OP": "Crypto_Mid",
    "SUI": "Crypto_Small", "TIA": "Crypto_Small",
    "UNI": "Crypto_Small",
}

LIVE_SECTORS = sorted(set(_SECTOR_MAP.values()))


def available_symbols(db_path: str = _DEFAULT_DB) -> dict:
    con = sqlite3.connect(db_path)
    c1m = [r[0] for r in con.execute("SELECT DISTINCT symbol FROM bars_1m ORDER BY symbol")]
    c5m = [r[0] for r in con.execute("SELECT DISTINCT symbol FROM bars_5m ORDER BY symbol")]
    con.close()
    return {"1m": c1m, "5m": c5m}


# ── Core bar loader ───────────────────────────────────────────────────────

def _load_bars(
    symbols: list[str],
    db_path: str,
    table: str,
    start_ts: Optional[int] = None,
    end_ts: Optional[int] = None,
) -> pd.DataFrame:
    """
    Load raw OHLCV bars from SQLite into a long DataFrame.
    Returns: columns [symbol, ts, open, high, low, close, volume]
    ts is Unix seconds.
    """
    placeholders = ",".join("?" * len(symbols))
    query = f"SELECT symbol, ts, open, high, low, close, volume FROM {table} WHERE symbol IN ({placeholders})"
    params: list = list(symbols)

    if start_ts is not None:
        query += " AND ts >= ?"
        params.append(start_ts)
    if end_ts is not None:
        query += " AND ts <= ?"
        params.append(end_ts)

    query += " ORDER BY symbol, ts"

    con = sqlite3.connect(db_path)
    df = pd.read_sql_query(query, con, params=params)
    con.close()
    df["datetime"] = pd.to_datetime(df["ts"], unit="s", utc=True)
    return df


# ── Resample intraday → daily OHLCV ──────────────────────────────────────

def _to_daily(long_df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """
    Resample intraday long DataFrame to daily OHLCV per symbol.
    Returns {symbol: DataFrame(Date × [open,high,low,close,volume])}
    """
    result = {}
    for sym, grp in long_df.groupby("symbol"):
        grp = grp.set_index("datetime").sort_index()
        daily = grp[["open", "high", "low", "close", "volume"]].resample("1D").agg({
            "open":   "first",
            "high":   "max",
            "low":    "min",
            "close":  "last",
            "volume": "sum",
        }).dropna(subset=["close"])
        daily.index = daily.index.tz_localize(None).normalize()
        result[str(sym)] = daily
    return result


# ── Build common date index ───────────────────────────────────────────────

def _common_dates(daily_dict: dict[str, pd.DataFrame], min_coverage: float = 0.5) -> pd.DatetimeIndex:
    """
    Find business dates where at least min_coverage fraction of symbols have data.
    """
    all_dates = pd.DatetimeIndex(
        sorted(set().union(*[d.index.tolist() for d in daily_dict.values()]))
    )
    counts = pd.Series(0, index=all_dates)
    for d in daily_dict.values():
        counts = counts.add(pd.Series(1, index=d.index.intersection(all_dates)), fill_value=0)

    threshold = min_coverage * len(daily_dict)
    good_dates = counts[counts >= threshold].index
    # Filter to business days only
    return pd.bdate_range(good_dates.min(), good_dates.max()).intersection(good_dates)


# ── Synthetic fundamentals from price data ────────────────────────────────

def _make_fundamentals(
    prices: pd.DataFrame,
    returns: pd.DataFrame,
    dates: pd.DatetimeIndex,
    instruments: list[str],
    seed: int = 42,
) -> pd.DataFrame:
    """
    Derive synthetic-style fundamental factors from price/return history:
      ep (earnings proxy) = inverse of 252d rolling vol (low vol → high 'quality earnings')
      bp (book proxy)     = 63d momentum rank inverse (mean reversion proxy)
      roe                 = 126d Sharpe (rolling)
      earn_surp           = 5d return residual vs market (earnings surprise proxy)
    """
    rng = np.random.default_rng(seed)
    records = []
    mkt_ret = returns.mean(axis=1)

    vol_252 = returns.rolling(252, min_periods=21).std() * np.sqrt(252)
    mom_63  = prices.pct_change(63)
    sharpe_126 = returns.rolling(126, min_periods=21).apply(
        lambda x: x.mean() / x.std() * np.sqrt(252) if x.std() > 1e-8 else 0,
        raw=True,
    )
    # Idiosyncratic 5d return (market-adjusted)
    beta_proxy = returns.rolling(60, min_periods=21).corr(mkt_ret)
    idio = returns - beta_proxy.multiply(mkt_ret, axis=0)
    esurp = idio.rolling(5).sum()

    # Sample every 5 days to keep DB manageable
    sample_dates = dates[::5]

    for t in sample_dates:
        if t not in vol_252.index:
            continue
        for sym in instruments:
            vol = vol_252.loc[t, sym] if sym in vol_252.columns else np.nan
            mom = mom_63.loc[t, sym]  if sym in mom_63.columns  else np.nan
            sr  = sharpe_126.loc[t, sym] if sym in sharpe_126.columns else 0.0
            es  = esurp.loc[t, sym]   if sym in esurp.columns   else 0.0

            ep  = (1 / vol) * 0.05 if (vol and not np.isnan(vol) and vol > 0) else 0.04
            bp  = max(0.1, 1.0 - (mom if not np.isnan(mom) else 0))
            roe = float(sr) if not np.isnan(sr) else 0.10

            records.append({
                "date": t, "instrument": sym,
                "ep": ep, "bp": bp, "roe": roe, "earn_surp": float(es) if not np.isnan(es) else 0.0,
            })

    if not records:
        # Fallback: minimal fundamentals
        for t in dates[::5]:
            for sym in instruments:
                records.append({"date": t, "instrument": sym,
                                "ep": 0.04, "bp": 0.8, "roe": 0.10, "earn_surp": 0.0})

    fund = pd.DataFrame(records).set_index(["date", "instrument"])
    # Forward-fill to every date
    fund_wide = {}
    for col in ["ep", "bp", "roe", "earn_surp"]:
        w = fund[col].unstack("instrument").reindex(dates).ffill().bfill()
        fund_wide[col] = w

    long_records = []
    for t in dates:
        for sym in instruments:
            long_records.append({
                "date": t, "instrument": sym,
                "ep":       float(fund_wide["ep"].loc[t, sym])       if sym in fund_wide["ep"].columns       else 0.04,
                "bp":       float(fund_wide["bp"].loc[t, sym])       if sym in fund_wide["bp"].columns       else 0.80,
                "roe":      float(fund_wide["roe"].loc[t, sym])      if sym in fund_wide["roe"].columns      else 0.10,
                "earn_surp":float(fund_wide["earn_surp"].loc[t, sym])if sym in fund_wide["earn_surp"].columns else 0.0,
            })
    return pd.DataFrame(long_records).set_index(["date", "instrument"])


# ── Main loader: load_daily ───────────────────────────────────────────────

def load_daily(
    symbols: Optional[list[str]] = None,
    db_path: str = _DEFAULT_DB,
    start: Optional[str] = None,       # "YYYY-MM-DD"
    end:   Optional[str] = None,
    bar_table: str = "bars_5m",        # "bars_1m" or "bars_5m"
    min_coverage: float = 0.5,
    seed: int = 42,
) -> Universe:
    """
    Load bars from futures.db, resample to daily, and return a Universe
    compatible with the W4D engine.

    symbols: None → all available in that table
    bar_table: "bars_5m" (more symbols, crypto-heavy) or "bars_1m" (includes ES/NQ/RTY/CL/6E)
    """
    # Resolve symbols
    avail = available_symbols(db_path)
    avail_syms = avail.get(bar_table.replace("bars_", ""), [])
    if symbols is None:
        symbols = avail_syms
    else:
        symbols = [s for s in symbols if s in avail_syms]

    if not symbols:
        raise ValueError(f"No valid symbols found in {bar_table}. Available: {avail_syms}")

    # Unix timestamp bounds
    start_ts = int(pd.Timestamp(start).timestamp()) if start else None
    end_ts   = int(pd.Timestamp(end).timestamp())   if end   else None

    print(f"[data_live] Loading {len(symbols)} symbols from {bar_table} …")
    long_df = _load_bars(symbols, db_path, bar_table, start_ts, end_ts)

    print(f"[data_live] Resampling {len(long_df):,} bars → daily …")
    daily_dict = _to_daily(long_df)

    # Filter to symbols that actually loaded
    symbols = [s for s in symbols if s in daily_dict]
    if not symbols:
        raise ValueError("No daily data after resampling")

    # Common date index
    dates = _common_dates(daily_dict, min_coverage)
    print(f"[data_live] {len(dates)} trading days, {len(symbols)} symbols ({dates[0].date()} → {dates[-1].date()})")

    # Build OHLCV matrices
    def _build_matrix(col: str, fill: float = np.nan) -> pd.DataFrame:
        frames = {sym: daily_dict[sym][col] for sym in symbols if col in daily_dict[sym].columns}
        df = pd.DataFrame(frames, index=dates)
        return df.ffill().fillna(fill)

    prices  = _build_matrix("close")
    highs   = _build_matrix("high")
    lows    = _build_matrix("low")
    volumes = _build_matrix("volume", fill=0)

    # Returns
    returns = prices.pct_change().fillna(0)

    # Forward returns
    fwd1  = returns.shift(-1)
    fwd5  = returns.rolling(5).sum().shift(-5)
    fwd21 = returns.rolling(21).sum().shift(-21)

    # Sectors
    sectors = pd.Series(
        {sym: _SECTOR_MAP.get(sym, "Other") for sym in symbols},
        name="sector",
    )

    # Market features for regime classifier
    rv20  = returns.std(axis=1).rolling(20).mean() * np.sqrt(252)
    vov   = rv20.rolling(60).std().fillna(0.02)
    mkt_r = returns.mean(axis=1)
    mom60 = mkt_r.rolling(60).sum().fillna(0)
    bond_n= pd.Series(np.random.default_rng(seed).standard_normal(len(dates)) * 0.01, index=dates)
    corr  = bond_n.rolling(60).mean().fillna(0)
    cred  = pd.Series(np.random.default_rng(seed + 1).standard_normal(len(dates)) * 0.2, index=dates)

    mkt_feat = pd.DataFrame({
        "realised_vol_20d":  rv20.fillna(0.15),
        "vol_of_vol_60d":    vov,
        "momentum_60d":      mom60,
        "cross_asset_corr":  corr,
        "credit_spread_chg": cred,
    }, index=dates)

    # Fundamentals
    print("[data_live] Building fundamentals …")
    fundamentals = _make_fundamentals(prices, returns, dates, symbols, seed)

    return Universe(
        prices       = prices,
        highs        = highs,
        lows         = lows,
        volumes      = volumes,
        returns      = returns,
        fwd_ret_1d   = fwd1,
        fwd_ret_5d   = fwd5,
        fwd_ret_21d  = fwd21,
        fundamentals = fundamentals,
        sectors      = sectors,
        market_features = mkt_feat,
        dates        = dates,
        instruments  = list(symbols),
    )


# ── Intraday loader (returns raw resampled OHLCV, not Universe) ───────────

@dataclass
class IntraBar:
    symbol: str
    datetime: pd.DatetimeIndex
    open:   np.ndarray
    high:   np.ndarray
    low:    np.ndarray
    close:  np.ndarray
    volume: np.ndarray

    def to_df(self) -> pd.DataFrame:
        return pd.DataFrame({
            "open": self.open, "high": self.high,
            "low": self.low, "close": self.close, "volume": self.volume,
        }, index=self.datetime)


def load_intraday(
    symbols: list[str],
    db_path: str = _DEFAULT_DB,
    freq: str = "5min",       # "1min", "5min", "15min", "1H", "4H"
    start: Optional[str] = None,
    end:   Optional[str] = None,
    table: str = "bars_5m",
) -> dict[str, IntraBar]:
    """
    Load intraday bars and resample to target frequency.
    Returns {symbol: IntraBar}.
    """
    avail = available_symbols(db_path)
    avail_table = avail.get(table.replace("bars_", ""), [])
    symbols = [s for s in symbols if s in avail_table]

    start_ts = int(pd.Timestamp(start).timestamp()) if start else None
    end_ts   = int(pd.Timestamp(end).timestamp())   if end   else None

    long_df = _load_bars(symbols, db_path, table, start_ts, end_ts)
    result = {}
    for sym, grp in long_df.groupby("symbol"):
        grp = grp.set_index("datetime").sort_index()
        ohlcv = grp[["open", "high", "low", "close", "volume"]].resample(freq).agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum",
        }).dropna(subset=["close"])
        result[str(sym)] = IntraBar(
            symbol=str(sym),
            datetime=ohlcv.index,
            open=ohlcv["open"].values,
            high=ohlcv["high"].values,
            low=ohlcv["low"].values,
            close=ohlcv["close"].values,
            volume=ohlcv["volume"].values,
        )
    return result


# ── Quick test / info ─────────────────────────────────────────────────────

def db_info(db_path: str = _DEFAULT_DB) -> dict:
    """Summary of what's in futures.db."""
    con = sqlite3.connect(db_path)
    info = {}
    for table in ["bars_1m", "bars_5m"]:
        rows = con.execute(
            f"SELECT symbol, COUNT(*) as n, "
            f"MIN(datetime(ts,'unixepoch')) as start, "
            f"MAX(datetime(ts,'unixepoch')) as end "
            f"FROM {table} GROUP BY symbol ORDER BY symbol"
        ).fetchall()
        info[table] = [{"symbol": r[0], "bars": r[1], "start": r[2], "end": r[3]} for r in rows]
    con.close()
    return info


if __name__ == "__main__":
    import json
    print("=== futures.db contents ===")
    info = db_info()
    for tbl, rows in info.items():
        print(f"\n{tbl}:")
        for r in rows:
            print(f"  {r['symbol']:<6} {r['bars']:>8,} bars  {r['start']} → {r['end']}")

    print("\n=== Loading daily universe (5m bars, all crypto) ===")
    univ = load_daily(
        symbols=CRYPTO_SYMBOLS_5M[:10],
        bar_table="bars_5m",
    )
    print(f"  Shape: {univ.prices.shape}  ({len(univ.dates)} days × {len(univ.instruments)} symbols)")
    print(f"  Sectors: {univ.sectors.value_counts().to_dict()}")
    print(f"  Date range: {univ.dates[0].date()} → {univ.dates[-1].date()}")
