"""
ds_app/data_fetch.py — Market data fetching.

Strategy:
  1. Try yfinance (works for stocks, ETFs, and many crypto via BTC-USD style tickers).
  2. Fall back to ccxt Binance for crypto symbols when yfinance returns empty data.

Returns a DataFrame with capitalised OHLCV columns required by backtesting.py:
    Open, High, Low, Close, Volume  (index = DatetimeIndex)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

import pandas as pd

logger = logging.getLogger(__name__)

# Crypto symbols that map to Binance USDT pairs when ccxt fallback is needed.
_CRYPTO_SYMBOLS = {
    "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX", "DOT",
    "MATIC", "LINK", "UNI", "LTC", "ATOM", "XLM", "NEAR", "ICP", "FIL",
    "APT", "ARB", "OP", "INJ", "SUI", "TIA", "PYTH", "JUP", "WIF",
}

# Interval normalisation for yfinance (accepts 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo)
_YF_INTERVAL_MAP = {
    "1min": "1m",
    "5min": "5m",
    "15min": "15m",
    "30min": "30m",
    "1h": "1h",
    "60m": "1h",
    "4h": "1h",   # yfinance has no 4h; fall back to 1h
    "1d": "1d",
    "1day": "1d",
    "daily": "1d",
    "d": "1d",
    "1w": "1wk",
    "1wk": "1wk",
}

# Binance CCXT interval strings
_CCXT_INTERVAL_MAP = {
    "1m": "1m",
    "1min": "1m",
    "5m": "5m",
    "5min": "5m",
    "15m": "15m",
    "15min": "15m",
    "30m": "30m",
    "30min": "30m",
    "1h": "1h",
    "60m": "1h",
    "4h": "4h",
    "1d": "1d",
    "1day": "1d",
    "daily": "1d",
    "d": "1d",
    "1w": "1w",
    "1wk": "1w",
}

_REQUIRED_COLS = {"Open", "High", "Low", "Close", "Volume"}


def _normalise_yf_interval(interval: str) -> str:
    return _YF_INTERVAL_MAP.get(interval.lower(), interval.lower())


def _normalise_ccxt_interval(interval: str) -> str:
    return _CCXT_INTERVAL_MAP.get(interval.lower(), interval.lower())


def _clean_df(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure capitalised OHLCV columns, drop NaN rows, sort by time."""
    # yfinance sometimes returns MultiIndex columns
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    rename = {}
    for col in df.columns:
        cap = col.capitalize() if col.lower() in ("open", "high", "low", "close", "volume", "adj close") else col
        rename[col] = cap
    df = df.rename(columns=rename)

    # Use 'Adj Close' as 'Close' when present (better for equities)
    if "Adj Close" in df.columns and "Close" in df.columns:
        df["Close"] = df["Adj Close"]

    missing = _REQUIRED_COLS - set(df.columns)
    if missing:
        raise ValueError(f"DataFrame missing columns: {missing}")

    df = df[list(_REQUIRED_COLS)].copy()
    df = df.dropna()
    df = df.sort_index()

    # Ensure float dtypes
    for col in _REQUIRED_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna()
    return df


def _fetch_yfinance(symbol: str, start: str, end: str, interval: str) -> pd.DataFrame:
    """Fetch OHLCV via yfinance. Returns cleaned DataFrame or empty DataFrame on failure."""
    try:
        import yfinance as yf
    except ImportError:
        logger.warning("yfinance not installed — skipping yfinance fetch")
        return pd.DataFrame()

    yf_interval = _normalise_yf_interval(interval)
    # yfinance needs stock-style ticker: BTC → BTC-USD
    ticker = symbol.upper()
    if ticker in _CRYPTO_SYMBOLS and not ticker.endswith("-USD"):
        ticker = f"{ticker}-USD"

    try:
        df = yf.download(
            ticker,
            start=start,
            end=end,
            interval=yf_interval,
            auto_adjust=True,
            progress=False,
        )
        if df is None or df.empty:
            logger.debug("yfinance returned empty for %s", ticker)
            return pd.DataFrame()
        return _clean_df(df)
    except Exception as exc:
        logger.debug("yfinance error for %s: %s", ticker, exc)
        return pd.DataFrame()


def _fetch_ccxt(symbol: str, start: str, end: str, interval: str) -> pd.DataFrame:
    """Fetch OHLCV from Binance via ccxt. Returns cleaned DataFrame or empty on failure."""
    try:
        import ccxt
    except ImportError:
        logger.warning("ccxt not installed — skipping ccxt fetch")
        return pd.DataFrame()

    ccxt_interval = _normalise_ccxt_interval(interval)
    # Convert symbol to Binance pair format: BTC → BTC/USDT
    base = symbol.upper().replace("-USD", "").replace("USDT", "").replace("/", "")
    pair = f"{base}/USDT"

    try:
        exchange = ccxt.binance({"enableRateLimit": True})

        since_ms = int(
            pd.Timestamp(start).timestamp() * 1000
        )
        end_ms = int(
            pd.Timestamp(end).timestamp() * 1000
        )

        all_ohlcv = []
        limit = 1000
        fetch_since = since_ms

        # Paginate to collect all bars in range
        while fetch_since < end_ms:
            ohlcv = exchange.fetch_ohlcv(pair, timeframe=ccxt_interval, since=fetch_since, limit=limit)
            if not ohlcv:
                break
            all_ohlcv.extend(ohlcv)
            last_ts = ohlcv[-1][0]
            if last_ts >= end_ms or len(ohlcv) < limit:
                break
            fetch_since = last_ts + 1

        if not all_ohlcv:
            logger.debug("ccxt Binance returned no data for %s", pair)
            return pd.DataFrame()

        df = pd.DataFrame(all_ohlcv, columns=["timestamp", "Open", "High", "Low", "Close", "Volume"])
        df.index = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
        df.index.name = "Datetime"
        df = df.drop(columns=["timestamp"])

        # Filter to requested date range
        df = df[df.index <= pd.Timestamp(end, tz="UTC")]
        return _clean_df(df)

    except Exception as exc:
        logger.debug("ccxt error for %s: %s", pair, exc)
        return pd.DataFrame()


def fetch_ohlcv(
    symbol: str,
    start: str,
    end: str,
    interval: str = "1d",
) -> pd.DataFrame:
    """
    Fetch OHLCV data for a symbol over a date range.

    Strategy:
      1. Try yfinance (stocks + crypto via -USD suffix).
      2. If result is empty or symbol looks like a pure crypto base token,
         fall back to ccxt Binance (USDT pair).

    Args:
        symbol:   Ticker symbol, e.g. "AAPL", "BTC", "BTC-USD", "ETH".
        start:    Start date string, e.g. "2024-01-01".
        end:      End date string, e.g. "2024-12-31".
        interval: Bar interval: "1d", "1h", "15m", etc.

    Returns:
        pd.DataFrame with columns Open, High, Low, Close, Volume.
        Raises ValueError if no data could be fetched.
    """
    sym = symbol.upper().strip()

    # Always try yfinance first
    df = _fetch_yfinance(sym, start, end, interval)
    if not df.empty:
        return df

    # If base symbol matches known crypto set, try ccxt
    base = sym.replace("-USD", "").replace("USDT", "")
    if base in _CRYPTO_SYMBOLS:
        logger.info("yfinance empty for %s — trying ccxt Binance", sym)
        df = _fetch_ccxt(base, start, end, interval)
        if not df.empty:
            return df

    raise ValueError(
        f"Could not fetch OHLCV for '{symbol}' ({start} → {end}, interval={interval}). "
        "Tried yfinance and ccxt Binance. Check symbol name and date range."
    )


# ---------------------------------------------------------------------------
# Convenience: fetch recent N days (used by screener)
# ---------------------------------------------------------------------------

def fetch_recent(symbol: str, days: int = 30, interval: str = "1d") -> pd.DataFrame:
    """Fetch the last `days` calendar days of OHLCV data."""
    end = datetime.utcnow().strftime("%Y-%m-%d")
    start = (datetime.utcnow() - timedelta(days=days + 5)).strftime("%Y-%m-%d")
    return fetch_ohlcv(symbol, start, end, interval)
