"""
Stat Arb — Cointegration pairs scanner (ARB expert, Sharpe 3.0+).
Counterparty: momentum traders who pushed correlated pairs apart.
Structural snap-back via cointegration.

Pairs: BTC/ETH, SOL/ETH, BNB/BTC, LINK/ETH + major stock pairs (NVDA/AMD).
Output per pair: z_score, spread, direction, half_life, confidence.
|z| > 2.0 → signal. |z| > 2.5 → strong. Flip at -|z|.
"""
from __future__ import annotations
import sqlite3, pathlib, time, logging
import numpy as np
import pandas as pd

log = logging.getLogger("stat_arb")

try:
    from statsmodels.tsa.stattools import coint, adfuller
    from statsmodels.regression.linear_model import OLS
    from statsmodels.tools import add_constant
    HAS_STATSMODELS = True
except ImportError:
    HAS_STATSMODELS = False
    log.warning("statsmodels not installed — pip install statsmodels")

ENGINE_DB = pathlib.Path(__file__).parent.parent.parent / "engine" / "data" / "algo_state.db"

# Default pairs — crypto only until stock OHLCV added
PAIRS = [
    ("BTCUSDT", "ETHUSDT"),
    ("SOLUSDT", "ETHUSDT"),
    ("BNBUSDT", "BTCUSDT"),
    ("LINKUSDT", "ETHUSDT"),
    ("AVAXUSDT", "SOLUSDT"),
    ("MATICUSDT", "ETHUSDT"),
    ("ARBUSDT", "ETHUSDT"),
    ("DOTUSDT", "ETHUSDT"),
]

LOOKBACK_BARS = 200   # bars for cointegration test
Z_ENTRY = 2.0
Z_STRONG = 2.5
Z_EXIT = 0.5

# ── Load close prices ─────────────────────────────────────────────────────────
def _load_closes(symbols: list[str], n: int = LOOKBACK_BARS) -> pd.DataFrame:
    if not ENGINE_DB.exists():
        return pd.DataFrame()
    try:
        sym_list = ",".join(f"'{s}'" for s in symbols)
        conn = sqlite3.connect(ENGINE_DB, timeout=5)
        df = pd.read_sql(
            f"SELECT symbol, timestamp, close FROM bars WHERE symbol IN ({sym_list}) ORDER BY timestamp",
            conn
        )
        conn.close()
    except Exception as e:
        log.warning(f"DB load: {e}")
        return pd.DataFrame()

    if df.empty:
        return df

    pivot = df.pivot_table(index="timestamp", columns="symbol", values="close", aggfunc="last")
    pivot = pivot.ffill().dropna()
    return pivot.tail(n)

# ── Half-life of mean reversion (Ornstein–Uhlenbeck) ─────────────────────────
def _half_life(spread: pd.Series) -> float:
    lag = spread.shift(1).dropna()
    delta = spread.diff().dropna()
    aligned = pd.concat([delta, lag], axis=1).dropna()
    if len(aligned) < 20:
        return float("inf")
    try:
        X = add_constant(aligned.iloc[:, 1].values)
        model = OLS(aligned.iloc[:, 0].values, X).fit()
        lam = model.params[1]
        if lam >= 0:
            return float("inf")
        return -np.log(2) / lam
    except Exception:
        return float("inf")

# ── Analyse one pair ──────────────────────────────────────────────────────────
def _analyse_pair(closes: pd.DataFrame, sym_a: str, sym_b: str) -> dict | None:
    if sym_a not in closes.columns or sym_b not in closes.columns:
        return None

    s_a = closes[sym_a].dropna()
    s_b = closes[sym_b].dropna()
    aligned = pd.concat([s_a, s_b], axis=1).dropna()
    if len(aligned) < 50:
        return None

    a = aligned[sym_a]
    b = aligned[sym_b]

    # OLS hedge ratio
    try:
        X = add_constant(b.values)
        model = OLS(a.values, X).fit()
        beta = model.params[1]
    except Exception:
        return None

    spread = a - beta * b
    mu  = spread.mean()
    std = spread.std()
    if std == 0:
        return None

    # Z-score (current)
    z = float((spread.iloc[-1] - mu) / std)

    # Cointegration test (p-value)
    try:
        _, pval, _ = coint(a, b)
    except Exception:
        pval = 1.0

    # ADF on spread
    try:
        adf_pval = adfuller(spread, maxlag=1)[1]
    except Exception:
        adf_pval = 1.0

    hl = _half_life(spread)
    confidence = max(0.0, min(1.0, (1 - pval) * 0.6 + (1 - adf_pval) * 0.4))

    direction = "FLAT"
    if abs(z) >= Z_ENTRY:
        # z > 0 means A expensive vs B → short A, long B
        direction = "SHORT_A_LONG_B" if z > 0 else "LONG_A_SHORT_B"

    return {
        "pair":        f"{sym_a}/{sym_b}",
        "sym_a":       sym_a,
        "sym_b":       sym_b,
        "z_score":     round(z, 3),
        "spread":      round(float(spread.iloc[-1]), 6),
        "spread_mean": round(float(mu), 6),
        "spread_std":  round(float(std), 6),
        "beta":        round(float(beta), 4),
        "half_life":   round(float(hl), 1) if hl != float("inf") else None,
        "coint_pval":  round(float(pval), 4),
        "adf_pval":    round(float(adf_pval), 4),
        "confidence":  round(confidence, 3),
        "direction":   direction,
        "signal":      abs(z) >= Z_ENTRY,
        "strong":      abs(z) >= Z_STRONG,
        "exit_target": abs(z) <= Z_EXIT,
        "ts":          int(time.time()),
    }

# ── Run all pairs ─────────────────────────────────────────────────────────────
def run_stat_arb(pairs: list = None) -> dict:
    if not HAS_STATSMODELS:
        return {"error": "statsmodels_not_installed", "pairs": [], "signals": []}

    pairs = pairs or PAIRS
    all_symbols = list({s for p in pairs for s in p})
    closes = _load_closes(all_symbols)

    if closes.empty:
        return {"error": "no_engine_data", "pairs": [], "signals": []}

    results = []
    for sym_a, sym_b in pairs:
        r = _analyse_pair(closes, sym_a, sym_b)
        if r:
            results.append(r)

    results.sort(key=lambda x: abs(x["z_score"]), reverse=True)
    signals = [r for r in results if r["signal"]]

    return {
        "pairs":   results,
        "signals": signals,
        "count":   len(results),
        "active_signals": len(signals),
        "ts":      int(time.time()),
    }
