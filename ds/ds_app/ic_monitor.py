"""
ds_app/ic_monitor.py — Rolling IC Decay Monitor (P1-B)

Tracks 14-day rolling Information Coefficient (IC) per signal.
Retirement decision uses REGIME IC (signal's home regime only), NOT global IC.

Rule: RETIRE only if regime_IC[home_regime] <= 0 for 3 consecutive windows.
      Global IC is noise for regime specialists. PULLBACK global IC = -0.012 → ALIVE.

Output: ds/data/ic_monitor.json
Endpoints: GET /v1/ic/report/   POST /v1/ic/run/
"""
from __future__ import annotations

import json
import logging
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

log = logging.getLogger("ic_monitor")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

SIGNAL_DB  = _DS_ROOT / "data" / "signal_log.db"
REPORT_OUT = _DS_ROOT / "data" / "ic_monitor.json"

WINDOW_DAYS     = 14
STEP_DAYS       = 7
SLOPE_WINDOW    = 3
MIN_TRADES      = 30
OUTCOME_COL     = "outcome_1h_pct"

# Signal home regime (source of truth: walkforward.py 41-fold regime IC, 2026-04-19)
SIGNAL_HOME_REGIME: dict[str, str] = {
    "PULLBACK":    "TRENDING",
    "ADX_TREND":   "TRENDING",
    "MACD_CROSS":  "TRENDING",
    "SUPERTREND":  "TRENDING",
    "TREND_SMA":   "TRENDING",
    "PSAR":        "TRENDING",
    "GOLDEN":      "TRENDING",
    "EMA_CROSS":   "TRENDING",
    "RSI_CROSS":   "RANGING",
    "RSI_STRONG":  "RANGING",
    "STOCH_CROSS": "RANGING",
    "MFI_CROSS":   "RANGING",
    "ATR_EXP":     "RANGING",
    "SQZPOP":      "BREAKOUT",
    "VOL_BO":      "BREAKOUT",
    "DON_BO":      "BREAKOUT",
    "RANGE_BO":    "BREAKOUT",
    "EMA_STACK":   "BREAKOUT",
    "NEW_HIGH":    "BREAKOUT",
    "BB_BREAK":    "BREAKOUT",
    "KC_BREAK":    "BREAKOUT",
    "CONSOL_BO":   "BREAKOUT",
    "OBV_TREND":   "RISK-OFF",
    "CMF_POS":     "RISK-OFF",
    "VOL_SURGE":   "RISK-OFF",
    "ROC_MOM":     "RISK-OFF",
    "CONSEC_BULL": "RISK-OFF",
}

SIGNALS = list(SIGNAL_HOME_REGIME.keys())


def _assign_regime_col(df: pd.DataFrame) -> pd.Series:
    """
    Lightweight regime labeler from price columns.
    Priority: RISK-OFF > BREAKOUT > TRENDING > RANGING.
    Uses same logic as sharpe_ensemble.assign_regimes() but without full pandas dependency.
    """
    n     = len(df)
    close = df["close"].values if "close" in df.columns else np.ones(n)
    atr   = df["atr_pct"].fillna(0).values if "atr_pct" in df.columns else np.zeros(n)
    sqz   = df["squeeze"].fillna(0).astype(int).values if "squeeze" in df.columns else np.zeros(n, int)

    sup = df["v_SUPERTREND"].fillna(0).astype(int).values if "v_SUPERTREND" in df.columns else np.zeros(n, int)
    adx = df["v_ADX_TREND"].fillna(0).astype(int).values  if "v_ADX_TREND"  in df.columns else np.zeros(n, int)
    ae  = df["v_ATR_EXP"].fillna(0).astype(int).values    if "v_ATR_EXP"    in df.columns else np.zeros(n, int)

    mom12 = np.zeros(n)
    for i in range(12, n):
        if close[i - 12] != 0:
            mom12[i] = (close[i] - close[i - 12]) / close[i - 12]

    atr_pos = atr[atr > 0]
    atr_75  = np.percentile(atr_pos, 75) if len(atr_pos) > 0 else 1.0
    risk_off = (atr > atr_75) & (mom12 < -0.015)

    sqz_prev = np.concatenate([[0], sqz[:-1]])
    breakout = ((sqz_prev == 1) & (sqz == 0)) | (ae == 1)

    alpha  = 2.0 / 201.0
    ema200 = np.zeros(n)
    ema200[0] = close[0]
    for i in range(1, n):
        ema200[i] = alpha * close[i] + (1 - alpha) * ema200[i - 1]
    trending = (close > ema200) & (sup == 1) & (adx == 1)

    regime = np.full(n, "RANGING", dtype=object)
    regime[trending]  = "TRENDING"
    regime[breakout]  = "BREAKOUT"
    regime[risk_off]  = "RISK-OFF"
    return pd.Series(regime, index=df.index)


def _ic(votes: np.ndarray, outcomes: np.ndarray) -> float | None:
    mask = ~np.isnan(votes) & ~np.isnan(outcomes) & (votes != 0)
    if mask.sum() < MIN_TRADES:
        return None
    r, _ = spearmanr(votes[mask], outcomes[mask])
    return round(float(r), 5) if not np.isnan(r) else None


def _slope(ic_series: list[float | None]) -> float | None:
    vals = [v for v in ic_series if v is not None]
    if len(vals) < 2:
        return None
    x = np.arange(len(vals))
    slope = np.polyfit(x, vals, 1)[0]
    return round(float(slope), 6)


def run() -> dict:
    conn = sqlite3.connect(SIGNAL_DB)
    # Include price cols for regime labeling
    price_cols = ["ts", "close", "atr_pct", "squeeze", "v_SUPERTREND", "v_ADX_TREND", "v_ATR_EXP"]
    sig_cols   = [f"v_{s}" for s in SIGNALS]
    pragma_cols = {r[1] for r in conn.execute("PRAGMA table_info(signal_log)")}
    sel_cols = [c for c in price_cols + sig_cols + [OUTCOME_COL] if c in pragma_cols]
    sel_cols = list(dict.fromkeys(sel_cols))  # dedup preserve order

    df = pd.read_sql_query(
        f"SELECT {', '.join(sel_cols)} FROM signal_log "
        f"WHERE ts IS NOT NULL AND {OUTCOME_COL} IS NOT NULL",
        conn,
    )
    conn.close()

    if df.empty:
        return {"error": "signal_log empty"}

    df["ts"] = pd.to_datetime(df["ts"], unit="s", utc=True)
    df = df.sort_values("ts").reset_index(drop=True)

    # Assign regime per bar
    df["_regime"] = _assign_regime_col(df)

    t_start = df["ts"].min()
    t_end   = df["ts"].max()
    log.info("Loaded %d rows, range %s → %s", len(df), t_start.date(), t_end.date())

    results: dict[str, dict] = {}

    for sig in SIGNALS:
        col = f"v_{sig}"
        if col not in df.columns:
            continue

        home_regime = SIGNAL_HOME_REGIME[sig]
        regime_df   = df[df["_regime"] == home_regime]

        # Global IC windows (for display / trending context)
        global_windows: list[dict] = []
        t = t_start
        while t + timedelta(days=WINDOW_DAYS) <= t_end:
            t_win_end = t + timedelta(days=WINDOW_DAYS)
            mask  = (df["ts"] >= t) & (df["ts"] < t_win_end)
            sub   = df[mask]
            ic    = _ic(sub[col].values, sub[OUTCOME_COL].values)
            global_windows.append({"start": str(t.date()), "ic": ic, "n": int(mask.sum())})
            t += timedelta(days=STEP_DAYS)

        global_ic_series = [w["ic"] for w in global_windows]
        global_latest    = next((v for v in reversed(global_ic_series) if v is not None), None)

        # Regime IC windows (the TRUTH for retirement)
        regime_windows: list[dict] = []
        t = t_start
        while t + timedelta(days=WINDOW_DAYS) <= t_end:
            t_win_end = t + timedelta(days=WINDOW_DAYS)
            mask  = (regime_df["ts"] >= t) & (regime_df["ts"] < t_win_end)
            sub   = regime_df[mask]
            ic    = _ic(sub[col].values, sub[OUTCOME_COL].values)
            regime_windows.append({"start": str(t.date()), "ic": ic, "n": int(mask.sum())})
            t += timedelta(days=STEP_DAYS)

        regime_ic_series = [w["ic"] for w in regime_windows]
        regime_latest    = next((v for v in reversed(regime_ic_series) if v is not None), None)
        recent_regime    = [v for v in regime_ic_series[-SLOPE_WINDOW:] if v is not None]
        regime_slope     = _slope(recent_regime) if len(recent_regime) >= 2 else None

        # RETIRE rule: regime IC <= 0 for 3 consecutive windows
        recent_nonzero = [v for v in regime_ic_series[-SLOPE_WINDOW:] if v is not None]
        retire_flag = (
            len(recent_nonzero) >= SLOPE_WINDOW
            and all(v <= 0 for v in recent_nonzero)
        )

        if retire_flag:
            status = "RETIRE"
        elif regime_latest is not None and regime_latest <= 0:
            status = "SLOW"
        elif regime_slope is not None and regime_slope < -0.0003:
            status = "DECLINING"
        elif regime_latest is not None and regime_latest > 0.005:
            status = "HEALTHY"
        else:
            status = "WATCH"

        results[sig] = {
            "status":           status,
            "home_regime":      home_regime,
            "regime_ic_latest": regime_latest,
            "regime_ic_slope":  regime_slope,
            "global_ic_latest": global_latest,
            "retire_flag":      retire_flag,
            "regime_windows":   regime_windows[-10:],
            "global_windows":   global_windows[-10:],
        }
        log.info(
            "  %-20s home=%-10s regime_ic=%s  global_ic=%s  status=%s",
            sig, home_regime, regime_latest, global_latest, status,
        )

    summary = {
        "generated_at":    datetime.now().isoformat(timespec="seconds"),
        "window_days":     WINDOW_DAYS,
        "retire_rule":     "regime_IC[home_regime] <= 0 for 3 consecutive windows",
        "retire_alerts":   [s for s, r in results.items() if r["retire_flag"]],
        "slow":            [s for s, r in results.items() if r["status"] == "SLOW"],
        "declining":       [s for s, r in results.items() if r["status"] == "DECLINING"],
        "healthy":         [s for s, r in results.items() if r["status"] == "HEALTHY"],
        "watch":           [s for s, r in results.items() if r["status"] == "WATCH"],
        "signals":         results,
    }
    REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT_OUT.write_text(json.dumps(summary, indent=2))
    log.info("IC monitor report → %s  alerts=%s", REPORT_OUT, summary["retire_alerts"])
    return summary


if __name__ == "__main__":
    out = run()
    print(f"\nRETIRE alerts: {out['retire_alerts']}")
    print(f"SLOW:          {out['slow']}")
    print(f"DECLINING:     {out['declining']}")
    print(f"HEALTHY:       {out['healthy']}")
    print(f"WATCH:         {out['watch']}")
    print()
    print(f"  {'Signal':20s} {'Home':10s} {'RegimeIC':>9s} {'GlobalIC':>9s} {'Status'}")
    for sig, r in out["signals"].items():
        print(f"  {sig:20s} {r['home_regime']:10s} {str(r['regime_ic_latest']):>9s} {str(r['global_ic_latest']):>9s} {r['status']}")
