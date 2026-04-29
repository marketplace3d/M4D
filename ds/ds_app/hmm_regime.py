"""
ds_app/hmm_regime.py — HMM 3-State Regime Posterior (P1-A)

Replaces the hard TRENDING/RANGING/BREAKOUT label with a probability vector:
  P(regime=TRENDING | data),  P(regime=RANGING | data),  P(regime=RISK-OFF | data)

METHOD:
  Hamilton-style Markov Switching Regression (statsmodels MarkovAutoregression).
  Input features: log-return volatility (21-bar std), 12-bar momentum.
  3 latent states fitted on all available 5m bar data per symbol.
  States mapped post-fit by expected volatility rank: low→RANGING, high→RISK-OFF, mid→TRENDING.

OUTPUT:
  ds/data/hmm_regime.json — per-symbol model fit stats + latest probabilities
  In-memory: posterior_proba(df) → pd.DataFrame with columns [TRENDING, RANGING, RISK-OFF]

LIVE USE:
  score_symbol() in alpaca_paper.py calls posterior_proba() and uses the probability
  vector as soft regime weights instead of a hard label.
  e.g. soft_mult = Σ_k P(regime=k) × SOFT_REGIME_MULT[signal][k]

IMPORTANT: HMM is fit on training data. Re-fit weekly (or POST /v1/hmm/fit/).
  Fitting is slow (~30-60s per symbol on 500k bars). Inference is fast (<1ms).
"""
from __future__ import annotations

import json
import logging
import pickle
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("hmm_regime")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

FUTURES_DB   = _DS_ROOT / "data" / "futures.db"
MODEL_DIR    = _DS_ROOT / "data" / "hmm_models"
REPORT_OUT   = _DS_ROOT / "data" / "hmm_regime.json"

N_STATES     = 3
VOL_WINDOW   = 21    # bars for realised vol
MOM_WINDOW   = 12    # bars for momentum
TRAIN_SYMBOL = "BTC" # anchor for state-to-regime mapping

_REGIMES = ["TRENDING", "RANGING", "RISK-OFF"]


# ── Feature engineering ────────────────────────────────────────────────────────

def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Returns DataFrame with [rvol, mom12, log_ret] on the same index."""
    cl     = df["close"] if "close" in df.columns else df["Close"]
    lr     = np.log(cl / cl.shift(1)).fillna(0)
    rvol   = lr.rolling(VOL_WINDOW).std().fillna(0)
    mom12  = ((cl - cl.shift(MOM_WINDOW)) / cl.shift(MOM_WINDOW)).fillna(0)
    return pd.DataFrame({"log_ret": lr, "rvol": rvol, "mom12": mom12}, index=df.index)


# ── Model fit ─────────────────────────────────────────────────────────────────

def fit_model(symbol: str, n_bars: int = 50_000) -> dict:
    """Fit 3-state Markov Switching AR(1) on vol+mom, return fit summary."""
    from statsmodels.tsa.regime_switching.markov_autoregression import MarkovAutoregression

    conn   = sqlite3.connect(FUTURES_DB)
    df_raw = pd.read_sql_query(
        f"SELECT close, high, low FROM bars_5m WHERE symbol=? ORDER BY ts DESC LIMIT {n_bars}",
        conn, params=(symbol,),
    )
    conn.close()

    if len(df_raw) < 500:
        return {"error": f"{symbol}: only {len(df_raw)} bars"}

    df_raw = df_raw.iloc[::-1].reset_index(drop=True)
    feats  = build_features(df_raw)

    log.info("Fitting HMM for %s (%d bars)...", symbol, len(feats))
    try:
        mod = MarkovAutoregression(
            feats["rvol"].values,
            k_regimes=N_STATES,
            order=1,
            switching_ar=True,
            switching_variance=True,
        )
        res = mod.fit(
            em_iter=50,
            search_reps=5,
            disp=False,
        )
    except Exception as exc:
        log.error("HMM fit failed for %s: %s", symbol, exc)
        return {"error": str(exc)}

    # Map states to regimes by volatility rank
    state_vols  = [res.params[f"sigma[{k}]"] ** 2 for k in range(N_STATES)]
    vol_rank    = np.argsort(state_vols)          # low→high index
    state_to_regime: dict[int, str] = {
        int(vol_rank[0]): "RANGING",
        int(vol_rank[1]): "TRENDING",
        int(vol_rank[2]): "RISK-OFF",
    }
    regime_to_state = {v: k for k, v in state_to_regime.items()}

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODEL_DIR / f"{symbol}_hmm.pkl"
    with open(model_path, "wb") as f:
        pickle.dump({
            "result": res,
            "state_to_regime": state_to_regime,
            "symbol": symbol,
        }, f)

    proba = res.smoothed_marginal_probabilities
    latest = {_REGIMES[i]: round(float(
        proba[:, regime_to_state[r]].iloc[-1] if hasattr(proba, 'iloc')
        else proba[-1, regime_to_state[r]]
    ), 4) for i, r in enumerate(_REGIMES)}

    summary = {
        "symbol":        symbol,
        "n_bars":        len(feats),
        "llf":           round(float(res.llf), 2),
        "aic":           round(float(res.aic), 2),
        "state_to_regime": state_to_regime,
        "state_vols":    [round(v, 6) for v in state_vols],
        "latest_proba":  latest,
        "model_path":    str(model_path),
    }
    log.info("%s HMM fitted: %s  latest=%s", symbol, state_to_regime, latest)
    return summary


# ── Inference ─────────────────────────────────────────────────────────────────

_model_cache: dict[str, dict] = {}


def _load_model(symbol: str) -> dict | None:
    if symbol in _model_cache:
        return _model_cache[symbol]
    path = MODEL_DIR / f"{symbol}_hmm.pkl"
    if not path.exists():
        return None
    with open(path, "rb") as f:
        obj = pickle.load(f)
    _model_cache[symbol] = obj
    return obj


def posterior_proba(df: pd.DataFrame, symbol: str) -> dict[str, float]:
    """
    Returns {TRENDING: p, RANGING: p, RISK-OFF: p} for last bar of df.
    Uses smoothed marginal probabilities from the fitted HMM (computed at fit time).
    Falls back to equal weights if model not fitted for this symbol.
    """
    obj = _load_model(symbol)
    if obj is None:
        return {r: 1.0 / N_STATES for r in _REGIMES}

    res             = obj["result"]
    state_to_regime = obj["state_to_regime"]
    regime_to_state = {v: k for k, v in state_to_regime.items()}

    try:
        proba = res.smoothed_marginal_probabilities
        if hasattr(proba, "iloc"):
            last = proba.iloc[-1].values
        else:
            last = proba[-1]
        return {r: round(float(last[regime_to_state[r]]), 4) for r in _REGIMES}
    except Exception:
        return {r: 1.0 / N_STATES for r in _REGIMES}


def batch_posterior_proba(symbol: str, n_bars: int) -> np.ndarray | None:
    """
    Returns (n_bars, N_STATES) array of smoothed HMM state probabilities.
    Row i = P([TRENDING, RANGING, RISK-OFF]) at bar i.
    Returns None if model not fitted; caller should fall back to hard-label routing.
    Aligns to the LAST n_bars of the fitted model's smoothed probabilities.
    """
    obj = _load_model(symbol)
    if obj is None:
        return None
    try:
        res   = obj["result"]
        state_to_regime = obj["state_to_regime"]
        regime_to_state = {v: k for k, v in state_to_regime.items()}
        proba = res.smoothed_marginal_probabilities
        if hasattr(proba, "values"):
            arr = proba.values        # DataFrame → numpy
        else:
            arr = np.asarray(proba)   # already numpy
        # arr shape: (n_fitted_bars, N_STATES) — columns ordered by state index
        # Re-order columns to match _REGIMES order: [TRENDING, RANGING, RISK-OFF]
        regime_col_idx = [regime_to_state[r] for r in _REGIMES]
        arr = arr[:, regime_col_idx]
        # Trim or pad to match n_bars (align to tail — OOS bars are recent)
        if arr.shape[0] >= n_bars:
            return arr[-n_bars:]
        # Fewer fitted bars than requested — prepend equal-weight rows
        pad = np.full((n_bars - arr.shape[0], N_STATES), 1.0 / N_STATES)
        return np.vstack([pad, arr])
    except Exception:
        return None


def soft_regime_weight(signal_id: str, proba: dict[str, float]) -> float:
    """
    Probability-weighted soft multiplier.
    proba = {TRENDING: p, RANGING: p, RISK-OFF: p}
    Returns Σ_k P(k) × SOFT_REGIME_MULT[sig][k], using legacy 4-regime fallback.
    """
    from ds_app.sharpe_ensemble import SOFT_REGIME_MULT, _REGIME_FALLBACK
    mult_map = SOFT_REGIME_MULT.get(signal_id, {})
    total = 0.0
    for r, p in proba.items():
        mult = mult_map.get(r) or mult_map.get(_REGIME_FALLBACK.get(r, ""), 1.0) or 1.0
        total += p * mult
    return round(total, 4)


# ── Batch fit all symbols ──────────────────────────────────────────────────────

def run(symbols: list[str] | None = None) -> dict:
    if symbols is None:
        conn = sqlite3.connect(FUTURES_DB)
        rows = conn.execute("SELECT DISTINCT symbol FROM bars_5m").fetchall()
        conn.close()
        symbols = [r[0] for r in rows]

    results = {}
    for sym in symbols:
        results[sym] = fit_model(sym)

    REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT_OUT.write_text(json.dumps(results, indent=2))
    log.info("HMM report → %s", REPORT_OUT)
    return results


if __name__ == "__main__":
    import sys
    syms = sys.argv[1:] if len(sys.argv) > 1 else None
    out  = run(syms)
    for sym, r in out.items():
        if "error" in r:
            print(f"  {sym}: ERROR {r['error']}")
        else:
            print(f"  {sym}: LLF={r['llf']} AIC={r['aic']} latest={r['latest_proba']}")
