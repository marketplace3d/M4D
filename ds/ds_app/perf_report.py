"""
ds_app/perf_report.py — Phase 8: Zipline-style Performance Report Generator

Simulates an equity curve from signal_log.db using the regime-routed signal map.
Computes institutional tear-sheet metrics.
Outputs ds/data/perf_report.json for M3D API + M6D React charts.

Usage:
  python ds_app/perf_report.py
  python ds_app/perf_report.py --horizon 4h --symbols ES NQ CL
  python ds_app/perf_report.py --signal DON_BO   # single-signal report
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
REGIME_MAP = _DS_ROOT / "data" / "regime_signal_map.json"
OUT = _DS_ROOT / "data" / "perf_report.json"

# regime-routing: first signal listed per regime is the primary
DEFAULT_ROUTING = {
    "TRENDING":  ["TREND_SMA", "MACD_CROSS", "CONSEC_BULL"],
    "RANGING":   ["VOL_BO", "DON_BO", "KC_BREAK"],
    "BREAKOUT":  ["GOLDEN", "DON_BO", "OBV_TREND"],
    "RISK-OFF":  ["SUPERTREND", "DON_BO"],
}

ANNUAL_MAP = {"1h": 252 * 24, "4h": 252 * 6, "1d": 252}


# ── helpers ────────────────────────────────────────────────────────────────────
def _sharpe(r: np.ndarray, annual: int) -> float:
    r = r[~np.isnan(r)]
    if len(r) < 10:
        return np.nan
    sd = r.std(ddof=1)
    return float(r.mean() / sd * np.sqrt(annual)) if sd > 0 else np.nan


def _max_dd(equity: np.ndarray) -> float:
    peak = np.maximum.accumulate(equity)
    dd = (equity - peak) / peak
    return float(dd.min())


def _calmar(total_ret: float, max_dd: float, n_years: float) -> float:
    if max_dd == 0:
        return np.nan
    ann_ret = (1 + total_ret) ** (1 / n_years) - 1
    return float(ann_ret / abs(max_dd))


def _sortino(r: np.ndarray, annual: int) -> float:
    r = r[~np.isnan(r)]
    if len(r) < 10:
        return np.nan
    downside = r[r < 0]
    if len(downside) == 0:
        return np.nan
    dsd = downside.std(ddof=1)
    return float(r.mean() / dsd * np.sqrt(annual)) if dsd > 0 else np.nan


def _rolling_sharpe(returns: pd.Series, window: int, annual: int) -> pd.Series:
    def _s(x: np.ndarray) -> float:
        if len(x) < 10:
            return np.nan
        sd = x.std(ddof=1)
        return float(x.mean() / sd * np.sqrt(annual)) if sd > 0 else np.nan

    return returns.rolling(window).apply(_s, raw=True)


def _monthly_heatmap(equity: pd.Series) -> list[dict]:
    """Returns list of {year, month, return_pct} for React heatmap."""
    monthly = equity.resample("ME").last()
    monthly_ret = monthly.pct_change().dropna()
    rows = []
    for ts, r in monthly_ret.items():
        rows.append({
            "year": ts.year,
            "month": ts.month,
            "return_pct": round(float(r * 100), 2),
        })
    return rows


def _underwater(equity: pd.Series) -> list[dict]:
    peak = equity.expanding().max()
    dd = ((equity - peak) / peak * 100).round(3)
    return [{"ts": int(ts.timestamp()), "dd_pct": float(v)} for ts, v in dd.items()]


def label_regime(df: pd.DataFrame) -> pd.Series:
    df = df.reset_index(drop=True)
    atr = df["atr_pct"].fillna(0)
    atr_hi = atr > atr.quantile(0.75)
    sqz = df["squeeze"].fillna(0).astype(int)
    sup = df.get("v_SUPERTREND", pd.Series(0, index=df.index)).fillna(0)
    adx = df.get("v_ADX_TREND", pd.Series(0, index=df.index)).fillna(0)
    atr_exp = df.get("v_ATR_EXP", pd.Series(0, index=df.index)).fillna(0)
    ema200 = df["close"].ewm(span=200, adjust=False).mean()
    above = (df["close"] > ema200).astype(int)
    mom12 = df["close"].pct_change(12).fillna(0)

    risk_off = atr_hi & (mom12 < -0.015)
    sqz_released = (sqz.shift(1, fill_value=0) == 1) & (sqz == 0)
    breakout = sqz_released | (atr_exp == 1)
    trending = (above == 1) & (sup == 1) & (adx == 1)

    r = pd.Series("RANGING", index=df.index)
    r[trending] = "TRENDING"
    r[breakout] = "BREAKOUT"
    r[risk_off] = "RISK-OFF"
    return r


def simulate_equity(
    df: pd.DataFrame,
    routing: dict[str, list[str]],
    horizon: str,
    annual: int,
) -> pd.Series:
    """
    Simulates an equal-weight regime-routed equity curve.
    Entry when ANY signal in the active regime votes +1.
    Return = outcome_{horizon}_pct for that bar.
    """
    outcome_col = f"outcome_{horizon}_pct"
    df = df.dropna(subset=[outcome_col]).reset_index(drop=True)
    df["regime"] = label_regime(df)

    entry = pd.Series(False, index=df.index)
    for reg, sig_ids in routing.items():
        reg_mask = df["regime"] == reg
        for sid in sig_ids:
            vcol = f"v_{sid}"
            if vcol in df.columns:
                entry |= (reg_mask & (df[vcol] == 1))

    trades = df[entry].copy()
    if trades.empty:
        return pd.Series(dtype=float)

    trades["ret"] = trades[outcome_col] / 100.0
    # sort by ts for time-series equity
    trades = trades.sort_values("ts")
    trades["ts_dt"] = pd.to_datetime(trades["ts"], unit="s")
    trades = trades.set_index("ts_dt")

    # daily mean return (equal-weight across all fires that day)
    daily = trades["ret"].resample("D").mean()
    equity = (1 + daily).cumprod()
    return equity


# ── main ──────────────────────────────────────────────────────────────────────
def run(horizon: str, symbols: list[str] | None, signal: str | None) -> None:
    annual = ANNUAL_MAP[horizon]

    # load routing
    routing = DEFAULT_ROUTING.copy()
    if REGIME_MAP.exists():
        with open(REGIME_MAP) as f:
            rm = json.load(f)
        for reg, sigs in rm.items():
            routing[reg] = [s["algo_id"] for s in sigs[:3]]

    if signal:
        # single-signal mode: always use this signal
        routing = {r: [signal] for r in routing}

    con = sqlite3.connect(SIGNAL_DB)
    avail = [r[0] for r in con.execute("SELECT DISTINCT symbol FROM signal_log ORDER BY symbol")]
    targets = [s for s in avail if not symbols or s in symbols]
    print(f"Perf Report — horizon={horizon} — {targets}")

    # load
    outcome_col = f"outcome_{horizon}_pct"
    vote_cols = [f"v_{a}" for a in ALL_ALGO_IDS]
    base = ["ts", "symbol", "close", "atr_pct", "squeeze", outcome_col]
    seen: set = set()
    sel = [c for c in base + vote_cols if not (c in seen or seen.add(c))]  # type: ignore

    sym_str = "','".join(targets)
    df = pd.read_sql_query(
        f"SELECT {', '.join(sel)} FROM signal_log WHERE symbol IN ('{sym_str}') ORDER BY ts",
        con,
    )
    con.close()
    print(f"  {len(df):,} rows loaded")

    # simulate equity per symbol then average
    equities: list[pd.Series] = []
    for sym in targets:
        df_sym = df[df["symbol"] == sym].copy()
        eq = simulate_equity(df_sym, routing, horizon, annual)
        if not eq.empty:
            equities.append(eq)

    if not equities:
        print("No equity curves generated.")
        return

    # align and average
    combined = pd.concat(equities, axis=1).ffill().mean(axis=1)
    combined = combined.dropna()

    daily_ret = combined.pct_change().dropna()
    ret_arr = daily_ret.values

    total_ret = float(combined.iloc[-1] - 1)
    n_years = (combined.index[-1] - combined.index[0]).days / 365.25
    mdd = _max_dd(combined.values)

    kpis = {
        "total_return_pct": round(total_ret * 100, 2),
        "annualized_return_pct": round(((1 + total_ret) ** (1 / max(n_years, 0.01)) - 1) * 100, 2),
        "sharpe": round(_sharpe(ret_arr, 252) or 0, 3),
        "sortino": round(_sortino(ret_arr, 252) or 0, 3),
        "max_drawdown_pct": round(mdd * 100, 2),
        "calmar": round(_calmar(total_ret, mdd, max(n_years, 0.01)) or 0, 3),
        "win_rate": round(float((ret_arr > 0).mean()), 3),
        "n_days": int(len(daily_ret)),
        "n_years": round(n_years, 2),
        "symbols": targets,
        "horizon": horizon,
    }

    # rolling sharpe (30d, 90d)
    roll_30 = _rolling_sharpe(daily_ret, 30, 252).round(3)
    roll_90 = _rolling_sharpe(daily_ret, 90, 252).round(3)

    equity_curve = [
        {"ts": int(ts.timestamp()), "equity": round(float(v), 6)}
        for ts, v in combined.items()
    ]
    rolling_sharpe_30 = [
        {"ts": int(ts.timestamp()), "sharpe": float(v) if not np.isnan(v) else None}
        for ts, v in roll_30.items()
    ]
    rolling_sharpe_90 = [
        {"ts": int(ts.timestamp()), "sharpe": float(v) if not np.isnan(v) else None}
        for ts, v in roll_90.items()
    ]
    monthly_hm = _monthly_heatmap(combined)
    underwater = _underwater(combined)

    # per-signal contribution
    signal_contrib: list[dict] = []
    for a in ALL_ALGO_IDS:
        vcol = f"v_{a}"
        if vcol not in df.columns:
            continue
        fired = df[df[vcol] == 1].dropna(subset=[outcome_col])
        if len(fired) < 10:
            continue
        r = fired[outcome_col].values / 100.0
        s = _sharpe(r, annual)
        signal_contrib.append({
            "algo_id": a,
            "sharpe": round(s, 3) if not np.isnan(s) else None,
            "n_trades": len(fired),
            "avg_ret_pct": round(float(r.mean() * 100), 4),
            "hit_rate": round(float((r > 0).mean()), 3),
        })
    signal_contrib.sort(key=lambda x: x["sharpe"] or -999, reverse=True)

    report = {
        "generated_at": pd.Timestamp.now().isoformat(),
        "kpis": kpis,
        "equity_curve": equity_curve,
        "rolling_sharpe_30d": rolling_sharpe_30,
        "rolling_sharpe_90d": rolling_sharpe_90,
        "monthly_heatmap": monthly_hm,
        "underwater": underwater,
        "signal_contributions": signal_contrib,
        "routing_used": routing,
    }

    with open(OUT, "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"\n══ TEAR SHEET ══")
    print(f"  Total Return:     {kpis['total_return_pct']:+.1f}%")
    print(f"  Ann. Return:      {kpis['annualized_return_pct']:+.1f}%")
    print(f"  Sharpe (daily):   {kpis['sharpe']:.3f}")
    print(f"  Sortino:          {kpis['sortino']:.3f}")
    print(f"  Max Drawdown:     {kpis['max_drawdown_pct']:.1f}%")
    print(f"  Calmar:           {kpis['calmar']:.3f}")
    print(f"  Win Rate:         {kpis['win_rate']:.1%}")
    print(f"  Period:           {kpis['n_years']:.1f} years / {kpis['n_days']} days")
    print(f"\n✓ Report → {OUT}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", default="4h", choices=["1h", "4h", "1d"])
    ap.add_argument("--symbols", nargs="*")
    ap.add_argument("--signal", default=None, help="single signal mode")
    args = ap.parse_args()
    run(args.horizon, args.symbols, args.signal)
