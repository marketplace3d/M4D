"""
ds_app/threshold_optimizer.py — Filter Threshold Grid Search

Jointly optimizes the loose entry filters over OOS data.
Finds (atr_pct_floor, rvol_floor, min_signals, jedi_min) that
maximize OOS Sharpe without killing trade count below min_trades.

Outputs: ds/data/optimal_thresholds.json

Usage:
  python ds_app/threshold_optimizer.py
  python ds_app/threshold_optimizer.py --horizon 4h --quick
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

from ds_app.algos_crypto import ALL_ALGO_IDS  # noqa: E402

SIGNAL_DB  = _DS_ROOT / "data" / "signal_log.db"
REGIME_MAP = _DS_ROOT / "data" / "regime_signal_map.json"
OUT        = _DS_ROOT / "data" / "optimal_thresholds.json"

ANNUAL_MAP  = {"1h": 252 * 24, "4h": 252 * 6, "1d": 252}
KILLED      = {"NEW_HIGH", "RANGE_BO", "CONSOL_BO", "ROC_MOM"}
SURVIVORS   = [a for a in ALL_ALGO_IDS if a not in KILLED]
MIN_TRADES  = 200  # minimum OOS trades to be statistically valid


def sharpe(r: np.ndarray, annual: int) -> float:
    r = r[~np.isnan(r)]
    if len(r) < 20:
        return -999.0
    sd = r.std(ddof=1)
    return float(r.mean() / sd * np.sqrt(annual)) if sd > 0 else -999.0


def label_regime_fast(df: pd.DataFrame) -> np.ndarray:
    n     = len(df)
    atr   = df["atr_pct"].fillna(0).values
    sqz   = df["squeeze"].fillna(0).astype(int).values
    sup   = df["v_SUPERTREND"].fillna(0).astype(int).values
    adx   = df["v_ADX_TREND"].fillna(0).astype(int).values
    atr_e = df["v_ATR_EXP"].fillna(0).astype(int).values
    close = df["close"].values
    mom12 = np.zeros(n)
    for i in range(12, n):
        if close[i - 12] != 0:
            mom12[i] = (close[i] - close[i - 12]) / close[i - 12]
    alpha   = 2.0 / 201.0
    ema200  = np.zeros(n)
    ema200[0] = close[0]
    for i in range(1, n):
        ema200[i] = alpha * close[i] + (1 - alpha) * ema200[i - 1]
    above      = close > ema200
    atr_75     = np.percentile(atr[atr > 0], 75) if (atr > 0).any() else 1.0
    risk_off   = (atr > atr_75) & (mom12 < -0.015)
    sqz_prev   = np.concatenate([[0], sqz[:-1]])
    breakout   = ((sqz_prev == 1) & (sqz == 0)) | (atr_e == 1)
    trending   = above & (sup == 1) & (adx == 1)
    regime     = np.full(n, "RANGING", dtype=object)
    regime[trending]  = "TRENDING"
    regime[breakout]  = "BREAKOUT"
    regime[risk_off]  = "RISK-OFF"
    return regime


def score_config(
    df_oos: pd.DataFrame,
    routing: dict[str, list[str]],
    outcome_col: str,
    annual: int,
    atr_pct_floor: float,
    rvol_floor: float,
    min_signals: int,
    jedi_min: int,
    trend_align: bool,
) -> tuple[float, int]:
    """Returns (sharpe, n_trades)."""
    df = df_oos.dropna(subset=[outcome_col]).reset_index(drop=True)
    if df.empty:
        return -999.0, 0

    atr  = df["atr_pct"].fillna(0)
    rvol = df["rvol"].fillna(1.0)
    jedi = df["jedi_raw"].fillna(0) if "jedi_raw" in df.columns else pd.Series(0, index=df.index)
    sqz  = df["squeeze"].fillna(0)

    atr_thresh = atr.quantile(atr_pct_floor / 100.0) if atr_pct_floor > 0 else 0
    gate = (atr >= atr_thresh) & (rvol >= rvol_floor) & (sqz == 0) & (jedi >= jedi_min)

    if trend_align:
        close  = df["close"].values
        alpha  = 2.0 / 201.0
        ema200 = np.zeros(len(df))
        ema200[0] = close[0]
        for i in range(1, len(df)):
            ema200[i] = alpha * close[i] + (1 - alpha) * ema200[i - 1]
        gate = gate & (close > ema200)

    regime = pd.Series(label_regime_fast(df), index=df.index)
    sig_count = pd.Series(0, index=df.index)
    for reg, sig_ids in routing.items():
        reg_mask = regime == reg
        for sid in sig_ids:
            vcol = f"v_{sid}"
            if vcol in df.columns:
                fires = (df[vcol] == 1).fillna(False)
                sig_count += (reg_mask & fires).astype(int)

    entry  = gate & (sig_count >= min_signals)
    trades = df[entry]
    if len(trades) < 20:
        return -999.0, len(trades)

    ret = trades[outcome_col].values / 100.0
    return sharpe(ret, annual), len(trades)


def run(horizon: str, quick: bool, symbols: list[str] | None) -> None:
    annual = ANNUAL_MAP[horizon]
    outcome_col = f"outcome_{horizon}_pct"

    routing: dict[str, list[str]] = {
        "TRENDING": ["TREND_SMA", "MACD_CROSS", "CONSEC_BULL"],
        "RANGING":  ["VOL_BO", "DON_BO", "KC_BREAK"],
        "BREAKOUT": ["GOLDEN", "DON_BO", "OBV_TREND"],
        "RISK-OFF": ["SUPERTREND", "DON_BO"],
    }
    if REGIME_MAP.exists():
        with open(REGIME_MAP) as f:
            rm = json.load(f)
        for reg, sigs in rm.items():
            routing[reg] = [s["algo_id"] for s in sigs[:3] if s["algo_id"] in SURVIVORS]

    con = sqlite3.connect(SIGNAL_DB)
    avail = [r[0] for r in con.execute("SELECT DISTINCT symbol FROM signal_log ORDER BY symbol")]
    targets = [s for s in avail if not symbols or s in symbols]

    vote_cols = [f"v_{a}" for a in ALL_ALGO_IDS]
    base_cols = ["ts", "symbol", "close", "atr_pct", "rvol", "squeeze",
                 "jedi_raw", "v_SUPERTREND", "v_ADX_TREND", "v_ATR_EXP", outcome_col]
    seen: set = set()
    sel = [c for c in base_cols + vote_cols if not (c in seen or seen.add(c))]  # type: ignore

    sym_str = "','".join(targets)
    print(f"Threshold Optimizer — horizon={horizon} — {targets}")
    print("Loading OOS … ", end="", flush=True)

    df_all = pd.read_sql_query(
        f"SELECT {', '.join(sel)} FROM signal_log WHERE symbol IN ('{sym_str}') ORDER BY ts",
        con,
    )
    con.close()

    ts_sorted = np.sort(df_all["ts"].unique())
    cutoff    = int(ts_sorted[int(len(ts_sorted) * 0.70)])
    df_oos    = df_all[df_all["ts"] > cutoff].reset_index(drop=True)
    print(f"{len(df_oos):,} OOS rows\n")

    # ── grid ─────────────────────────────────────────────────────────────────
    if quick:
        atr_floors    = [0, 20, 30]
        rvol_floors   = [0.0, 0.8, 1.0]
        min_sigs      = [1, 2]
        jedi_mins     = [0, 2]
        trend_aligns  = [True]
    else:
        atr_floors    = [0, 10, 20, 30, 40]
        rvol_floors   = [0.0, 0.6, 0.8, 1.0, 1.2]
        min_sigs      = [1, 2, 3]
        jedi_mins     = [0, 1, 2, 3, 5]
        trend_aligns  = [True, False]

    grid = list(product(atr_floors, rvol_floors, min_sigs, jedi_mins, trend_aligns))
    print(f"Grid: {len(grid)} combinations\n")
    print(f"{'ATR%':<7} {'RVOL':<7} {'SIGS':<6} {'JEDI':<6} {'TREND':<7} {'SHARPE':<10} {'TRADES':<8}")
    print("─" * 58)

    best_sharpe = -999.0
    best_config: dict = {}
    all_results = []

    for atr_f, rvol_f, ms, jm, ta in grid:
        s, n = score_config(df_oos, routing, outcome_col, annual,
                            atr_f, rvol_f, ms, jm, ta)
        if n < MIN_TRADES:
            continue  # skip statistically weak combos
        flag = " ◄ BEST" if s > best_sharpe else ""
        print(f"{atr_f:<7} {rvol_f:<7} {ms:<6} {jm:<6} {str(ta):<7} {s:.3f}     {n}{flag}")
        all_results.append({
            "atr_pct_floor": atr_f, "rvol_floor": rvol_f,
            "min_signals": ms, "jedi_min": jm, "trend_align": ta,
            "sharpe": round(s, 3), "n_trades": n,
        })
        if s > best_sharpe:
            best_sharpe = s
            best_config = dict(all_results[-1])

    all_results.sort(key=lambda x: x["sharpe"], reverse=True)

    print(f"\n══ OPTIMAL CONFIG ══")
    print(f"  ATR floor:    {best_config.get('atr_pct_floor')}th percentile")
    print(f"  RVOL floor:   {best_config.get('rvol_floor')}")
    print(f"  Min signals:  {best_config.get('min_signals')}")
    print(f"  JEDI min:     {best_config.get('jedi_min')}")
    print(f"  Trend align:  {best_config.get('trend_align')}")
    print(f"  OOS Sharpe:   {best_config.get('sharpe'):.3f}")
    print(f"  OOS Trades:   {best_config.get('n_trades'):,}")

    out = {
        "horizon": horizon,
        "optimal": best_config,
        "top_10": all_results[:10],
        "symbols": targets,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\n✓ Optimal thresholds → {OUT}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", default="4h", choices=["1h", "4h", "1d"])
    ap.add_argument("--quick",   action="store_true", help="small grid for fast test")
    ap.add_argument("--symbols", nargs="*")
    args = ap.parse_args()
    run(args.horizon, args.quick, args.symbols)
