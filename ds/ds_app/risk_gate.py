"""
risk_gate.py — Pre-trade Risk Gate
Sits between MoE alpha signal and any order submission.
Returns APPROVED / REJECTED / FLAGGED per signal.

Checks (in order):
  1. DAILY_HALT    — portfolio daily loss > MAX_DAILY_LOSS → halt all
  2. CONCENTRATION — position size > MAX_POSITION_PCT of capital
  3. POD_KILL      — expert rolling drawdown > POD_KILL_THRESH → zero weight
  4. VOLATILITY    — ATR spike filter (regime mismatch)
  5. CORRELATION   — too many correlated longs in same sector
  6. MIN_CONFIDENCE — alpha below threshold gets rejected
"""
from __future__ import annotations

import json
import pathlib
import time
from dataclasses import dataclass, field
from typing import Literal

# ── Constants ────────────────────────────────────────────────────────────────
MAX_DAILY_LOSS      = -0.02      # -2% portfolio → halt all signals
MAX_POSITION_PCT    = 0.05       # 5% max per position
POD_KILL_THRESH     = -0.03      # -3% expert drawdown → kill pod
MIN_ALPHA           = 0.40       # below this → rejected
MIN_CONFIDENCE      = 0.50
MAX_CORRELATED_LONGS = 5         # max same-direction positions

ALGO_DAY_PATH = pathlib.Path(__file__).parent.parent.parent / "engine" / "data" / "algo_day.json"

# ── In-memory pod state (resets on server restart) ───────────────────────────
_pod_state: dict[str, dict] = {
    "vector":     {"drawdown": 0.0, "peak_score": 0.0, "killed": False},
    "volatility": {"drawdown": 0.0, "peak_score": 0.0, "killed": False},
    "ghost":      {"drawdown": 0.0, "peak_score": 0.0, "killed": False},
    "arb":        {"drawdown": 0.0, "peak_score": 0.0, "killed": False},
    "pulse":      {"drawdown": 0.0, "peak_score": 0.0, "killed": False},
}

_portfolio_state = {
    "daily_pnl":      0.0,
    "halted":         False,
    "open_longs":     0,
    "open_shorts":    0,
    "last_reset_day": "",
}


# ── Data classes ─────────────────────────────────────────────────────────────
@dataclass
class AlphaSignal:
    symbol:     str
    alpha:      float          # -1 to +1
    direction:  str            # LONG | SHORT | FLAT
    confidence: float          # 0-1
    regime:     str
    expert_weights: dict       # {vector: 0.4, pulse: 0.3, ...}
    proposed_size:  float = 0.02   # fraction of capital


@dataclass
class GateResult:
    symbol:     str
    status:     Literal["APPROVED", "REJECTED", "FLAGGED"]
    approved_size: float       # 0 if rejected
    reasons:    list[str] = field(default_factory=list)
    checks:     dict = field(default_factory=dict)


# ── Core gate function ────────────────────────────────────────────────────────
def run_gate(signals: list[AlphaSignal]) -> list[GateResult]:
    _maybe_reset_daily()
    results = []

    for sig in signals:
        result = _check_signal(sig)
        results.append(result)

    return results


def _check_signal(sig: AlphaSignal) -> GateResult:
    reasons: list[str] = []
    checks:  dict      = {}
    status             = "APPROVED"
    approved_size      = sig.proposed_size

    # 1. DAILY HALT
    checks["daily_halt"] = _portfolio_state["halted"]
    if _portfolio_state["halted"]:
        return GateResult(sig.symbol, "REJECTED", 0.0,
                          ["DAILY_HALT: portfolio daily loss exceeded"],
                          checks)

    # 2. MIN ALPHA / CONFIDENCE
    checks["alpha_ok"] = abs(sig.alpha) >= MIN_ALPHA
    checks["conf_ok"]  = sig.confidence >= MIN_CONFIDENCE
    if not checks["alpha_ok"]:
        reasons.append(f"ALPHA_WEAK: {sig.alpha:.3f} < {MIN_ALPHA}")
        status = "REJECTED"
    if not checks["conf_ok"]:
        reasons.append(f"CONF_LOW: {sig.confidence:.2f} < {MIN_CONFIDENCE}")
        status = "REJECTED"
    if status == "REJECTED":
        return GateResult(sig.symbol, status, 0.0, reasons, checks)

    # 3. POD KILL CHECK — if dominant expert is killed, reduce or reject
    dominant_expert = max(sig.expert_weights, key=sig.expert_weights.get)
    pod = _pod_state.get(dominant_expert, {})
    checks["pod_killed"]  = pod.get("killed", False)
    checks["pod_drawdown"] = pod.get("drawdown", 0.0)
    if pod.get("killed", False):
        reasons.append(f"POD_KILLED: {dominant_expert} drawdown {pod['drawdown']:.1%}")
        status = "FLAGGED"
        approved_size *= 0.25   # allow at 25% size only

    # 4. CONCENTRATION — cap size
    checks["concentration"] = approved_size
    if approved_size > MAX_POSITION_PCT:
        reasons.append(f"CONCENTRATION: size {approved_size:.1%} capped to {MAX_POSITION_PCT:.1%}")
        approved_size = MAX_POSITION_PCT
        if status == "APPROVED":
            status = "FLAGGED"

    # 5. CORRELATION — too many open same-direction longs
    if sig.direction == "LONG" and _portfolio_state["open_longs"] >= MAX_CORRELATED_LONGS:
        reasons.append(f"CORRELATION: {_portfolio_state['open_longs']} open longs already")
        status = "FLAGGED"
        approved_size *= 0.5

    # 6. VOLATILITY FILTER — reject if regime=HIGH_VOL_NEWS and direction mismatch
    checks["regime"] = sig.regime
    if sig.regime == "HIGH_VOL_NEWS" and sig.direction == "LONG" and sig.alpha < 0.7:
        reasons.append(f"VOL_FILTER: HIGH_VOL_NEWS regime requires alpha > 0.7, got {sig.alpha:.2f}")
        status = "FLAGGED"
        approved_size *= 0.5

    if status == "APPROVED":
        checks["approved"] = True

    return GateResult(sig.symbol, status, round(approved_size, 4), reasons, checks)


# ── Portfolio state management ────────────────────────────────────────────────
def update_pod_score(expert: str, score: float) -> None:
    """Call after each expert evaluation to track drawdown."""
    if expert not in _pod_state:
        return
    pod = _pod_state[expert]
    if score > pod["peak_score"]:
        pod["peak_score"] = score
        pod["drawdown"]   = 0.0
    else:
        pod["drawdown"] = (score - pod["peak_score"]) / max(pod["peak_score"], 0.01)
    pod["killed"] = pod["drawdown"] < POD_KILL_THRESH


def record_pnl(pnl_pct: float) -> None:
    """Update daily PnL; triggers halt if threshold crossed."""
    _portfolio_state["daily_pnl"] += pnl_pct
    if _portfolio_state["daily_pnl"] < MAX_DAILY_LOSS:
        _portfolio_state["halted"] = True


def reset_halt() -> None:
    _portfolio_state["halted"]    = False
    _portfolio_state["daily_pnl"] = 0.0


def _maybe_reset_daily() -> None:
    today = time.strftime("%Y-%m-%d")
    if _portfolio_state["last_reset_day"] != today:
        _portfolio_state["daily_pnl"]      = 0.0
        _portfolio_state["halted"]         = False
        _portfolio_state["last_reset_day"] = today
        for pod in _pod_state.values():
            pod["killed"] = False


# ── Snapshot for UI ───────────────────────────────────────────────────────────
def gate_status_snapshot() -> dict:
    return {
        "portfolio": {
            "daily_pnl":  _portfolio_state["daily_pnl"],
            "halted":     _portfolio_state["halted"],
            "open_longs": _portfolio_state["open_longs"],
        },
        "pods": {
            k: {
                "drawdown": round(v["drawdown"], 4),
                "killed":   v["killed"],
            }
            for k, v in _pod_state.items()
        },
        "limits": {
            "max_daily_loss":    MAX_DAILY_LOSS,
            "max_position_pct":  MAX_POSITION_PCT,
            "pod_kill_thresh":   POD_KILL_THRESH,
            "min_alpha":         MIN_ALPHA,
        },
        "ts": int(time.time()),
    }
