"""
ds_app/regime.py — Phase 4: Regime Classifier + Regime-Routed Signal Audit

Labels each bar TRENDING / RANGING / BREAKOUT / RISK-OFF.
Then re-audits each signal within its native regime only.

Output:
  ds/data/regime_signal_map.json   { regime: [best signals ranked by sharpe] }
  ds/data/regime_stats.json        { regime: { count, pct, sharpe per signal } }
  prints routing table

Logic:
  RISK-OFF  : ATR% > 75th pct  AND  12-bar momentum < -1.5%
  BREAKOUT  : squeeze just released (squeeze[t-1]=1, squeeze[t]=0)
              OR ATR_EXP fired (v_ATR_EXP = 1)
  TRENDING  : price > EMA200  AND  SUPERTREND = +1  AND  ADX > 0
  RANGING   : everything else (default)

Usage:
  python ds_app/regime.py
  python ds_app/regime.py --horizon 4h --symbols ES NQ CL
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
OUT_MAP = _DS_ROOT / "data" / "regime_signal_map.json"
OUT_STATS = _DS_ROOT / "data" / "regime_stats.json"

REGIMES = ["TRENDING", "RANGING", "BREAKOUT", "RISK-OFF"]
ANNUAL_MAP = {"1h": 252 * 24, "4h": 252 * 6, "1d": 252}
MIN_TRADES = 20


def sharpe(r: np.ndarray, annual: int) -> float:
    r = r[~np.isnan(r)]
    if len(r) < MIN_TRADES:
        return np.nan
    sd = r.std(ddof=1)
    if sd == 0:
        return np.nan
    return float(r.mean() / sd * np.sqrt(annual))


def label_regimes(df: pd.DataFrame) -> pd.Series:
    """
    df must have: close, atr_pct, squeeze, v_SUPERTREND, v_ADX_TREND, v_ATR_EXP
    Returns Series of regime labels aligned with df.index.
    Priority: RISK-OFF > BREAKOUT > TRENDING > RANGING
    """
    df = df.reset_index(drop=True)

    atr = df["atr_pct"].fillna(0)
    atr_hi_thresh = atr.quantile(0.75)

    sqz = df["squeeze"].fillna(0).astype(int)
    sup = df["v_SUPERTREND"].fillna(0).astype(int)
    adx = df["v_ADX_TREND"].fillna(0).astype(int)
    atr_exp = df["v_ATR_EXP"].fillna(0).astype(int)

    ema200 = df["close"].ewm(span=200, adjust=False).mean()
    above_ema200 = (df["close"] > ema200).astype(int)

    # 12-bar momentum
    mom12 = df["close"].pct_change(12).fillna(0)

    # RISK-OFF: very high ATR + large negative 12-bar move
    risk_off = (atr > atr_hi_thresh) & (mom12 < -0.015)

    # BREAKOUT: squeeze just released OR ATR expansion bar
    sqz_released = (sqz.shift(1, fill_value=0) == 1) & (sqz == 0)
    breakout = sqz_released | (atr_exp == 1)

    # TRENDING: above EMA200 + Supertrend bullish + ADX positive cross
    trending = (above_ema200 == 1) & (sup == 1) & (adx == 1)

    # Priority assignment
    regime = pd.Series("RANGING", index=df.index)
    regime[trending] = "TRENDING"
    regime[breakout] = "BREAKOUT"
    regime[risk_off] = "RISK-OFF"

    return regime


def run(horizon: str, symbols: list[str] | None) -> None:
    con = sqlite3.connect(SIGNAL_DB)
    avail = [r[0] for r in con.execute("SELECT DISTINCT symbol FROM signal_log ORDER BY symbol")]
    targets = [s for s in avail if not symbols or s in symbols]
    print(f"Regime Classifier — horizon={horizon} — {targets}\n")

    annual = ANNUAL_MAP[horizon]
    outcome_col = f"outcome_{horizon}_pct"

    # ── load required columns ─────────────────────────────────────────────────
    vote_cols = [f"v_{a}" for a in ALL_ALGO_IDS]
    base_cols = ["ts", "symbol", "close", "atr_pct", "squeeze",
                 "v_SUPERTREND", "v_ADX_TREND", "v_ATR_EXP", outcome_col]
    # avoid duplicates (v_SUPERTREND etc are in ALL_ALGO_IDS)
    seen: set = set()
    all_cols = [c for c in base_cols + vote_cols if not (c in seen or seen.add(c))]  # type: ignore

    sym_str = "','".join(targets)
    q = f"SELECT {', '.join(all_cols)} FROM signal_log WHERE symbol IN ('{sym_str}') ORDER BY ts"
    print("Loading … ", end="", flush=True)
    df = pd.read_sql_query(q, con)
    con.close()
    print(f"{len(df):,} rows")

    # OOS split
    ts_sorted = np.sort(df["ts"].unique())
    cutoff = int(ts_sorted[int(len(ts_sorted) * 0.70)])
    df_oos = df[df["ts"] > cutoff].reset_index(drop=True)
    print(f"OOS: {len(df_oos):,} rows\n")

    # ── label regimes ─────────────────────────────────────────────────────────
    df_oos["regime"] = label_regimes(df_oos)

    regime_counts = df_oos["regime"].value_counts()
    total = len(df_oos)
    print("── Regime Distribution (OOS) ──")
    for reg in REGIMES:
        n = regime_counts.get(reg, 0)
        pct = n / total * 100
        bar = "█" * int(pct / 2)
        print(f"  {reg:<12} {n:>8,} bars  {pct:5.1f}%  {bar}")
    print()

    # ── per-signal Sharpe within each regime ─────────────────────────────────
    regime_stats: dict[str, dict] = {}
    regime_signal_map: dict[str, list] = {}

    for reg in REGIMES:
        df_reg = df_oos[df_oos["regime"] == reg]
        n_reg = len(df_reg)
        sig_stats = []

        for a in ALL_ALGO_IDS:
            vcol = f"v_{a}"
            if vcol not in df_reg.columns:
                continue
            fired = df_reg[df_reg[vcol] == 1]
            fired = fired.dropna(subset=[outcome_col])
            n_trades = len(fired)
            if n_trades < MIN_TRADES:
                sig_stats.append({
                    "algo_id": a,
                    "sharpe": None,
                    "n_trades": n_trades,
                    "hit_rate": None,
                    "avg_ret_pct": None,
                })
                continue
            ret = fired[outcome_col].values / 100.0
            s = round(sharpe(ret, annual), 3)
            hit = round(float((ret > 0).mean()), 3)
            avg = round(float(ret.mean() * 100), 4)
            sig_stats.append({
                "algo_id": a,
                "sharpe": s,
                "n_trades": n_trades,
                "hit_rate": hit,
                "avg_ret_pct": avg,
            })

        sig_stats.sort(key=lambda x: x["sharpe"] or -999, reverse=True)
        regime_stats[reg] = {"n_bars": n_reg, "pct": round(n_reg / total * 100, 1), "signals": sig_stats}

        # top signals for this regime (sharpe > 0.5)
        top = [s for s in sig_stats if s["sharpe"] and s["sharpe"] > 0.5]
        regime_signal_map[reg] = top

        print(f"── {reg} ({n_reg:,} bars, {n_reg/total*100:.1f}%) — Top Signals ──")
        if top:
            for s in top[:8]:
                print(f"  {s['algo_id']:<16} sharpe={s['sharpe']:<8} trades={s['n_trades']:<7} hit={s['hit_rate']:.1%}")
        else:
            print("  [no signals pass threshold in this regime]")
        print()

    # ── routing table ─────────────────────────────────────────────────────────
    print("══ REGIME ROUTING TABLE (War Council) ══")
    print(f"{'REGIME':<14} {'TOP 3 SIGNALS'}")
    print("─" * 60)
    for reg in REGIMES:
        top3 = [s["algo_id"] for s in regime_signal_map[reg][:3]]
        print(f"{reg:<14} {' | '.join(top3) if top3 else 'CASH / SKIP'}")

    # ── save ──────────────────────────────────────────────────────────────────
    with open(OUT_MAP, "w") as f:
        json.dump(regime_signal_map, f, indent=2)
    with open(OUT_STATS, "w") as f:
        json.dump(regime_stats, f, indent=2)

    print(f"\n✓ Regime signal map → {OUT_MAP}")
    print(f"✓ Regime stats      → {OUT_STATS}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", default="4h", choices=["1h", "4h", "1d"])
    ap.add_argument("--symbols", nargs="*")
    args = ap.parse_args()
    run(args.horizon, args.symbols)
