"""
ds_app/correlate.py — Phase 3: Signal Correlation Analysis

Reads signal_log.db OOS return series.
Computes full Pearson correlation matrix.
Clusters signals at corr > 0.6, keeps best Sharpe per cluster.
Outputs:
  ds/data/correlation_matrix.csv
  ds/data/signal_clusters.json   { cluster_id: [algo_ids], winner: algo_id }
  prints ranked signal table

Usage:
  python ds_app/correlate.py
  python ds_app/correlate.py --horizon 4h --threshold 0.6
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
OUT_CORR = _DS_ROOT / "data" / "correlation_matrix.csv"
OUT_CLUST = _DS_ROOT / "data" / "signal_clusters.json"

ANNUAL_MAP = {"1h": 252 * 24, "4h": 252 * 6, "1d": 252}


def sharpe(returns: np.ndarray, annual: int) -> float:
    r = returns[~np.isnan(returns)]
    if len(r) < 20:
        return np.nan
    sd = r.std(ddof=1)
    if sd == 0:
        return np.nan
    return float(r.mean() / sd * np.sqrt(annual))


def load_oos_returns(con: sqlite3.Connection, horizon: str, symbols: list[str]) -> pd.DataFrame:
    """
    For each algo, build a ts-indexed return series: outcome when vote=+1, else NaN.
    OOS = last 30% by ts.
    Returns DataFrame: index=ts, columns=algo_ids.
    """
    outcome_col = f"outcome_{horizon}_pct"
    sym_str = "','".join(symbols)

    vote_cols = [f"v_{a}" for a in ALL_ALGO_IDS]
    sel = ["ts", outcome_col] + vote_cols
    q = f"SELECT {', '.join(sel)} FROM signal_log WHERE symbol IN ('{sym_str}') ORDER BY ts"

    print("Loading … ", end="", flush=True)
    df = pd.read_sql_query(q, con)
    print(f"{len(df):,} rows")

    # OOS cutoff: top 30% by ts
    ts_sorted = np.sort(df["ts"].unique())
    cutoff = int(ts_sorted[int(len(ts_sorted) * 0.70)])
    df = df[df["ts"] > cutoff].copy()
    print(f"OOS: {len(df):,} rows (ts > {cutoff})")

    # build return series per algo: mean return across instruments at each ts when signal fires
    series: dict[str, pd.Series] = {}
    for a in ALL_ALGO_IDS:
        vcol = f"v_{a}"
        fired = df[df[vcol] == 1][["ts", outcome_col]].copy()
        fired = fired.dropna(subset=[outcome_col])
        fired = fired.groupby("ts")[outcome_col].mean()
        series[a] = fired

    ret_df = pd.DataFrame(series)
    ret_df.index.name = "ts"
    return ret_df


def cluster_signals(corr_mat: pd.DataFrame, threshold: float) -> list[dict]:
    """
    Single-linkage clustering: if any pair in a group has abs(corr) > threshold,
    they're in the same cluster. Returns list of {members: [...], linked_pairs: [...]}.
    """
    ids = list(corr_mat.columns)
    n = len(ids)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(n):
        for j in range(i + 1, n):
            if abs(corr_mat.iloc[i, j]) >= threshold:
                union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(n):
        root = find(i)
        clusters.setdefault(root, []).append(i)

    return [{"members": [ids[i] for i in group]} for group in clusters.values()]


def run(horizon: str, threshold: float, symbols: list[str] | None) -> None:
    con = sqlite3.connect(SIGNAL_DB)
    avail = [r[0] for r in con.execute("SELECT DISTINCT symbol FROM signal_log ORDER BY symbol")]
    targets = [s for s in avail if not symbols or s in symbols]
    print(f"Correlate — horizon={horizon} threshold={threshold} — {targets}\n")

    annual = ANNUAL_MAP[horizon]
    ret_df = load_oos_returns(con, horizon, targets)
    con.close()

    # ── Sharpe per signal ─────────────────────────────────────────────────────
    sharpes: dict[str, float] = {}
    trade_counts: dict[str, int] = {}
    for a in ALL_ALGO_IDS:
        if a not in ret_df.columns:
            continue
        r = ret_df[a].dropna().values / 100.0
        sharpes[a] = round(sharpe(r, annual), 3)
        trade_counts[a] = len(r)

    # ── Correlation matrix ────────────────────────────────────────────────────
    # fill NaN with 0 for correlation (no signal = 0 return assumption)
    filled = ret_df.fillna(0)
    corr_mat = filled.corr(method="pearson").round(4)
    corr_mat.to_csv(OUT_CORR)
    print(f"Correlation matrix saved → {OUT_CORR}\n")

    # ── Cluster ───────────────────────────────────────────────────────────────
    clusters = cluster_signals(corr_mat, threshold)
    clusters_out = []
    kept_ids = []

    for i, cl in enumerate(clusters):
        members = cl["members"]
        # rank members by sharpe descending
        ranked = sorted(members, key=lambda a: sharpes.get(a, -999), reverse=True)
        winner = ranked[0]
        kept_ids.append(winner)
        clusters_out.append({
            "cluster_id": i,
            "size": len(members),
            "members": members,
            "member_sharpes": {a: sharpes.get(a) for a in members},
            "winner": winner,
            "winner_sharpe": sharpes.get(winner),
        })

    clusters_out.sort(key=lambda c: c["winner_sharpe"] or -999, reverse=True)
    with open(OUT_CLUST, "w") as f:
        json.dump(clusters_out, f, indent=2)

    # ── Print ranked table ────────────────────────────────────────────────────
    print(f"{'RANK':<5} {'ALGO':<16} {'SHARPE':<10} {'TRADES':<10} {'CLUSTER_SIZE':<14} {'STATUS'}")
    print("─" * 72)
    rank = 0
    for cl in clusters_out:
        winner = cl["winner"]
        rank += 1
        for a in cl["members"]:
            is_winner = a == winner
            status = "KEEP ←" if is_winner else "KILLED (corr)"
            s = sharpes.get(a, np.nan)
            t = trade_counts.get(a, 0)
            sz = cl["size"] if is_winner else ""
            r_str = str(rank) if is_winner else ""
            print(f"{r_str:<5} {a:<16} {str(s):<10} {t:<10} {str(sz):<14} {status}")

    print(f"\n── KEPT (one winner per cluster): {len(kept_ids)} signals ──")
    for kid in kept_ids:
        s = sharpes.get(kid, np.nan)
        t = trade_counts.get(kid, 0)
        print(f"  {kid:<16} sharpe={s:.3f}  trades={t:,}")

    # ── High-corr pairs ───────────────────────────────────────────────────────
    print(f"\n── High-Corr Pairs (abs ≥ {threshold}) ──")
    ids = list(corr_mat.columns)
    pairs = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            c = corr_mat.iloc[i, j]
            if abs(c) >= threshold:
                pairs.append((ids[i], ids[j], round(float(c), 3)))
    pairs.sort(key=lambda x: abs(x[2]), reverse=True)
    for a, b, c in pairs[:20]:
        print(f"  {a:<16} ↔ {b:<16}  corr={c:+.3f}")

    print(f"\n✓ Clusters → {OUT_CLUST}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", default="4h", choices=["1h", "4h", "1d"])
    ap.add_argument("--threshold", type=float, default=0.6)
    ap.add_argument("--symbols", nargs="*")
    args = ap.parse_args()
    run(args.horizon, args.threshold, args.symbols)
