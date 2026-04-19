"""
ds_app/pca_signals.py — PCA on 23-signal return matrix

Answers: are the 23 survivors truly independent dimensions,
or do they collapse to 5 (or 3)?

Method:
  1. Load OOS data (30% split) from signal_log.db
  2. Build return matrix: shape (n_bars, 23_signals)
     cell = outcome_4h_pct × v_signal  (0 when signal not firing)
  3. StandardScaler → PCA
  4. Report: variance explained per component, n_components at 80/90/95%,
     top-loading signals per component, effective dimensionality
  5. Build correlation matrix for signal pairs

Output: ds/data/pca_report.json
"""
from __future__ import annotations

import json
import logging
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

log = logging.getLogger("pca_signals")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

from ds_app.algos_crypto import ALL_ALGO_IDS  # noqa: E402

SIGNAL_DB = _DS_ROOT / "data" / "signal_log.db"
OUT       = _DS_ROOT / "data" / "pca_report.json"

KILLED    = {"NEW_HIGH", "RANGE_BO", "CONSOL_BO", "ROC_MOM"}
SURVIVORS = [a for a in ALL_ALGO_IDS if a not in KILLED]


def _oos_ts(conn: sqlite3.Connection, tf: str = "5m", train_frac: float = 0.70) -> int:
    rows = conn.execute(
        "SELECT COUNT(*) FROM signal_log WHERE timeframe=?", (tf,)
    ).fetchone()[0]
    offset = int(rows * train_frac)
    ts = conn.execute(
        "SELECT ts FROM signal_log WHERE timeframe=? ORDER BY ts LIMIT 1 OFFSET ?",
        (tf, offset),
    ).fetchone()
    return ts[0] if ts else 0


def build_return_matrix(conn: sqlite3.Connection, oos_ts: int) -> pd.DataFrame:
    """
    Returns DataFrame shape (n_bars, 23) where cell = outcome_4h_pct * v_signal.
    Bars where all signals are 0 are dropped.
    """
    vote_cols = [f"v_{s}" for s in SURVIVORS]
    sel = ", ".join(["ts", "symbol", "outcome_4h_pct"] + vote_cols)
    df = pd.read_sql_query(
        f"SELECT {sel} FROM signal_log WHERE timeframe='5m' AND ts>={oos_ts}"
        f" AND outcome_4h_pct IS NOT NULL",
        conn,
    )
    if df.empty:
        raise ValueError("No OOS data")

    log.info("Loaded %d OOS bars", len(df))

    # For PCA: return contribution = ret * vote (0 when signal off)
    ret = df["outcome_4h_pct"].values
    mat = pd.DataFrame(index=df.index, dtype=float)
    for s in SURVIVORS:
        v = df[f"v_{s}"].fillna(0).values.astype(float)
        mat[s] = ret * v

    # Drop rows where every signal is 0 (no signal fired at all)
    active = mat.abs().sum(axis=1) > 0
    mat = mat[active]
    log.info("Active-signal rows: %d  (%.1f%%)", len(mat), 100 * len(mat) / len(df))
    return mat


def run_pca(mat: pd.DataFrame) -> dict:
    X = StandardScaler().fit_transform(mat.values)
    n_components = min(len(SURVIVORS), X.shape[0], X.shape[1])
    pca = PCA(n_components=n_components, random_state=42)
    pca.fit(X)

    var_explained   = pca.explained_variance_ratio_.tolist()
    cumvar          = np.cumsum(var_explained).tolist()
    n_80  = int(np.searchsorted(cumvar, 0.80)) + 1
    n_90  = int(np.searchsorted(cumvar, 0.90)) + 1
    n_95  = int(np.searchsorted(cumvar, 0.95)) + 1
    n_99  = int(np.searchsorted(cumvar, 0.99)) + 1

    # Top signals per component (by abs loading)
    components = []
    for i, comp in enumerate(pca.components_):
        top_idx = np.argsort(np.abs(comp))[::-1][:5]
        components.append({
            "pc": i + 1,
            "var_pct": round(var_explained[i] * 100, 2),
            "cum_var_pct": round(cumvar[i] * 100, 2),
            "top_signals": [
                {"signal": SURVIVORS[j], "loading": round(float(comp[j]), 4)}
                for j in top_idx
            ],
        })

    return {
        "n_signals": len(SURVIVORS),
        "n_bars": len(mat),
        "effective_dims": {
            "at_80pct": n_80,
            "at_90pct": n_90,
            "at_95pct": n_95,
            "at_99pct": n_99,
        },
        "interpretation": _interpret(n_80, n_90),
        "variance_per_component": [round(v * 100, 2) for v in var_explained],
        "cumulative_variance":    [round(v * 100, 2) for v in cumvar],
        "components": components[:10],
    }


def _interpret(n80: int, n90: int) -> str:
    if n80 <= 3:
        return f"HIGHLY REDUNDANT — {n80} components explain 80%. Signals cluster tightly. Prune aggressively."
    if n80 <= 6:
        return f"MODERATE OVERLAP — {n80} components at 80%. Some redundancy but real breadth exists."
    if n80 <= 12:
        return f"MOSTLY INDEPENDENT — {n80} components at 80%. Signals cover genuine dimensions. Good ensemble."
    return f"NEAR ORTHOGONAL — {n80} components at 80%. All {len(SURVIVORS)} signals add unique dimensions."


def build_corr_matrix(mat: pd.DataFrame) -> dict:
    """
    Pairwise correlation of signal return contributions.
    High corr = signals fire together AND produce same return direction.
    """
    corr = mat.corr().round(3)
    # Find top correlated pairs (excl self)
    pairs = []
    n = len(SURVIVORS)
    for i in range(n):
        for j in range(i + 1, n):
            c = float(corr.iloc[i, j])
            if abs(c) > 0.30:
                pairs.append({
                    "a": SURVIVORS[i], "b": SURVIVORS[j],
                    "corr": round(c, 3),
                    "flag": "HIGH" if abs(c) > 0.60 else "MOD",
                })
    pairs.sort(key=lambda x: abs(x["corr"]), reverse=True)

    return {
        "high_corr_pairs": [p for p in pairs if p["flag"] == "HIGH"],
        "mod_corr_pairs":  [p for p in pairs if p["flag"] == "MOD"],
        "matrix_signals":  SURVIVORS,
        "matrix_values":   [[round(corr.iloc[i, j], 3) for j in range(n)] for i in range(n)],
    }


def per_signal_stats(mat: pd.DataFrame) -> list[dict]:
    """Mean return, std, fire-rate, Sharpe per signal (when signal fires)."""
    out = []
    for s in SURVIVORS:
        fired = mat[s][mat[s] != 0]
        n = len(fired)
        if n < 20:
            out.append({"signal": s, "n_fired": n, "sharpe": None, "mean_ret": None, "fire_rate": 0.0})
            continue
        mean = float(fired.mean())
        std  = float(fired.std(ddof=1))
        sharpe = round(mean / std * np.sqrt(252 * 288), 3) if std > 0 else None
        out.append({
            "signal":    s,
            "n_fired":   n,
            "fire_rate": round(n / len(mat), 4),
            "mean_ret":  round(mean * 100, 4),
            "std_ret":   round(std * 100, 4),
            "sharpe":    sharpe,
        })
    out.sort(key=lambda x: (x["sharpe"] or -999), reverse=True)
    return out


def run() -> dict:
    if not SIGNAL_DB.exists():
        return {"error": f"signal_log.db not found: {SIGNAL_DB}"}

    conn     = sqlite3.connect(SIGNAL_DB)
    oos_ts   = _oos_ts(conn)
    log.info("OOS start ts: %d", oos_ts)

    mat      = build_return_matrix(conn, oos_ts)
    pca_res  = run_pca(mat)
    corr_res = build_corr_matrix(mat)
    stats    = per_signal_stats(mat)
    conn.close()

    report = {
        "pca": pca_res,
        "correlation": corr_res,
        "per_signal": stats,
        "survivors": SURVIVORS,
        "killed":    list(KILLED),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2))
    log.info("pca_report.json written → %s", OUT)

    # Print summary
    e = pca_res["effective_dims"]
    log.info(
        "EFFECTIVE DIMS: 80%%=%d  90%%=%d  95%%=%d  of %d signals",
        e["at_80pct"], e["at_90pct"], e["at_95pct"], pca_res["n_signals"],
    )
    log.info("INTERPRETATION: %s", pca_res["interpretation"])
    if corr_res["high_corr_pairs"]:
        log.info("HIGH-CORR PAIRS: %s", corr_res["high_corr_pairs"])

    return report


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="Print full JSON output")
    args = ap.parse_args()
    r = run()
    if args.json:
        print(json.dumps(r, indent=2))
