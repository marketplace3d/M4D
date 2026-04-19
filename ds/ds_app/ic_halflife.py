"""
ds_app/ic_halflife.py — IC Half-Life Tracker (P3-B)

For each signal, fits an exponential (or linear) decay model to the rolling
IC time series produced by ic_monitor.py. Returns per-signal half-life in days
and an estimated edge-expiry date.

Models:
  EXP  — IC(t) = IC₀ · exp(−λt)     when IC stays positive throughout windows
           half_life = ln(2) / λ (days)
  LIN  — IC(t) ≈ IC₀ + slope · t    fallback
           time_to_zero = −IC_last / slope (windows) × STEP_DAYS

Alerts:
  IMMINENT  — half_life < 7 days or time_to_zero < 7 days
  SHORT     — 7 ≤ half_life < 21 days
  STABLE    — half_life ≥ 21 days or IC not decaying

Output: ds/data/ic_halflife.json
Endpoint: GET /v1/ic/halflife/   POST /v1/ic/halflife/run/
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

log = logging.getLogger("ic_halflife")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent

IC_REPORT_PATH  = _DS_ROOT / "data" / "ic_monitor.json"
HALFLIFE_OUT    = _DS_ROOT / "data" / "ic_halflife.json"
WF_REPORT       = _DS_ROOT / "data" / "walkforward_report.json"
STEP_DAYS       = 7      # must match ic_monitor.STEP_DAYS
IMMINENT_DAYS   = 7
SHORT_DAYS      = 21
MIN_WINDOWS     = 4      # need at least 4 windows for a reliable fit

# Signals confirmed as REGIME SPECIALISTS in walkforward — GLOBAL IC decline is expected
# and NOT structural decay. Only flag IMMINENT if regime-conditional IC is ALSO negative.
REGIME_SPECIALISTS = {
    "SUPERTREND", "SQZPOP", "PULLBACK", "PSAR", "MACD_CROSS", "EMA_STACK",
    "GOLDEN", "RANGE_BO", "DON_BO", "VOL_BO", "NEW_HIGH", "CONSOL_BO",
    "RSI_CROSS", "BB_BREAK", "KC_BREAK",
}


def _load_best_regime_ic() -> dict[str, float]:
    """Load best-regime IC per signal from walkforward_report.json."""
    if not WF_REPORT.exists():
        return {}
    try:
        wf  = json.loads(WF_REPORT.read_text())
        lc  = wf.get("signal_lifecycle", {})
        out = {}
        for sig, info in lc.items():
            # Try several field names the walkforward may use
            best = (info.get("best_regime_ic") or
                    info.get("best_ic") or
                    max(info.get("regime_ics", {}).values(), default=None))
            if best is not None:
                out[sig.upper()] = float(best)
        return out
    except Exception:
        return {}


def _exp_halflife(ic_series: list[float], step_days: int) -> tuple[float, float]:
    """Fit IC(t) = IC₀ · exp(−λt). Returns (half_life_days, R²)."""
    from scipy.optimize import curve_fit
    t = np.arange(len(ic_series), dtype=float)
    y = np.array(ic_series, dtype=float)
    try:
        popt, _ = curve_fit(
            lambda t, ic0, lam: ic0 * np.exp(-lam * t),
            t, y,
            p0=[y[0], 0.1],
            maxfev=2000,
            bounds=([-np.inf, 0], [np.inf, np.inf]),
        )
        ic0, lam = popt
        if lam <= 0:
            return float("inf"), 0.0
        y_pred = ic0 * np.exp(-lam * t)
        ss_res = np.sum((y - y_pred) ** 2)
        ss_tot = np.sum((y - y.mean()) ** 2)
        r2 = 1 - ss_res / ss_tot if ss_tot > 1e-12 else 0.0
        half_life = np.log(2) / lam * step_days
        return round(float(half_life), 1), round(float(r2), 3)
    except Exception:
        return float("inf"), 0.0


def _lin_time_to_zero(ic_series: list[float], step_days: int) -> tuple[float, float]:
    """Linear extrapolation: time until IC reaches 0. Returns (days, R²)."""
    t = np.arange(len(ic_series), dtype=float)
    y = np.array(ic_series, dtype=float)
    slope, intercept = np.polyfit(t, y, 1)
    if slope >= 0:
        return float("inf"), 0.0
    t_zero = -intercept / slope          # window index at IC=0
    days = (t_zero - len(ic_series) + 1) * step_days
    y_pred = slope * t + intercept
    ss_res = np.sum((y - y_pred) ** 2)
    ss_tot = np.sum((y - y.mean()) ** 2)
    r2 = 1 - ss_res / ss_tot if ss_tot > 1e-12 else 0.0
    return round(float(max(days, 0)), 1), round(float(r2), 3)


def run() -> dict:
    if not IC_REPORT_PATH.exists():
        from ds_app.ic_monitor import run as ic_run
        log.info("ic_monitor.json not found — running ic_monitor first")
        ic_run()

    base = json.loads(IC_REPORT_PATH.read_text())
    signals_raw: dict = base.get("signals", {})
    step_days = base.get("window_step_days", STEP_DAYS)

    regime_ic = _load_best_regime_ic()   # {SIGNAL: best_regime_IC}

    results: dict[str, dict] = {}
    now = datetime.now()

    for sig, info in signals_raw.items():
        windows = info.get("windows", [])
        ic_vals = [w["ic"] for w in windows if w.get("ic") is not None]

        if len(ic_vals) < MIN_WINDOWS:
            results[sig] = {
                "status":       "INSUFFICIENT_DATA",
                "half_life_days": None,
                "fit_type":     None,
                "r2":           None,
                "expiry_estimate": None,
                "latest_ic":    info.get("latest_ic"),
                "ic_trend":     info.get("status"),
            }
            continue

        # Determine fit type
        all_positive = all(v > 0 for v in ic_vals)
        latest_slope = info.get("slope", 0) or 0

        if all_positive and latest_slope < 0:
            half_life, r2 = _exp_halflife(ic_vals, step_days)
            fit_type = "EXP"
        elif latest_slope < 0:
            half_life, r2 = _lin_time_to_zero(ic_vals, step_days)
            fit_type = "LIN"
        else:
            half_life, r2 = float("inf"), 1.0
            fit_type = "STABLE"

        # Alert status
        if half_life == float("inf") or fit_type == "STABLE":
            alert = "STABLE"
        elif half_life < IMMINENT_DAYS:
            alert = "IMMINENT"
        elif half_life < SHORT_DAYS:
            alert = "SHORT"
        else:
            alert = "STABLE"

        expiry = None
        if half_life != float("inf"):
            expiry = (now + timedelta(days=half_life)).strftime("%Y-%m-%d")

        # Regime specialist override — global IC decay is structural for specialists.
        # Only truly IMMINENT if regime IC is also negative or absent.
        sig_upper = sig.upper()
        is_specialist = sig_upper in REGIME_SPECIALISTS
        best_regime_ic = regime_ic.get(sig_upper)
        regime_note = None
        if is_specialist and alert == "IMMINENT":
            if best_regime_ic is None:
                regime_note = "REGIME_IC_UNKNOWN — run walkforward to validate"
            elif best_regime_ic > 0.005:
                alert = "REGIME_SPECIALIST"   # downgrade: regime IC positive, not dead
                regime_note = f"regime_IC=+{best_regime_ic:.4f} — global decay is expected; edge intact in specialist regime"
            else:
                regime_note = f"regime_IC={best_regime_ic:.4f} — both global and regime IC negative; may be truly dead"

        results[sig] = {
            "status":           alert,
            "half_life_days":   half_life if half_life != float("inf") else None,
            "fit_type":         fit_type,
            "r2":               r2,
            "expiry_estimate":  expiry,
            "latest_ic":        info.get("latest_ic"),
            "best_regime_ic":   best_regime_ic,
            "ic_trend":         info.get("status"),
            "is_specialist":    is_specialist,
            "regime_note":      regime_note,
            "n_windows":        len(ic_vals),
        }
        log.info("  %-20s %s  half_life=%-8s fit=%s r2=%.3f",
                 sig, alert, f"{half_life:.1f}d" if half_life != float("inf") else "∞",
                 fit_type, r2)

    imminent    = [s for s, r in results.items() if r["status"] == "IMMINENT"]
    specialists = [s for s, r in results.items() if r["status"] == "REGIME_SPECIALIST"]
    short_hl    = [s for s, r in results.items() if r["status"] == "SHORT"]
    stable      = [s for s, r in results.items() if r["status"] == "STABLE"]

    report = {
        "generated_at":  now.isoformat(timespec="seconds"),
        "step_days":     step_days,
        "imminent_threshold_days": IMMINENT_DAYS,
        "short_threshold_days":   SHORT_DAYS,
        "doctrine": "REGIME_SPECIALIST status overrides IMMINENT — regime IC positive = edge intact",
        "imminent_alerts":   imminent,
        "regime_specialists": specialists,
        "short_alerts":      short_hl,
        "stable":            stable,
        "signals":           results,
    }
    HALFLIFE_OUT.parent.mkdir(parents=True, exist_ok=True)
    HALFLIFE_OUT.write_text(json.dumps(report, indent=2))
    log.info("IC half-life report → %s  imminent=%s", HALFLIFE_OUT, imminent)
    return report


def load_latest() -> dict | None:
    if HALFLIFE_OUT.exists():
        return json.loads(HALFLIFE_OUT.read_text())
    return None


if __name__ == "__main__":
    out = run()
    print(f"\nIMMINENT (< {IMMINENT_DAYS}d): {out['imminent_alerts']}")
    print(f"SHORT    (< {SHORT_DAYS}d): {out['short_alerts']}")
    print(f"\n{'Signal':22s} {'Status':10s} {'HalfLife':10s} {'Fit':6s} {'R²':6s} {'Expiry':12s} {'IC':8s}")
    print("-" * 78)
    for sig, r in sorted(out["signals"].items(), key=lambda x: x[1].get("half_life_days") or 9999):
        hl   = f"{r['half_life_days']:.1f}d" if r["half_life_days"] else "∞"
        exp  = r["expiry_estimate"] or "-"
        r2   = f"{r['r2']:.3f}" if r["r2"] is not None else "-"
        ic   = f"{r['latest_ic']:.5f}" if r["latest_ic"] is not None else "-"
        print(f"  {sig:20s} {r['status']:10s} {hl:10s} {(r['fit_type'] or '-'):6s} {r2:6s} {exp:12s} {ic}")
