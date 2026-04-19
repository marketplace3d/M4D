"""
Walk-Forward Validation Engine — RenTech / Medallion Protocol
=============================================================

Rolling folds on signal_log.db with embargo gap between train/test.
Measures OOS Sharpe stability, IS/OOS ratio, regime consistency,
and IC decay — the 4 core RenTech validation gates.

Configuration (all tunable):
  TRAIN_DAYS  = 90   — 3 months in-sample weight fitting
  TEST_DAYS   = 30   — 1 month forward test
  STEP_DAYS   = 15   — advance by 2 weeks per fold
  EMBARGO_DAYS = 2   — gap (autocorr leakage guard)

For 2yr signal_log: ~42 folds total.

Output: data/walkforward_report.json
"""

import json, pathlib, sqlite3, time
import numpy as np
from datetime import datetime, timedelta

DB_PATH = pathlib.Path(__file__).parent.parent / "data" / "signal_log.db"
OUT_PATH = pathlib.Path(__file__).parent.parent / "data" / "walkforward_report.json"
REGIME_MAP = pathlib.Path(__file__).parent.parent / "data" / "regime_signal_map.json"

TRAIN_DAYS   = 90
TEST_DAYS    = 30
STEP_DAYS    = 15
EMBARGO_DAYS = 2
OUTCOME_COL  = "outcome_4h_pct"
THRESHOLD    = 0.5   # ensemble score threshold to take trade (0..1 normalised)

SIGNAL_COLS = [
    "DON_BO","BB_BREAK","KC_BREAK","SQZPOP","ATR_EXP","VOL_BO","CONSOL_BO",
    "NEW_HIGH","RANGE_BO","EMA_CROSS","EMA_STACK","MACD_CROSS","SUPERTREND",
    "ADX_TREND","GOLDEN","PSAR","PULLBACK","TREND_SMA","RSI_CROSS","RSI_STRONG",
    "ROC_MOM","VOL_SURGE","CONSEC_BULL",
]
V_COLS = [f"v_{s}" for s in SIGNAL_COLS]

REGIME_COLS = {
    "TRENDING": ["v_EMA_STACK","v_MACD_CROSS","v_SUPERTREND","v_ADX_TREND","v_TREND_SMA"],
    "RANGING":  ["v_RSI_CROSS","v_RSI_STRONG","v_STOCH_CROSS","v_MFI_CROSS"],
    "BREAKOUT": ["v_VOL_BO","v_BB_BREAK","v_KC_BREAK","v_SQZPOP","v_ATR_EXP"],
    "RISK-OFF": ["v_OBV_TREND","v_CMF_POS","v_VOL_SURGE"],
}

# ── Data loader ───────────────────────────────────────────────────────────────

def _load_data():
    conn = sqlite3.connect(DB_PATH)
    query = f"""
        SELECT ts, {', '.join(V_COLS)}, {OUTCOME_COL}, rvol
        FROM signal_log
        WHERE {OUTCOME_COL} IS NOT NULL
        ORDER BY ts
    """
    rows = conn.execute(query).fetchall()
    conn.close()
    cols = ["ts"] + V_COLS + [OUTCOME_COL, "rvol"]
    data = {c: np.array([r[i] for r in rows]) for i, c in enumerate(cols)}
    return data

# ── Regime label per bar (simple heuristic on vote counts) ────────────────────

def _regime_labels(data: dict) -> np.ndarray:
    n = len(data["ts"])
    labels = np.full(n, "MIXED", dtype=object)
    for regime, cols in REGIME_COLS.items():
        available = [c for c in cols if c in data]
        if not available:
            continue
        votes = sum(data[c] for c in available) / len(available)
        mask = votes > 0.4
        labels[mask] = regime
    return labels

# ── Per-window weight fitter (Sharpe-weighted) ────────────────────────────────

def _fit_weights(ts_mask: np.ndarray, outcomes: np.ndarray, votes: dict) -> dict:
    """For each signal: Sharpe of returns when signal fired. Normalize to sum=1."""
    weights = {}
    for sig in SIGNAL_COLS:
        v = votes.get(f"v_{sig}")
        if v is None:
            weights[sig] = 0.0
            continue
        fired = ts_mask & (v == 1)
        n = fired.sum()
        if n < 10:
            weights[sig] = 0.0
            continue
        rets = outcomes[fired]
        mu, sigma = rets.mean(), rets.std()
        if sigma < 1e-9:
            weights[sig] = 0.0
            continue
        sharpe = mu / sigma * np.sqrt(252 * 78)   # annualised (78 5m bars/day)
        weights[sig] = max(0.0, sharpe)            # long-only signal weight

    total = sum(weights.values())
    if total < 1e-9:
        return {s: 1.0 / len(SIGNAL_COLS) for s in SIGNAL_COLS}
    return {s: w / total for s, w in weights.items()}

# ── Fold evaluator ────────────────────────────────────────────────────────────

def _eval_fold(ts_mask: np.ndarray, weights: dict, outcomes: np.ndarray,
               votes: dict, regimes: np.ndarray) -> dict:
    # Weighted ensemble score per bar
    score = np.zeros(ts_mask.sum(), dtype=float)
    for sig, w in weights.items():
        v = votes.get(f"v_{sig}")
        if v is not None:
            score += v[ts_mask] * w

    # Normalise to 0..1
    score = np.clip(score, 0, 1)
    traded = score >= THRESHOLD
    rets = outcomes[ts_mask][traded]
    n = traded.sum()

    if n < 5:
        return {"n_trades": int(n), "sharpe": None, "hit_rate": None, "mean_ret": None}

    mu, sigma = rets.mean(), rets.std()
    sharpe = float(mu / sigma * np.sqrt(252 * 78)) if sigma > 1e-9 else 0.0
    hit_rate = float((rets > 0).mean())

    # Regime breakdown
    regime_fold = regimes[ts_mask]
    regime_bd = {}
    for rg in np.unique(regime_fold):
        rg_traded = traded & (regime_fold == rg)
        rg_rets = outcomes[ts_mask][rg_traded]
        if rg_rets.size < 3:
            continue
        rg_mu, rg_sig = rg_rets.mean(), rg_rets.std()
        rg_sharpe = float(rg_mu / rg_sig * np.sqrt(252 * 78)) if rg_sig > 1e-9 else 0.0
        regime_bd[str(rg)] = {"sharpe": round(rg_sharpe, 3), "n": int(rg_traded.sum())}

    return {
        "n_trades":   int(n),
        "sharpe":     round(sharpe, 3),
        "hit_rate":   round(hit_rate, 3),
        "mean_ret":   round(float(mu), 5),
        "regime_bd":  regime_bd,
    }

# ── IS Sharpe for the same fold ───────────────────────────────────────────────

def _eval_equal_weight(ts_mask: np.ndarray, outcomes: np.ndarray, votes: dict) -> float:
    """Equal-weight baseline for comparison."""
    vote_sum = sum(votes[f"v_{s}"][ts_mask] for s in SIGNAL_COLS if f"v_{s}" in votes)
    traded = vote_sum >= (len(SIGNAL_COLS) * THRESHOLD)
    rets = outcomes[ts_mask][traded]
    if rets.size < 5:
        return 0.0
    mu, sigma = rets.mean(), rets.std()
    return float(mu / sigma * np.sqrt(252 * 78)) if sigma > 1e-9 else 0.0

# ── IC (Information Coefficient) per fold ─────────────────────────────────────

def _ic(ts_mask, weights, outcomes, votes):
    """Rank correlation between ensemble score and outcome — pure IC."""
    score = np.zeros(ts_mask.sum(), dtype=float)
    for sig, w in weights.items():
        v = votes.get(f"v_{sig}")
        if v is not None:
            score += v[ts_mask] * w
    rets = outcomes[ts_mask]
    if len(score) < 10:
        return 0.0
    # Spearman rank correlation
    from scipy.stats import spearmanr
    rho, _ = spearmanr(score, rets)
    return float(rho) if not np.isnan(rho) else 0.0

# ── Main walk-forward engine ──────────────────────────────────────────────────

def run_walkforward() -> dict:
    print("Loading signal_log.db…")
    t0 = time.time()
    data = _load_data()
    regimes = _regime_labels(data)

    ts = data["ts"]
    outcomes = data[OUTCOME_COL]
    n_total = len(ts)

    ts_start = int(ts[0])
    ts_end   = int(ts[-1])

    train_sec   = TRAIN_DAYS   * 86400
    test_sec    = TEST_DAYS    * 86400
    embargo_sec = EMBARGO_DAYS * 86400
    step_sec    = STEP_DAYS    * 86400

    folds = []
    window_start = ts_start

    print(f"  {n_total:,} rows · {(ts_end - ts_start) / 86400:.0f} days · building folds…")

    fold_idx = 0
    while True:
        train_start = window_start
        train_end   = train_start + train_sec
        test_start  = train_end + embargo_sec
        test_end    = test_start + test_sec

        if test_end > ts_end:
            break

        train_mask = (ts >= train_start) & (ts < train_end)
        test_mask  = (ts >= test_start) & (ts < test_end)

        n_train = train_mask.sum()
        n_test  = test_mask.sum()
        if n_train < 500 or n_test < 100:
            window_start += step_sec
            continue

        # Fit weights on train
        weights = _fit_weights(train_mask, outcomes, data)

        # IS (in-sample) performance using fitted weights on train
        is_result = _eval_fold(train_mask, weights, outcomes, data, regimes)

        # OOS (out-of-sample) performance on test
        oos_result = _eval_fold(test_mask, weights, outcomes, data, regimes)

        # Equal-weight baseline OOS
        ew_oos = _eval_equal_weight(test_mask, outcomes, data)

        # IC on OOS (ensemble)
        try:
            ic_val = _ic(test_mask, weights, outcomes, data)
        except Exception:
            ic_val = None

        # Per-signal IC on OOS — individual predictive power this fold
        from scipy.stats import spearmanr as _spr
        sig_ic_fold = {}
        for sig in SIGNAL_COLS:
            v = data.get(f"v_{sig}")
            if v is None:
                continue
            sv = v[test_mask].astype(float)
            rets_t = outcomes[test_mask]
            if (sv != 0).sum() < 10:   # need at least 10 fired bars
                sig_ic_fold[sig] = None
                continue
            rho, _ = _spr(sv, rets_t)
            sig_ic_fold[sig] = round(float(rho), 5) if not np.isnan(rho) else None

        # Regime-conditional IC per signal per fold
        sig_ic_regime = {}  # {sig: {regime: ic_value}}
        for sig in SIGNAL_COLS:
            v = data.get(f"v_{sig}")
            if v is None:
                continue
            sig_ic_regime[sig] = {}
            for rg in ["TRENDING", "RANGING", "BREAKOUT", "RISK-OFF", "MIXED"]:
                rg_mask = test_mask & (regimes == rg)
                n_rg = rg_mask.sum()
                if n_rg < 20:
                    continue
                sv = v[rg_mask].astype(float)
                if (sv != 0).sum() < 8:
                    continue
                rho, _ = _spr(sv, outcomes[rg_mask])
                if not np.isnan(rho):
                    sig_ic_regime[sig][rg] = round(float(rho), 5)

        # IS/OOS Sharpe ratio
        is_oos_ratio = None
        if is_result["sharpe"] and oos_result["sharpe"] and abs(is_result["sharpe"]) > 0.01:
            is_oos_ratio = round(oos_result["sharpe"] / abs(is_result["sharpe"]), 3)

        fold = {
            "fold":           fold_idx,
            "train_start":    datetime.fromtimestamp(train_start).strftime("%Y-%m-%d"),
            "train_end":      datetime.fromtimestamp(train_end).strftime("%Y-%m-%d"),
            "test_start":     datetime.fromtimestamp(test_start).strftime("%Y-%m-%d"),
            "test_end":       datetime.fromtimestamp(test_end).strftime("%Y-%m-%d"),
            "n_train_bars":   int(n_train),
            "n_test_bars":    int(n_test),
            "is":             is_result,
            "oos":            oos_result,
            "oos_equal_wt":   round(ew_oos, 3),
            "is_oos_ratio":   is_oos_ratio,
            "ic":             round(ic_val, 5) if ic_val is not None else None,
            "sig_ic":         sig_ic_fold,
            "sig_ic_regime":  sig_ic_regime,
            "top_weights":    sorted([(s, round(w, 4)) for s, w in weights.items() if w > 0.02],
                                     key=lambda x: -x[1])[:8],
        }
        folds.append(fold)
        fold_idx += 1
        window_start += step_sec

    if not folds:
        return {"ok": False, "error": "No folds produced — check DB range and parameters"}

    # ── Summary statistics ────────────────────────────────────────────────────
    oos_sharpes   = [f["oos"]["sharpe"] for f in folds if f["oos"]["sharpe"] is not None]
    is_sharpes    = [f["is"]["sharpe"]  for f in folds if f["is"]["sharpe"]  is not None]
    ic_vals       = [f["ic"] for f in folds if f["ic"] is not None]
    ios_ratios    = [f["is_oos_ratio"] for f in folds if f["is_oos_ratio"] is not None]

    def _stats(arr):
        if not arr:
            return {}
        a = np.array(arr)
        return {
            "mean":   round(float(a.mean()), 3),
            "std":    round(float(a.std()), 3),
            "min":    round(float(a.min()), 3),
            "max":    round(float(a.max()), 3),
            "pct_positive": round(float((a > 0).mean()), 3),
        }

    # ── Per-signal lifecycle analysis (with regime-conditional IC) ────────────
    signal_lifecycle = {}
    for sig in SIGNAL_COLS:
        ic_series = [f["sig_ic"].get(sig) for f in folds if f.get("sig_ic", {}).get(sig) is not None]
        if len(ic_series) < 4:
            signal_lifecycle[sig] = {
                "status": "INSUFFICIENT_DATA",
                "ic_mean": None,
                "ic_slope": None,
                "ic_history": [],
                "regime_ic": {},
                "best_regime": None,
            }
            continue

        arr = np.array(ic_series, dtype=float)
        ic_mean  = float(arr.mean())
        ic_std   = float(arr.std())
        x        = np.arange(len(arr))
        slope    = float(np.polyfit(x, arr, 1)[0])
        pct_pos  = float((arr > 0).mean())

        # Recent 8 folds vs first 8 — is the IC falling?
        half = len(arr) // 2
        early_mean = float(arr[:half].mean())
        late_mean  = float(arr[half:].mean())
        decay_pct  = ((late_mean - early_mean) / (abs(early_mean) + 1e-9)) * 100

        # ── Regime-conditional IC aggregation across folds ────────────────────
        regime_ic = {}
        for rg in ["TRENDING", "RANGING", "BREAKOUT", "RISK-OFF", "MIXED"]:
            rg_vals = []
            for f in folds:
                fv = f.get("sig_ic_regime", {}).get(sig, {}).get(rg)
                if fv is not None:
                    rg_vals.append(fv)
            if len(rg_vals) < 2:
                if rg_vals:
                    regime_ic[rg] = {
                        "mean": round(rg_vals[0], 5),
                        "slope": 0.0,
                        "status": "INSUFFICIENT",
                        "n_folds": 1,
                    }
                continue
            rg_arr = np.array(rg_vals, dtype=float)
            rg_mean = float(rg_arr.mean())
            rg_x = np.arange(len(rg_arr))
            rg_slope = float(np.polyfit(rg_x, rg_arr, 1)[0]) if len(rg_arr) >= 3 else 0.0
            rg_pct_pos = float((rg_arr > 0).mean())

            if rg_mean > 0 and rg_pct_pos >= 0.5:
                rg_status = "ALIVE"
            elif rg_mean > 0 and rg_slope > 0.0002:
                rg_status = "RISING"
            elif rg_mean < 0 and rg_pct_pos < 0.3:
                rg_status = "DEAD"
            elif rg_slope > 0 and rg_mean < 0:
                rg_status = "PROBATION"
            else:
                rg_status = "MIXED"

            regime_ic[rg] = {
                "mean":    round(rg_mean, 5),
                "slope":   round(rg_slope, 7),
                "status":  rg_status,
                "n_folds": len(rg_vals),
            }

        # Best regime = highest positive mean IC
        positive_regimes = {rg: v["mean"] for rg, v in regime_ic.items() if v["mean"] > 0}
        best_regime = max(positive_regimes, key=positive_regimes.get) if positive_regimes else None
        best_regime_ic = positive_regimes.get(best_regime) if best_regime else None

        # ── Revised lifecycle status with REGIME_SPECIALIST ───────────────────
        if ic_mean < 0 and pct_pos < 0.3 and not positive_regimes:
            status = "DEAD"               # consistently negative IC everywhere — retire
        elif ic_mean < 0 and positive_regimes:
            status = "REGIME_SPECIALIST"  # global IC negative but has a good regime
        elif slope > 0.0002 and ic_mean > 0:
            status = "RISING"             # IC trending up — promote
        elif ic_mean > 0 and pct_pos >= 0.5:
            status = "ALIVE"              # healthy
        elif ic_mean < 0 or (slope < -0.0003 and decay_pct < -30):
            status = "PROBATION"          # declining or slightly negative
        else:
            status = "MIXED"              # inconsistent but not negative

        signal_lifecycle[sig] = {
            "status":       status,
            "ic_mean":      round(ic_mean,  5),
            "ic_std":       round(ic_std,   5),
            "ic_slope":     round(slope,    7),
            "pct_positive": round(pct_pos,  3),
            "early_mean":   round(early_mean, 5),
            "late_mean":    round(late_mean,  5),
            "decay_pct":    round(decay_pct,  1),
            "ic_history":   [round(v, 5) for v in arr.tolist()],
            "regime_ic":    regime_ic,
            "best_regime":  best_regime,
            "best_regime_ic_mean": round(best_regime_ic, 5) if best_regime_ic is not None else None,
        }

    # Death Star retirement list — only DEAD (not REGIME_SPECIALIST)
    retire_candidates  = [s for s, v in signal_lifecycle.items() if v["status"] == "DEAD"]
    specialist_list    = [s for s, v in signal_lifecycle.items() if v["status"] == "REGIME_SPECIALIST"]
    probation_list     = [s for s, v in signal_lifecycle.items() if v["status"] == "PROBATION"]
    rising_list        = [s for s, v in signal_lifecycle.items() if v["status"] == "RISING"]

    # IC decay: slope of IC over folds (positive = improving, negative = decaying)
    ic_slope = None
    if len(ic_vals) >= 4:
        x = np.arange(len(ic_vals))
        ic_slope = round(float(np.polyfit(x, ic_vals, 1)[0]), 6)

    # OOS Sharpe trend (decay signal)
    oos_slope = None
    if len(oos_sharpes) >= 4:
        x = np.arange(len(oos_sharpes))
        oos_slope = round(float(np.polyfit(x, oos_sharpes, 1)[0]), 4)

    # Regime consistency across folds
    regime_counts = {"TRENDING": [], "RANGING": [], "BREAKOUT": [], "RISK-OFF": [], "MIXED": []}
    for f in folds:
        for rg, stats in (f["oos"].get("regime_bd") or {}).items():
            if rg in regime_counts:
                regime_counts[rg].append(stats["sharpe"])

    regime_summary = {}
    for rg, sharpes in regime_counts.items():
        if sharpes:
            regime_summary[rg] = {
                "mean_sharpe": round(float(np.mean(sharpes)), 3),
                "pct_positive": round(float((np.array(sharpes) > 0).mean()), 3),
                "n_folds": len(sharpes),
            }

    # RenTech gates
    oos_mean = float(np.mean(oos_sharpes)) if oos_sharpes else 0
    oos_std  = float(np.std(oos_sharpes))  if oos_sharpes else 1
    is_oos_mean = float(np.mean(ios_ratios)) if ios_ratios else 0

    gates = {
        "oos_sharpe_positive":    oos_mean > 0,
        "oos_stability_ok":       (oos_std < 0.3 * abs(oos_mean)) if oos_mean != 0 else False,
        "is_oos_ratio_ok":        is_oos_mean > 0.4,
        "regime_consistency_ok":  len([r for r in regime_summary.values() if r["pct_positive"] > 0.5]) >= 3,
        "ic_not_decaying":        ic_slope is not None and ic_slope >= 0,
    }
    gates_passed = sum(gates.values())

    verdict = (
        "ROBUST"     if gates_passed >= 5 else
        "PROMISING"  if gates_passed >= 3 else
        "FRAGILE"    if gates_passed >= 2 else
        "OVERFIT"
    )

    elapsed = time.time() - t0
    report = {
        "ok": True,
        "generated_at":  datetime.now().isoformat(timespec="seconds"),
        "elapsed_s":     round(elapsed, 1),
        "config": {
            "train_days":   TRAIN_DAYS,
            "test_days":    TEST_DAYS,
            "step_days":    STEP_DAYS,
            "embargo_days": EMBARGO_DAYS,
            "threshold":    THRESHOLD,
            "outcome":      OUTCOME_COL,
            "n_signals":    len(SIGNAL_COLS),
        },
        "n_folds": len(folds),
        "summary": {
            "oos_sharpe":     _stats(oos_sharpes),
            "is_sharpe":      _stats(is_sharpes),
            "ic":             _stats(ic_vals),
            "is_oos_ratio":   _stats(ios_ratios),
            "oos_sharpe_slope": oos_slope,
            "ic_slope":         ic_slope,
        },
        "regime_summary":   regime_summary,
        "rentech_gates":    gates,
        "gates_passed":     f"{gates_passed}/5",
        "verdict":          verdict,
        "signal_lifecycle": signal_lifecycle,
        "retire_candidates": retire_candidates,
        "specialist_list":   specialist_list,
        "probation_list":    probation_list,
        "rising_list":       rising_list,
        "folds":            folds,
    }

    OUT_PATH.parent.mkdir(exist_ok=True)
    OUT_PATH.write_text(json.dumps(report, indent=2))
    print(f"  {len(folds)} folds · OOS Sharpe {oos_mean:+.3f} · IS/OOS {is_oos_mean:.3f} · verdict: {verdict}")
    print(f"  Elapsed: {elapsed:.1f}s")
    return report


def load_latest() -> dict | None:
    if OUT_PATH.exists():
        return json.loads(OUT_PATH.read_text())
    return None


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)
    r = run_walkforward()
    if r.get("ok"):
        print(f"\nVERDICT: {r['verdict']}  ({r['gates_passed']} gates)")
        print(f"\nRETIRE:      {r['retire_candidates']}")
        print(f"SPECIALISTS: {r['specialist_list']}")
        print(f"PROBATION:   {r['probation_list']}")
        print(f"RISING:      {r['rising_list']}")

        print("\nOOS Sharpe by fold:")
        for f in r["folds"]:
            mark = "+" if (f["oos"]["sharpe"] or 0) > 0 else "-"
            print(f"  [{mark}] fold {f['fold']:02d}  {f['test_start']} -> {f['test_end']}"
                  f"  OOS={f['oos']['sharpe']}  IS/OOS={f['is_oos_ratio']}  IC={f['ic']}")

        print("\nRenTech gates:")
        for g, v in r["rentech_gates"].items():
            print(f"  {'OK' if v else 'FAIL'}  {g}")

        # Signal lifecycle table: signal | status | best_regime | global_ic_mean | best_regime_ic_mean
        print("\n--- Signal Lifecycle (Regime-Conditional) ---")
        header = f"{'Signal':<16} {'Status':<20} {'BestRegime':<12} {'GlobalIC':>10} {'BestRegimeIC':>13}"
        print(header)
        print("-" * len(header))
        for sig, v in sorted(r["signal_lifecycle"].items(), key=lambda x: (x[1].get("ic_mean") or -99), reverse=True):
            status = v.get("status", "")
            best_rg = v.get("best_regime") or "-"
            g_ic = v.get("ic_mean")
            br_ic = v.get("best_regime_ic_mean")
            print(f"{sig:<16} {status:<20} {best_rg:<12} "
                  f"{g_ic:>10.5f}  {br_ic:>12.5f}" if (g_ic is not None and br_ic is not None) else
                  f"{sig:<16} {status:<20} {best_rg:<12} {'N/A':>10}  {'N/A':>12}")
