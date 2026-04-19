"""
ds_app/star_optimizer.py — Star-Ray Optimizer

Multi-dimensional signal tuning engine.
Finds optimal hours, days, regimes, thresholds.
Computes Kelly fraction per config.
Scores "stars aligned" for position sizing.
Tests master scalper (loose 1h mode) vs council mode (4h).

Outputs: ds/data/star_report.json — consumed by StarOptimizerPage UI.

Usage:
  python ds_app/star_optimizer.py
  python ds_app/star_optimizer.py --horizon 4h --symbols ES NQ CL
  python ds_app/star_optimizer.py --scalper       # 1h loose mode only
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_HERE   = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

from ds_app.algos_crypto import ALL_ALGO_IDS  # noqa: E402

SIGNAL_DB  = _DS_ROOT / "data" / "signal_log.db"
REGIME_MAP = _DS_ROOT / "data" / "regime_signal_map.json"
OUT        = _DS_ROOT / "data" / "star_report.json"

ANNUAL_MAP = {"1h": 252 * 24, "4h": 252 * 6, "1d": 252}
KILLED     = {"NEW_HIGH", "RANGE_BO", "CONSOL_BO", "ROC_MOM"}
SURVIVORS  = [a for a in ALL_ALGO_IDS if a not in KILLED]

# traffic light thresholds
TL_GREEN  = 1.5
TL_YELLOW = 0.5

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


# ── helpers ────────────────────────────────────────────────────────────────────
def sharpe(r: np.ndarray, annual: int, min_n: int = 20) -> float | None:
    r = r[~np.isnan(r)]
    if len(r) < min_n:
        return None
    sd = r.std(ddof=1)
    if sd == 0:
        return None
    return round(float(r.mean() / sd * np.sqrt(annual)), 3)


def kelly(returns: np.ndarray) -> dict:
    """Full Kelly and Half Kelly from trade returns."""
    r = returns[~np.isnan(returns)]
    if len(r) < 20:
        return {"full": None, "half": None, "win_rate": None, "rr": None}
    wins  = r[r > 0]
    loses = r[r < 0]
    W = float(len(wins) / len(r))
    avg_win  = float(wins.mean())  if len(wins)  > 0 else 0.0
    avg_loss = float(abs(loses.mean())) if len(loses) > 0 else 1e-9
    R = avg_win / avg_loss if avg_loss > 0 else 0.0
    # Kelly: f* = W - (1-W)/R
    if R > 0:
        f_full = max(0.0, W - (1.0 - W) / R)
    else:
        f_full = 0.0
    return {
        "full":     round(f_full * 100, 2),
        "half":     round(f_full * 50,  2),
        "win_rate": round(W, 3),
        "rr":       round(R, 3),
        "avg_win_pct":  round(float(avg_win  * 100), 4),
        "avg_loss_pct": round(float(avg_loss * 100), 4),
    }


def traffic_light(s: float | None) -> str:
    if s is None:
        return "grey"
    if s >= TL_GREEN:
        return "green"
    if s >= TL_YELLOW:
        return "yellow"
    return "red"


def regime_entry_mask(df: pd.DataFrame, routing: dict[str, list[str]]) -> pd.Series:
    """Returns boolean mask for regime-routed entries."""
    n = len(df)
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
    atr_75   = np.percentile(atr[atr > 0], 75) if (atr > 0).any() else 1.0
    risk_off = (atr > atr_75) & (mom12 < -0.015)
    sqz_prev = np.concatenate([[0], sqz[:-1]])
    breakout = ((sqz_prev == 1) & (sqz == 0)) | (atr_e == 1)
    alpha    = 2.0 / 201.0
    ema200   = np.zeros(n)
    ema200[0] = close[0]
    for i in range(1, n):
        ema200[i] = alpha * close[i] + (1 - alpha) * ema200[i - 1]
    trending = (close > ema200) & (sup == 1) & (adx == 1)
    regime   = np.full(n, "RANGING", dtype=object)
    regime[trending]  = "TRENDING"
    regime[breakout]  = "BREAKOUT"
    regime[risk_off]  = "RISK-OFF"
    regime_s = pd.Series(regime, index=df.index)

    entry = pd.Series(False, index=df.index)
    for reg, sig_ids in routing.items():
        reg_mask = regime_s == reg
        for sid in sig_ids:
            vcol = f"v_{sid}"
            if vcol in df.columns:
                entry |= (reg_mask & (df[vcol] == 1).fillna(False))
    return entry, regime_s


# ── dimension analyses ────────────────────────────────────────────────────────
def analyze_hours(df: pd.DataFrame, entry: pd.Series, outcome_col: str, annual: int) -> dict:
    df = df.copy()
    df["hour"] = pd.to_datetime(df["ts"], unit="s").dt.hour
    df["_entry"] = entry.values

    hour_stats = {}
    for h in range(24):
        mask = df["_entry"] & (df["hour"] == h)
        r    = df.loc[mask, outcome_col].dropna().values / 100.0
        s    = sharpe(r, annual, min_n=10)
        k    = kelly(r)
        hour_stats[h] = {
            "hour":     h,
            "sharpe":   s,
            "n_trades": int(len(r)),
            "hit_rate": round(float((r > 0).mean()), 3) if len(r) > 0 else None,
            "kelly_half": k["half"],
            "light":    traffic_light(s),
        }
    best_hours  = [h for h, v in hour_stats.items() if v["light"] == "green"]
    kill_hours  = [h for h, v in hour_stats.items() if v["light"] == "red"]
    return {"by_hour": hour_stats, "best_hours": best_hours, "kill_hours": kill_hours}


def analyze_days(df: pd.DataFrame, entry: pd.Series, outcome_col: str, annual: int) -> dict:
    df = df.copy()
    df["dow"]    = pd.to_datetime(df["ts"], unit="s").dt.dayofweek
    df["_entry"] = entry.values

    day_stats = {}
    for d in range(7):
        mask = df["_entry"] & (df["dow"] == d)
        r    = df.loc[mask, outcome_col].dropna().values / 100.0
        s    = sharpe(r, annual, min_n=10)
        k    = kelly(r)
        day_stats[d] = {
            "day":      DAYS[d],
            "sharpe":   s,
            "n_trades": int(len(r)),
            "hit_rate": round(float((r > 0).mean()), 3) if len(r) > 0 else None,
            "kelly_half": k["half"],
            "light":    traffic_light(s),
        }
    best_days = [d for d, v in day_stats.items() if v["light"] == "green"]
    kill_days = [d for d, v in day_stats.items() if v["light"] == "red"]
    return {"by_day": day_stats, "best_days": best_days, "kill_days": kill_days}


def analyze_regime_performance(df: pd.DataFrame, regime_s: pd.Series, entry: pd.Series,
                                outcome_col: str, annual: int) -> dict:
    df = df.copy()
    df["_entry"]  = entry.values
    df["_regime"] = regime_s.values
    out = {}
    for reg in ["TRENDING", "RANGING", "BREAKOUT", "RISK-OFF"]:
        mask = df["_entry"] & (df["_regime"] == reg)
        r    = df.loc[mask, outcome_col].dropna().values / 100.0
        s    = sharpe(r, annual, min_n=10)
        k    = kelly(r)
        pct  = round(float((df["_regime"] == reg).mean() * 100), 1)
        out[reg] = {
            "sharpe":    s,
            "n_trades":  int(len(r)),
            "pct_bars":  pct,
            "kelly_half": k["half"],
            "hit_rate":  round(float((r > 0).mean()), 3) if len(r) > 0 else None,
            "light":     traffic_light(s),
        }
    return out


def analyze_rvol_tiers(df: pd.DataFrame, entry: pd.Series, outcome_col: str, annual: int) -> list:
    df = df.copy()
    df["_entry"] = entry.values
    tiers = [
        ("Dead  (< 0.5)",  0.0, 0.5),
        ("Low   (0.5–0.8)", 0.5, 0.8),
        ("Avg   (0.8–1.2)", 0.8, 1.2),
        ("High  (1.2–2.0)", 1.2, 2.0),
        ("Surge (> 2.0)",   2.0, 999),
    ]
    out = []
    for label, lo, hi in tiers:
        rvol = df["rvol"].fillna(1.0)
        mask = df["_entry"] & (rvol >= lo) & (rvol < hi)
        r    = df.loc[mask, outcome_col].dropna().values / 100.0
        s    = sharpe(r, annual, min_n=10)
        out.append({
            "label": label, "rvol_lo": lo, "rvol_hi": hi,
            "sharpe": s, "n_trades": int(len(r)),
            "light": traffic_light(s),
        })
    return out


def analyze_scalper(df: pd.DataFrame, routing: dict, annual_1h: int) -> dict:
    """
    Master Scalper: loose entry, 1h outcome, many trades.
    Entry = ANY survivor signal fires (no regime restriction).
    Progressively tighter: all → rvol>0.5 → rvol>1.0 → 2+ signals
    """
    oc = "outcome_1h_pct"
    if oc not in df.columns:
        return {"error": "outcome_1h_pct not in data"}

    df = df.dropna(subset=[oc]).reset_index(drop=True)
    results = []

    for label, rvol_floor, min_sigs in [
        ("Loose (all, RVOL≥0)",   0.0, 1),
        ("Active (RVOL≥0.5)",     0.5, 1),
        ("Volume (RVOL≥1.0)",     1.0, 1),
        ("Stacked (RVOL≥0.5, 2+)", 0.5, 2),
        ("Regime-routed (RVOL≥0)", 0.0, 1),  # regime routing
    ]:
        rvol = df["rvol"].fillna(1.0)
        gate = rvol >= rvol_floor

        if "Regime" in label:
            # use regime routing
            entry_mask, _ = regime_entry_mask(df, routing)
            fired = gate & entry_mask
        else:
            # any survivor fires
            sig_count = pd.Series(0, index=df.index)
            for sid in SURVIVORS:
                vcol = f"v_{sid}"
                if vcol in df.columns:
                    sig_count += (df[vcol] == 1).fillna(False).astype(int)
            fired = gate & (sig_count >= min_sigs)

        r = df.loc[fired, oc].values / 100.0
        s = sharpe(r, annual_1h, min_n=20)
        k = kelly(r)
        results.append({
            "label":      label,
            "sharpe":     s,
            "n_trades":   int(len(r)),
            "kelly_half": k["half"],
            "hit_rate":   round(float((r > 0).mean()), 3) if len(r) > 0 else None,
            "light":      traffic_light(s),
        })
    return {"modes": results}


def compute_stars(
    current_hour: int,
    current_dow: int,
    current_rvol: float,
    current_regime: str,
    squeeze_off: bool,
    hour_data: dict,
    day_data: dict,
    regime_data: dict,
) -> dict:
    """
    Stars 0-5 for position sizing: more stars = larger Kelly fraction.
    """
    stars = []

    def _s(name: str, condition: bool, detail: str) -> None:
        stars.append({"name": name, "lit": condition, "detail": detail})

    h_light = hour_data["by_hour"].get(current_hour, {}).get("light", "red")
    d_light = day_data["by_day"].get(current_dow,    {}).get("light", "red")
    r_light = regime_data.get(current_regime,         {}).get("light", "red")

    _s("Hour window",   h_light == "green", f"Hour {current_hour}:00 → {h_light}")
    _s("Day quality",   d_light == "green", f"{DAYS[current_dow]} → {d_light}")
    _s("Regime power",  r_light == "green", f"{current_regime} → {r_light}")
    _s("Volume surge",  current_rvol >= 1.2, f"RVOL {current_rvol:.2f} ≥ 1.2")
    _s("Squeeze clear", squeeze_off,          "BB > KC (breakout energy free)")

    lit = sum(1 for s in stars if s["lit"])
    return {
        "stars": stars,
        "count": lit,
        "display": "★" * lit + "☆" * (5 - lit),
        "kelly_multiplier": round(0.2 + 0.2 * lit, 2),  # 0.2x (0 stars) → 1.2x (5 stars)
        "suggestion": (
            "MAX SIZE — all systems go"       if lit == 5 else
            "FULL KELLY — strong alignment"   if lit == 4 else
            "HALF KELLY — good conditions"    if lit == 3 else
            "QUARTER KELLY — marginal"        if lit == 2 else
            "SKIP / MIN SIZE — unfavorable"
        ),
    }


# ── traffic light report ──────────────────────────────────────────────────────
def build_traffic_lights(
    baseline_s: float | None,
    regime_s: float | None,
    hour_filtered_s: float | None,
    day_filtered_s: float | None,
    rvol_s: float | None,
    scalper_s: float | None,
    kelly_data: dict,
) -> list:
    steps = [
        ("BASELINE",         "All survivors, no filters",             baseline_s,        None),
        ("REGIME ROUTING",   "Route signals by TRENDING/RANGING/etc", regime_s,          baseline_s),
        ("HOUR FILTER",      "Remove bad-hour trades",                hour_filtered_s,   regime_s),
        ("DAY FILTER",       "Remove bad-day trades",                 day_filtered_s,    hour_filtered_s),
        ("RVOL GATE",        "Trades with above-avg volume only",     rvol_s,            day_filtered_s),
        ("SCALPER MODE",     "1h horizon, loose entry, many trades",  scalper_s,         None),
        ("KELLY SIZING",     f"Half Kelly = {kelly_data.get('half')}%  Full = {kelly_data.get('full')}%",
         None, None),
    ]
    lights = []
    for name, desc, s, prev_s in steps:
        delta = None
        if s is not None and prev_s is not None:
            delta = round(s - prev_s, 3)
        lights.append({
            "name":    name,
            "desc":    desc,
            "sharpe":  s,
            "delta":   delta,
            "light":   traffic_light(s) if s is not None else "grey",
            "verdict": (
                "APPLY — improves edge" if (delta or 0) > 0.05  else
                "NEUTRAL — no improvement"  if delta is not None and abs(delta) <= 0.05 else
                "SKIP — hurts edge"         if (delta or 0) < -0.05 else
                "INFO"
            ),
        })
    return lights


# ── main ──────────────────────────────────────────────────────────────────────
def run(horizon: str, symbols: list[str] | None, scalper_only: bool) -> None:
    annual    = ANNUAL_MAP[horizon]
    annual_1h = ANNUAL_MAP["1h"]
    oc        = f"outcome_{horizon}_pct"

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
                 "jedi_raw", "v_SUPERTREND", "v_ADX_TREND", "v_ATR_EXP",
                 oc, "outcome_1h_pct"]
    seen: set = set()
    sel = [c for c in base_cols + vote_cols if not (c in seen or seen.add(c))]  # type: ignore

    sym_str = "','".join(targets)
    print(f"Star-Ray Optimizer — horizon={horizon} — {targets}")
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

    # ── build entry masks ─────────────────────────────────────────────────────
    print("Computing regime routing …")
    entry_regime, regime_s = regime_entry_mask(df_oos, routing)

    # baseline: any survivor fires
    sig_count_all = pd.Series(0, index=df_oos.index)
    for sid in SURVIVORS:
        vcol = f"v_{sid}"
        if vcol in df_oos.columns:
            sig_count_all += (df_oos[vcol] == 1).fillna(False).astype(int)
    entry_baseline = sig_count_all >= 1

    def _sharpe_for(entry: pd.Series) -> float | None:
        r = df_oos.loc[entry, oc].dropna().values / 100.0
        return sharpe(r, annual, min_n=50)

    s_baseline = _sharpe_for(entry_baseline)
    s_regime   = _sharpe_for(entry_regime)
    print(f"  Baseline: {s_baseline}  Regime-routed: {s_regime}")

    # ── hour analysis ─────────────────────────────────────────────────────────
    print("Hour analysis …")
    hour_data = analyze_hours(df_oos, entry_regime, oc, annual)
    best_h    = hour_data["best_hours"]
    kill_h    = hour_data["kill_hours"]

    entry_hour_filtered = entry_regime & ~pd.to_datetime(df_oos["ts"], unit="s").dt.hour.isin(kill_h)
    s_hour_filtered = _sharpe_for(entry_hour_filtered)
    print(f"  Best hours: {best_h}  Kill hours: {kill_h}  Sharpe after: {s_hour_filtered}")

    # ── day analysis ─────────────────────────────────────────────────────────
    print("Day analysis …")
    day_data = analyze_days(df_oos, entry_hour_filtered, oc, annual)
    best_d   = day_data["best_days"]
    kill_d   = day_data["kill_days"]

    entry_day_filtered = entry_hour_filtered & ~pd.to_datetime(df_oos["ts"], unit="s").dt.dayofweek.isin(kill_d)
    s_day_filtered = _sharpe_for(entry_day_filtered)
    print(f"  Best days: {[DAYS[d] for d in best_d]}  Kill days: {[DAYS[d] for d in kill_d]}  Sharpe after: {s_day_filtered}")

    # ── RVOL analysis ─────────────────────────────────────────────────────────
    print("RVOL tiers …")
    rvol_tiers  = analyze_rvol_tiers(df_oos, entry_day_filtered, oc, annual)
    best_rvol   = next((t for t in rvol_tiers if t["light"] == "green"), None)
    entry_rvol  = entry_day_filtered & (df_oos["rvol"].fillna(1.0) >= (best_rvol["rvol_lo"] if best_rvol else 0.0))
    s_rvol      = _sharpe_for(entry_rvol)

    # ── regime performance ────────────────────────────────────────────────────
    regime_perf = analyze_regime_performance(df_oos, regime_s, entry_regime, oc, annual)

    # ── Kelly ─────────────────────────────────────────────────────────────────
    best_r = df_oos.loc[entry_day_filtered, oc].dropna().values / 100.0
    kelly_data = kelly(best_r)
    print(f"  Kelly → full {kelly_data['full']}%  half {kelly_data['half']}%")

    # ── scalper ───────────────────────────────────────────────────────────────
    print("Scalper analysis …")
    scalper_data = analyze_scalper(df_oos, routing, annual_1h)
    best_scalper = max((m for m in scalper_data["modes"] if m["sharpe"]), key=lambda m: m["sharpe"], default=None)
    s_scalper    = best_scalper["sharpe"] if best_scalper else None

    # ── traffic lights ────────────────────────────────────────────────────────
    tl = build_traffic_lights(
        s_baseline, s_regime, s_hour_filtered, s_day_filtered,
        s_rvol, s_scalper, kelly_data,
    )

    # ── stars example (current bar = last bar) ────────────────────────────────
    last = df_oos.iloc[-1]
    last_hour  = int(pd.Timestamp(int(last["ts"]), unit="s").hour)
    last_dow   = int(pd.Timestamp(int(last["ts"]), unit="s").dayofweek)
    last_rvol  = float(last["rvol"]) if not np.isnan(last["rvol"]) else 1.0
    last_regime = str(regime_s.iloc[-1])
    last_sqz_off = int(last["squeeze"]) == 0
    stars_data = compute_stars(
        last_hour, last_dow, last_rvol, last_regime, last_sqz_off,
        hour_data, day_data, regime_perf,
    )

    # ── hyperparameter grid ───────────────────────────────────────────────────
    print("Hyperparam grid (loose) …")
    hyperparam_grid = []
    for rvol_f in [0.0, 0.5, 0.8, 1.0]:
        for min_s in [1, 2, 3]:
            gate = entry_regime & (df_oos["rvol"].fillna(1.0) >= rvol_f)
            # signal stacking
            stk_gate = gate & (sig_count_all >= min_s)
            r   = df_oos.loc[stk_gate, oc].dropna().values / 100.0
            s   = sharpe(r, annual, min_n=30)
            k   = kelly(r)
            hyperparam_grid.append({
                "rvol_floor":  rvol_f,
                "min_signals": min_s,
                "sharpe":      s,
                "n_trades":    int(len(r)),
                "kelly_half":  k["half"],
                "light":       traffic_light(s),
            })
    hyperparam_grid.sort(key=lambda x: x["sharpe"] or -999, reverse=True)

    # ── print summary ─────────────────────────────────────────────────────────
    print(f"\n{'STEP':<28} {'SHARPE':<10} {'DELTA':<10} {'STATUS'}")
    print("─" * 62)
    for step in tl:
        s_str = f"{step['sharpe']:.3f}" if step["sharpe"] is not None else "  —  "
        d_str = f"{step['delta']:+.3f}" if step["delta"] is not None else "  —  "
        print(f"{step['name']:<28} {s_str:<10} {d_str:<10} {step['light'].upper():<8} {step['verdict']}")

    print(f"\nKelly: Full={kelly_data['full']}%  Half={kelly_data['half']}%  Win={kelly_data['win_rate']:.1%}  R:R={kelly_data['rr']:.2f}")
    print(f"Stars ({last_regime} @ {last_hour}h): {stars_data['display']}  → {stars_data['suggestion']}")

    # ── save ──────────────────────────────────────────────────────────────────
    report = {
        "generated_at":     pd.Timestamp.now().isoformat(),
        "horizon":          horizon,
        "symbols":          targets,
        "oos_rows":         int(len(df_oos)),
        "traffic_lights":   tl,
        "hour_analysis":    hour_data,
        "day_analysis":     day_data,
        "regime_perf":      regime_perf,
        "rvol_tiers":       rvol_tiers,
        "kelly":            kelly_data,
        "stars_current":    stars_data,
        "scalper":          scalper_data,
        "hyperparam_grid":  hyperparam_grid,
        "routing_used":     routing,
        "summary": {
            "baseline_sharpe":       s_baseline,
            "regime_sharpe":         s_regime,
            "hour_filtered_sharpe":  s_hour_filtered,
            "day_filtered_sharpe":   s_day_filtered,
            "rvol_filtered_sharpe":  s_rvol,
            "best_scalper_sharpe":   s_scalper,
            "best_hours":            best_h,
            "kill_hours":            kill_h,
            "best_days":             best_d,
            "kill_days":             kill_d,
            "top_hyperparam":        hyperparam_grid[0] if hyperparam_grid else None,
        },
    }

    with open(OUT, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\n✓ Star report → {OUT}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon",      default="4h", choices=["1h", "4h", "1d"])
    ap.add_argument("--symbols",      nargs="*")
    ap.add_argument("--scalper",      action="store_true")
    args = ap.parse_args()
    run(args.horizon, args.symbols, args.scalper)
