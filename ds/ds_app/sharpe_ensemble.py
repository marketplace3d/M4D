"""
ds_app/sharpe_ensemble.py — Sharpe-weighted ensemble vs equal-weight baseline

Replaces equal-weight vote counting with regime-specific Sharpe-proportional weights.

Method:
  1. Load OOS data from signal_log.db
  2. Apply regime labeling (same logic as star_optimizer.regime_entry_mask)
  3. Per bar, compute:
     equal_score    = count(v_i = 1 for signals in regime routing)
     weighted_score = Σ(sharpe_i × v_i) / Σ(sharpe_i) for signals in routing
  4. Sweep entry thresholds for both modes
  5. Output best threshold per mode, Sharpe comparison, equity curves

Output: ds/data/ensemble_report.json
"""
from __future__ import annotations

import json
import logging
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("sharpe_ensemble")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

from ds_app.algos_crypto import ALL_ALGO_IDS  # noqa: E402

SIGNAL_DB  = _DS_ROOT / "data" / "signal_log.db"
REGIME_MAP = _DS_ROOT / "data" / "regime_signal_map.json"
OUT        = _DS_ROOT / "data" / "ensemble_report.json"

KILLED    = {"NEW_HIGH", "RANGE_BO", "CONSOL_BO", "ROC_MOM"}
SURVIVORS = [a for a in ALL_ALGO_IDS if a not in KILLED]
ANNUAL    = 252 * 288   # 5m bars

KILL_HOURS = {20, 22, 23}
KILL_DAYS  = {3, 5, 6}   # Thu=3, Sat=5, Sun=6


# ── helpers ────────────────────────────────────────────────────────────────────
def sharpe(r: np.ndarray, annual: int = ANNUAL, min_n: int = 30) -> float | None:
    r = r[~np.isnan(r)]
    if len(r) < min_n:
        return None
    sd = r.std(ddof=1)
    if sd == 0:
        return None
    return round(float(r.mean() / sd * np.sqrt(annual)), 3)


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


# ── regime labeling ───────────────────────────────────────────────────────────
def assign_regimes(df: pd.DataFrame) -> pd.Series:
    n     = len(df)
    close = df["close"].values
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

    alpha  = 2.0 / 201.0
    ema200 = np.zeros(n)
    ema200[0] = close[0]
    for i in range(1, n):
        ema200[i] = alpha * close[i] + (1 - alpha) * ema200[i - 1]
    trending = (close > ema200) & (sup == 1) & (adx == 1)

    regime = np.full(n, "RANGING", dtype=object)
    regime[trending] = "TRENDING"
    regime[breakout] = "BREAKOUT"
    regime[risk_off] = "RISK-OFF"
    return pd.Series(regime, index=df.index)


# ── load regime routing weights ───────────────────────────────────────────────
def load_routing(path: Path) -> dict[str, list[dict]]:
    """Returns {regime: [{algo_id, sharpe, ...}, ...]}"""
    return json.loads(path.read_text())


def routing_weights(routing: dict[str, list[dict]]) -> dict[str, dict[str, float]]:
    """
    Returns {regime: {signal: normalized_sharpe_weight}}.
    Weights sum to 1 per regime.
    """
    weights: dict[str, dict[str, float]] = {}
    for regime, rows in routing.items():
        survivors = [r for r in rows if r["algo_id"] not in KILLED and (r["sharpe"] or 0) > 0]
        if not survivors:
            continue
        total = sum(r["sharpe"] for r in survivors)
        weights[regime] = {r["algo_id"]: round(r["sharpe"] / total, 6) for r in survivors}
    return weights


# ── score computation ─────────────────────────────────────────────────────────
def compute_scores(df: pd.DataFrame, regimes: pd.Series, weights: dict[str, dict[str, float]]) -> pd.DataFrame:
    """
    Returns df with columns:
      equal_score    — count of routing signals that fired (current system)
      weighted_score — Σ(w_i × v_i) for signals in regime routing
      n_routing      — how many routing signals exist for this regime
    """
    eq   = np.zeros(len(df))
    wt   = np.zeros(len(df))
    n_rt = np.zeros(len(df), dtype=int)

    for i, (idx, row) in enumerate(df.iterrows()):
        reg = regimes.iloc[i]
        wmap = weights.get(reg, {})
        n_rt[i] = len(wmap)
        for sig, w in wmap.items():
            v = float(row.get(f"v_{sig}", 0) or 0)
            eq[i]  += v
            wt[i]  += w * v

    out = df[["ts", "outcome_4h_pct", "outcome_1h_pct"]].copy()
    out["regime"]         = regimes.values
    out["equal_score"]    = eq
    out["weighted_score"] = wt
    out["n_routing"]      = n_rt
    return out


# ── time-of-day kill filter ───────────────────────────────────────────────────
def apply_time_kills(scores: pd.DataFrame) -> pd.Series:
    dt  = pd.to_datetime(scores["ts"], unit="s", utc=True)
    ok  = ~dt.dt.hour.isin(KILL_HOURS) & ~dt.dt.dayofweek.isin(KILL_DAYS)
    return ok


# ── threshold sweep ───────────────────────────────────────────────────────────
def sweep_threshold(
    scores: pd.DataFrame,
    time_ok: pd.Series,
    score_col: str,
    thresholds: list[float],
    outcome_col: str = "outcome_4h_pct",
) -> list[dict]:
    results = []
    for thr in thresholds:
        mask = time_ok & (scores[score_col] >= thr) & scores[outcome_col].notna()
        ret  = scores.loc[mask, outcome_col].values
        s    = sharpe(ret)
        results.append({
            "threshold": round(thr, 4),
            "sharpe":    s,
            "n_trades":  int(len(ret)),
            "win_rate":  round(float((ret > 0).mean()), 3) if len(ret) > 0 else None,
        })
    return sorted(results, key=lambda x: (x["sharpe"] or -999), reverse=True)


# ── equity curve (resampled daily, equal-weight) ──────────────────────────────
def equity_curve(returns: np.ndarray, n_points: int = 200) -> list[float]:
    if len(returns) == 0:
        return []
    eq = np.cumprod(1 + returns)
    # downsample
    idx = np.linspace(0, len(eq) - 1, min(n_points, len(eq))).astype(int)
    return [round(float(eq[i]), 6) for i in idx]


# ── regime breakdown ──────────────────────────────────────────────────────────
def regime_breakdown(
    scores: pd.DataFrame,
    time_ok: pd.Series,
    weights: dict[str, dict[str, float]],
    mode: str,
    best_thr: float,
) -> list[dict]:
    out = []
    score_col = "weighted_score" if mode == "weighted" else "equal_score"
    for reg in ["RANGING", "BREAKOUT", "RISK-OFF", "TRENDING"]:
        reg_ok = time_ok & (scores["regime"] == reg) & (scores[score_col] >= best_thr) & scores["outcome_4h_pct"].notna()
        ret = scores.loc[reg_ok, "outcome_4h_pct"].values
        s = sharpe(ret)
        wmap = weights.get(reg, {})
        out.append({
            "regime":   reg,
            "sharpe":   s,
            "n_trades": len(ret),
            "top_signals": sorted(wmap.items(), key=lambda x: x[1], reverse=True)[:3],
        })
    return out


# ── main ──────────────────────────────────────────────────────────────────────
def run() -> dict:
    if not SIGNAL_DB.exists():
        return {"error": f"signal_log.db not found: {SIGNAL_DB}"}
    if not REGIME_MAP.exists():
        return {"error": f"regime_signal_map.json not found — run regime.py first"}

    conn   = sqlite3.connect(SIGNAL_DB)
    oos_ts = _oos_ts(conn)

    vote_cols = [f"v_{s}" for s in SURVIVORS]
    sel = ", ".join(
        ["ts", "symbol", "close", "atr_pct", "squeeze",
         "outcome_4h_pct", "outcome_1h_pct"]
        + vote_cols
    )
    df = pd.read_sql_query(
        f"SELECT {sel} FROM signal_log WHERE timeframe='5m' AND ts>={oos_ts}"
        f" AND outcome_4h_pct IS NOT NULL ORDER BY symbol, ts",
        conn,
    )
    conn.close()
    log.info("OOS rows loaded: %d", len(df))

    routing = load_routing(REGIME_MAP)
    weights = routing_weights(routing)
    log.info("Routing weights loaded for %d regimes", len(weights))

    # Process per-symbol to keep regime labeling coherent
    parts = []
    for sym, g in df.groupby("symbol"):
        g = g.sort_values("ts").reset_index(drop=True)
        reg = assign_regimes(g)
        sc  = compute_scores(g, reg, weights)
        parts.append(sc)
    scores = pd.concat(parts, ignore_index=True)
    log.info("Scores computed: %d rows", len(scores))

    time_ok = apply_time_kills(scores)

    # Equal-weight sweep (min 1 routing signal → threshold=0.99 ≈ ≥1)
    eq_thresholds = [1.0, 2.0, 3.0, 0.5]
    wt_thresholds = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]

    eq_sweep = sweep_threshold(scores, time_ok, "equal_score",    eq_thresholds)
    wt_sweep = sweep_threshold(scores, time_ok, "weighted_score", wt_thresholds)

    best_eq = eq_sweep[0]
    best_wt = wt_sweep[0]

    # Per-regime breakdown
    reg_breakdown_eq = regime_breakdown(scores, time_ok, weights, "equal",    best_eq["threshold"])
    reg_breakdown_wt = regime_breakdown(scores, time_ok, weights, "weighted", best_wt["threshold"])

    # Equity curves at best thresholds
    mask_eq = time_ok & (scores["equal_score"]    >= best_eq["threshold"]) & scores["outcome_4h_pct"].notna()
    mask_wt = time_ok & (scores["weighted_score"] >= best_wt["threshold"]) & scores["outcome_4h_pct"].notna()
    curve_eq = equity_curve(scores.loc[mask_eq, "outcome_4h_pct"].values)
    curve_wt = equity_curve(scores.loc[mask_wt, "outcome_4h_pct"].values)

    # Improvement
    s_eq = best_eq["sharpe"] or 0
    s_wt = best_wt["sharpe"] or 0
    delta = round(s_wt - s_eq, 3)

    # Per-regime weights table for display
    regime_weights_table = []
    for reg, wmap in weights.items():
        regime_weights_table.append({
            "regime": reg,
            "signals": sorted(
                [{"signal": s, "weight": round(w * 100, 1)} for s, w in wmap.items()],
                key=lambda x: x["weight"], reverse=True,
            )[:8],
        })

    report = {
        "equal_weight": {
            "best_threshold":  best_eq["threshold"],
            "best_sharpe":     best_eq["sharpe"],
            "n_trades":        best_eq["n_trades"],
            "win_rate":        best_eq["win_rate"],
            "threshold_sweep": eq_sweep,
            "regime_breakdown": reg_breakdown_eq,
            "equity_curve":    curve_eq,
        },
        "sharpe_weighted": {
            "best_threshold":  best_wt["threshold"],
            "best_sharpe":     best_wt["sharpe"],
            "n_trades":        best_wt["n_trades"],
            "win_rate":        best_wt["win_rate"],
            "threshold_sweep": wt_sweep,
            "regime_breakdown": reg_breakdown_wt,
            "equity_curve":    curve_wt,
        },
        "improvement": {
            "delta_sharpe":     delta,
            "verdict": "WEIGHTED WINS" if delta > 0.05 else ("TIE" if abs(delta) <= 0.05 else "EQUAL WINS"),
            "pct_change":       round(delta / abs(s_eq) * 100, 1) if s_eq != 0 else None,
        },
        "regime_weights": regime_weights_table,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2))
    log.info("ensemble_report.json written → %s", OUT)
    log.info(
        "RESULT: equal=%.3f  weighted=%.3f  delta=%+.3f  verdict=%s",
        s_eq, s_wt, delta, report["improvement"]["verdict"],
    )

    return report


SIGNAL_ROUTING = {
    # TRENDING-only — these MUST NOT fire in flat/ranging
    "SUPERTREND":  ["TRENDING"],
    "EMA_CROSS":   ["TRENDING"],
    "EMA_STACK":   ["TRENDING", "BREAKOUT"],
    "MACD_CROSS":  ["TRENDING"],
    "GOLDEN":      ["TRENDING", "BREAKOUT"],
    "TREND_SMA":   ["TRENDING"],
    "PSAR":        ["TRENDING"],
    "ADX_TREND":   ["TRENDING", "BREAKOUT"],
    "PULLBACK":    ["TRENDING"],
    # RANGING-only oscillators
    "RSI_CROSS":   ["RANGING", "RISK-OFF"],
    "RSI_STRONG":  ["RANGING", "RISK-OFF"],
    "STOCH_CROSS": ["RANGING", "RISK-OFF"],
    "MFI_CROSS":   ["RANGING", "RISK-OFF"],
    "CMF_POS":     ["RANGING", "RISK-OFF", "TRENDING"],
    "OBV_TREND":   ["RANGING", "RISK-OFF", "TRENDING", "BREAKOUT"],
    # BREAKOUT signals
    "VOL_BO":      ["BREAKOUT", "TRENDING"],
    "BB_BREAK":    ["BREAKOUT"],
    "KC_BREAK":    ["BREAKOUT"],
    "SQZPOP":      ["BREAKOUT"],
    "ATR_EXP":     ["BREAKOUT", "TRENDING"],
    "DON_BO":      ["BREAKOUT", "TRENDING"],
    "NEW_HIGH":    ["BREAKOUT", "TRENDING"],
    "RANGE_BO":    ["BREAKOUT"],
    "VOL_SURGE":   ["BREAKOUT", "TRENDING"],
    "CONSEC_BULL": ["TRENDING", "BREAKOUT"],
    "ROC_MOM":     ["TRENDING"],
    "CONSOL_BO":   ["BREAKOUT"],
}

# Soft multipliers per signal per regime.
# 1.5 = specialist boost · 1.0 = neutral · 0.3 = soft suppress · 0.05 = near-zero (wrong regime)
# Derived from regime-conditional IC analysis (walkforward.py 41-fold run 2026-04-19).
# NEVER change without re-running walkforward.py to verify delta flips positive.
_R = "RANGING"
_T = "TRENDING"
_B = "BREAKOUT"
_O = "RISK-OFF"

SOFT_REGIME_MULT: dict[str, dict[str, float]] = {
    # TRENDING specialists — boost in T, suppress hard in B (regime IC = 0 in BREAKOUT)
    # Exception: SUPERTREND, TREND_SMA, EMA_STACK confirmed +IC in BREAKOUT regime
    "SUPERTREND":  {_T: 1.5, _B: 1.5, _R: 0.05, _O: 0.05},  # +0.025 BREAKOUT IC ✓
    "EMA_CROSS":   {_T: 1.5, _B: 0.05, _R: 0.05, _O: 0.05},  # TRENDING-only
    "EMA_STACK":   {_T: 1.5, _B: 1.5,  _R: 0.05, _O: 0.20},  # +0.012 BREAKOUT IC ✓
    "MACD_CROSS":  {_T: 1.5, _B: 0.05, _R: 0.05, _O: 0.10},  # TRENDING-only
    "GOLDEN":      {_T: 1.2, _B: 0.05, _R: 0.30, _O: 1.5},   # RISK-OFF specialist
    "TREND_SMA":   {_T: 1.5, _B: 1.5,  _R: 0.05, _O: 0.10},  # +0.012 BREAKOUT IC ✓
    "PSAR":        {_T: 1.5, _B: 0.05, _R: 0.05, _O: 0.10},  # TRENDING-only
    "ADX_TREND":   {_T: 1.5, _B: 0.05, _R: 0.30, _O: 0.30},  # TRENDING-only
    "PULLBACK":    {_T: 1.5, _B: 0.05, _R: 0.10, _O: 0.10},  # TRENDING-only
    # Mean-reversion oscillators — suppress in trending/breakout
    "RSI_CROSS":   {_T: 0.10, _B: 0.10, _R: 1.5, _O: 1.5},
    "RSI_STRONG":  {_T: 0.10, _B: 0.10, _R: 1.5, _O: 1.5},
    "STOCH_CROSS": {_T: 0.10, _B: 0.10, _R: 1.5, _O: 1.5},
    "MFI_CROSS":   {_T: 0.10, _B: 0.10, _R: 1.5, _O: 1.5},
    "CMF_POS":     {_T: 0.80, _B: 0.10, _R: 1.2, _O: 1.2},  # suppress in B
    "OBV_TREND":   {_T: 1.0,  _B: 0.10, _R: 1.0, _O: 1.0},  # suppress in B
    # BREAKOUT specialists — confirmed positive regime IC (walkforward 2026-04-19)
    "VOL_BO":      {_T: 1.2, _B: 1.5, _R: 0.10, _O: 0.10},  # +0.031 ✓
    "BB_BREAK":    {_T: 0.3, _B: 1.5, _R: 0.30, _O: 0.10},  # +0.001 WATCH
    "KC_BREAK":    {_T: 0.3, _B: 1.5, _R: 0.30, _O: 0.10},  # +0.001 WATCH
    "SQZPOP":      {_T: 0.3, _B: 1.5, _R: 0.05, _O: 0.10},  # +0.033 ✓ top BREAKOUT
    "ATR_EXP":     {_T: 1.2, _B: 1.5, _R: 0.20, _O: 0.10},  # +0.001 WATCH
    "DON_BO":      {_T: 1.2, _B: 1.5, _R: 0.10, _O: 0.10},  # +0.016 ✓
    "NEW_HIGH":    {_T: 1.2, _B: 1.5, _R: 0.10, _O: 0.10},  # +0.011 ✓
    "RANGE_BO":    {_T: 0.3, _B: 1.5, _R: 0.30, _O: 0.10},  # +0.023 ✓
    # RISK-OFF specialists — suppress in BREAKOUT
    "VOL_SURGE":   {_T: 1.2, _B: 0.10, _R: 0.10, _O: 0.30},
    "CONSEC_BULL": {_T: 1.2, _B: 0.10, _R: 0.10, _O: 0.10},
    "ROC_MOM":     {_T: 1.5, _B: 0.05, _R: 0.10, _O: 0.30},
    "CONSOL_BO":   {_T: 0.3, _B: 1.5,  _R: 0.10, _O: 0.10},
}

ROUTED_OUT = _DS_ROOT / "data" / "routed_ensemble_report.json"


def _regime_labels_simple(data: dict, n: int) -> np.ndarray:
    """Lightweight regime labeler for numpy arrays (no pandas required)."""
    _REGIME_COLS = {
        "TRENDING": ["v_EMA_STACK", "v_MACD_CROSS", "v_SUPERTREND", "v_ADX_TREND", "v_TREND_SMA"],
        "RANGING":  ["v_RSI_CROSS", "v_RSI_STRONG"],
        "BREAKOUT": ["v_VOL_BO", "v_BB_BREAK", "v_KC_BREAK", "v_SQZPOP", "v_ATR_EXP"],
        "RISK-OFF": ["v_VOL_SURGE"],
    }
    labels = np.full(n, "RANGING", dtype=object)
    for regime, cols in _REGIME_COLS.items():
        available = [c for c in cols if c in data]
        if not available:
            continue
        votes = sum(data[c].astype(float) for c in available) / len(available)
        mask = votes > 0.4
        labels[mask] = regime
    return labels


def build_routed_ensemble() -> dict:
    """
    3-way Sharpe comparison:
      equal_weight    — equal vote count (no routing, no weighting)
      sharpe_weighted — Sharpe weights from regime_signal_map, no regime routing
      routed_weighted — Sharpe weights + regime routing (signals blocked if wrong regime)
    OOS = last 30% by timestamp.
    """
    if not SIGNAL_DB.exists():
        log.error("signal_log.db not found: %s", SIGNAL_DB)
        return {"error": str(SIGNAL_DB)}
    if not REGIME_MAP.exists():
        log.error("regime_signal_map.json not found")
        return {"error": str(REGIME_MAP)}

    conn = sqlite3.connect(SIGNAL_DB)

    # All signal columns available in DB
    all_sigs = [a for a in ALL_ALGO_IDS]
    v_cols = [f"v_{s}" for s in all_sigs]
    avail_vcols = []
    pragma = {r[1] for r in conn.execute("PRAGMA table_info(signal_log)")}
    for vc in v_cols:
        if vc in pragma:
            avail_vcols.append(vc)

    # Load price/vol cols for assign_regimes() (price-based, avoids circular signal-vote regime labels)
    price_cols = ["close", "atr_pct", "squeeze"]
    avail_price = [c for c in price_cols if c in pragma]
    # assign_regimes also uses v_SUPERTREND, v_ADX_TREND, v_ATR_EXP — include if present
    regime_sig_cols = ["v_SUPERTREND", "v_ADX_TREND", "v_ATR_EXP"]
    avail_regime_sigs = [c for c in regime_sig_cols if c in pragma and c not in avail_vcols]

    sel_cols = ["ts", "symbol", "outcome_4h_pct"] + avail_price + avail_regime_sigs + avail_vcols
    # deduplicate while preserving order
    seen = set()
    sel_cols = [c for c in sel_cols if not (c in seen or seen.add(c))]

    rows = conn.execute(
        f"SELECT {', '.join(sel_cols)} FROM signal_log WHERE outcome_4h_pct IS NOT NULL ORDER BY symbol, ts"
    ).fetchall()
    conn.close()

    n_total = len(rows)
    if n_total < 100:
        return {"error": "not enough rows"}

    df_all = pd.DataFrame(rows, columns=sel_cols)
    ts       = df_all["ts"].values
    outcomes = df_all["outcome_4h_pct"].values.astype(float)

    # OOS cutoff: last 30% by timestamp
    oos_cut  = int(np.percentile(ts, 70))
    oos_mask = ts >= oos_cut
    n_oos    = int(oos_mask.sum())
    log.info("OOS bars: %d (%.1f%% of %d total)", n_oos, n_oos / n_total * 100, n_total)

    # Regime per bar — price-based (EMA200 + ATR momentum, not signal-vote circular)
    # Process per-symbol so EMA200 is coherent
    regime_arr = np.full(n_total, "RANGING", dtype=object)
    if "close" in df_all.columns:
        for sym, grp in df_all.groupby("symbol"):
            g = grp.sort_values("ts").reset_index(drop=False)
            reg_s = assign_regimes(g)
            regime_arr[g["index"].values] = reg_s.values
    else:
        # fallback to signal-vote labels if price cols missing
        data_np = {c: df_all[c].values for c in sel_cols if c in df_all}
        regime_arr = _regime_labels_simple(data_np, n_total)
    regimes = regime_arr

    # Rebuild data dict for signal columns (used in loop below)
    data = {c: df_all[c].values for c in sel_cols}

    # Load Sharpe weights from regime_signal_map
    routing = json.loads(REGIME_MAP.read_text())

    # Flat sharpe weight per signal (max across all regimes — regime-blind weighting)
    flat_sharpe: dict[str, float] = {}
    for regime_rows in routing.values():
        for row in regime_rows:
            sig = row["algo_id"]
            sh  = row.get("sharpe") or 0.0
            if sh > 0:
                flat_sharpe[sig] = max(flat_sharpe.get(sig, 0.0), sh)
    fs_total = sum(flat_sharpe.values()) or 1.0
    flat_w = {s: v / fs_total for s, v in flat_sharpe.items()}

    # Per-regime Sharpe weights (for routed branch)
    regime_weights: dict[str, dict[str, float]] = {}
    for regime, regime_rows in routing.items():
        survivors = [r for r in regime_rows if (r.get("sharpe") or 0) > 0]
        if not survivors:
            continue
        total = sum(r["sharpe"] for r in survivors)
        regime_weights[regime] = {r["algo_id"]: r["sharpe"] / total for r in survivors}

    sigs_in_data = [s for s in all_sigs if f"v_{s}" in data]

    # Build OOS scores for all 4 branches
    n_oos_int  = int(n_oos)
    eq_score   = np.zeros(n_oos_int, dtype=float)
    sw_score   = np.zeros(n_oos_int, dtype=float)
    hard_score = np.zeros(n_oos_int, dtype=float)  # binary block (old — kept for comparison)
    soft_score = np.zeros(n_oos_int, dtype=float)  # soft multipliers (P0-A fix)

    oos_regimes = regimes[oos_mask]

    n_blocked = np.zeros(n_oos_int, dtype=int)

    for sig in sigs_in_data:
        vc    = f"v_{sig}"
        v_oos = data[vc][oos_mask].astype(float)
        fw    = flat_w.get(sig, 0.0)

        eq_score += (v_oos == 1).astype(float)
        sw_score += v_oos * fw

        # hard branch: binary block (regime must be in allowed list)
        allowed_regimes = set(SIGNAL_ROUTING.get(sig, []))
        if not allowed_regimes:
            hard_score += v_oos * fw
        else:
            for i, rg in enumerate(oos_regimes):
                if v_oos[i] == 1 and rg not in allowed_regimes:
                    n_blocked[i] += 1
            allowed_mask = np.array([rg in allowed_regimes for rg in oos_regimes])
            hard_score += v_oos * fw * allowed_mask.astype(float)

        # soft branch: per-regime multiplier from SOFT_REGIME_MULT
        mult_map = SOFT_REGIME_MULT.get(sig, {})
        if mult_map:
            soft_mults = np.array([mult_map.get(rg, 1.0) for rg in oos_regimes], dtype=float)
        else:
            soft_mults = np.ones(n_oos_int, dtype=float)
        soft_score += v_oos * fw * soft_mults

    bars_blocked = int((n_blocked > 0).sum())
    bars_routed_pct = round(bars_blocked / n_oos_int * 100, 2)

    oos_outcomes = outcomes[oos_mask]

    def _branch_stats(score: np.ndarray, threshold: float, label: str) -> dict:
        traded = score >= threshold
        rets   = oos_outcomes[traded]
        n      = int(traded.sum())
        if n < 30:
            return {"sharpe": None, "n_trades": n, "hit_rate": None}
        mu  = float(rets.mean())
        sd  = float(rets.std(ddof=1))
        if sd < 1e-9:
            return {"sharpe": 0.0, "n_trades": n, "hit_rate": round(float((rets > 0).mean()), 3)}
        sh  = round(mu / sd * np.sqrt(252 * 78), 3)
        hr  = round(float((rets > 0).mean()), 3)
        log.info("%s  thr=%.3f  n=%d  sharpe=%.3f  hit=%.3f", label, threshold, n, sh, hr)
        return {"sharpe": sh, "n_trades": n, "hit_rate": hr}

    # Sweep thresholds to find best for each branch
    def _best_branch(score: np.ndarray, thresholds: list, label: str) -> dict:
        best = None
        for thr in thresholds:
            res = _branch_stats(score, thr, label)
            if res["sharpe"] is not None and (best is None or res["sharpe"] > (best.get("sharpe") or -999)):
                best = res
                best["threshold"] = round(thr, 4)
        return best or {"sharpe": None, "n_trades": 0, "hit_rate": None, "threshold": None}

    n_sigs = len(sigs_in_data)
    eq_thresholds   = [max(1, int(n_sigs * t)) for t in [0.05, 0.10, 0.15, 0.20]]
    sw_thresholds   = [0.02, 0.04, 0.06, 0.08, 0.10, 0.15]
    hard_thresholds = [0.02, 0.04, 0.06, 0.08, 0.10, 0.15]
    soft_thresholds = [0.02, 0.04, 0.06, 0.08, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60]

    eq_res   = _best_branch(eq_score,   eq_thresholds,   "EQUAL")
    sw_res   = _best_branch(sw_score,   sw_thresholds,   "SHARPE_WT")
    hard_res = _best_branch(hard_score, hard_thresholds, "HARD_ROUTED")
    soft_res = _best_branch(soft_score, soft_thresholds, "SOFT_ROUTED")

    sw_sh        = sw_res.get("sharpe") or 0.0
    hard_sh      = hard_res.get("sharpe") or 0.0
    soft_sh      = soft_res.get("sharpe") or 0.0
    hard_delta   = round(hard_sh - sw_sh, 3)
    soft_delta   = round(soft_sh - sw_sh, 3)

    def _verdict(d: float) -> str:
        return "IMPROVED" if d > 0.05 else ("DEGRADED" if d < -0.05 else "NEUTRAL")

    report = {
        "equal_weight":    eq_res,
        "sharpe_weighted": sw_res,
        "hard_routed":     hard_res,
        "soft_routed":     soft_res,
        "hard_routing_delta":   hard_delta,
        "hard_routing_verdict": _verdict(hard_delta),
        "soft_routing_delta":   soft_delta,
        "soft_routing_verdict": _verdict(soft_delta),
        "signal_routing":  SIGNAL_ROUTING,
        "soft_regime_mult": {k: v for k, v in SOFT_REGIME_MULT.items()},
        "bars_routed_pct": bars_routed_pct,
        "n_oos_bars":      n_oos_int,
        "generated_at":    datetime.now().isoformat(timespec="seconds") if True else "",
    }

    ROUTED_OUT.parent.mkdir(parents=True, exist_ok=True)
    ROUTED_OUT.write_text(json.dumps(report, indent=2))
    log.info("routed_ensemble_report.json written → %s", ROUTED_OUT)

    return report


if __name__ == "__main__":
    from datetime import datetime
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--routed", action="store_true", help="Run routed ensemble instead of standard")
    args = ap.parse_args()

    if args.routed:
        r = build_routed_ensemble()
        print(f"\nEQUAL-WEIGHT    Sharpe={r['equal_weight']['sharpe']}   trades={r['equal_weight']['n_trades']}")
        print(f"SHARPE-WEIGHTED Sharpe={r['sharpe_weighted']['sharpe']}  trades={r['sharpe_weighted']['n_trades']}")
        print(f"HARD-ROUTED     Sharpe={r['hard_routed']['sharpe']}  trades={r['hard_routed']['n_trades']}  delta={r['hard_routing_delta']:+.3f}  {r['hard_routing_verdict']}")
        print(f"SOFT-ROUTED     Sharpe={r['soft_routed']['sharpe']}  trades={r['soft_routed']['n_trades']}  delta={r['soft_routing_delta']:+.3f}  {r['soft_routing_verdict']}")
        print(f"BARS HARD-BLOCKED {r['bars_routed_pct']}% of {r['n_oos_bars']:,} OOS bars")
    else:
        r = run()
        print(f"\nEQUAL-WEIGHT    Sharpe={r['equal_weight']['best_sharpe']}  trades={r['equal_weight']['n_trades']}")
        print(f"SHARPE-WEIGHTED Sharpe={r['sharpe_weighted']['best_sharpe']}  trades={r['sharpe_weighted']['n_trades']}")
        print(f"DELTA           {r['improvement']['delta_sharpe']:+.3f}  {r['improvement']['verdict']}")
    if args.json:
        print(json.dumps(r, indent=2))
