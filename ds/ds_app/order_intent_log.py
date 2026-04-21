"""
order_intent_log.py — Shared audit rows for Alpaca + IBKR paper (I-OPT P0).

Env:
  PAPER_OPERATOR_ID — who/what triggered the run (default: system)
  M3D_PIPELINE_REV  — optional git SHA or release tag (shown in snapshot JSON)

Table: order_intent (created by alpaca_paper._init_db). Column alpaca_order_id holds
any broker order id (Alpaca UUID or IBKR integer id as string).

Engine SSOT: `engine/data/algo_day.json` timestamp is merged into each snapshot (mtime-cached).
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any

_ENGINE_ROOT = Path(__file__).resolve().parent.parent.parent
_ALGO_DAY_PATH = _ENGINE_ROOT / "engine" / "data" / "algo_day.json"
_algo_day_mtime: float = 0.0
_algo_day_ts_cached: str | None = None


def _engine_context_for_audit() -> dict[str, Any]:
    """`algo_day_timestamp` from engine snapshot when file exists (cached by mtime)."""
    global _algo_day_mtime, _algo_day_ts_cached
    try:
        st = _ALGO_DAY_PATH.stat().st_mtime
    except OSError:
        return {}
    if st != _algo_day_mtime:
        _algo_day_mtime = st
        _algo_day_ts_cached = None
        try:
            with open(_ALGO_DAY_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            _algo_day_ts_cached = data.get("timestamp") or data.get("ts")
        except Exception:
            _algo_day_ts_cached = None
    if _algo_day_ts_cached:
        return {"algo_day_timestamp": _algo_day_ts_cached}
    return {}


def engine_audit_meta() -> dict[str, Any]:
    """For HTTP JSON: engine file presence + timestamp (no DB)."""
    meta: dict[str, Any] = {"algo_day_path": "engine/data/algo_day.json"}
    try:
        st = _ALGO_DAY_PATH.stat().st_mtime
        meta["algo_day_file_mtime"] = int(st)
        meta["algo_day_exists"] = True
    except OSError:
        meta["algo_day_exists"] = False
        return meta
    ctx = _engine_context_for_audit()
    if ctx:
        meta.update(ctx)
    return meta


def audit_json(
    action: str,
    *,
    pipeline: str,
    gates_pass: bool = True,
    killed: list[str] | None = None,
    sc: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> str:
    p: dict[str, Any] = {
        "action": action,
        "gates_pass": gates_pass,
        "killed": killed or [],
        "pipeline": pipeline,
        "operator": os.getenv("PAPER_OPERATOR_ID", "system"),
    }
    rev = os.getenv("M3D_PIPELINE_REV", "").strip()
    if rev:
        p["pipeline_rev"] = rev
    eng = _engine_context_for_audit()
    if eng:
        p.update(eng)
    if sc:
        p["regime"] = sc.get("regime")
        p["soft_score"] = sc.get("soft_score")
        p["jedi_raw"] = sc.get("jedi_raw")
    if extra:
        p.update(extra)
    return json.dumps(p, separators=(",", ":"))


def insert_order_intent(
    db: sqlite3.Connection,
    ts: str,
    *,
    broker: str,
    symbol_raw: str,
    symbol_broker: str,
    side: str,
    qty: float,
    mode: str,
    dry_run: bool,
    snapshot_json: str,
    status: str,
    broker_order_id: str | None = None,
    error_text: str | None = None,
) -> None:
    db.execute(
        """
        INSERT INTO order_intent
        (ts, broker, symbol_raw, symbol_broker, side, qty, mode, dry_run,
         snapshot_json, status, alpaca_order_id, error_text)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            ts,
            broker,
            symbol_raw,
            symbol_broker,
            side.lower(),
            round(float(qty), 6),
            mode,
            1 if dry_run else 0,
            snapshot_json,
            status,
            broker_order_id,
            error_text,
        ),
    )
