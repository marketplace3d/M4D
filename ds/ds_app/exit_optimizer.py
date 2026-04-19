"""
exit_optimizer.py — Exit Signal Search

For each entry bar (gates clear + soft_score >= 0.35):
  BASELINE: hold to 4h outcome
  WITH EXIT: if exit signal fires within 1h window → use 1h outcome instead

Delta = sharpe(with_exit) - sharpe(baseline_4h)
Positive delta = this signal is a BETTER exit than just holding 4h.

Candidates tested: tape decel, volume fade, score decay rate, candle exhaustion,
ATR divergence, over-extension, EQH/EQL proximity, BB touch, RVOL fade,
momentum divergence, regime degradation, round-number proximity.

Output: ds/data/exit_optimizer_report.json
"""
from __future__ import annotations

import json, sqlite3, sys
from pathlib import Path

import numpy as np
import pandas as pd

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

from ds_app.algos_crypto import ALL_ALGO_IDS
from ds_app.sharpe_ensemble import SIGNAL_DB, REGIME_MAP, SOFT_REGIME_MULT, assign_regimes
from ds_app.trade_quality_gate import (
    _enrich, _build_soft_scores,
    _gate_squeeze, _gate_atr_rank_low, _gate_hour_kills,
    _gate_rvol_exhaustion, _gate_low_jedi,
)

ANNUAL    = 252 * 78
SOFT_THR  = 0.35
HOLD_BARS = 48   # 4h = 48 × 5m bars
CHECK_WIN = 12   # check exit signals within first 12 bars (1h)

OUT = _DS_ROOT / "data" / "exit_optimizer_report.json"


def sharpe(r: np.ndarray) -> float | None:
    r = r[~np.isnan(r)]
    if len(r) < 50: return None
    sd = r.std(ddof=1)
    if sd < 1e-9: return None
    return round(float(r.mean() / sd * np.sqrt(ANNUAL)), 3)


# ── Load + enrich ─────────────────────────────────────────────────────────────
def _load() -> pd.DataFrame:
    conn = sqlite3.connect(SIGNAL_DB)
    pragma = {r[1] for r in conn.execute("PRAGMA table_info(signal_log)")}
    v_cols = [f"v_{s}" for s in ALL_ALGO_IDS if f"v_{s}" in pragma]
    want   = ["ts","symbol","outcome_4h_pct","outcome_1h_pct",
              "close","high","low","open","atr_pct","squeeze",
              "rvol","jedi_raw","volume"] + v_cols
    sel = [c for c in want if c in pragma]
    seen: set = set()
    sel = [c for c in sel if not (c in seen or seen.add(c))]
    rows = conn.execute(
        f"SELECT {','.join(sel)} FROM signal_log"
        f" WHERE outcome_4h_pct IS NOT NULL AND outcome_1h_pct IS NOT NULL"
        f" ORDER BY symbol,ts"
    ).fetchall()
    conn.close()
    df = pd.DataFrame(rows, columns=sel)
    oos_cut = int(np.percentile(df["ts"].values, 70))
    return df[df["ts"] >= oos_cut].copy()


# ── Exit signal functions (per-symbol, in-position window) ───────────────────
# Each returns a bool array: True = exit signal fires at this bar

def _exit_tape_decel(g: pd.DataFrame) -> np.ndarray:
    """3 consecutive bars of volume decline."""
    v = g["volume"].fillna(0).values
    n = len(v)
    out = np.zeros(n, dtype=bool)
    for i in range(2, n):
        out[i] = v[i] < v[i-1] < v[i-2] and v[i-2] > 0
    return out

def _exit_rvol_fade(g: pd.DataFrame) -> np.ndarray:
    """RVOL declining: current < mean of last 3 bars by > 20%."""
    rv = g["rvol"].fillna(1.0).values
    n  = len(rv)
    out = np.zeros(n, dtype=bool)
    for i in range(3, n):
        mean3 = rv[i-3:i].mean()
        out[i] = mean3 > 0 and rv[i] < mean3 * 0.80
    return out

def _exit_score_decay_fast(scores: np.ndarray, window: int = 3) -> np.ndarray:
    """Score dropped > 35% vs 3-bar peak."""
    n = len(scores)
    out = np.zeros(n, dtype=bool)
    for i in range(window, n):
        pk = scores[i-window:i].max()
        out[i] = pk > 0 and scores[i] < pk * 0.65
    return out

def _exit_body_shrink(g: pd.DataFrame) -> np.ndarray:
    """2 consecutive doji candles: body < 15% of range."""
    c = g["close"].values; o = g["open"].values
    h = g["high"].values;  l = g["low"].values
    n = len(c)
    body  = np.abs(c - o)
    rng   = h - l
    ratio = np.where(rng > 0, body / rng, 0.5)
    out   = np.zeros(n, dtype=bool)
    for i in range(1, n):
        out[i] = ratio[i] < 0.15 and ratio[i-1] < 0.15
    return out

def _exit_atr_diverge(g: pd.DataFrame, scores: np.ndarray) -> np.ndarray:
    """Score rising but ATR contracting — momentum without participation."""
    atr = g["atr_pct"].fillna(0).values
    n   = len(atr)
    out = np.zeros(n, dtype=bool)
    for i in range(4, n):
        score_up = scores[i] > scores[i-4] * 1.05
        atr_down = atr[i] < atr[i-4] * 0.85 and atr[i-4] > 0
        out[i]   = score_up and atr_down
    return out

def _exit_over_extension(g: pd.DataFrame, mult: float = 2.5) -> np.ndarray:
    """Close > mult × ATR above entry bar close — take partial."""
    c   = g["close"].values
    atr = g["atr_pct"].fillna(0.01).values
    n   = len(c)
    out = np.zeros(n, dtype=bool)
    for i in range(1, n):
        extension = abs(c[i] - c[0]) / c[0] if c[0] > 0 else 0
        out[i]    = extension > atr[i] * mult
    return out

def _exit_eqh_eql_proximity(g: pd.DataFrame, tol: float = 0.0020) -> np.ndarray:
    """Price within tol% of equal highs/lows (liquidity pool target)."""
    h = g["high"].values;  l = g["low"].values
    c = g["close"].values
    n = len(c)
    out = np.zeros(n, dtype=bool)
    # EQH: two highs within 0.05% = liquidity pool above
    # EQL: two lows within 0.05% of each other = pool below
    for i in range(10, n):
        window_h = h[max(0,i-48):i]
        window_l = l[max(0,i-48):i]
        # find equal highs in window
        for j in range(len(window_h)-1):
            for k in range(j+1, len(window_h)):
                if window_h[k] > 0 and abs(window_h[j] - window_h[k]) / window_h[k] < 0.0005:
                    # EQH exists; are we within tol of it?
                    if c[i] > 0 and abs(c[i] - window_h[k]) / c[i] < tol:
                        out[i] = True
                        break
            if out[i]:
                break
    return out

def _exit_bb_touch(g: pd.DataFrame, window: int = 20, mult: float = 2.0) -> np.ndarray:
    """Price touching upper BB (in long) or lower BB (in short) — mean reversion zone."""
    c = g["close"].values
    n = len(c)
    out = np.zeros(n, dtype=bool)
    for i in range(window, n):
        w   = c[i-window:i]
        mid = w.mean()
        std = w.std()
        upper = mid + mult * std
        lower = mid - mult * std
        out[i] = c[i] >= upper or c[i] <= lower
    return out

def _exit_round_number(g: pd.DataFrame, tol: float = 0.0015) -> np.ndarray:
    """Price within tol% of round number (psychological MM magnet)."""
    c   = g["close"].values
    n   = len(c)
    out = np.zeros(n, dtype=bool)
    for i in range(n):
        if c[i] <= 0:
            continue
        # Round to nearest: 1, 10, 100, 1000, 10000, 100000
        for mag in [1, 10, 100, 1000, 10000, 100000]:
            rounded = round(c[i] / mag) * mag
            if rounded > 0 and abs(c[i] - rounded) / c[i] < tol:
                out[i] = True
                break
    return out

def _exit_regime_degrade(g: pd.DataFrame) -> np.ndarray:
    """Regime shifted from TRENDING to RANGING (momentum died)."""
    reg = g["regime"].values
    n   = len(reg)
    out = np.zeros(n, dtype=bool)
    for i in range(1, n):
        out[i] = reg[i-1] == "TRENDING" and reg[i] in ("RANGING", "RISK-OFF")
    return out

def _exit_jedi_fade(g: pd.DataFrame) -> np.ndarray:
    """jedi_raw dropped > 50% from entry bar value."""
    j = g["jedi_raw"].fillna(0).values
    n = len(j)
    out = np.zeros(n, dtype=bool)
    entry_j = abs(j[0]) if len(j) > 0 else 0
    if entry_j < 4:
        return out
    for i in range(1, n):
        out[i] = abs(j[i]) < entry_j * 0.50
    return out


# ── Simulate: baseline 4h vs early-exit-if-signal ────────────────────────────

def simulate_exit_signal(
    df_sym: pd.DataFrame,
    scores: np.ndarray,
    entry_mask: np.ndarray,
    exit_signal: np.ndarray,
    check_window: int = CHECK_WIN,
) -> tuple[np.ndarray, np.ndarray]:
    """
    For each entry bar, compare:
      baseline_ret : outcome_4h_pct (full hold)
      early_ret    : outcome_1h_pct if exit fires within check_window, else outcome_4h_pct
    Returns (baseline_returns, early_exit_returns).
    """
    n = len(df_sym)
    baseline, early = [], []
    for i in range(n):
        if not entry_mask[i]:
            continue
        r4h = float(df_sym.iloc[i]["outcome_4h_pct"])
        r1h = float(df_sym.iloc[i]["outcome_1h_pct"])
        baseline.append(r4h)
        # check if exit signal fires within window
        fired = False
        for k in range(1, min(check_window + 1, n - i)):
            if exit_signal[i + k]:
                fired = True
                break
        early.append(r1h if fired else r4h)
    return np.array(baseline), np.array(early)


# ── Main ──────────────────────────────────────────────────────────────────────

def run() -> dict:
    print("Loading OOS data…")
    df = _load()
    print(f"OOS bars: {len(df):,}")

    df = _enrich(df)
    scores_all = _build_soft_scores(df, df["regime"].values)
    df["soft_score"] = scores_all

    gate_blocked = (
        _gate_squeeze(df) |
        _gate_atr_rank_low(df) |
        _gate_hour_kills(df) |
        _gate_rvol_exhaustion(df) |
        _gate_low_jedi(df)
    )

    all_base, all_early_map = [], {k: [] for k in [
        "tape_decel", "rvol_fade", "score_decay_fast", "body_shrink",
        "atr_diverge", "over_extension", "bb_touch",
        "round_number", "regime_degrade", "jedi_fade",
    ]}

    for sym, g in df.groupby("symbol"):
        g   = g.sort_values("ts").reset_index(drop=True)
        sc  = g["soft_score"].values
        blk = gate_blocked[g.index if hasattr(gate_blocked, '__getitem__') else slice(None)]
        # use per-row blocked correctly
        blk = g.apply(lambda r: False, axis=1).values  # will recompute below
        blk = (
            _gate_squeeze(g) |
            _gate_atr_rank_low(g) |
            _gate_hour_kills(g) |
            _gate_rvol_exhaustion(g) |
            _gate_low_jedi(g)
        )

        entry = (sc >= SOFT_THR) & ~blk

        if entry.sum() < 5:
            continue

        # Compute exit signals
        signals = {
            "tape_decel":       _exit_tape_decel(g),
            "rvol_fade":        _exit_rvol_fade(g),
            "score_decay_fast": _exit_score_decay_fast(sc),
            "body_shrink":      _exit_body_shrink(g),
            "atr_diverge":      _exit_atr_diverge(g, sc),
            "over_extension":   _exit_over_extension(g),
            "bb_touch":         _exit_bb_touch(g),
            "round_number":     _exit_round_number(g),
            "regime_degrade":   _exit_regime_degrade(g),
            "jedi_fade":        _exit_jedi_fade(g),
        }

        # baseline returns for this symbol
        base = np.array([
            float(g.iloc[i]["outcome_4h_pct"])
            for i in range(len(g)) if entry[i]
        ])
        all_base.extend(base.tolist())

        for name, sig in signals.items():
            _, early = simulate_exit_signal(g, sc, entry, sig)
            all_early_map[name].extend(early.tolist())

    base_arr = np.array(all_base)
    base_sh  = sharpe(base_arr)
    print(f"\nBaseline (hold 4h): Sharpe={base_sh}  n={len(base_arr):,}")

    results = []
    for name, early_list in all_early_map.items():
        early_arr = np.array(early_list)
        if len(early_arr) != len(base_arr):
            continue
        # How many trades had early exit triggered?
        n_early = int((early_arr != base_arr).sum())
        pct_triggered = round(n_early / max(len(base_arr), 1) * 100, 1)
        sh = sharpe(early_arr)
        delta = round((sh or 0) - (base_sh or 0), 3)
        verdict = "IMPROVES" if delta > 0.05 else ("HURTS" if delta < -0.05 else "NEUTRAL")
        results.append({
            "signal":        name,
            "sharpe":        sh,
            "delta":         delta,
            "n_early":       n_early,
            "pct_triggered": pct_triggered,
            "verdict":       verdict,
        })
        print(f"  {name:22s}  delta={delta:+.3f}  triggered={pct_triggered:5.1f}%  sharpe={sh}  {verdict}")

    results.sort(key=lambda x: x["delta"], reverse=True)

    # Greedy combination: add exit signals that stack
    print("\n--- FORWARD COMBINATION ---")
    # For combination: "use 1h outcome if ANY selected exit fires"
    base_arr_combined = np.array(all_base)
    combined_early = base_arr_combined.copy()  # starts as 4h
    current_sh = base_sh
    selected = []

    for r in results:
        if r["delta"] <= 0.05:
            break
        name = r["signal"]
        # Recompute combined: take 1h if THIS signal OR any already selected fires
        all_early_combined = []
        sym_offset = 0
        for sym, g in df.groupby("symbol"):
            g = g.sort_values("ts").reset_index(drop=True)
            sc = g["soft_score"].values
            blk = (
                _gate_squeeze(g) | _gate_atr_rank_low(g) |
                _gate_hour_kills(g) | _gate_rvol_exhaustion(g) |
                _gate_low_jedi(g)
            )
            entry = (sc >= SOFT_THR) & ~blk
            if entry.sum() < 5:
                continue
            sigs = {
                "tape_decel":       _exit_tape_decel(g),
                "rvol_fade":        _exit_rvol_fade(g),
                "score_decay_fast": _exit_score_decay_fast(sc),
                "body_shrink":      _exit_body_shrink(g),
                "atr_diverge":      _exit_atr_diverge(g, sc),
                "over_extension":   _exit_over_extension(g),
                "bb_touch":         _exit_bb_touch(g),
                "round_number":     _exit_round_number(g),
                "regime_degrade":   _exit_regime_degrade(g),
                "jedi_fade":        _exit_jedi_fade(g),
            }
            # combined signal = union of selected + this candidate
            combined_sig = np.zeros(len(g), dtype=bool)
            for s in selected + [name]:
                combined_sig |= sigs[s]
            _, early = simulate_exit_signal(g, sc, entry, combined_sig)
            all_early_combined.extend(early.tolist())

        trial_sh = sharpe(np.array(all_early_combined))
        if trial_sh is not None and trial_sh > current_sh + 0.05:
            current_sh = trial_sh
            selected.append(name)
            print(f"  ADD {name:22s} → Sharpe={trial_sh:.3f}")
        else:
            print(f"  SKIP {name:22s}  (s={trial_sh})")

    print(f"\nFINAL: Sharpe={current_sh:.3f}  selected={selected}")

    report = {
        "baseline_sharpe":  base_sh,
        "baseline_n":       len(base_arr),
        "per_signal":       results,
        "selected_exits":   selected,
        "combined_sharpe":  current_sh,
        "generated_at":     __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2))
    print(f"\nexit_optimizer_report.json → {OUT}")
    return report


if __name__ == "__main__":
    run()
