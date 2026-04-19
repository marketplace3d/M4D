"""
ds_app/signal_logger.py — Phase 1: Signal Logger

Reads bars_5m (and optionally bars_1m) from futures.db.
Computes all 27 algo signals vectorially per symbol.
Writes wide-format signal_log.db for correlation / backtest analysis.

Row = (symbol, timeframe, ts): 27 votes + scores, derived metrics, outcomes.

Usage:
  python ds_app/signal_logger.py                     # all symbols, 5m
  python ds_app/signal_logger.py --symbols BTC ETH   # subset
  python ds_app/signal_logger.py --tf 1m             # 1m bars
  python ds_app/signal_logger.py --since 2025-01-01  # date filter
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

# ── path setup so we can import algos_crypto ─────────────────────────────────
_HERE = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

from ds_app.algos_crypto import ALGO_REGISTRY, ALL_ALGO_IDS, build_features  # noqa: E402

# ── paths ─────────────────────────────────────────────────────────────────────
FUTURES_DB = _DS_ROOT / "data" / "futures.db"
SIGNAL_DB = _DS_ROOT / "data" / "signal_log.db"

BATCH_SIZE = 5_000  # rows per SQLite insert batch

# ── outcome horizons (bars) at 5m → 12=1h, 48=4h, 288=1d ────────────────────
HORIZONS = {"1h": 12, "4h": 48, "1d": 288}
HORIZONS_1M = {"1h": 60, "4h": 240, "1d": 1440}


# ── DDL ───────────────────────────────────────────────────────────────────────
def _algo_cols_ddl() -> str:
    vote_cols = ",\n    ".join(f"v_{a} INTEGER" for a in ALL_ALGO_IDS)
    score_cols = ",\n    ".join(f"s_{a} REAL" for a in ALL_ALGO_IDS)
    return f"{vote_cols},\n    {score_cols}"


DDL = f"""
CREATE TABLE IF NOT EXISTS signal_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              INTEGER NOT NULL,
    symbol          TEXT    NOT NULL,
    timeframe       TEXT    NOT NULL,
    open            REAL    NOT NULL,
    high            REAL    NOT NULL,
    low             REAL    NOT NULL,
    close           REAL    NOT NULL,
    volume          REAL    NOT NULL,
    rvol            REAL,
    atr_pct         REAL,
    squeeze         INTEGER,
    {_algo_cols_ddl()},
    jedi_raw           INTEGER,
    jedi_score         REAL,
    dr_high            REAL,
    dr_low             REAL,
    idr_high           REAL,
    idr_low            REAL,
    pdh                REAL,
    pdl                REAL,
    pwh                REAL,
    pwl                REAL,
    dr_proximity_pct   REAL,
    nearest_sig_pct    REAL,
    nearest_sig_type   TEXT,
    level_stack        INTEGER,
    sig_zone           TEXT,
    ob_bull_near       INTEGER,
    ob_bear_near       INTEGER,
    ob_inst_score      INTEGER,
    fvg_bull           INTEGER,
    fvg_bear           INTEGER,
    vwap               REAL,
    vwap_dev_pct       REAL,
    vwap_bias          INTEGER,
    vwap_band          TEXT,
    outcome_1h_pct     REAL,
    outcome_4h_pct     REAL,
    outcome_1d_pct     REAL,
    UNIQUE(symbol, timeframe, ts)
);
CREATE INDEX IF NOT EXISTS idx_sl_sym_ts ON signal_log(symbol, ts);
CREATE INDEX IF NOT EXISTS idx_sl_ts     ON signal_log(ts);
"""


def init_db(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    con.executescript(DDL)
    con.commit()
    return con


# ── helpers ───────────────────────────────────────────────────────────────────
def _ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def _atr14(h: pd.Series, l: pd.Series, c: pd.Series) -> pd.Series:
    prev = c.shift(1)
    tr = pd.concat([(h - l).abs(), (h - prev).abs(), (l - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(span=14, adjust=False).mean()


def _squeeze_state(h: pd.Series, l: pd.Series, c: pd.Series, n: int = 20) -> pd.Series:
    """BB inside KC = 1 (coiling), else 0."""
    basis = c.rolling(n).mean()
    std = c.rolling(n).std(ddof=0)
    bb_upper = basis + 2 * std
    bb_lower = basis - 2 * std

    ema_m = _ema(c, n)
    atr = _atr14(h, l, c)
    kc_upper = ema_m + 2 * atr
    kc_lower = ema_m - 2 * atr

    return ((bb_upper < kc_upper) & (bb_lower > kc_lower)).astype(int)


def _rvol(v: pd.Series, n: int = 20) -> pd.Series:
    avg = v.rolling(n).mean()
    return (v / avg.replace(0, np.nan)).round(3)


# ── core: compute all signals for one symbol ─────────────────────────────────
def compute_signals(df_raw: pd.DataFrame) -> pd.DataFrame:
    """
    df_raw columns: symbol, ts, open, high, low, close, volume
    Returns wide DataFrame with all signal columns + outcomes.
    """
    df = df_raw.copy()
    df = df.rename(columns={
        "open": "Open", "high": "High", "low": "Low",
        "close": "Close", "volume": "Volume",
    })
    df = df.sort_values("ts").reset_index(drop=True)

    h, l, c, v = df["High"], df["Low"], df["Close"], df["Volume"]

    # ── derived metrics ───────────────────────────────────────────────────────
    atr = _atr14(h, l, c)
    df["rvol"] = _rvol(v)
    df["atr_pct"] = (atr / c.replace(0, np.nan) * 100).round(4)
    df["squeeze"] = _squeeze_state(h, l, c)

    # ── run all 27 algos vectorially ──────────────────────────────────────────
    for algo_id in ALL_ALGO_IDS:
        try:
            feat = build_features(df, algo_id, {})
            entry = feat["entry"].astype(int)
            exit_s = feat["exit_sig"].astype(int)
            # vote: entry=+1, exit=-1, neutral=0
            df[f"v_{algo_id}"] = entry - exit_s
            # score: fraction of last 5 bars that fired entry (roll=5)
            df[f"s_{algo_id}"] = feat["entry"].rolling(5).mean().round(4)
        except Exception as exc:
            print(f"  [WARN] {algo_id}: {exc}")
            df[f"v_{algo_id}"] = 0
            df[f"s_{algo_id}"] = 0.0

    # ── JEDI: sum of votes ────────────────────────────────────────────────────
    vote_cols = [f"v_{a}" for a in ALL_ALGO_IDS]
    df["jedi_raw"] = df[vote_cols].sum(axis=1).astype(int)
    df["jedi_score"] = (df["jedi_raw"].abs() / len(ALL_ALGO_IDS)).round(4)

    # ── outcomes: forward return at each horizon ──────────────────────────────
    for label, n_bars in HORIZONS.items():
        future_close = df["Close"].shift(-n_bars)
        df[f"outcome_{label}_pct"] = ((future_close - df["Close"]) / df["Close"] * 100).round(4)

    # ── rename back for storage ───────────────────────────────────────────────
    df = df.rename(columns={
        "Open": "open", "High": "high", "Low": "low",
        "Close": "close", "Volume": "volume",
    })

    # ── DR/IDR + PDH/PDL + PWH/PWL cumulative levels (T1-C) ──────────────────
    try:
        from ds_app.target_levels import compute_dr_levels
        df = compute_dr_levels(df)
    except Exception as exc:
        print(f"  [WARN] DR/IDR: {exc}")
        for col in ["dr_high","dr_low","idr_high","idr_low","pdh","pdl","pwh","pwl",
                    "dr_proximity_pct","nearest_sig_pct","level_stack"]:
            df[col] = np.nan if col != "level_stack" else 0
        df["nearest_sig_type"] = "CLEAR"
        df["sig_zone"]         = "CLEAR"

    # ── Order Block + FVG detection (T2-A/B) ──────────────────────────────────
    try:
        from ds_app.ob_signal import compute_ob_signals
        df = compute_ob_signals(df)
    except Exception as exc:
        print(f"  [WARN] OB/FVG: {exc}")
        df["ob_bull_near"]   = 0
        df["ob_bear_near"]   = 0
        df["ob_inst_score"]  = 0
        df["fvg_bull"]       = 0
        df["fvg_bear"]       = 0

    # ── VWAP (T3-A) ───────────────────────────────────────────────────────────
    try:
        from ds_app.vwap_signal import compute_vwap
        df = compute_vwap(df)
    except Exception as exc:
        print(f"  [WARN] VWAP: {exc}")
        df["vwap"]         = np.nan
        df["vwap_dev_pct"] = np.nan
        df["vwap_bias"]    = 0
        df["vwap_band"]    = "AT_VWAP"

    return df


# ── writer ────────────────────────────────────────────────────────────────────
_INSERT_COLS = (
    ["ts", "symbol", "timeframe", "open", "high", "low", "close", "volume",
     "rvol", "atr_pct", "squeeze"]
    + [f"v_{a}" for a in ALL_ALGO_IDS]
    + [f"s_{a}" for a in ALL_ALGO_IDS]
    + ["jedi_raw", "jedi_score",
       "dr_high", "dr_low", "idr_high", "idr_low",
       "pdh", "pdl", "pwh", "pwl",
       "dr_proximity_pct", "nearest_sig_pct", "nearest_sig_type",
       "level_stack", "sig_zone",
       "ob_bull_near", "ob_bear_near", "ob_inst_score",
       "fvg_bull", "fvg_bear",
       "vwap", "vwap_dev_pct", "vwap_bias", "vwap_band",
       "outcome_1h_pct", "outcome_4h_pct", "outcome_1d_pct"]
)

_INSERT_SQL = (
    "INSERT OR REPLACE INTO signal_log ("
    + ", ".join(_INSERT_COLS)
    + ") VALUES ("
    + ", ".join("?" * len(_INSERT_COLS))
    + ")"
)


def write_rows(con: sqlite3.Connection, df: pd.DataFrame, symbol: str, tf: str) -> int:
    df = df.copy()
    df["symbol"] = symbol
    df["timeframe"] = tf

    rows = df[_INSERT_COLS].itertuples(index=False, name=None)
    batch = []
    total = 0

    for row in rows:
        # replace NaN with None for SQLite
        batch.append(tuple(None if (isinstance(x, float) and np.isnan(x)) else x for x in row))
        if len(batch) >= BATCH_SIZE:
            con.executemany(_INSERT_SQL, batch)
            con.commit()
            total += len(batch)
            batch = []

    if batch:
        con.executemany(_INSERT_SQL, batch)
        con.commit()
        total += len(batch)

    return total


# ── main ──────────────────────────────────────────────────────────────────────
def run(symbols: list[str] | None, tf: str, since: str | None) -> None:
    src = sqlite3.connect(FUTURES_DB)
    tbl = "bars_5m" if tf == "5m" else "bars_1m"

    # override horizons for 1m
    if tf == "1m":
        for label, n in HORIZONS_1M.items():
            HORIZONS[label] = n

    # discover available symbols
    avail = [r[0] for r in src.execute(f"SELECT DISTINCT symbol FROM {tbl} ORDER BY symbol")]
    targets = [s for s in avail if not symbols or s in symbols]
    print(f"Signal logger — {tbl} — {len(targets)} symbols: {targets}")

    since_ts = int(pd.Timestamp(since).timestamp()) if since else 0

    con = init_db(SIGNAL_DB)
    grand_total = 0
    t0 = time.time()

    for i, sym in enumerate(targets, 1):
        t1 = time.time()
        q = f"SELECT symbol, ts, open, high, low, close, volume FROM {tbl} WHERE symbol=?"
        params: list = [sym]
        if since_ts:
            q += " AND ts >= ?"
            params.append(since_ts)
        q += " ORDER BY ts"

        df_raw = pd.read_sql_query(q, src, params=params)
        if df_raw.empty:
            print(f"  [{i}/{len(targets)}] {sym}: no data, skip")
            continue

        print(f"  [{i}/{len(targets)}] {sym}: {len(df_raw):,} bars … ", end="", flush=True)
        df_out = compute_signals(df_raw)
        n = write_rows(con, df_out, sym, tf)
        grand_total += n
        print(f"{n:,} rows written  ({time.time()-t1:.1f}s)")

    src.close()
    con.close()
    elapsed = time.time() - t0
    print(f"\nDone. {grand_total:,} total rows in {SIGNAL_DB} ({elapsed:.1f}s)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", nargs="*", help="subset of symbols")
    ap.add_argument("--tf", default="5m", choices=["5m", "1m"])
    ap.add_argument("--since", default=None, help="ISO date e.g. 2025-01-01")
    args = ap.parse_args()
    run(args.symbols, args.tf, args.since)
