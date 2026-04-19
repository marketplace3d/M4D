"""
ds_app/filter_test.py — Filter Ablation Study

Shows the Sharpe improvement from each gate added incrementally.
Identifies which filters help vs hurt.
Also tests: doldrums kill (RANGING + bear = skip).

Usage:
  python ds_app/filter_test.py
  python ds_app/filter_test.py --horizon 4h --symbols ES NQ CL
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

ANNUAL_MAP = {"1h": 252 * 24, "4h": 252 * 6, "1d": 252}
KILLED     = {"NEW_HIGH", "RANGE_BO", "CONSOL_BO", "ROC_MOM"}
SURVIVORS  = [a for a in ALL_ALGO_IDS if a not in KILLED]


def sharpe(r: np.ndarray, annual: int) -> float:
    r = r[~np.isnan(r)]
    if len(r) < 20:
        return np.nan
    sd = r.std(ddof=1)
    return float(r.mean() / sd * np.sqrt(annual)) if sd > 0 else np.nan


def eval_config(
    df: pd.DataFrame,
    outcome_col: str,
    annual: int,
    routing: dict[str, list[str]],
    use_regime: bool = False,
    rvol_floor: float = 0.0,
    min_signals: int = 1,
    trend_align: bool = False,
    doldrums_kill: bool = False,
    short_riskoff: bool = False,
    squeeze_gate: bool = False,
    ema200_slope: bool = False,
) -> dict:
    df = df.dropna(subset=[outcome_col]).reset_index(drop=True)
    n  = len(df)
    if n == 0:
        return {"sharpe": np.nan, "n_trades": 0, "hit": np.nan, "avg": np.nan}

    # ── EMA200 ────────────────────────────────────────────────────────────────
    close = df["close"].values
    alpha = 2.0 / 201.0
    ema200 = np.zeros(n)
    ema200[0] = close[0]
    for i in range(1, n):
        ema200[i] = alpha * close[i] + (1 - alpha) * ema200[i - 1]
    above_ema200 = close > ema200

    # EMA50 slope (for ema200_slope gate: EMA200 must be rising)
    alpha50 = 2.0 / 51.0
    ema50 = np.zeros(n)
    ema50[0] = close[0]
    for i in range(1, n):
        ema50[i] = alpha50 * close[i] + (1 - alpha50) * ema50[i - 1]
    ema200_rising = np.zeros(n, dtype=bool)
    ema200_rising[20:] = ema200[20:] > ema200[:-20]  # rising over 20 bars

    # ── regime label ─────────────────────────────────────────────────────────
    atr   = df["atr_pct"].fillna(0).values
    sqz   = df["squeeze"].fillna(0).astype(int).values
    sup   = df["v_SUPERTREND"].fillna(0).astype(int).values
    adx   = df["v_ADX_TREND"].fillna(0).astype(int).values
    atr_e = df["v_ATR_EXP"].fillna(0).astype(int).values
    mom12 = np.zeros(n)
    for i in range(12, n):
        if close[i - 12] != 0:
            mom12[i] = (close[i] - close[i - 12]) / close[i - 12]
    atr_75   = np.percentile(atr[atr > 0], 75) if (atr > 0).any() else 1.0
    risk_off = (atr > atr_75) & (mom12 < -0.015)
    sqz_prev = np.concatenate([[0], sqz[:-1]])
    breakout = ((sqz_prev == 1) & (sqz == 0)) | (atr_e == 1)
    trending = above_ema200 & (sup == 1) & (adx == 1)
    regime   = np.full(n, "RANGING", dtype=object)
    regime[trending]  = "TRENDING"
    regime[breakout]  = "BREAKOUT"
    regime[risk_off]  = "RISK-OFF"

    # ── 5-day momentum for doldrums kill ─────────────────────────────────────
    mom5d = np.zeros(n)
    bars5d = 5 * 24 * 12 if "5m" in outcome_col else 5 * 24 * 60  # rough
    bars5d = min(bars5d, 60)  # cap at 60 bars
    for i in range(bars5d, n):
        if close[i - bars5d] != 0:
            mom5d[i] = (close[i] - close[i - bars5d]) / close[i - bars5d]

    # ── build entry mask ──────────────────────────────────────────────────────
    rvol = df["rvol"].fillna(1.0).values
    jedi = df["jedi_raw"].fillna(0).values if "jedi_raw" in df.columns else np.zeros(n)

    gate = np.ones(n, dtype=bool)

    if rvol_floor > 0:
        gate &= rvol >= rvol_floor

    if trend_align:
        gate &= above_ema200

    if ema200_slope:
        gate &= ema200_rising

    if squeeze_gate:
        gate &= sqz == 0  # not in coil

    if doldrums_kill:
        # skip RANGING bars where 5-day return is negative (going nowhere or down)
        doldrums = (regime == "RANGING") & (mom5d < 0.0)
        gate &= ~doldrums

    # regime-routed signal count
    sig_count = np.zeros(n, dtype=int)
    if use_regime:
        for reg, sig_ids in routing.items():
            reg_mask = regime == reg
            for sid in sig_ids:
                vcol = f"v_{sid}"
                if vcol in df.columns:
                    fires = (df[vcol] == 1).fillna(False).values
                    sig_count += (reg_mask & fires).astype(int)
    else:
        # use all survivors
        for sid in SURVIVORS:
            vcol = f"v_{sid}"
            if vcol in df.columns:
                fires = (df[vcol] == 1).fillna(False).values
                sig_count += fires.astype(int)

    gate &= sig_count >= min_signals

    # ── evaluate LONG trades ─────────────────────────────────────────────────
    ret_series = df[outcome_col].values / 100.0
    long_ret   = ret_series[gate]

    # ── SHORT trades in RISK-OFF (optional) ──────────────────────────────────
    if short_riskoff:
        short_gate = risk_off & (sig_count >= 1)
        short_ret  = -ret_series[short_gate]  # flip sign for short
        all_ret    = np.concatenate([long_ret, short_ret])
    else:
        all_ret = long_ret

    n_trades = len(all_ret)
    if n_trades < 20:
        return {"sharpe": np.nan, "n_trades": n_trades, "hit": np.nan, "avg": np.nan}

    s   = sharpe(all_ret, annual)
    hit = float((all_ret > 0).mean())
    avg = float(all_ret.mean() * 100)
    return {"sharpe": round(s, 3), "n_trades": n_trades,
            "hit": round(hit, 3), "avg": round(avg, 4)}


def run(horizon: str, symbols: list[str] | None) -> None:
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
    print(f"Filter Ablation — horizon={horizon} — {targets}\n")
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

    # ── ablation table ────────────────────────────────────────────────────────
    configs = [
        ("BASELINE: all survivors, no filters",
         dict(use_regime=False, rvol_floor=0, min_signals=1, trend_align=False,
              doldrums_kill=False, short_riskoff=False, squeeze_gate=False, ema200_slope=False)),
        ("+ Regime routing (TRENDING/RANGING/BREAKOUT/RISK-OFF)",
         dict(use_regime=True,  rvol_floor=0, min_signals=1, trend_align=False,
              doldrums_kill=False, short_riskoff=False, squeeze_gate=False, ema200_slope=False)),
        ("+ Trend align (long only above EMA200)",
         dict(use_regime=True,  rvol_floor=0, min_signals=1, trend_align=True,
              doldrums_kill=False, short_riskoff=False, squeeze_gate=False, ema200_slope=False)),
        ("+ RVOL ≥ 1.0 (active volume only)",
         dict(use_regime=True,  rvol_floor=1.0, min_signals=1, trend_align=True,
              doldrums_kill=False, short_riskoff=False, squeeze_gate=False, ema200_slope=False)),
        ("+ Min 2 signals required",
         dict(use_regime=True,  rvol_floor=1.0, min_signals=2, trend_align=True,
              doldrums_kill=False, short_riskoff=False, squeeze_gate=False, ema200_slope=False)),
        ("+ Squeeze gate (no entry during coil)",
         dict(use_regime=True,  rvol_floor=1.0, min_signals=2, trend_align=True,
              doldrums_kill=False, short_riskoff=False, squeeze_gate=True,  ema200_slope=False)),
        ("+ Doldrums kill (RANGING + 5d down = skip)",
         dict(use_regime=True,  rvol_floor=1.0, min_signals=2, trend_align=True,
              doldrums_kill=True,  short_riskoff=False, squeeze_gate=True,  ema200_slope=False)),
        ("+ EMA200 slope rising (no entry in falling trend)",
         dict(use_regime=True,  rvol_floor=1.0, min_signals=2, trend_align=True,
              doldrums_kill=True,  short_riskoff=False, squeeze_gate=True,  ema200_slope=True)),
        ("+ SHORT in RISK-OFF (symmetry: flip signal in bear)",
         dict(use_regime=True,  rvol_floor=1.0, min_signals=2, trend_align=True,
              doldrums_kill=True,  short_riskoff=True,  squeeze_gate=True,  ema200_slope=True)),
    ]

    print(f"{'CONFIG':<60} {'SHARPE':<10} {'TRADES':<8} {'HIT%':<8} {'AVG%'}")
    print("─" * 96)

    best = None
    for label, cfg in configs:
        res = eval_config(df_oos, outcome_col, annual, routing, **cfg)
        s   = res["sharpe"]
        arrow = " ◄" if (s or 0) > (best or 0) else ""
        if s and (best is None or s > best):
            best = s
        s_str  = f"{s:.3f}" if s is not None and not (isinstance(s, float) and np.isnan(s)) else " N/A "
        hit    = f"{res['hit']:.1%}" if res["hit"] else "  N/A"
        avg    = f"{res['avg']:.4f}%" if res["avg"] else " N/A"
        print(f"{label:<60} {s_str:<10} {res['n_trades']:<8} {hit:<8} {avg}{arrow}")

    print(f"\nFinal best OOS Sharpe: {best:.3f}" if best else "\nNo valid config found.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", default="4h", choices=["1h", "4h", "1d"])
    ap.add_argument("--symbols", nargs="*")
    args = ap.parse_args()
    run(args.horizon, args.symbols)
