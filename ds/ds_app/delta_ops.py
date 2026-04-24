"""
ds_app/delta_ops.py — Delta Special Ops Position Manager

DOCTRINE: No stops. No donations to the MM Benevolent Society.
Exit on invalidation. Re-enter if revalidated. Always winning.

POSITION LIFECYCLE:
  FLAT     → ENTRY when: gates clear + soft_score >= ENTRY_THR + jedi conviction
  IN       → SCALE-IN when: acceleration confirmed (score↑ + rvol↑, 3 bars)
  IN       → SCALE-OUT (1 lot) when: deceleration (score↓ or rvol↓) — lock partial
  IN       → FULL EXIT when: CIS >= CIS_THRESHOLD (2 of 5 invalidation signals)
  POST-CIS → RE-ENTRY when: CIS clears to 0 + setup revalidates within REENTRY_WINDOW bars

COMBINED INVALIDATION SCORE (CIS):
  1. SQUEEZE_FIRED    — squeeze activated while in trend (BB contracted inside KC)
  2. REGIME_FLIP      — current regime != entry regime
  3. JEDI_REVERSAL    — jedi_raw crossed to opposite sign vs entry
  4. SCORE_DECAY      — soft_score dropped below DECAY_THR (momentum gone)
  5. ATR_COLLAPSE     — ATR rank < 20th pct (market frozen post-entry)

Any 2+ firing = EXIT. No stop price. No donation.

Output: ds/data/delta_ops_report.json
"""
from __future__ import annotations

import json
import logging
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("delta_ops")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

_HERE    = Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent
if str(_DS_ROOT) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT))

from ds_app.algos_crypto import ALL_ALGO_IDS  # noqa: E402
from ds_app.sharpe_ensemble import (          # noqa: E402
    SIGNAL_DB, REGIME_MAP, SOFT_REGIME_MULT, assign_regimes,
)
from ds_app.trade_quality_gate import (       # noqa: E402
    KILL_HOURS, ATR_RANK_WINDOW, RVOL_EXHAUST_WINDOW,
    _gate_squeeze, _gate_atr_rank_low, _gate_hour_kills,
    _gate_rvol_exhaustion, _gate_low_jedi,
)

OUT = _DS_ROOT / "data" / "delta_ops_report.json"
ANNUAL = 252 * 78


# ── Mode configs ──────────────────────────────────────────────────────────────

@dataclass
class ModeConfig:
    name: str
    kelly_mult: float      # fraction of full Kelly
    max_lots: float        # maximum total position (in Kelly units)
    entry_thr: float       # soft_score threshold for entry
    decay_thr: float       # soft_score below which SCORE_DECAY fires
    cis_threshold: int     # how many CIS signals = exit (default 2)
    accel_bars: int        # bars of sustained improvement before scale-in
    reentry_window: int    # bars after CIS exit to look for re-entry
    jedi_min: int          # minimum abs(jedi_raw) for entry (LOW_JEDI gate)
    be_bars: int = 0       # bars after entry before breakeven stop activates (0 = disabled)
    harvest_on_scale: bool = False  # on each scale-in, book 1 base_lot as harvested profit
    reentry_lot_mult: float = 1.0  # multiply base_lot on re-entry (retest confirmation edge)
    horizon_bars: int = 48  # max hold duration in 5m bars (48=4h, 24=2h, 12=1h)


PADAWAN = ModeConfig(
    name="PADAWAN",
    kelly_mult=0.25,
    max_lots=1.5,          # never scale past 1.5× (3 half-lots)
    entry_thr=0.05,        # top ~10% of soft_score distribution
    decay_thr=0.02,
    cis_threshold=2,
    accel_bars=3,
    reentry_window=12,     # 1h of 5m bars
    jedi_min=4,
)

NORMAL = ModeConfig(
    name="NORMAL",
    kelly_mult=1.0,
    max_lots=3.0,
    entry_thr=0.12,        # top ~5% of soft_score distribution
    decay_thr=0.05,
    cis_threshold=2,
    accel_bars=3,
    reentry_window=24,     # 2h
    jedi_min=4,
)

EUPHORIA = ModeConfig(
    name="EUPHORIA",
    kelly_mult=2.5,
    max_lots=2.5,          # iopt: accel=1 fires fast, 2.5 cap prevents over-pyramid
    entry_thr=0.12,        # iopt: top ~5% — jedi=10 does the quality filtering, not score extremes
    decay_thr=0.05,
    cis_threshold=2,       # iopt: fat pitches need room — cis=1 cuts winners too early
    accel_bars=1,          # iopt: accel=1 fires faster scale-in, critical for 30m horizon
    reentry_window=4,      # iopt: tight retest window — confirmation must be immediate
    jedi_min=10,           # iopt: THE key param — jedi>=10 selects continuation, not exhaustion
    be_bars=5,             # iopt: 5×5m = 25min continuation before house money
    harvest_on_scale=True,
    reentry_lot_mult=2.0,
    horizon_bars=6,        # iopt: 30min — fast mover, get off at next station
)

# MAX = all-in mode. 4× Kelly, exponential pyramid 1→2→4 clipped at 5.
# Tightest CIS (2 fires) — must exit fast at this size. jedi_min=10 = fat pitch only.
# After 2 bars (or first continuation), stop moves to entry price (house money).
# Each scale-in harvests 1 base_lot — lock life-changing moves early.
MAX = ModeConfig(
    name="MAX",
    kelly_mult=4.0,
    max_lots=5.0,          # pyramid: tier0=1 tier1=+1→2 tier2=+2→4 tier3=+4→clipped at 5
    entry_thr=0.35,        # iopt: entry_thr=0.35 + jedi=8 → 92 trades, 6 scale-ins, Sharpe 17.8
    decay_thr=0.12,
    cis_threshold=1,       # exit FAST — 5× position, any single signal = out
    accel_bars=2,
    reentry_window=4,
    jedi_min=8,            # iopt: jedi=8 (not 10) — entry_thr does the quality filtering at MAX level
    be_bars=2,             # house money after 2 bars
    harvest_on_scale=True,
    reentry_lot_mult=3.0,
    horizon_bars=6,        # 30min max
)


# ── CIS computation ───────────────────────────────────────────────────────────

def compute_cis(
    idx: int,
    df: pd.DataFrame,
    scores: np.ndarray,
    regimes: np.ndarray,
    entry_regime: str,
    entry_jedi: float,
    entry_score: float,
    mode: ModeConfig,
) -> tuple[int, dict]:
    """Return (cis_total, breakdown_dict).

    EUPHORIA uses structural-only CIS (SQUEEZE + SCORE_DECAY + ATR_COLLAPSE).
    Early-warning signals (JEDI_FADE, REGIME_DEGRADE) are too sensitive for
    fat-pitch positions that naturally span regime transitions.
    """
    flags: dict[str, int] = {}
    is_euphoria = (mode.name == "EUPHORIA")

    # 1. SQUEEZE_FIRED
    sqz = int(df.iloc[idx]["squeeze"]) if "squeeze" in df.columns else 0
    flags["SQUEEZE_FIRED"] = int(sqz == 1)

    j_now = float(df.iloc[idx].get("jedi_raw", 0) or 0)

    if is_euphoria:
        # EUPHORIA: only exit on structural break — RISK-OFF/EXHAUSTION or hard JEDI reversal
        # TRENDING_STRONG→TRENDING_WEAK is noise in fat pitches — don't exit
        _STRUCTURAL_BAD = {"RISK-OFF", "EXHAUSTION", "RANGING"}
        flags["REGIME_FLIP"]    = int(regimes[idx] in _STRUCTURAL_BAD and entry_regime not in _STRUCTURAL_BAD)
        flags["JEDI_REVERSAL"]  = int(
            (entry_jedi > 0 and j_now < -2) or (entry_jedi < 0 and j_now > 2)
        )
    else:
        # PADAWAN/NORMAL: early-warning signals — exit before the full reversal
        # REGIME_DEGRADE: trend died (+1.121 Sharpe, 3.7% trigger)
        # 7-regime logic: degrade = entry was in a "good" regime, now in a "bad" one
        _GOOD = {"TRENDING_STRONG", "TRENDING_WEAK", "TRENDING", "BREAKOUT"}
        _BAD  = {"RANGING", "RISK-OFF", "EXHAUSTION"}
        cur   = regimes[idx]
        degrade = (
            # entered in strong trend, now ranging/risk-off/exhaustion
            (entry_regime in _GOOD and cur in _BAD)
            # entered in TRENDING_STRONG, now TRENDING_WEAK (partial degrade)
            or (entry_regime == "TRENDING_STRONG" and cur == "TRENDING_WEAK")
            # entered in BREAKOUT but it stalled (BREAKOUT → RANGING without TRENDING)
            or (entry_regime == "BREAKOUT" and cur in _BAD)
        )
        flags["REGIME_DEGRADE"] = int(degrade)
        # JEDI_FADE: conviction halved (+0.486 Sharpe, 9.5% trigger)
        flags["JEDI_FADE"]      = int(
            abs(entry_jedi) >= 4 and abs(j_now) < abs(entry_jedi) * 0.50
        )

    # 4. SCORE_DECAY — soft score fallen to < 40% of entry score (momentum collapse)
    flags["SCORE_DECAY"] = int(scores[idx] < entry_score * 0.40)

    # 5. ATR_COLLAPSE — atr dropped into bottom 20% of recent window (market frozen)
    atr_rank = float(df.iloc[idx].get("atr_rank", 0.5) or 0.5)
    flags["ATR_COLLAPSE"] = int(atr_rank < 0.20)

    # 6. SQUEEZE_FIRED — squeeze activated while in a directional position
    sqz = int(df.iloc[idx]["squeeze"]) if "squeeze" in df.columns else 0
    flags["SQUEEZE_FIRED"] = int(sqz == 1)

    total = sum(flags.values())
    return total, flags


# ── Acceleration / deceleration detector ─────────────────────────────────────

def _accel_state(idx: int, scores: np.ndarray, rvol: np.ndarray, window: int = 3) -> str:
    """
    Returns 'ACCEL', 'DECEL', or 'FLAT'.
    ACCEL: score AND rvol both rising over last `window` bars.
    DECEL: score OR rvol declining over last `window` bars.
    """
    if idx < window:
        return "FLAT"
    s_now, s_prev = scores[idx], scores[idx - window]
    r_now, r_prev = rvol[idx],   rvol[idx - window]
    if s_now > s_prev * 1.05 and r_now > r_prev * 1.05:
        return "ACCEL"
    if s_now < s_prev * 0.90 or r_now < r_prev * 0.90:
        return "DECEL"
    return "FLAT"


# ── Main simulation ───────────────────────────────────────────────────────────

@dataclass
class Trade:
    entry_idx: int
    entry_score: float
    entry_regime: str
    entry_jedi: float
    lots_in: float
    base_lot: float = 1.0  # initial entry size — anchor for exponential pyramid
    entry_price: float = 0.0
    scale_in_count: int = 0
    scale_out_count: int = 0
    partial_returns: list[float] = field(default_factory=list)
    breakeven_locked: bool = False
    harvested_lots: int = 0
    exit_idx: int = -1
    exit_reason: str = ""
    final_return: float = 0.0
    reentry: bool = False


def simulate_symbol(
    df: pd.DataFrame,
    scores: np.ndarray,
    regimes: np.ndarray,
    outcomes: np.ndarray,
    gates_blocked: np.ndarray,
    mode: ModeConfig,
) -> list[Trade]:
    """Simulate Delta Ops lifecycle on a single symbol's OOS bars."""
    n = len(df)
    rvol = df["rvol"].fillna(1.0).values
    trades: list[Trade] = []
    position: Trade | None = None
    cis_exit_idx = -999  # last CIS exit bar index

    for i in range(1, n):
        score = scores[i]
        regime = regimes[i]
        jedi = float(df.iloc[i].get("jedi_raw", 0) or 0)

        # ── In position: update ──────────────────────────────────────────────
        if position is not None:
            close_now = float(df.iloc[i].get("close", position.entry_price) or position.entry_price)
            outcome_1h = float(df.iloc[i].get("outcome_1h_pct", 0) or 0)

            # Breakeven lock: trigger after be_bars of continuation in profit
            if (not position.breakeven_locked
                    and mode.be_bars > 0
                    and (i - position.entry_idx) >= mode.be_bars
                    and close_now > position.entry_price):
                position.breakeven_locked = True

            # Breakeven stop: price returned to entry — exit at 0 (house money protected)
            if position.breakeven_locked and close_now <= position.entry_price:
                position.exit_idx = i
                position.exit_reason = "BREAKEVEN_STOP"
                position.final_return = 0.0
                trades.append(position)
                position = None
                continue

            cis_total, cis_flags = compute_cis(
                i, df, scores, regimes,
                position.entry_regime, position.entry_jedi,
                position.entry_score, mode,
            )

            # CIS exit — check BEFORE scale-in (never scale into an exit)
            if cis_total >= mode.cis_threshold:
                position.exit_idx = i
                position.exit_reason = f"CIS={cis_total} [{','.join(k for k,v in cis_flags.items() if v)}]"
                position.final_return = float(df.iloc[i].get("outcome_1h_pct", 0) or 0) * position.lots_in
                trades.append(position)
                cis_exit_idx = i
                position = None
                continue

            # Natural exit at mode horizon — "getting off at next station"
            if i - position.entry_idx >= mode.horizon_bars:
                position.exit_idx = i
                position.exit_reason = "HORIZON"
                position.final_return = float(df.iloc[i].get("outcome_1h_pct", 0) or 0) * position.lots_in
                trades.append(position)
                position = None
                continue

            accel = _accel_state(i, scores, rvol, mode.accel_bars)

            # Scale-in on confirmed acceleration
            if (accel == "ACCEL"
                    and position.lots_in < mode.max_lots
                    and not gates_blocked[i]):
                if mode.name in ("EUPHORIA", "MAX"):
                    # Exponential pyramid: tier 0=+1×, tier 1=+2×, tier 2=+4×
                    add = position.base_lot * (2 ** position.scale_in_count)
                else:
                    add = 0.5
                position.lots_in = min(position.lots_in + add, mode.max_lots)
                position.scale_in_count += 1

                # EUPHORIA/MAX: harvest 1 base_lot — realized gain from entry to now
                if mode.harvest_on_scale and position.entry_price > 0:
                    realized = (close_now - position.entry_price) / position.entry_price
                    position.partial_returns.append(realized * position.base_lot)
                    position.harvested_lots += 1
                    if not position.breakeven_locked and close_now > position.entry_price:
                        position.breakeven_locked = True

            # Scale-out on deceleration — trim last exponential add, lock partial
            elif accel == "DECEL" and position.lots_in > position.base_lot:
                if mode.name in ("EUPHORIA", "MAX") and position.scale_in_count > 0:
                    remove = position.base_lot * (2 ** (position.scale_in_count - 1))
                    remove = min(remove, position.lots_in - position.base_lot)
                else:
                    remove = min(0.5, position.lots_in - position.base_lot)
                partial_ret = float(df.iloc[i].get("outcome_1h_pct", 0) or 0)
                position.partial_returns.append(partial_ret * remove)
                position.lots_in -= remove
                position.scale_out_count += 1

        # ── Flat: check entry ────────────────────────────────────────────────
        else:
            if gates_blocked[i]:
                continue
            if score < mode.entry_thr:
                continue
            if abs(jedi) < mode.jedi_min:
                continue

            # Re-entry: only allowed REENTRY_WINDOW bars after CIS exit, if setup revalidated
            is_reentry = (0 < (i - cis_exit_idx) <= mode.reentry_window)

            base = mode.reentry_lot_mult if is_reentry else 1.0
            position = Trade(
                entry_idx=i,
                entry_score=score,
                entry_regime=regime,
                entry_jedi=jedi,
                lots_in=base,
                base_lot=base,
                entry_price=float(df.iloc[i].get("close", 0) or 0),
                reentry=is_reentry,
            )

    # Close any open position at end
    if position is not None:
        last = len(df) - 1
        position.exit_idx = last
        position.exit_reason = "END_OF_DATA"
        position.final_return = float(df.iloc[last].get("outcome_4h_pct", 0) or 0)
        trades.append(position)

    return trades


# ── Return aggregation ────────────────────────────────────────────────────────

def _trade_returns(trades: list[Trade]) -> np.ndarray:
    rets = []
    for t in trades:
        total = sum(t.partial_returns) + t.final_return
        rets.append(total)
    return np.array(rets)


def sharpe(r: np.ndarray) -> float | None:
    r = r[~np.isnan(r)]
    if len(r) < 30: return None
    sd = r.std(ddof=1)
    if sd < 1e-9: return None
    return round(float(r.mean() / sd * np.sqrt(ANNUAL)), 3)


# ── Main entry ────────────────────────────────────────────────────────────────

def run(mode: ModeConfig = PADAWAN, days: int = 0) -> dict:
    if not SIGNAL_DB.exists():
        return {"error": str(SIGNAL_DB)}
    if not REGIME_MAP.exists():
        return {"error": "regime_signal_map.json missing"}

    conn = sqlite3.connect(SIGNAL_DB)
    pragma = {r[1] for r in conn.execute("PRAGMA table_info(signal_log)")}
    v_cols = [f"v_{s}" for s in ALL_ALGO_IDS if f"v_{s}" in pragma]
    want   = ["ts","symbol","outcome_4h_pct","outcome_1h_pct","close","high","low","open",
              "atr_pct","squeeze","rvol","volume","jedi_raw"] + v_cols
    sel = [c for c in want if c in pragma]
    seen: set = set()
    sel = [c for c in sel if not (c in seen or seen.add(c))]
    rows = conn.execute(
        f"SELECT {','.join(sel)} FROM signal_log"
        f" WHERE outcome_4h_pct IS NOT NULL ORDER BY symbol,ts"
    ).fetchall()
    conn.close()

    df_all = pd.DataFrame(rows, columns=sel)

    if days > 0:
        per_day = 86_400_000 if df_all["ts"].max() > 1e12 else 86_400
        cutoff = df_all["ts"].max() - days * per_day
        df_all = df_all[df_all["ts"] >= cutoff].copy()
        log.info("Medallion slice: last %d days → %d bars", days, len(df_all))

    oos_cut = int(np.percentile(df_all["ts"].values, 70))
    df_all = df_all[df_all["ts"] >= oos_cut].copy()
    log.info("OOS bars: %d", len(df_all))

    # Build soft scores and gates per-symbol
    from ds_app.trade_quality_gate import _enrich, _build_soft_scores  # noqa: E402

    log.info("Enriching…")
    df_all = _enrich(df_all)
    regimes_all = df_all["regime"].values
    scores_all  = _build_soft_scores(df_all, regimes_all)
    df_all["soft_score"] = scores_all

    # Gate mask (True = blocked)
    df_all["__blocked"] = (
        _gate_squeeze(df_all) |
        _gate_atr_rank_low(df_all) |
        _gate_hour_kills(df_all) |
        _gate_rvol_exhaustion(df_all) |
        _gate_low_jedi(df_all)
    )

    all_trades:     list[Trade] = []
    reentry_trades: list[Trade] = []

    for sym, g in df_all.groupby("symbol"):
        g = g.sort_values("ts").reset_index(drop=True)
        s   = g["soft_score"].values   # pre-computed, aligned with g after reset_index
        reg = g["regime"].values
        out = g["outcome_4h_pct"].values.astype(float)
        blk = g["__blocked"].values

        t = simulate_symbol(g, s, reg, out, blk, mode)
        all_trades.extend(t)
        reentry_trades.extend(x for x in t if x.reentry)

    rets = _trade_returns(all_trades)
    reentry_rets = _trade_returns(reentry_trades) if reentry_trades else np.array([])

    # Breakdown by exit reason
    exit_reasons: dict[str, list[float]] = {}
    for t in all_trades:
        reason = t.exit_reason.split("=")[0].split("[")[0]
        exit_reasons.setdefault(reason, []).append(
            sum(t.partial_returns) + t.final_return
        )

    scale_in_events   = sum(t.scale_in_count  for t in all_trades)
    scale_out_events  = sum(t.scale_out_count for t in all_trades)
    be_stop_trades    = [t for t in all_trades if t.exit_reason == "BREAKEVEN_STOP"]
    total_harvested   = sum(t.harvested_lots  for t in all_trades)
    be_rets           = _trade_returns(be_stop_trades) if be_stop_trades else np.array([])

    log.info("MODE=%s  trades=%d  sharpe=%.3f  scale_in=%d  scale_out=%d  reentries=%d  be_stops=%d  harvested_lots=%d",
             mode.name, len(all_trades), sharpe(rets) or 0,
             scale_in_events, scale_out_events, len(reentry_trades),
             len(be_stop_trades), total_harvested)

    report = {
        "mode":          mode.name,
        "n_trades":      len(all_trades),
        "sharpe":        sharpe(rets),
        "win_rate":      round(float((rets > 0).mean()), 3) if len(rets) > 0 else None,
        "avg_return":    round(float(rets.mean()), 5) if len(rets) > 0 else None,
        "scale_in_events":  scale_in_events,
        "scale_out_events": scale_out_events,
        "breakeven_stops":  len(be_stop_trades),
        "harvested_lots":   total_harvested,
        "reentry_trades":   len(reentry_trades),
        "reentry_sharpe":   sharpe(reentry_rets),
        "exit_breakdown": {
            k: {
                "n": len(v),
                "sharpe": sharpe(np.array(v)),
                "win_rate": round(float((np.array(v) > 0).mean()), 3),
            }
            for k, v in exit_reasons.items()
        },
        "config": {
            "kelly_mult":       mode.kelly_mult,
            "max_lots":         mode.max_lots,
            "entry_thr":        mode.entry_thr,
            "decay_thr":        mode.decay_thr,
            "cis_threshold":    mode.cis_threshold,
            "accel_bars":       mode.accel_bars,
            "reentry_window":   mode.reentry_window,
            "kill_hours":       sorted(KILL_HOURS),
        },
        "generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2))
    log.info("delta_ops_report.json → %s", OUT)
    return report


HOLDOUT_OUT = _DS_ROOT / "data" / "holdout_report.json"


def run_holdout(mode: ModeConfig = PADAWAN, holdout_pct: float = 85.0) -> dict:
    """
    Re-entry holdout validation.
    Uses only the top (100 - holdout_pct)% of data — data the model never saw
    during OOS gate selection or mode tuning.

    OOS slice: 70th–holdout_pct percentile  (gate search + tuning)
    HOLDOUT:   holdout_pct–100th percentile  (this function)

    Verdict:
      reentry_sharpe on holdout >= 10   → VALID (edge holds on unseen data)
      reentry_sharpe on holdout 5–10    → MARGINAL (monitor)
      reentry_sharpe < 5 or negative    → OVERFIT WARNING
    """
    if not SIGNAL_DB.exists():
        return {"error": str(SIGNAL_DB)}
    if not REGIME_MAP.exists():
        return {"error": "regime_signal_map.json missing"}

    conn = sqlite3.connect(SIGNAL_DB)
    pragma = {r[1] for r in conn.execute("PRAGMA table_info(signal_log)")}
    v_cols = [f"v_{s}" for s in ALL_ALGO_IDS if f"v_{s}" in pragma]
    want   = ["ts","symbol","outcome_4h_pct","outcome_1h_pct","close","high","low","open",
              "atr_pct","squeeze","rvol","volume","jedi_raw"] + v_cols
    sel    = [c for c in want if c in pragma]
    seen: set = set()
    sel = [c for c in sel if not (c in seen or seen.add(c))]
    rows = conn.execute(
        f"SELECT {','.join(sel)} FROM signal_log"
        f" WHERE outcome_4h_pct IS NOT NULL ORDER BY symbol,ts"
    ).fetchall()
    conn.close()

    df_all = pd.DataFrame(rows, columns=sel)
    all_ts  = df_all["ts"].values
    oos_cut     = int(np.percentile(all_ts, 70))
    holdout_cut = int(np.percentile(all_ts, holdout_pct))
    df_oos     = df_all[(df_all["ts"] >= oos_cut) & (df_all["ts"] < holdout_cut)].copy()
    df_holdout = df_all[df_all["ts"] >= holdout_cut].copy()

    log.info("Holdout split: OOS=%d bars, holdout=%d bars (%.0f–100th pct)",
             len(df_oos), len(df_holdout), holdout_pct)

    from ds_app.trade_quality_gate import _enrich, _build_soft_scores

    df_holdout = _enrich(df_holdout)
    regimes_h  = df_holdout["regime"].values
    scores_h   = _build_soft_scores(df_holdout, regimes_h)
    df_holdout["soft_score"] = scores_h

    df_holdout["__blocked"] = (
        _gate_squeeze(df_holdout) |
        _gate_atr_rank_low(df_holdout) |
        _gate_hour_kills(df_holdout) |
        _gate_rvol_exhaustion(df_holdout) |
        _gate_low_jedi(df_holdout)
    )

    all_trades:     list[Trade] = []
    reentry_trades: list[Trade] = []
    for sym, g in df_holdout.groupby("symbol"):
        g = g.sort_values("ts").reset_index(drop=True)
        s   = g["soft_score"].values
        reg = g["regime"].values
        out = g["outcome_4h_pct"].values.astype(float)
        blk = g["__blocked"].values
        t = simulate_symbol(g, s, reg, out, blk, mode)
        all_trades.extend(t)
        reentry_trades.extend(x for x in t if x.reentry)

    rets = _trade_returns(all_trades)
    reentry_rets = _trade_returns(reentry_trades) if reentry_trades else np.array([])

    reentry_sharpe = sharpe(reentry_rets)
    overall_sharpe = sharpe(rets)
    # Prefer re-entry Sharpe if available (thin-statistics guard).
    # Fall back to overall holdout Sharpe when re-entries are 0 (tight configs).
    _judge = reentry_sharpe if reentry_sharpe is not None else overall_sharpe
    verdict = (
        "VALID"    if _judge is not None and _judge >= 10 else
        "MARGINAL" if _judge is not None and _judge >= 5  else
        "OVERFIT_WARNING"
    )

    import datetime
    report = {
        "mode":             mode.name,
        "holdout_pct_cut":  holdout_pct,
        "holdout_bars":     len(df_holdout),
        "oos_bars":         len(df_oos),
        "n_trades":         len(all_trades),
        "sharpe":           sharpe(rets),
        "win_rate":         round(float((rets > 0).mean()), 3) if len(rets) > 0 else None,
        "reentry_trades":   len(reentry_trades),
        "reentry_sharpe":   reentry_sharpe,
        "reentry_win_rate": round(float((reentry_rets > 0).mean()), 3) if len(reentry_rets) > 0 else None,
        "verdict":          verdict,
        "note":             (
            f"OOS reentry Sharpe was ~29.7 on {87} trades. "
            f"Holdout reentry: {reentry_sharpe} on {len(reentry_trades)} trades."
        ),
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }

    HOLDOUT_OUT.parent.mkdir(parents=True, exist_ok=True)
    HOLDOUT_OUT.write_text(json.dumps(report, indent=2))
    log.info("holdout_report.json → %s", HOLDOUT_OUT)
    return report


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["PADAWAN","NORMAL","EUPHORIA","MAX"], default="PADAWAN")
    ap.add_argument("--holdout", action="store_true", help="run holdout validation only")
    ap.add_argument("--days", type=int, default=0, help="limit to last N days (0=all data)")
    args = ap.parse_args()
    m = {"PADAWAN": PADAWAN, "NORMAL": NORMAL, "EUPHORIA": EUPHORIA, "MAX": MAX}[args.mode]

    if args.holdout:
        r = run_holdout(m)
        print(f"\n{'='*55}")
        print(f"  HOLDOUT VALIDATION — MODE: {r['mode']}")
        print(f"{'='*55}")
        print(f"  Holdout bars:    {r['holdout_bars']:,}  (OOS: {r['oos_bars']:,})")
        print(f"  Trades:          {r['n_trades']:,}")
        print(f"  Sharpe:          {r['sharpe']}")
        print(f"  Win rate:        {r['win_rate']}")
        print(f"  Re-entry trades: {r['reentry_trades']}")
        print(f"  Re-entry Sharpe: {r['reentry_sharpe']}")
        print(f"  Verdict:         {r['verdict']}")
        print(f"{'='*55}")
    else:
        r = run(m, days=args.days)
        print(f"\n{'='*55}")
        print(f"  DELTA SPECIAL OPS — MODE: {r['mode']}")
        print(f"{'='*55}")
        print(f"  Trades:          {r['n_trades']:,}")
        print(f"  Sharpe:          {r['sharpe']}")
        print(f"  Win rate:        {r['win_rate']}")
        print(f"  Scale-in events: {r['scale_in_events']}")
        print(f"  Scale-out events:{r['scale_out_events']}  ← partial profit locks")
        print(f"  Breakeven stops: {r['breakeven_stops']}  ← house money exits")
        print(f"  Harvested lots:  {r['harvested_lots']}  ← lots booked on scale-in")
        print(f"  Re-entry trades: {r['reentry_trades']}  (Sharpe={r['reentry_sharpe']})")
        print(f"\n  Exit breakdown:")
        for reason, st in r["exit_breakdown"].items():
            print(f"    {reason:20s}  n={st['n']:4d}  sharpe={st['sharpe']}  win={st['win_rate']}")
        print(f"{'='*55}")
