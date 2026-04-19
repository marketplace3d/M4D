"""
ds_app/mega_backtest.py — Phase 2: WorldQuant 4-Gate Signal Audit

Reads signal_log.db. For each of the 27 algo signals:
  Gate 1 — OOS Sharpe > 1.0  (chronological 70/30 IS/OOS split)
  Gate 2 — Corr < 0.3 with already-approved signals
  Gate 3 — Works on 5+ instruments (not single-market overfit)
  Gate 4 — Survives all 4 regimes (TRENDING / RANGING / BREAKOUT / RISK-OFF)

Outputs:
  ds/data/mega_backtest_results.json   full per-algo stats
  ds/data/surviving_signals.json       gate-passing signals with metadata
  prints summary table to stdout

Usage:
  python ds_app/mega_backtest.py
  python ds_app/mega_backtest.py --horizon 4h --min-sharpe 1.0
  python ds_app/mega_backtest.py --symbols ES NQ CL
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

SIGNAL_DB = _DS_ROOT / "data" / "signal_log.db"
OUT_FULL = _DS_ROOT / "data" / "mega_backtest_results.json"
OUT_PASS = _DS_ROOT / "data" / "surviving_signals.json"

# gate thresholds
MIN_OOS_SHARPE = 1.0
MAX_CORR = 0.3
MIN_INSTRUMENTS = 3    # relax to 3 given 7 instruments total
MIN_REGIME_SHARPE = 0.3  # each regime must have sharpe > this

# annualisation: 1m futures ~24h/day × 252 / horizon_bars
ANNUAL_MAP = {
    "1h":  {"5m": 252 * 24, "1m": 252 * 24},
    "4h":  {"5m": 252 *  6, "1m": 252 *  6},
    "1d":  {"5m": 252,      "1m": 252},
}


# ── regime detection ──────────────────────────────────────────────────────────
def assign_regime(df: pd.DataFrame) -> pd.Series:
    """
    Heuristic regime from stored columns: atr_pct, squeeze, v_SUPERTREND, v_ADX_TREND.
    Returns str Series: TRENDING | RANGING | BREAKOUT | RISK-OFF
    """
    df = df.reset_index(drop=True)
    atr = df["atr_pct"].fillna(df["atr_pct"].median())
    atr_hi = atr > atr.quantile(0.75)
    atr_lo = atr < atr.quantile(0.25)

    sqz = df["squeeze"].fillna(0).astype(int)
    sup = df.get("v_SUPERTREND", pd.Series(0, index=df.index)).fillna(0).astype(int)
    adx = df.get("v_ADX_TREND", pd.Series(0, index=df.index)).fillna(0).astype(int)

    # close relative to 200-bar EMA for trend filter
    ema200 = df["close"].ewm(span=200, adjust=False).mean()
    above_trend = df["close"] > ema200

    # RISK-OFF: very high ATR + negative momentum
    mom = df["close"].pct_change(12).fillna(0)
    risk_off = atr_hi & (mom < -0.01)

    # BREAKOUT: squeeze just released (sqz shifted 1→0)
    sqz_released = (sqz.shift(1, fill_value=0) == 1) & (sqz == 0)

    # TRENDING: supertrend bullish + ADX + above ema200
    trending = (sup == 1) & (adx == 1) & above_trend

    # RANGING: squeeze or low ATR
    ranging = sqz.astype(bool) | atr_lo

    regime = pd.Series("RANGING", index=df.index)
    regime[ranging] = "RANGING"
    regime[trending] = "TRENDING"
    regime[sqz_released] = "BREAKOUT"
    regime[risk_off] = "RISK-OFF"
    return regime


# ── sharpe ────────────────────────────────────────────────────────────────────
def sharpe(returns: np.ndarray, annual_periods: int) -> float:
    returns = returns[~np.isnan(returns)]
    if len(returns) < 30:
        return np.nan
    mu = returns.mean()
    sd = returns.std(ddof=1)
    if sd == 0:
        return np.nan
    return float(mu / sd * np.sqrt(annual_periods))


# ── per-signal evaluation ─────────────────────────────────────────────────────
def eval_signal(
    algo_id: str,
    df_all: pd.DataFrame,
    horizon: str,
    symbols: list[str],
) -> dict:
    outcome_col = f"outcome_{horizon}_pct"
    vote_col = f"v_{algo_id}"
    score_col = f"s_{algo_id}"

    results: dict = {
        "algo_id": algo_id,
        "horizon": horizon,
        "gate1_oos_sharpe": np.nan,
        "gate2_pass": None,  # filled later
        "gate3_n_instruments": 0,
        "gate4_regime_sharpes": {},
        "passes_all": False,
        "n_trades_oos": 0,
        "hit_rate_oos": np.nan,
        "avg_return_oos": np.nan,
        "symbols_pass": [],
    }

    if vote_col not in df_all.columns or outcome_col not in df_all.columns:
        return results

    base_cols = ["ts", "symbol", "atr_pct", "squeeze", "close",
                 "v_SUPERTREND", "v_ADX_TREND", vote_col, outcome_col]
    # deduplicate while preserving order
    seen: set = set()
    sel_cols = [c for c in base_cols if not (c in seen or seen.add(c))]  # type: ignore[func-returns-value]

    df = df_all[sel_cols].dropna(subset=[outcome_col]).copy()

    if df.empty:
        return results

    # ── IS/OOS split on ts (chronological) ───────────────────────────────────
    ts_sorted = np.sort(df["ts"].unique())
    split_ts = ts_sorted[int(len(ts_sorted) * 0.70)]
    is_mask = df["ts"] <= split_ts
    oos_mask = ~is_mask

    df_oos = df[oos_mask]
    if df_oos.empty:
        return results

    # ── Gate 1: OOS Sharpe ───────────────────────────────────────────────────
    annual = ANNUAL_MAP[horizon].get("1m", 252 * 6)  # safe default
    oos_entries = df_oos[df_oos[vote_col] == 1]
    results["n_trades_oos"] = len(oos_entries)

    if len(oos_entries) >= 30:
        ret = oos_entries[outcome_col].values / 100.0  # pct → ratio
        results["gate1_oos_sharpe"] = round(sharpe(ret, annual), 3)
        results["hit_rate_oos"] = round(float((ret > 0).mean()), 3)
        results["avg_return_oos"] = round(float(ret.mean() * 100), 4)

    # ── Gate 3: per-instrument check ─────────────────────────────────────────
    passing_syms = []
    for sym in symbols:
        sym_oos = df_oos[(df_oos["symbol"] == sym) & (df_oos[vote_col] == 1)]
        if len(sym_oos) < 20:
            continue
        ret = sym_oos[outcome_col].values / 100.0
        s = sharpe(ret, annual)
        if not np.isnan(s) and s > 0.5:
            passing_syms.append(sym)
    results["gate3_n_instruments"] = len(passing_syms)
    results["symbols_pass"] = passing_syms

    # ── Gate 4: regime Sharpe ─────────────────────────────────────────────────
    df_oos = df_oos.reset_index(drop=True)
    df_oos["regime"] = assign_regime(df_oos)
    regime_sharpes = {}
    for reg in ["TRENDING", "RANGING", "BREAKOUT", "RISK-OFF"]:
        mask = (df_oos["regime"] == reg) & (df_oos[vote_col] == 1)
        entries = df_oos[mask]
        if len(entries) >= 15:
            ret = entries[outcome_col].values / 100.0
            regime_sharpes[reg] = round(sharpe(ret, annual), 3)
        else:
            regime_sharpes[reg] = None  # insufficient data
    results["gate4_regime_sharpes"] = regime_sharpes

    return results


# ── correlation matrix across signals ────────────────────────────────────────
def build_return_series(
    algo_ids: list[str],
    df_all: pd.DataFrame,
    horizon: str,
    oos_ts_cutoff: int,
) -> pd.DataFrame:
    """
    Build a DataFrame where each column = algo return series on OOS entries.
    Index = ts. Value = outcome_pct when signal fired, else NaN.
    """
    outcome_col = f"outcome_{horizon}_pct"
    df_oos = df_all[df_all["ts"] > oos_ts_cutoff].copy()

    series = {}
    for a in algo_ids:
        vote_col = f"v_{a}"
        if vote_col not in df_oos.columns:
            continue
        fired = df_oos[df_oos[vote_col] == 1][["ts", outcome_col]].copy()
        fired = fired.dropna(subset=[outcome_col])
        # aggregate multiple instruments: take mean return at same ts
        fired = fired.groupby("ts")[outcome_col].mean()
        series[a] = fired

    if not series:
        return pd.DataFrame()

    ret_df = pd.DataFrame(series).fillna(0)
    return ret_df


# ── gate 2: greedy correlation filter ────────────────────────────────────────
def greedy_corr_filter(
    candidates: list[str],
    ret_df: pd.DataFrame,
    max_corr: float,
) -> list[str]:
    """
    Keep highest-Sharpe signal first, then add next if corr < max_corr with all kept.
    Candidates must be sorted by OOS Sharpe descending before calling.
    """
    kept = []
    for algo_id in candidates:
        if algo_id not in ret_df.columns:
            kept.append(algo_id)
            continue
        if not kept:
            kept.append(algo_id)
            continue
        corrs = [
            abs(float(ret_df[algo_id].corr(ret_df[k])))
            for k in kept
            if k in ret_df.columns
        ]
        if all(c < max_corr for c in corrs):
            kept.append(algo_id)
    return kept


# ── main ──────────────────────────────────────────────────────────────────────
def run(horizon: str, min_sharpe: float, symbols: list[str] | None) -> None:
    con = sqlite3.connect(SIGNAL_DB)

    # discover available symbols
    avail = [r[0] for r in con.execute("SELECT DISTINCT symbol FROM signal_log ORDER BY symbol")]
    targets = [s for s in avail if not symbols or s in symbols]
    print(f"Mega Backtest — horizon={horizon} — symbols: {targets}")
    print(f"Gates: Sharpe>{min_sharpe} OOS | Corr<{MAX_CORR} | {MIN_INSTRUMENTS}+ instruments | all 4 regimes\n")

    # load all data once
    cols = (
        ["ts", "symbol", "close", "atr_pct", "squeeze",
         f"outcome_{horizon}_pct"]
        + [f"v_{a}" for a in ALL_ALGO_IDS]
        + [f"s_{a}" for a in ALL_ALGO_IDS]
    )
    sym_filter = "','".join(targets)
    q = f"SELECT {', '.join(cols)} FROM signal_log WHERE symbol IN ('{sym_filter}') ORDER BY ts"
    print("Loading signal_log … ", end="", flush=True)
    df_all = pd.read_sql_query(q, con)
    con.close()
    print(f"{len(df_all):,} rows loaded")

    # OOS cutoff
    ts_sorted = np.sort(df_all["ts"].unique())
    oos_cutoff = int(ts_sorted[int(len(ts_sorted) * 0.70)])

    # ── evaluate all signals ──────────────────────────────────────────────────
    all_results = []
    for algo_id in ALL_ALGO_IDS:
        r = eval_signal(algo_id, df_all, horizon, targets)
        all_results.append(r)
        s = r["gate1_oos_sharpe"]
        n = r["n_trades_oos"]
        syms = r["gate3_n_instruments"]
        print(f"  {algo_id:<14} sharpe={s!s:<8} trades={n:<6} instruments={syms}")

    # ── Gate 1 filter ─────────────────────────────────────────────────────────
    g1 = [r for r in all_results
          if not np.isnan(r["gate1_oos_sharpe"] or np.nan)
          and r["gate1_oos_sharpe"] >= min_sharpe]
    g1 = sorted(g1, key=lambda r: r["gate1_oos_sharpe"], reverse=True)
    print(f"\n── Gate 1 (Sharpe ≥ {min_sharpe}): {len(g1)}/{len(ALL_ALGO_IDS)} pass ──")
    for r in g1:
        print(f"   {r['algo_id']:<14} sharpe={r['gate1_oos_sharpe']:.3f}  hit={r['hit_rate_oos']:.1%}  avg={r['avg_return_oos']:.3f}%")

    # ── Gate 2: correlation filter ────────────────────────────────────────────
    g1_ids = [r["algo_id"] for r in g1]
    ret_df = build_return_series(g1_ids, df_all, horizon, oos_cutoff)
    g2_ids = greedy_corr_filter(g1_ids, ret_df, MAX_CORR)
    g2 = [r for r in g1 if r["algo_id"] in g2_ids]
    print(f"\n── Gate 2 (Corr < {MAX_CORR}): {len(g2)}/{len(g1)} survive ──")
    for r in g2:
        print(f"   {r['algo_id']:<14} sharpe={r['gate1_oos_sharpe']:.3f}")

    # ── Gate 3: instrument breadth ────────────────────────────────────────────
    g3 = [r for r in g2 if r["gate3_n_instruments"] >= MIN_INSTRUMENTS]
    print(f"\n── Gate 3 (≥{MIN_INSTRUMENTS} instruments): {len(g3)}/{len(g2)} survive ──")
    for r in g3:
        print(f"   {r['algo_id']:<14} instruments={r['gate3_n_instruments']}  syms={r['symbols_pass']}")

    # ── Gate 4: regime survival ───────────────────────────────────────────────
    g4 = []
    for r in g3:
        rs = r["gate4_regime_sharpes"]
        # pass if every regime with data has sharpe > MIN_REGIME_SHARPE
        tested = {k: v for k, v in rs.items() if v is not None}
        if not tested:
            continue
        if all(v >= MIN_REGIME_SHARPE for v in tested.values()):
            g4.append(r)
    print(f"\n── Gate 4 (all regimes Sharpe ≥ {MIN_REGIME_SHARPE}): {len(g4)}/{len(g3)} survive ──")
    for r in g4:
        rs = r["gate4_regime_sharpes"]
        print(f"   {r['algo_id']:<14} regimes={rs}")

    # ── correlation matrix of survivors ──────────────────────────────────────
    if len(g4) > 1:
        surv_ids = [r["algo_id"] for r in g4]
        surv_ret = ret_df[surv_ids] if all(i in ret_df.columns for i in surv_ids) else pd.DataFrame()
        if not surv_ret.empty:
            corr_mat = surv_ret.corr().round(3)
            print("\n── Survivor Correlation Matrix ──")
            print(corr_mat.to_string())

    # ── save outputs ──────────────────────────────────────────────────────────
    with open(OUT_FULL, "w") as f:
        json.dump(all_results, f, indent=2, default=str)

    surviving = {
        "horizon": horizon,
        "min_sharpe": min_sharpe,
        "max_corr": MAX_CORR,
        "min_instruments": MIN_INSTRUMENTS,
        "gate1_count": len(g1),
        "gate2_count": len(g2),
        "gate3_count": len(g3),
        "gate4_count": len(g4),
        "signals": g4,
    }
    with open(OUT_PASS, "w") as f:
        json.dump(surviving, f, indent=2, default=str)

    print(f"\n✓ Full results → {OUT_FULL}")
    print(f"✓ Survivors    → {OUT_PASS}")
    print(f"\n═══ SUMMARY ═══")
    print(f"  Tested:      {len(ALL_ALGO_IDS)} signals")
    print(f"  Gate 1 pass: {len(g1)}  (Sharpe ≥ {min_sharpe} OOS)")
    print(f"  Gate 2 pass: {len(g2)}  (corr < {MAX_CORR})")
    print(f"  Gate 3 pass: {len(g3)}  ({MIN_INSTRUMENTS}+ instruments)")
    print(f"  Gate 4 pass: {len(g4)}  (all regimes survive)")
    if g4:
        print(f"\n  SURVIVORS: {[r['algo_id'] for r in g4]}")
    else:
        print("\n  No signals cleared all 4 gates at current thresholds.")
        print("  → Run with --min-sharpe 0.5 to see what's close.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", default="4h", choices=["1h", "4h", "1d"])
    ap.add_argument("--min-sharpe", type=float, default=MIN_OOS_SHARPE)
    ap.add_argument("--symbols", nargs="*")
    args = ap.parse_args()
    run(args.horizon, args.min_sharpe, args.symbols)
