"""
Holly Scanner — Trade-Ideas style EV-ranked signal engine.
Runs on engine SQLite bars, evaluates algo family daily, returns top 3 + signals.

Holly logic:
  1. Load recent bars (last 5 days) from engine SQLite
  2. Add features: rel_vol, vwap, high_20, low_20, ATR
  3. Run algo family: breakout, vwap_pullback, mean_reversion
  4. Backtest each with stop/target simulation → true EV
  5. Select top 3 by score
  6. Run top algos on latest bar → live signals

Output: { top_algos: [...], signals: {algo: [rows]}, ts }
"""
from __future__ import annotations
import sqlite3, pathlib, time, logging
import numpy as np
import pandas as pd

log = logging.getLogger("holly")

# ── Engine DB path ─────────────────────────────────────────────────────────────
ENGINE_DB = pathlib.Path(__file__).parent.parent.parent / "engine" / "data" / "algo_state.db"

SLIPPAGE   = 0.0005   # 5 bps
STOP_PCT   = 0.006    # 0.6% stop
TARGET_PCT = 0.015    # 1.5% target  → 2.5R
MAX_HOLD   = 12       # bars
DAYS_BACK  = 5        # rolling evaluation window

# ── Load bars ─────────────────────────────────────────────────────────────────
def _load_bars(days: int = DAYS_BACK) -> pd.DataFrame:
    if not ENGINE_DB.exists():
        return pd.DataFrame()
    try:
        conn = sqlite3.connect(ENGINE_DB, timeout=5)
        df = pd.read_sql(
            "SELECT symbol, timestamp, open, high, low, close, volume FROM bars ORDER BY symbol, timestamp",
            conn
        )
        conn.close()
    except Exception as e:
        log.warning(f"DB load failed: {e}")
        return pd.DataFrame()

    if df.empty:
        return df

    df["datetime"] = pd.to_datetime(df["timestamp"], unit="s", utc=True)
    cutoff = df["datetime"].max() - pd.Timedelta(days=days)
    return df[df["datetime"] >= cutoff].copy()

# ── Feature engineering ───────────────────────────────────────────────────────
def _add_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["symbol", "datetime"]).copy()
    g = df.groupby("symbol")

    df["ret_1"]    = g["close"].pct_change()
    df["vol_ma20"] = g["volume"].transform(lambda x: x.rolling(20, min_periods=5).mean())
    df["rel_vol"]  = df["volume"] / df["vol_ma20"].replace(0, np.nan)
    df["high_20"]  = g["high"].transform(lambda x: x.rolling(20, min_periods=5).max())
    df["low_20"]   = g["low"].transform(lambda x: x.rolling(20, min_periods=5).min())

    # VWAP (session cumulative)
    df["vwap"] = (
        (df["close"] * df["volume"]).groupby(df["symbol"]).cumsum()
        / df["volume"].groupby(df["symbol"]).cumsum()
    )

    # ATR (simple)
    df["atr"] = g.apply(
        lambda x: (x["high"] - x["low"]).rolling(14, min_periods=3).mean()
    ).reset_index(level=0, drop=True)

    return df.dropna(subset=["rel_vol"])

# ── Algo definitions ──────────────────────────────────────────────────────────
def algo_breakout(df: pd.DataFrame) -> pd.DataFrame:
    cond = (df["close"] > df["high_20"].shift(1)) & (df["rel_vol"] > 1.5)
    return df[cond].copy()

def algo_vwap_pullback(df: pd.DataFrame) -> pd.DataFrame:
    cond = (
        (df["close"] > df["vwap"]) &
        (df["close"].shift(1) < df["vwap"].shift(1)) &
        (df["rel_vol"] > 1.2)
    )
    return df[cond].copy()

def algo_mean_reversion(df: pd.DataFrame) -> pd.DataFrame:
    cond = (df["close"] < df["low_20"].shift(1)) & (df["rel_vol"] > 1.3)
    return df[cond].copy()

def algo_atr_breakout(df: pd.DataFrame) -> pd.DataFrame:
    cond = (
        (df["close"] > df["close"].shift(1) + df["atr"]) &
        (df["rel_vol"] > 1.8)
    )
    return df[cond].copy()

def algo_volume_surge_long(df: pd.DataFrame) -> pd.DataFrame:
    cond = (df["rel_vol"] > 2.5) & (df["ret_1"] > 0.005)
    return df[cond].copy()

ALGO_REGISTRY = {
    "breakout":        algo_breakout,
    "vwap_pullback":   algo_vwap_pullback,
    "mean_reversion":  algo_mean_reversion,
    "atr_breakout":    algo_atr_breakout,
    "volume_surge":    algo_volume_surge_long,
}

# ── Trade simulator ───────────────────────────────────────────────────────────
def _simulate_trade(df_sym: pd.DataFrame, entry_idx: int,
                    stop_pct: float = STOP_PCT,
                    target_pct: float = TARGET_PCT,
                    max_hold: int = MAX_HOLD) -> float:
    entry = df_sym.iloc[entry_idx]["close"]
    stop   = entry * (1 - stop_pct)
    target = entry * (1 + target_pct)

    for i in range(1, max_hold + 1):
        if entry_idx + i >= len(df_sym):
            break
        row = df_sym.iloc[entry_idx + i]
        if row["low"] <= stop:
            return -stop_pct - SLIPPAGE
        if row["high"] >= target:
            return target_pct - SLIPPAGE

    exit_price = df_sym.iloc[min(entry_idx + max_hold, len(df_sym) - 1)]["close"]
    return (exit_price / entry) - 1 - SLIPPAGE

def _backtest(df: pd.DataFrame, algo_fn) -> dict | None:
    signals = algo_fn(df)
    if signals.empty or len(signals) < 10:
        return None

    returns = []
    for sym in signals["symbol"].unique():
        df_sym = df[df["symbol"] == sym].reset_index(drop=True)
        sig_sym = signals[signals["symbol"] == sym]
        idx_map = {dt: i for i, dt in enumerate(df_sym["datetime"])}
        last_exit = -1
        for _, row in sig_sym.iterrows():
            idx = idx_map.get(row["datetime"])
            if idx is None or idx <= last_exit:
                continue
            pnl = _simulate_trade(df_sym, idx)
            returns.append(pnl)
            last_exit = idx + MAX_HOLD

    if len(returns) < 10:
        return None

    r = pd.Series(returns)
    wins = r > 0
    if not wins.any() or wins.all():
        return None

    return {
        "trades":      len(r),
        "win_rate":    float(wins.mean()),
        "avg_win":     float(r[wins].mean()),
        "avg_loss":    float(r[~wins].mean()),
        "expectancy":  float(r.mean()),
        "sharpe":      float(r.mean() / r.std()) if r.std() > 0 else 0.0,
    }

# ── Scoring & selection ───────────────────────────────────────────────────────
def _score(stats: dict) -> float:
    ev  = stats["expectancy"]
    wr  = stats["win_rate"]
    rr  = abs(stats["avg_win"]) / max(abs(stats["avg_loss"]), 0.0001)
    return ev * 0.5 + wr * 0.2 + (rr / 10) * 0.3

# ── Live signal ranking ───────────────────────────────────────────────────────
def _rank(signals: pd.DataFrame) -> pd.DataFrame:
    signals = signals.copy()
    signals["score"] = (
        signals.get("rel_vol", 1.0) * 0.4 +
        signals.get("ret_1", 0.0).abs() * 200 * 0.4 +
        ((signals.get("close", 0) - signals.get("vwap", 0)) / signals.get("close", 1).replace(0, 1)) * 0.2
    )
    return signals.sort_values("score", ascending=False)

# ── Main Holly pipeline ───────────────────────────────────────────────────────
def run_holly(top_k: int = 3) -> dict:
    df_raw = _load_bars(DAYS_BACK)
    if df_raw.empty:
        return {"top_algos": [], "signals": {}, "ts": int(time.time()), "error": "no_engine_data"}

    df = _add_features(df_raw)

    # Evaluate all algos
    stats_list = []
    for name, fn in ALGO_REGISTRY.items():
        s = _backtest(df, fn)
        if s:
            s["algo"] = name
            s["score"] = _score(s)
            stats_list.append(s)

    if not stats_list:
        return {"top_algos": [], "signals": {}, "ts": int(time.time()), "error": "insufficient_data"}

    stats_df = pd.DataFrame(stats_list).sort_values("score", ascending=False)
    top_algos = stats_df.head(top_k).to_dict("records")

    # Run top algos on full dataset → live signals (top 10 per algo)
    SIGNAL_COLS = ["symbol", "datetime", "close", "rel_vol", "ret_1", "vwap", "score"]
    live_signals: dict[str, list] = {}
    latest_time = df["datetime"].max()
    df_live = df[df["datetime"] >= latest_time - pd.Timedelta(hours=1)]

    for entry in top_algos:
        fn = ALGO_REGISTRY[entry["algo"]]
        sigs = fn(df_live)
        if sigs.empty:
            sigs = fn(df)  # fallback to full window
        if not sigs.empty:
            sigs = _rank(sigs)
            out_cols = [c for c in SIGNAL_COLS if c in sigs.columns]
            rows = sigs[out_cols].head(10).copy()
            rows["datetime"] = rows["datetime"].astype(str)
            live_signals[entry["algo"]] = rows.to_dict("records")

    return {
        "top_algos": top_algos,
        "signals":   live_signals,
        "ts":        int(time.time()),
        "evaluated": len(stats_list),
        "stop_pct":  STOP_PCT,
        "target_pct": TARGET_PCT,
    }
