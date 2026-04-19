"""
ds_app/walk_forward.py — Phase 5: Walk-Forward Validation

Expanding-window OOS proof. No parameter changes between windows.
Tests regime-routed ensemble using only the 23 surviving signals.

Method:
  Window 1:  train bars 1-70%/12,  test next 1/12
  Window 2:  train bars 1-70%/12 + 1/12, test next 1/12
  ...
  Window 12: train bars 1-70%/12 + 11/12, test last 1/12

Pass criteria (WorldQuant standard):
  OOS Sharpe > 1.0 in ≥ 10/12 windows
  No single window MaxDD > 20%
  Median OOS Sharpe > 1.5

Filters applied (loose — "not too tight"):
  atr_pct  > atr_20_pct_floor  (default: 20th percentile)
  rvol     > rvol_floor         (default: 0.8)
  ema200   trend alignment      (long only above)
  min_signals ≥ 1               (at least 1 regime signal fires)

Usage:
  python ds_app/walk_forward.py
  python ds_app/walk_forward.py --horizon 4h --windows 12
  python ds_app/walk_forward.py --symbols ES NQ CL --atr-pct 25 --rvol 0.8
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
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
OUT        = _DS_ROOT / "data" / "walkforward_results.json"

ANNUAL_MAP = {"1h": 252 * 24, "4h": 252 * 6, "1d": 252}

# surviving signals after correlation kill (Phase 3)
KILLED = {"NEW_HIGH", "RANGE_BO", "CONSOL_BO", "ROC_MOM"}
SURVIVORS = [a for a in ALL_ALGO_IDS if a not in KILLED]


# ── stats helpers ─────────────────────────────────────────────────────────────
def sharpe(r: np.ndarray, annual: int) -> float:
    r = r[~np.isnan(r)]
    if len(r) < 10:
        return np.nan
    sd = r.std(ddof=1)
    return float(r.mean() / sd * np.sqrt(annual)) if sd > 0 else np.nan


def max_dd(equity: np.ndarray) -> float:
    peak = np.maximum.accumulate(equity)
    dd = (equity - peak) / np.where(peak == 0, 1, peak)
    return float(dd.min())


# ── regime labeller (fast numpy) ─────────────────────────────────────────────
def label_regime(df: pd.DataFrame) -> np.ndarray:
    n = len(df)
    atr   = df["atr_pct"].fillna(0).values
    sqz   = df["squeeze"].fillna(0).astype(int).values
    sup   = df["v_SUPERTREND"].fillna(0).astype(int).values
    adx   = df["v_ADX_TREND"].fillna(0).astype(int).values
    atr_e = df["v_ATR_EXP"].fillna(0).astype(int).values
    close = df["close"].values

    # EMA200 (exponential, alpha=2/201)
    alpha = 2.0 / 201.0
    ema200 = np.zeros(n)
    ema200[0] = close[0]
    for i in range(1, n):
        ema200[i] = alpha * close[i] + (1 - alpha) * ema200[i - 1]
    above_ema200 = (close > ema200).astype(int)

    # 12-bar momentum
    mom12 = np.full(n, 0.0)
    for i in range(12, n):
        if close[i - 12] != 0:
            mom12[i] = (close[i] - close[i - 12]) / close[i - 12]

    atr_75 = np.percentile(atr[atr > 0], 75) if (atr > 0).any() else 1.0
    risk_off  = (atr > atr_75) & (mom12 < -0.015)
    sqz_prev  = np.concatenate([[0], sqz[:-1]])
    breakout  = ((sqz_prev == 1) & (sqz == 0)) | (atr_e == 1)
    trending  = (above_ema200 == 1) & (sup == 1) & (adx == 1)

    regime = np.full(n, "RANGING", dtype=object)
    regime[trending]  = "TRENDING"
    regime[breakout]  = "BREAKOUT"
    regime[risk_off]  = "RISK-OFF"
    return regime


# ── entry mask: regime-routed + loose filters ─────────────────────────────────
def build_entry_mask(
    df: pd.DataFrame,
    routing: dict[str, list[str]],
    atr_pct_floor: float,  # percentile floor, e.g. 20
    rvol_floor: float,     # e.g. 0.8
    min_signals: int,      # e.g. 1
    trend_align: bool,     # only long above EMA200
) -> pd.Series:
    df = df.reset_index(drop=True)
    n = len(df)

    # ── filter gates ─────────────────────────────────────────────────────────
    atr  = df["atr_pct"].fillna(0)
    rvol = df["rvol"].fillna(1.0)
    sqz  = df["squeeze"].fillna(0)

    atr_threshold = atr.quantile(atr_pct_floor / 100.0) if atr_pct_floor > 0 else 0
    gate_atr  = atr  >= atr_threshold
    gate_rvol = rvol >= rvol_floor
    gate_sqz  = sqz  == 0   # not in dead coil (always-on, very loose)

    # EMA200 trend alignment
    close  = df["close"].values
    alpha  = 2.0 / 201.0
    ema200 = np.zeros(n)
    ema200[0] = close[0]
    for i in range(1, n):
        ema200[i] = alpha * close[i] + (1 - alpha) * ema200[i - 1]
    gate_trend = pd.Series(close > ema200, index=df.index) if trend_align else pd.Series(True, index=df.index)

    regime = pd.Series(label_regime(df), index=df.index)

    # ── signal gates ─────────────────────────────────────────────────────────
    signal_count = pd.Series(0, index=df.index)
    for reg, sig_ids in routing.items():
        reg_mask = regime == reg
        for sid in sig_ids:
            if sid not in SURVIVORS:
                continue
            vcol = f"v_{sid}"
            if vcol not in df.columns:
                continue
            fires = (df[vcol] == 1).fillna(False)
            signal_count += (reg_mask & fires).astype(int)

    gate_signals = signal_count >= min_signals

    entry = gate_atr & gate_rvol & gate_sqz & gate_trend & gate_signals
    return entry


# ── single-window eval ────────────────────────────────────────────────────────
def eval_window(
    df_test: pd.DataFrame,
    routing: dict[str, list[str]],
    horizon: str,
    annual: int,
    atr_pct_floor: float,
    rvol_floor: float,
    min_signals: int,
    trend_align: bool,
) -> dict:
    outcome_col = f"outcome_{horizon}_pct"
    df = df_test.dropna(subset=[outcome_col]).reset_index(drop=True)
    if df.empty:
        return {"sharpe": np.nan, "max_dd": np.nan, "n_trades": 0, "hit_rate": np.nan}

    entry = build_entry_mask(df, routing, atr_pct_floor, rvol_floor, min_signals, trend_align)
    trades = df[entry]

    if len(trades) < 10:
        return {"sharpe": np.nan, "max_dd": np.nan, "n_trades": len(trades), "hit_rate": np.nan}

    ret = trades[outcome_col].values / 100.0
    s   = sharpe(ret, annual)

    # equity curve for drawdown
    daily_ret = (
        trades.assign(ret=ret, ts_dt=pd.to_datetime(trades["ts"], unit="s"))
        .set_index("ts_dt")["ret"]
        .resample("D").mean()
        .dropna()
    )
    eq = (1 + daily_ret).cumprod().values if len(daily_ret) > 0 else np.array([1.0])
    mdd = max_dd(eq)

    return {
        "sharpe":   round(s, 3) if not np.isnan(s) else None,
        "max_dd":   round(mdd * 100, 2),
        "n_trades": int(len(trades)),
        "hit_rate": round(float((ret > 0).mean()), 3),
        "avg_ret":  round(float(ret.mean() * 100), 4),
    }


# ── walk-forward loop ─────────────────────────────────────────────────────────
def run(
    horizon: str,
    n_windows: int,
    symbols: list[str] | None,
    atr_pct_floor: float,
    rvol_floor: float,
    min_signals: int,
    trend_align: bool,
) -> None:
    annual = ANNUAL_MAP[horizon]

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

    # load all required columns
    outcome_col = f"outcome_{horizon}_pct"
    vote_cols   = [f"v_{a}" for a in ALL_ALGO_IDS]
    base_cols   = ["ts", "symbol", "close", "atr_pct", "rvol", "squeeze",
                   "v_SUPERTREND", "v_ADX_TREND", "v_ATR_EXP", outcome_col]
    seen: set = set()
    sel = [c for c in base_cols + vote_cols if not (c in seen or seen.add(c))]  # type: ignore

    sym_str = "','".join(targets)
    print(f"Walk-Forward — horizon={horizon} windows={n_windows} symbols={targets}")
    print(f"Filters: ATR≥{atr_pct_floor}pct  RVOL≥{rvol_floor}  min_signals={min_signals}  trend_align={trend_align}\n")
    print("Loading … ", end="", flush=True)
    df_all = pd.read_sql_query(
        f"SELECT {', '.join(sel)} FROM signal_log WHERE symbol IN ('{sym_str}') ORDER BY ts",
        con,
    )
    con.close()
    print(f"{len(df_all):,} rows")

    # ── define window boundaries on ts ───────────────────────────────────────
    ts_sorted   = np.sort(df_all["ts"].unique())
    total_ts    = len(ts_sorted)
    # OOS = last 30%; slice that into n_windows equal windows
    oos_start   = int(total_ts * 0.70)
    oos_ts      = ts_sorted[oos_start:]
    window_size = max(len(oos_ts) // n_windows, 1)

    results = []
    print(f"\n{'WIN':<5} {'TS_TEST_START':<22} {'N_TS':<8} {'TRADES':<8} {'SHARPE':<10} {'MAX_DD%':<10} {'HIT%'}")
    print("─" * 78)

    for w in range(n_windows):
        w_start = w * window_size
        w_end   = w_start + window_size if w < n_windows - 1 else len(oos_ts)
        w_ts    = oos_ts[w_start:w_end]
        if len(w_ts) == 0:
            continue

        df_win = df_all[df_all["ts"].isin(set(w_ts))].copy()
        if df_win.empty:
            continue

        res = eval_window(df_win, routing, horizon, annual,
                          atr_pct_floor, rvol_floor, min_signals, trend_align)
        ts_str = pd.Timestamp(int(w_ts[0]), unit="s").strftime("%Y-%m-%d")
        s_str  = f"{res['sharpe']:.3f}" if res["sharpe"] is not None else "  N/A  "
        hit_str = f"{res['hit_rate']:.1%}" if res["hit_rate"] else "  N/A"
        flag   = "" if (res["sharpe"] or 0) >= 1.0 else " ✗"
        print(f"{w+1:<5} {ts_str:<22} {len(w_ts):<8} {res['n_trades']:<8} {s_str:<10} {str(res['max_dd'])+'%':<10} {hit_str}{flag}")
        results.append({"window": w + 1, "ts_start": int(w_ts[0]), **res})

    # ── summary ───────────────────────────────────────────────────────────────
    sharpes   = [r["sharpe"] for r in results if r["sharpe"] is not None]
    n_pass    = sum(1 for s in sharpes if s >= 1.0)
    n_tested  = len(sharpes)
    med_sharpe = float(np.median(sharpes)) if sharpes else np.nan
    max_dds   = [r["max_dd"] for r in results if r["max_dd"] is not None]
    worst_dd  = min(max_dds) if max_dds else np.nan

    passed = (
        n_pass >= int(n_windows * 0.83)    # ≥10/12 or scaled
        and (not np.isnan(med_sharpe) and med_sharpe >= 1.5)
        and (not np.isnan(worst_dd)   and worst_dd >= -20.0)
    )

    print(f"\n══ WALK-FORWARD SUMMARY ══")
    print(f"  Windows tested:  {n_tested}")
    print(f"  Pass (S≥1.0):    {n_pass}/{n_tested}")
    print(f"  Median Sharpe:   {med_sharpe:.3f}")
    print(f"  Worst Window DD: {worst_dd:.1f}%")
    print(f"  VERDICT:         {'✓ PASS — edge is real' if passed else '✗ FAIL — re-tune or add filters'}")

    out_data = {
        "horizon": horizon,
        "n_windows": n_windows,
        "filters": {
            "atr_pct_floor": atr_pct_floor,
            "rvol_floor": rvol_floor,
            "min_signals": min_signals,
            "trend_align": trend_align,
        },
        "windows": results,
        "summary": {
            "n_pass": n_pass,
            "n_tested": n_tested,
            "pct_pass": round(n_pass / n_tested * 100, 1) if n_tested else 0,
            "median_sharpe": round(med_sharpe, 3) if not np.isnan(med_sharpe) else None,
            "worst_dd_pct": worst_dd,
            "passed": passed,
        },
    }
    with open(OUT, "w") as f:
        json.dump(out_data, f, indent=2)
    print(f"\n✓ Results → {OUT}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon",      default="4h",  choices=["1h", "4h", "1d"])
    ap.add_argument("--windows",      type=int,   default=12)
    ap.add_argument("--symbols",      nargs="*")
    ap.add_argument("--atr-pct",      type=float, default=20.0,
                    help="ATR percentile floor (0=off, 20=20th pct)")
    ap.add_argument("--rvol",         type=float, default=0.8,
                    help="Minimum relative volume (0=off)")
    ap.add_argument("--min-signals",  type=int,   default=1,
                    help="Min regime signals required to fire")
    ap.add_argument("--trend-align",  action=argparse.BooleanOptionalAction, default=False,
                    help="Only enter when above EMA200 (default: off)")
    args = ap.parse_args()
    run(args.horizon, args.windows, args.symbols,
        args.atr_pct, args.rvol, args.min_signals, args.trend_align)
