"""
futures_walkforward.py — Futures Walk-Forward Validation Engine

Reads bars_1m from futures.db, resamples to 5m, computes all 23 signals
vectorized via feat_* functions, applies 7-regime classification,
runs rolling walk-forward with IS/OOS Sharpe + IC + regime-conditional IC.

No dependency on signal_log.db — runs directly on OHLCV history.

Output: data/futures_walkforward_report.json
CLI:    python ds_app/futures_walkforward.py --sym ES --years 3
API:    POST /v1/futures/wf/run/?sym=ES&years=3
        GET  /v1/futures/wf/
"""
from __future__ import annotations

import json
import logging
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

log = logging.getLogger("futures_wf")
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(name)s %(levelname)s %(message)s")

FUTURES_DB = _DS_ROOT / "data" / "futures.db"
OUT_PATH   = _DS_ROOT / "data" / "futures_walkforward_report.json"

TRAIN_DAYS   = 90
TEST_DAYS    = 30
STEP_DAYS    = 15
EMBARGO_DAYS = 3
OUTCOME_LAG  = 12    # 12 × 5m = 60min forward return
THRESHOLD    = 0.5
MIN_OBS      = 50
BARS_PER_DAY = 78    # RTH 5m bars (6.5h × 12); used for Sharpe annualisation

SIGNAL_COLS = [
    "DON_BO", "BB_BREAK", "KC_BREAK", "SQZPOP", "ATR_EXP", "VOL_BO",
    "CONSOL_BO", "NEW_HIGH", "RANGE_BO", "EMA_CROSS", "EMA_STACK",
    "MACD_CROSS", "SUPERTREND", "ADX_TREND", "GOLDEN", "PSAR",
    "PULLBACK", "TREND_SMA", "RSI_CROSS", "RSI_STRONG", "ROC_MOM",
    "VOL_SURGE", "CONSEC_BULL",
    # Discovery signals validated on ES 3yr WF (2026-04-24)
    "RANGE_POS", "EMA_DIST", "VWAP_DEV",
]

REGIMES_7 = [
    "RISK-OFF", "EXHAUSTION", "SQUEEZE", "BREAKOUT",
    "TRENDING_STRONG", "TRENDING_WEAK", "RANGING",
]


# ── Bar loader ─────────────────────────────────────────────────────────────────

def _load_bars(symbol: str, years: int = 3) -> pd.DataFrame:
    cutoff = int(time.time()) - years * 366 * 86400
    conn   = sqlite3.connect(FUTURES_DB)
    rows   = conn.execute(
        "SELECT ts,open,high,low,close,volume FROM bars_1m "
        "WHERE symbol=? AND ts>=? ORDER BY ts",
        (symbol.upper(), cutoff),
    ).fetchall()
    conn.close()
    if len(rows) < 500:
        raise RuntimeError(f"Insufficient bars for {symbol}: {len(rows)}")
    df = pd.DataFrame(rows, columns=["ts", "Open", "High", "Low", "Close", "Volume"])
    df["ts"] = pd.to_datetime(df["ts"], unit="s", utc=True)
    df = df.set_index("ts").astype(float)
    df5 = df.resample("5min").agg(
        {"Open": "first", "High": "max", "Low": "min",
         "Close": "last", "Volume": "sum"}
    ).dropna(subset=["Close"])
    log.info("Loaded %s: %d 1m bars → %d 5m bars (%d years)",
             symbol, len(rows), len(df5), years)
    return df5


# ── Vectorized signal computation ─────────────────────────────────────────────

def _compute_signals(df: pd.DataFrame) -> pd.DataFrame:
    from ds_app.algos_crypto import (
        feat_DON_BO, feat_BB_BREAK, feat_KC_BREAK, feat_SQZPOP, feat_ATR_EXP,
        feat_VOL_BO, feat_CONSOL_BO, feat_NEW_HIGH, feat_RANGE_BO,
        feat_EMA_CROSS, feat_EMA_STACK, feat_MACD_CROSS, feat_SUPERTREND,
        feat_ADX_TREND, feat_GOLDEN, feat_PSAR, feat_PULLBACK, feat_TREND_SMA,
        feat_RSI_CROSS, feat_RSI_STRONG, feat_ROC_MOM, feat_VOL_SURGE,
        feat_CONSEC_BULL, feat_RANGE_POS, feat_EMA_DIST, feat_VWAP_DEV,
    )
    fn_map = {
        "DON_BO": feat_DON_BO, "BB_BREAK": feat_BB_BREAK,
        "KC_BREAK": feat_KC_BREAK, "SQZPOP": feat_SQZPOP,
        "ATR_EXP": feat_ATR_EXP, "VOL_BO": feat_VOL_BO,
        "CONSOL_BO": feat_CONSOL_BO, "NEW_HIGH": feat_NEW_HIGH,
        "RANGE_BO": feat_RANGE_BO, "EMA_CROSS": feat_EMA_CROSS,
        "EMA_STACK": feat_EMA_STACK, "MACD_CROSS": feat_MACD_CROSS,
        "SUPERTREND": feat_SUPERTREND, "ADX_TREND": feat_ADX_TREND,
        "GOLDEN": feat_GOLDEN, "PSAR": feat_PSAR,
        "PULLBACK": feat_PULLBACK, "TREND_SMA": feat_TREND_SMA,
        "RSI_CROSS": feat_RSI_CROSS, "RSI_STRONG": feat_RSI_STRONG,
        "ROC_MOM": feat_ROC_MOM, "VOL_SURGE": feat_VOL_SURGE,
        "CONSEC_BULL": feat_CONSEC_BULL,
        "RANGE_POS": feat_RANGE_POS, "EMA_DIST": feat_EMA_DIST,
        "VWAP_DEV": feat_VWAP_DEV,
    }
    result: dict[str, pd.Series] = {}
    for sig, fn in fn_map.items():
        try:
            out = fn(df.copy(), {})
            entry = out.get("entry", pd.Series(False, index=df.index))
            result[f"v_{sig}"] = entry.fillna(False).astype(int).reindex(df.index, fill_value=0)
        except Exception as exc:
            log.warning("Signal %s failed: %s", sig, exc)
            result[f"v_{sig}"] = pd.Series(0, index=df.index, dtype=int)
    return pd.DataFrame(result, index=df.index)


# ── Weight fitter ─────────────────────────────────────────────────────────────

def _fit_weights(sigs: np.ndarray, outcomes: np.ndarray) -> np.ndarray:
    valid = ~np.isnan(outcomes)
    weights = np.zeros(len(SIGNAL_COLS))
    for i in range(len(SIGNAL_COLS)):
        fired = valid & (sigs[:, i] == 1)
        n = int(fired.sum())
        if n < 10:
            continue
        rets = outcomes[fired]
        mu, sigma = float(rets.mean()), float(rets.std())
        if sigma < 1e-9:
            continue
        weights[i] = max(0.0, mu / sigma * np.sqrt(252 * BARS_PER_DAY))
    total = weights.sum()
    if total < 1e-9:
        return np.full(len(SIGNAL_COLS), 1.0 / len(SIGNAL_COLS))
    return weights / total


# ── Fold evaluator ────────────────────────────────────────────────────────────

def _eval_window(sigs: np.ndarray, outcomes: np.ndarray,
                 weights: np.ndarray, regimes: np.ndarray) -> dict:
    valid = ~np.isnan(outcomes)
    score = np.clip((sigs * weights).sum(axis=1), 0.0, 1.0)
    traded = valid & (score >= THRESHOLD)
    rets = outcomes[traded]
    n = int(traded.sum())

    if n < 5:
        return {"n_trades": n, "sharpe": None, "hit_rate": None,
                "mean_ret": None, "regime_bd": {}}

    mu, sigma = float(rets.mean()), float(rets.std())
    sharpe   = float(mu / sigma * np.sqrt(252 * BARS_PER_DAY)) if sigma > 1e-9 else 0.0
    hit_rate = float((rets > 0).mean())

    regime_bd: dict = {}
    for rg in REGIMES_7:
        mask = traded & (regimes == rg)
        rg_rets = outcomes[mask]
        if rg_rets.size < 3:
            continue
        rg_mu, rg_sig = float(rg_rets.mean()), float(rg_rets.std())
        rg_sh = float(rg_mu / rg_sig * np.sqrt(252 * BARS_PER_DAY)) if rg_sig > 1e-9 else 0.0
        regime_bd[rg] = {"sharpe": round(rg_sh, 3), "n": int(mask.sum())}

    return {
        "n_trades": n,
        "sharpe":   round(sharpe, 3),
        "hit_rate": round(hit_rate, 3),
        "mean_ret": round(mu, 6),
        "regime_bd": regime_bd,
    }


# ── Main walk-forward engine ──────────────────────────────────────────────────

def run_walkforward(symbol: str = "ES", years: int = 3) -> dict:
    t0 = time.time()
    log.info("Futures walk-forward: symbol=%s  years=%d", symbol, years)

    df       = _load_bars(symbol, years)
    n        = len(df)
    log.info("Computing %d signals on %d bars…", len(SIGNAL_COLS), n)
    sigs_df  = _compute_signals(df)

    from ds_app.regime_engine import classify_series
    regimes_s  = classify_series(df, smooth_window=3)
    outcomes_s = df["Close"].pct_change(OUTCOME_LAG).shift(-OUTCOME_LAG)

    # Vol-normalized outcomes: divide by expected vol over holding period.
    # Simulates constant-vol position sizing — prevents high-vol folds from
    # dominating IS weight fitting and Sharpe calculation.
    log_ret    = np.diff(np.log(np.where(df["Close"].values > 0, df["Close"].values, 1e-9)))
    rvol_20    = pd.Series(log_ret).rolling(20).std().bfill().values
    rvol_20    = np.concatenate([[rvol_20[0]], rvol_20])
    hold_vol   = np.where(rvol_20 > 1e-5, rvol_20 * np.sqrt(OUTCOME_LAG), 1.0)
    outcomes_vol = outcomes_s.values / hold_vol   # vol-normalized returns

    v_cols   = [f"v_{s}" for s in SIGNAL_COLS]
    sigs     = sigs_df[v_cols].values.astype(float)
    regimes  = regimes_s.values
    outcomes = outcomes_vol          # use vol-normalized for WF fitting + IC
    outcomes_raw = outcomes_s.values # kept for regime_bd display
    ts_arr   = (df.index.astype(np.int64) // 10 ** 9).values

    ts_start    = int(ts_arr[0])
    ts_end      = int(ts_arr[-1])
    train_sec   = TRAIN_DAYS   * 86400
    test_sec    = TEST_DAYS    * 86400
    embargo_sec = EMBARGO_DAYS * 86400
    step_sec    = STEP_DAYS    * 86400

    log.info("Building folds (train=%dd test=%dd step=%dd)…",
             TRAIN_DAYS, TEST_DAYS, STEP_DAYS)

    folds: list[dict] = []
    fold_idx     = 0
    window_start = ts_start

    while True:
        train_start = window_start
        train_end   = train_start + train_sec
        test_start  = train_end   + embargo_sec
        test_end    = test_start  + test_sec
        if test_end > ts_end:
            break

        tr_mask = (ts_arr >= train_start) & (ts_arr < train_end)
        te_mask = (ts_arr >= test_start)  & (ts_arr < test_end)
        if tr_mask.sum() < 500 or te_mask.sum() < 100:
            window_start += step_sec
            continue

        weights    = _fit_weights(sigs[tr_mask], outcomes[tr_mask])
        is_result  = _eval_window(sigs[tr_mask], outcomes[tr_mask], weights, regimes[tr_mask])
        oos_result = _eval_window(sigs[te_mask], outcomes[te_mask], weights, regimes[te_mask])

        # Ensemble IC on OOS
        valid_te   = te_mask & ~np.isnan(outcomes)
        score_oos  = np.clip((sigs[valid_te] * weights).sum(axis=1), 0.0, 1.0)
        outs_oos   = outcomes[valid_te]
        ic_val     = None
        if len(score_oos) >= 10:
            rho, _ = spearmanr(score_oos, outs_oos)
            ic_val = round(float(rho), 5) if not np.isnan(rho) else None

        # Per-signal OOS IC
        sig_ic: dict[str, float | None] = {}
        for i, sig in enumerate(SIGNAL_COLS):
            v = sigs[valid_te, i]
            if (v != 0).sum() < 10:
                sig_ic[sig] = None
                continue
            rho, _ = spearmanr(v, outs_oos)
            sig_ic[sig] = round(float(rho), 5) if not np.isnan(rho) else None

        # Per-signal per-regime IC
        sig_ic_regime: dict[str, dict] = {}
        for i, sig in enumerate(SIGNAL_COLS):
            sig_ic_regime[sig] = {}
            for rg in REGIMES_7:
                rg_mask = valid_te & (regimes == rg)
                if rg_mask.sum() < 20:
                    continue
                v = sigs[rg_mask, i]
                if (v != 0).sum() < 8:
                    continue
                rho, _ = spearmanr(v, outcomes[rg_mask])
                if not np.isnan(rho):
                    sig_ic_regime[sig][rg] = round(float(rho), 5)

        is_oos_ratio = None
        if is_result["sharpe"] and oos_result["sharpe"] and abs(is_result["sharpe"]) > 0.01:
            is_oos_ratio = round(oos_result["sharpe"] / abs(is_result["sharpe"]), 3)

        def _fmt_date(ts: int) -> str:
            return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")

        folds.append({
            "fold":           fold_idx,
            "train_start":    _fmt_date(train_start),
            "train_end":      _fmt_date(train_end),
            "test_start":     _fmt_date(test_start),
            "test_end":       _fmt_date(test_end),
            "n_train_bars":   int(tr_mask.sum()),
            "n_test_bars":    int(te_mask.sum()),
            "is":             is_result,
            "oos":            oos_result,
            "is_oos_ratio":   is_oos_ratio,
            "ic":             ic_val,
            "sig_ic":         sig_ic,
            "sig_ic_regime":  sig_ic_regime,
            "top_weights":    sorted(
                [(SIGNAL_COLS[i], round(float(weights[i]), 4)) for i in range(len(SIGNAL_COLS)) if weights[i] > 0.02],
                key=lambda x: -x[1],
            )[:8],
        })
        fold_idx     += 1
        window_start += step_sec

    if not folds:
        return {"ok": False, "error": "No folds produced — check data range and parameters"}

    # ── Summary ───────────────────────────────────────────────────────────────
    oos_sharpes = [f["oos"]["sharpe"] for f in folds if f["oos"]["sharpe"] is not None]
    is_sharpes  = [f["is"]["sharpe"]  for f in folds if f["is"]["sharpe"]  is not None]
    ic_vals     = [f["ic"] for f in folds if f["ic"] is not None]
    ios_ratios  = [f["is_oos_ratio"] for f in folds if f["is_oos_ratio"] is not None]

    def _stats(arr: list) -> dict:
        if not arr:
            return {}
        a = np.array(arr, dtype=float)
        return {
            "mean":         round(float(a.mean()), 3),
            "median":       round(float(np.median(a)), 3),
            "std":          round(float(a.std()),  3),
            "min":          round(float(a.min()),  3),
            "max":          round(float(a.max()),  3),
            "p25":          round(float(np.percentile(a, 25)), 3),
            "p75":          round(float(np.percentile(a, 75)), 3),
            "pct_positive": round(float((a > 0).mean()), 3),
        }

    # ── Signal lifecycle ──────────────────────────────────────────────────────
    signal_lifecycle: dict[str, dict] = {}
    for sig in SIGNAL_COLS:
        ic_series = [
            f["sig_ic"].get(sig) for f in folds
            if f.get("sig_ic", {}).get(sig) is not None
        ]
        if len(ic_series) < 3:
            signal_lifecycle[sig] = {
                "status": "INSUFFICIENT_DATA", "ic_mean": None,
                "regime_ic": {}, "best_regime": None,
            }
            continue
        arr      = np.array(ic_series, dtype=float)
        ic_mean  = float(arr.mean())
        pct_pos  = float((arr > 0).mean())
        slope    = float(np.polyfit(np.arange(len(arr)), arr, 1)[0])

        regime_ic: dict[str, dict] = {}
        for rg in REGIMES_7:
            rg_vals = [
                f.get("sig_ic_regime", {}).get(sig, {}).get(rg)
                for f in folds
                if f.get("sig_ic_regime", {}).get(sig, {}).get(rg) is not None
            ]
            if len(rg_vals) < 2:
                continue
            rg_arr   = np.array(rg_vals, dtype=float)
            rg_mean  = float(rg_arr.mean())
            rg_slope = float(np.polyfit(np.arange(len(rg_arr)), rg_arr, 1)[0]) if len(rg_arr) >= 3 else 0.0
            rg_pct   = float((rg_arr > 0).mean())
            regime_ic[rg] = {
                "mean":    round(rg_mean, 5),
                "slope":   round(rg_slope, 7),
                "status":  "ALIVE" if rg_mean > 0 and rg_pct >= 0.5 else
                           "DEAD"  if rg_mean < 0 and rg_pct < 0.3  else "MIXED",
                "n_folds": len(rg_vals),
            }

        positive_regimes = {rg: v["mean"] for rg, v in regime_ic.items() if v["mean"] > 0}
        best_regime = max(positive_regimes, key=positive_regimes.get) if positive_regimes else None

        status = (
            "DEAD"              if ic_mean < 0 and pct_pos < 0.3 and not positive_regimes else
            "REGIME_SPECIALIST" if ic_mean < 0 and positive_regimes else
            "RISING"            if slope > 0.0002 and ic_mean > 0 else
            "ALIVE"             if ic_mean > 0 and pct_pos >= 0.5 else
            "PROBATION"
        )
        signal_lifecycle[sig] = {
            "status":       status,
            "ic_mean":      round(ic_mean, 5),
            "ic_slope":     round(slope, 7),
            "pct_positive": round(pct_pos, 3),
            "ic_history":   [round(v, 5) for v in arr.tolist()],
            "regime_ic":    regime_ic,
            "best_regime":  best_regime,
        }

    oos_mean    = float(np.mean(oos_sharpes)) if oos_sharpes else 0.0
    oos_std     = float(np.std(oos_sharpes))  if oos_sharpes else 1.0
    is_oos_mean = float(np.mean(ios_ratios))  if ios_ratios  else 0.0
    ic_slope    = (
        round(float(np.polyfit(np.arange(len(ic_vals)), np.array(ic_vals), 1)[0]), 6)
        if len(ic_vals) >= 4 else None
    )

    # Regime summary across all folds
    regime_summary: dict[str, dict] = {}
    for rg in REGIMES_7:
        sharpes = [
            f["oos"]["regime_bd"].get(rg, {}).get("sharpe")
            for f in folds
            if f["oos"]["regime_bd"].get(rg)
        ]
        sharpes = [s for s in sharpes if s is not None]
        if sharpes:
            a = np.array(sharpes, dtype=float)
            regime_summary[rg] = {
                "mean_sharpe":  round(float(a.mean()), 3),
                "pct_positive": round(float((a > 0).mean()), 3),
                "n_folds":      len(sharpes),
            }

    gates = {
        "oos_sharpe_positive":  oos_mean > 0,
        "oos_stability_ok":     (oos_std < 0.3 * abs(oos_mean)) if oos_mean != 0 else False,
        "is_oos_ratio_ok":      is_oos_mean > 0.4,
        "regime_consistency_ok": sum(
            1 for v in regime_summary.values() if v.get("pct_positive", 0) > 0.5
        ) >= 3,
        "ic_not_decaying":      ic_slope is not None and ic_slope >= 0,
    }
    gates_passed = sum(gates.values())
    verdict = (
        "ROBUST"    if gates_passed >= 5 else
        "PROMISING" if gates_passed >= 3 else
        "FRAGILE"   if gates_passed >= 2 else
        "OVERFIT"
    )

    elapsed = round(time.time() - t0, 1)
    report = {
        "ok":           True,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "symbol":       symbol,
        "years":        years,
        "n_bars":       n,
        "elapsed_s":    elapsed,
        "config": {
            "train_days":   TRAIN_DAYS,
            "test_days":    TEST_DAYS,
            "step_days":    STEP_DAYS,
            "embargo_days": EMBARGO_DAYS,
            "outcome_lag":  OUTCOME_LAG,
            "threshold":    THRESHOLD,
        },
        "n_folds":          len(folds),
        "summary": {
            "oos_sharpe":   _stats(oos_sharpes),
            "is_sharpe":    _stats(is_sharpes),
            "ic":           _stats(ic_vals),
            "is_oos_ratio": _stats(ios_ratios),
            "ic_slope":     ic_slope,
        },
        "regime_summary":    regime_summary,
        "rentech_gates":     gates,
        "gates_passed":      f"{gates_passed}/5",
        "verdict":           verdict,
        "signal_lifecycle":  signal_lifecycle,
        "retire_candidates": [s for s, v in signal_lifecycle.items() if v["status"] == "DEAD"],
        "specialist_list":   [s for s, v in signal_lifecycle.items() if v["status"] == "REGIME_SPECIALIST"],
        "probation_list":    [s for s, v in signal_lifecycle.items() if v["status"] == "PROBATION"],
        "rising_list":       [s for s, v in signal_lifecycle.items() if v["status"] == "RISING"],
        "folds":             folds,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(report, indent=2))
    log.info("Futures WF report → %s  (%ds)  verdict=%s  OOS=%.3f",
             OUT_PATH, elapsed, verdict, oos_mean)
    return report


def load_latest() -> dict | None:
    if OUT_PATH.exists():
        return json.loads(OUT_PATH.read_text())
    return None


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--sym",   default="ES")
    parser.add_argument("--years", type=int, default=3)
    args = parser.parse_args()

    r = run_walkforward(args.sym, args.years)
    if not r["ok"]:
        print("ERROR:", r.get("error"))
        sys.exit(1)

    print(f"\nVERDICT: {r['verdict']}  ({r['gates_passed']} gates)  {r['elapsed_s']}s")
    print(f"OOS Sharpe  mean={r['summary']['oos_sharpe'].get('mean','?')}  "
          f"median={r['summary']['oos_sharpe'].get('median','?')}  "
          f"std={r['summary']['oos_sharpe'].get('std','?')}")
    print(f"IS/OOS ratio  {r['summary']['is_oos_ratio'].get('mean','?')}")
    print()
    for f in r["folds"]:
        mark = "+" if (f["oos"]["sharpe"] or 0) > 0 else "-"
        print(f"  [{mark}] fold {f['fold']:02d}  {f['test_start']} → {f['test_end']}"
              f"  OOS={f['oos']['sharpe']}  IS/OOS={f['is_oos_ratio']}  IC={f['ic']}")
    print()
    print("RenTech gates:")
    for g, v in r["rentech_gates"].items():
        print(f"  {'OK  ' if v else 'FAIL'}  {g}")
    print()
    print(f"{'Signal':<16} {'Status':<20} {'BestRegime':<16} {'GlobalIC':>8}")
    print("-" * 64)
    for sig, v in sorted(r["signal_lifecycle"].items(),
                         key=lambda x: (x[1].get("ic_mean") or -99), reverse=True):
        ic_m = v.get("ic_mean")
        print(f"{sig:<16} {v.get('status',''):<20} {v.get('best_regime') or '-':<16} "
              f"{ic_m:+.5f}" if ic_m is not None else f"{sig:<16} {v.get('status',''):<20} —")
