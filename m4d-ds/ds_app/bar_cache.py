"""
bar_cache.py — SQLite bar cache + parallel loader + swarm runner
================================================================
Solves three problems at once:

1. CACHE  — Never re-download the same bars twice.
           SQLite keyed by (symbol, interval, period).
           Stale = older than TTL. Fresh = serve from disk.

2. PARALLEL — Load 500 symbols across all 10 Mac Mini cores.
           `load_universe_parallel(universe, tf, period)` replaces
           `_load_universe_frames()` everywhere. Same return type.

3. SWARM  — `run_swarm(signal_name, universe, ...)` runs any algo_signals
           signal across the full universe in parallel, returns ranked
           results. 500 stocks × 30 signals = feasible in minutes, not hours.

Claude Code subagent note (answer to "can swarms run from Claude?"):
  YES — Claude Code Agent tool can launch parallel subagents that each
  call these functions. But for CPU-bound backtests you want Python
  multiprocessing (this file), not Claude subagents. Claude subagents
  are for I/O-bound or research tasks. Backtests = multiprocessing here.
  Use Claude subagents for: research, doc generation, code review.
  Use this file for: parameter sweeps, universe scans, signal scoring.
"""

from __future__ import annotations

import hashlib
import logging
import os
import pickle
import sqlite3
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

# ── Cache config ──────────────────────────────────────────────────────────────
CACHE_DIR = Path(os.environ.get("M4D_CACHE_DIR", Path.home() / ".m4d_cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DB = CACHE_DIR / "bars.sqlite"

# TTL by interval — 5m data stales fast; daily data stays fresh longer
TTL_SECONDS: dict[str, int] = {
    "1m":  60 * 60 * 2,        # 2 hours
    "2m":  60 * 60 * 4,
    "5m":  60 * 60 * 6,        # 6 hours
    "15m": 60 * 60 * 12,       # 12 hours
    "30m": 60 * 60 * 18,
    "1h":  60 * 60 * 24,       # 1 day
    "1d":  60 * 60 * 24 * 3,   # 3 days
    "1wk": 60 * 60 * 24 * 7,
}
DEFAULT_TTL = 60 * 60 * 6  # 6 hours fallback

# Max parallel workers — leave 1 core free for Django/UI
MAX_WORKERS = min(9, (os.cpu_count() or 4))


# ── SQLite schema ─────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(CACHE_DB), timeout=30, check_same_thread=False)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bars (
            cache_key  TEXT PRIMARY KEY,
            symbol     TEXT NOT NULL,
            interval   TEXT NOT NULL,
            period     TEXT NOT NULL,
            fetched_at INTEGER NOT NULL,
            payload    BLOB NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_bars_sym ON bars(symbol, interval, period)")
    conn.commit()
    return conn


def _cache_key(symbol: str, interval: str, period: str) -> str:
    raw = f"{symbol.upper()}|{interval}|{period}"
    return hashlib.sha1(raw.encode()).hexdigest()


def _ttl(interval: str) -> int:
    return TTL_SECONDS.get(interval.lower(), DEFAULT_TTL)


def cache_get(symbol: str, interval: str, period: str) -> pd.DataFrame | None:
    """Return cached DataFrame if fresh, else None."""
    key = _cache_key(symbol, interval, period)
    try:
        conn = _get_conn()
        row = conn.execute(
            "SELECT fetched_at, payload FROM bars WHERE cache_key = ?", (key,)
        ).fetchone()
        conn.close()
        if row is None:
            return None
        fetched_at, payload = row
        age = time.time() - fetched_at
        if age > _ttl(interval):
            return None  # stale
        return pickle.loads(payload)
    except Exception as e:
        logger.warning("cache_get failed: %s", e)
        return None


def cache_put(symbol: str, interval: str, period: str, df: pd.DataFrame) -> None:
    """Write DataFrame to cache."""
    key = _cache_key(symbol, interval, period)
    try:
        conn = _get_conn()
        payload = pickle.dumps(df, protocol=5)
        conn.execute(
            """INSERT OR REPLACE INTO bars
               (cache_key, symbol, interval, period, fetched_at, payload)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (key, symbol.upper(), interval, period, int(time.time()), payload),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning("cache_put failed: %s", e)


def cache_invalidate(symbol: str | None = None, interval: str | None = None) -> int:
    """Delete rows matching symbol and/or interval. Returns count deleted."""
    try:
        conn = _get_conn()
        if symbol and interval:
            cur = conn.execute(
                "DELETE FROM bars WHERE symbol = ? AND interval = ?",
                (symbol.upper(), interval),
            )
        elif symbol:
            cur = conn.execute("DELETE FROM bars WHERE symbol = ?", (symbol.upper(),))
        elif interval:
            cur = conn.execute("DELETE FROM bars WHERE interval = ?", (interval,))
        else:
            cur = conn.execute("DELETE FROM bars")
        n = cur.rowcount
        conn.commit()
        conn.close()
        return n
    except Exception as e:
        logger.warning("cache_invalidate failed: %s", e)
        return 0


def cache_stats() -> dict:
    """Return cache size and row count."""
    try:
        conn = _get_conn()
        rows = conn.execute("SELECT COUNT(*), SUM(LENGTH(payload)) FROM bars").fetchone()
        conn.close()
        count = rows[0] or 0
        size_mb = (rows[1] or 0) / 1_048_576
        return {
            "rows": count,
            "size_mb": round(size_mb, 2),
            "db_path": str(CACHE_DB),
            "max_workers": MAX_WORKERS,
        }
    except Exception:
        return {"rows": 0, "size_mb": 0.0, "db_path": str(CACHE_DB)}


# ── Single-symbol fetch with cache ───────────────────────────────────────────

def fetch_symbol(symbol: str, interval: str, period: str) -> pd.DataFrame | None:
    """
    Fetch one symbol: cache first, then yfinance. Writes to cache on success.
    Safe to call from worker processes.
    """
    sym = symbol.strip().upper()

    # Cache hit
    cached = cache_get(sym, interval, period)
    if cached is not None and len(cached) >= 30:
        return cached

    # yfinance fetch
    try:
        import yfinance as yf
        from .boom_backtest import _normalize_ohlcv

        df_raw = yf.download(
            tickers=sym,
            period=period,
            interval=interval,
            progress=False,
            auto_adjust=False,
            prepost=False,
            threads=False,
        )
        df = _normalize_ohlcv(df_raw)
        if len(df) < 30:
            return None
        cache_put(sym, interval, period, df)
        return df
    except Exception as e:
        logger.debug("fetch_symbol %s failed: %s", sym, e)
        return None


# Worker function at module level — required for multiprocessing pickle
def _fetch_worker(args: tuple) -> tuple[str, pd.DataFrame | None]:
    symbol, interval, period = args
    df = fetch_symbol(symbol, interval, period)
    return symbol, df


# ── Parallel universe loader (replaces _load_universe_frames) ─────────────────

def load_universe_parallel(
    universe: list[str],
    interval: str,
    period: str,
    min_bars: int = 120,
    workers: int | None = None,
) -> tuple[dict[str, pd.DataFrame], str]:
    """
    Drop-in replacement for boom_backtest._load_universe_frames().
    Uses SQLite cache + ProcessPoolExecutor across all cores.

    Returns: (frames dict, data_source string)
    """
    n_workers = min(workers or MAX_WORKERS, len(universe))
    frames: dict[str, pd.DataFrame] = {}

    if n_workers <= 1 or len(universe) == 1:
        # Single-threaded path (also handles in-process Django requests safely)
        for sym in universe:
            df = fetch_symbol(sym, interval, period)
            if df is not None and len(df) >= min_bars:
                frames[sym] = df
    else:
        args = [(sym, interval, period) for sym in universe]
        with ProcessPoolExecutor(max_workers=n_workers) as pool:
            futures = {pool.submit(_fetch_worker, a): a[0] for a in args}
            for future in as_completed(futures):
                try:
                    sym, df = future.result(timeout=60)
                    if df is not None and len(df) >= min_bars:
                        frames[sym] = df
                except Exception as e:
                    logger.warning("worker failed for %s: %s", futures[future], e)

    if not frames:
        from .boom_backtest import synthetic_ohlcv_bars
        sym0 = universe[0] if universe else "SPY"
        frames[sym0] = synthetic_ohlcv_bars(400)
        return frames, "synthetic"

    return frames, "yfinance+cache"


# ── Swarm runner — signal × universe ─────────────────────────────────────────

def _swarm_worker(args: tuple) -> list[dict]:
    """Run one signal on one symbol. Module-level for pickling."""
    signal_name, symbol, interval, period, flat_eod, min_trades, param_overrides = args
    try:
        df = fetch_symbol(symbol, interval, period)
        if df is None or len(df) < 60:
            return []
        from .algo_signals import SIGNAL_REGISTRY, boom_rank_score
        reg = SIGNAL_REGISTRY.get(signal_name)
        if not reg:
            return []
        default_p = reg["default_params"]
        fields = {f: getattr(default_p, f) for f in default_p.__dataclass_fields__}
        fields.update(param_overrides or {})
        p = reg["params_cls"](**fields)
        result = reg["run_one_fn"](df, p, symbol=symbol, flat_eod=flat_eod)
        result["boom_rank_score"] = boom_rank_score(result)
        if result.get("trades", 0) < min_trades:
            return []
        return [result]
    except Exception as e:
        logger.debug("swarm_worker %s/%s: %s", signal_name, symbol, e)
        return []


def run_swarm(
    signal_name: str,
    universe: list[str],
    interval: str = "1d",
    period: str = "6mo",
    flat_eod: bool = False,
    min_trades: int = 3,
    param_overrides: dict | None = None,
    workers: int | None = None,
) -> list[dict]:
    """
    Run signal_name across every symbol in universe in parallel.
    Returns all results sorted by boom_rank_score descending.

    500 symbols × default params on 10 cores ≈ 2–4 minutes (1D bars).
    Cache makes subsequent runs near-instant.
    """
    n_workers = min(workers or MAX_WORKERS, len(universe))
    args = [
        (signal_name, sym, interval, period, flat_eod, min_trades, param_overrides or {})
        for sym in universe
    ]

    all_rows: list[dict] = []
    if n_workers <= 1:
        for a in args:
            all_rows.extend(_swarm_worker(a))
    else:
        with ProcessPoolExecutor(max_workers=n_workers) as pool:
            futures = [pool.submit(_swarm_worker, a) for a in args]
            for f in as_completed(futures):
                try:
                    all_rows.extend(f.result(timeout=120))
                except Exception:
                    pass

    all_rows.sort(key=lambda r: r.get("boom_rank_score", -999), reverse=True)
    return all_rows


def run_swarm_multisignal(
    signals: list[str],
    universe: list[str],
    interval: str = "1d",
    period: str = "6mo",
    flat_eod: bool = False,
    min_trades: int = 3,
    workers: int | None = None,
) -> dict[str, list[dict]]:
    """
    Run multiple signals across the full universe.
    Returns {signal_name: [ranked results]}.

    This is the LEGEND SCANNER engine:
      run_swarm_multisignal(
          signals=["stage2", "choc_bos", "ema_ribbon", ...],
          universe=LEGEND_UNIVERSE_T1,
          interval="1d", period="2y"
      )
    """
    from concurrent.futures import ThreadPoolExecutor

    results: dict[str, list[dict]] = {}

    def run_one_signal(sig: str) -> tuple[str, list[dict]]:
        rows = run_swarm(sig, universe, interval, period, flat_eod, min_trades, workers=workers)
        return sig, rows

    # Signals run in threads (each signal's universe runs in processes internally)
    with ThreadPoolExecutor(max_workers=min(len(signals), 4)) as pool:
        for sig, rows in pool.map(run_one_signal, signals):
            results[sig] = rows

    return results


# ── LEGEND compression scanner ────────────────────────────────────────────────

def scan_atr_compression(
    universe: list[str],
    interval: str = "1d",
    period: str = "2y",
    atr_fast: int = 14,
    atr_slow: int = 50,
    compression_threshold: float = 0.75,
    bb_pct_threshold: float = 35.0,
    workers: int | None = None,
) -> list[dict]:
    """
    Scan universe for ATR compression setups (PHYSICIST protocol).
    Returns symbols ranked by compression score (lower = more compressed = more coiled).

    compression_score = ATR(fast) / ATR(slow)
    < 0.70 = heavily compressed (TRIGGER WATCH)
    < 0.80 = compressed (PREPARE)
    < 0.90 = tightening (WATCH)
    """
    n_workers = min(workers or MAX_WORKERS, len(universe))

    def score_one(sym: str) -> dict | None:
        try:
            df = fetch_symbol(sym, interval, period)
            if df is None or len(df) < atr_slow + 20:
                return None
            import numpy as np
            h, l, c = df["High"].values, df["Low"].values, df["Close"].values
            prev_c = np.roll(c, 1); prev_c[0] = c[0]
            tr = np.maximum.reduce([
                np.abs(h - l),
                np.abs(h - prev_c),
                np.abs(l - prev_c),
            ])
            # EWM ATR
            def ewm_atr(span: int) -> float:
                alpha = 2.0 / (span + 1)
                val = float(tr[0])
                for v in tr[1:]:
                    val = alpha * v + (1 - alpha) * val
                return val

            fast_atr = ewm_atr(atr_fast)
            slow_atr = ewm_atr(atr_slow)
            if slow_atr <= 0:
                return None
            comp_ratio = fast_atr / slow_atr

            # Bollinger Band width percentile (last 90 bars)
            window = min(90, len(c) - 1)
            bb_window = 20
            if len(c) > bb_window + window:
                widths = []
                for i in range(window):
                    idx = len(c) - window + i
                    sl = c[max(0, idx - bb_window):idx]
                    if len(sl) >= 5:
                        mean = float(np.mean(sl))
                        std = float(np.std(sl, ddof=0))
                        if mean > 0:
                            widths.append(2 * std / mean * 100)
                if widths:
                    current_width = widths[-1]
                    pct = sum(1 for w in widths if w < current_width) / len(widths) * 100
                else:
                    pct = 50.0
            else:
                pct = 50.0

            # Volume trend (is volume declining into base?)
            vol = df["Volume"].values[-20:]
            vol_slope = float(np.polyfit(range(len(vol)), vol, 1)[0]) if len(vol) > 3 else 0
            vol_declining = vol_slope < 0

            state = "WATCH"
            if comp_ratio < 0.70 and pct < 25:
                state = "TRIGGER"
            elif comp_ratio < compression_threshold and pct < bb_pct_threshold:
                state = "PREPARE"
            elif comp_ratio < 0.90:
                state = "WATCH"
            else:
                state = "IDLE"

            return {
                "symbol": sym,
                "compression_ratio": round(comp_ratio, 4),
                "bb_width_pct": round(pct, 1),
                "vol_declining": vol_declining,
                "state": state,
                "compression_score": round(comp_ratio * (pct / 100), 4),
                "last_close": round(float(c[-1]), 4),
                "bars": len(df),
            }
        except Exception as e:
            logger.debug("scan_atr_compression %s: %s", sym, e)
            return None

    results = []
    if n_workers <= 1:
        for sym in universe:
            r = score_one(sym)
            if r:
                results.append(r)
    else:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            for r in pool.map(score_one, universe):
                if r:
                    results.append(r)

    results.sort(key=lambda r: r["compression_score"])
    return results
