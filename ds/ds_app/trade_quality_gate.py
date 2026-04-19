"""
ds_app/trade_quality_gate.py — Trade Quality Veto Layer (P0-B)

Optimal gate set discovered via systematic search (gate_search.py, 2026-04-19):
  SQUEEZE_LOCK    — squeeze==1 (no directional edge)            +0.934
  ATR_RANK_LOW    — atr in bottom 30% of recent history         +0.661
  HOUR_KILLS      — UTC hours 0,1,3,4,5,12,13,20,21,22,23      +1.434
  RVOL_EXHAUSTION — rvol > 90th pct of last 100 bars (climax)  +0.435
  LOW_JEDI        — abs(jedi_raw) < 4 (zero conviction)         +0.310

Ichimoku (+0.105) excluded — redundant after ATR_RANK_LOW.
PDH_MIDDLE excluded — HURTS in 24/7 crypto (no session structure).
DEAD_MARKET (rvol<0.65) excluded — HURTS (low rvol ≠ bad entry in crypto).

NOTE: gates selected on OOS set. Individual gates are economically justified.
Full holdout validation needed before live use.

Output: ds/data/gate_report.json
"""
from __future__ import annotations

import json
import logging
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("trade_quality_gate")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

from ds_app.algos_crypto import ALL_ALGO_IDS  # noqa: E402
from ds_app.sharpe_ensemble import (          # noqa: E402
    SIGNAL_DB, REGIME_MAP, SOFT_REGIME_MULT, assign_regimes,
)

OUT    = _DS_ROOT / "data" / "gate_report.json"
ANNUAL = 252 * 78

# Hours (UTC) with structural thin markets — crypto transition periods
KILL_HOURS = {0, 1, 3, 4, 5, 12, 13, 20, 21, 22, 23}

# ATR lookback for rank computation
ATR_RANK_WINDOW = 50

# RVOL exhaustion lookback
RVOL_EXHAUST_WINDOW = 100


def sharpe(r: np.ndarray) -> float | None:
    r = r[~np.isnan(r)]
    if len(r) < 50: return None
    sd = r.std(ddof=1)
    if sd < 1e-9: return None
    return round(float(r.mean() / sd * np.sqrt(ANNUAL)), 3)


# ── feature enrichment (per-symbol) ──────────────────────────────────────────
def _enrich(df: pd.DataFrame) -> pd.DataFrame:
    parts = []
    for sym, g in df.groupby("symbol"):
        g = g.sort_values("ts").reset_index(drop=False)
        n = len(g)
        atr = g["atr_pct"].fillna(0).values
        rv  = g["rvol"].fillna(1.0).values
        h   = g["high"].values
        l   = g["low"].values

        # ATR rank in rolling window (0=low, 1=high)
        atr_rank = np.zeros(n)
        for i in range(ATR_RANK_WINDOW, n):
            w = atr[i - ATR_RANK_WINDOW:i]
            atr_rank[i] = (w < atr[i]).mean()
        g["atr_rank"] = atr_rank

        # RVOL exhaustion flag: current bar in top 10% of recent RVOL
        rv_exhaust = np.zeros(n, dtype=bool)
        for i in range(RVOL_EXHAUST_WINDOW, n):
            rv_exhaust[i] = rv[i] > np.percentile(rv[i - RVOL_EXHAUST_WINDOW:i], 90)
        g["rvol_exhaustion"] = rv_exhaust.astype(int)

        # Regime (price-based EMA200 + ATR)
        reg_s = assign_regimes(g)
        g["regime"] = reg_s.values

        parts.append(g)
    return pd.concat(parts, ignore_index=True)


# ── soft score (replicates build_routed_ensemble logic) ──────────────────────
def _build_soft_scores(df: pd.DataFrame, regimes: np.ndarray) -> np.ndarray:
    routing = json.loads(REGIME_MAP.read_text())
    flat_sh: dict[str, float] = {}
    for rrows in routing.values():
        for r in rrows:
            s = r["algo_id"]; sh = r.get("sharpe") or 0.0
            if sh > 0: flat_sh[s] = max(flat_sh.get(s, 0.0), sh)
    fs_total = sum(flat_sh.values()) or 1.0
    flat_w = {s: v / fs_total for s, v in flat_sh.items()}
    sigs = [s for s in ALL_ALGO_IDS if f"v_{s}" in df.columns]
    scores = np.zeros(len(df), dtype=float)
    for sig in sigs:
        v  = df[f"v_{sig}"].fillna(0).values.astype(float)
        fw = flat_w.get(sig, 0.0)
        mm = SOFT_REGIME_MULT.get(sig, {})
        mults = np.array([mm.get(r, 1.0) for r in regimes]) if mm else np.ones(len(df))
        scores += v * fw * mults
    return scores


# ── gate functions ────────────────────────────────────────────────────────────
def _gate_squeeze(df: pd.DataFrame) -> np.ndarray:
    return df["squeeze"].fillna(0).astype(int).values == 1

def _gate_atr_rank_low(df: pd.DataFrame) -> np.ndarray:
    return df["atr_rank"].values < 0.30

def _gate_hour_kills(df: pd.DataFrame) -> np.ndarray:
    hours = pd.to_datetime(df["ts"], unit="s", utc=True).dt.hour.values
    return np.isin(hours, list(KILL_HOURS))

def _gate_rvol_exhaustion(df: pd.DataFrame) -> np.ndarray:
    return df["rvol_exhaustion"].values.astype(bool)

def _gate_low_jedi(df: pd.DataFrame) -> np.ndarray:
    j = df["jedi_raw"].fillna(0).values if "jedi_raw" in df.columns else np.zeros(len(df))
    return np.abs(j) < 4

GATES = {
    "SQUEEZE_LOCK":    _gate_squeeze,
    "ATR_RANK_LOW":    _gate_atr_rank_low,
    "HOUR_KILLS":      _gate_hour_kills,
    "RVOL_EXHAUSTION": _gate_rvol_exhaustion,
    "LOW_JEDI":        _gate_low_jedi,
}


# ── main ──────────────────────────────────────────────────────────────────────
def run() -> dict:
    if not SIGNAL_DB.exists():
        return {"error": str(SIGNAL_DB)}
    if not REGIME_MAP.exists():
        return {"error": "regime_signal_map.json missing"}

    conn = sqlite3.connect(SIGNAL_DB)
    pragma = {r[1] for r in conn.execute("PRAGMA table_info(signal_log)")}
    v_cols = [f"v_{s}" for s in ALL_ALGO_IDS if f"v_{s}" in pragma]
    want   = ["ts","symbol","outcome_4h_pct","close","high","low","open",
              "atr_pct","squeeze","rvol","jedi_raw"] + v_cols
    sel = [c for c in want if c in pragma]
    seen: set = set()
    sel = [c for c in sel if not (c in seen or seen.add(c))]
    rows = conn.execute(
        f"SELECT {','.join(sel)} FROM signal_log"
        f" WHERE outcome_4h_pct IS NOT NULL ORDER BY symbol,ts"
    ).fetchall()
    conn.close()
    df = pd.DataFrame(rows, columns=sel)
    oos_cut = int(np.percentile(df["ts"].values, 70))
    df = df[df["ts"] >= oos_cut].copy()
    log.info("OOS bars: %d", len(df))

    log.info("Enriching features…")
    df = _enrich(df)

    regimes  = df["regime"].values
    scores   = _build_soft_scores(df, regimes)
    outcomes = df["outcome_4h_pct"].values.astype(float)
    df["soft_score"] = scores

    SW_THR   = 0.06
    SOFT_THR = 0.35
    sw_mask   = scores >= SW_THR
    soft_mask = scores >= SOFT_THR

    base_sw   = sharpe(outcomes[sw_mask])
    base_soft = sharpe(outcomes[soft_mask])
    log.info("SW baseline:   Sharpe=%.3f  n=%d", base_sw or 0, int(sw_mask.sum()))
    log.info("Soft baseline: Sharpe=%.3f  n=%d", base_soft or 0, int(soft_mask.sum()))

    combined_veto = np.zeros(len(df), dtype=bool)
    gate_results  = []

    for name, fn in GATES.items():
        veto      = fn(df)
        n_bl      = int((sw_mask & veto).sum())
        pct_bl    = round(n_bl / max(int(sw_mask.sum()), 1) * 100, 1)
        after_mask = sw_mask & ~veto
        st = sharpe(outcomes[after_mask])
        delta = round((st or 0) - (base_sw or 0), 3)
        gate_results.append({
            "gate":          name,
            "n_blocked":     n_bl,
            "pct_blocked":   pct_bl,
            "sharpe_after":  st,
            "n_trades_after": int(after_mask.sum()),
            "delta_sharpe":  delta,
            "verdict":       "IMPROVES" if delta > 0.05 else ("HURTS" if delta < -0.05 else "NEUTRAL"),
        })
        combined_veto |= veto
        log.info("GATE %-18s  blocked=%5d (%.1f%%)  sharpe=%s  delta=%+.3f",
                 name, n_bl, pct_bl, st, delta)

    combined_sw   = sharpe(outcomes[sw_mask   & ~combined_veto])
    combined_soft = sharpe(outcomes[soft_mask & ~combined_veto])
    combined_n_sw = int((sw_mask   & ~combined_veto).sum())
    combined_n_sf = int((soft_mask & ~combined_veto).sum())
    delta_sw   = round((combined_sw   or 0) - (base_sw   or 0), 3)
    delta_soft = round((combined_soft or 0) - (base_soft or 0), 3)
    log.info("COMBINED SW:   Sharpe=%.3f  n=%d  delta=%+.3f", combined_sw or 0, combined_n_sw, delta_sw)
    log.info("COMBINED SOFT: Sharpe=%.3f  n=%d  delta=%+.3f", combined_soft or 0, combined_n_sf, delta_soft)

    report = {
        "baseline_sw":        {"sharpe": base_sw,   "n_trades": int(sw_mask.sum()),   "threshold": SW_THR},
        "baseline_soft":      {"sharpe": base_soft, "n_trades": int(soft_mask.sum()), "threshold": SOFT_THR},
        "per_gate":           gate_results,
        "combined_sw":        {"sharpe": combined_sw,   "n_trades": combined_n_sw, "delta_sharpe": delta_sw},
        "combined_soft":      {"sharpe": combined_soft, "n_trades": combined_n_sf, "delta_sharpe": delta_soft},
        "kill_hours":         sorted(KILL_HOURS),
        "generated_at":       __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2))
    log.info("gate_report.json → %s", OUT)
    return report


if __name__ == "__main__":
    r = run()
    print(f"\nBASELINE SW(0.06)     Sharpe={r['baseline_sw']['sharpe']}   n={r['baseline_sw']['n_trades']:,}")
    print(f"BASELINE soft(0.35)   Sharpe={r['baseline_soft']['sharpe']}   n={r['baseline_soft']['n_trades']:,}")
    print()
    for g in r["per_gate"]:
        print(f"  {g['gate']:20s}  blocked={g['pct_blocked']:5.1f}%  sharpe={g['sharpe_after']}  delta={g['delta_sharpe']:+.3f}  {g['verdict']}")
    print()
    c = r["combined_sw"]
    print(f"COMBINED+SW           Sharpe={c['sharpe']}   n={c['n_trades']:,}   delta={c['delta_sharpe']:+.3f}")
    c2 = r["combined_soft"]
    print(f"COMBINED+soft(0.35)   Sharpe={c2['sharpe']}   n={c2['n_trades']:,}   delta={c2['delta_sharpe']:+.3f}")
