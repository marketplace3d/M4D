"""
Persistent walk-forward *best* params for live /v1/signals and default backtest merges.

POST /v1/optimize/ or /v1/optimize/all/ with "persist": true — writes
ds/data/optimized_algo_params.json

Shape:
  {
    "version": 1,
    "system": { "jedi_bull_min_votes": 9, "jedi_bear_max_votes": -9, "updated": "ISO..." },
    "by_asset": { "BTC": { "DON_BO": {"n": 20, "exit_n": 10} } }
  }
"""
from __future__ import annotations

import json
import pathlib
import time
from typing import Any

from django.conf import settings

_STORE_NAME = "optimized_algo_params.json"


def _path() -> pathlib.Path:
    base = getattr(settings, "DS_DATA_DIR", None)
    if base is not None:
        return pathlib.Path(base) / _STORE_NAME
    return pathlib.Path(__file__).resolve().parent.parent / "data" / _STORE_NAME


def _default_state() -> dict[str, Any]:
    return {
        "version": 1,
        "system": {
            "jedi_bull_min_votes": 9,
            "jedi_bear_max_votes": -9,
            "updated": None,
        },
        "by_asset": {},
    }


def load_store() -> dict[str, Any]:
    p = _path()
    if not p.is_file():
        return _default_state()
    try:
        raw = json.loads(p.read_text())
        if not isinstance(raw, dict):
            return _default_state()
        d = _default_state()
        d["version"] = int(raw.get("version", 1))
        d["system"].update(raw.get("system") or {})
        d["by_asset"] = raw.get("by_asset") or {}
        if not isinstance(d["by_asset"], dict):
            d["by_asset"] = {}
        return d
    except (json.JSONDecodeError, OSError, TypeError, ValueError):
        return _default_state()


def save_store(state: dict[str, Any]) -> None:
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    state["system"] = state.get("system") or {}
    state["system"]["updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    p.write_text(json.dumps(state, indent=2, sort_keys=True))


def params_for_algo(asset: str, algo_id: str) -> dict:
    """
    Return persisted params for (asset, algo) or {} so feat_*() use in-code defaults.
    """
    st = load_store()
    by = (st.get("by_asset") or {}).get((asset or "").upper(), {}) or {}
    p = by.get((algo_id or "").upper(), {})
    return p if isinstance(p, dict) else {}


def system_ict_flags() -> dict:
    st = load_store()
    s = st.get("system") or {}
    return {
        "jedi_bull_min_votes": int(s.get("jedi_bull_min_votes", 9)),
        "jedi_bear_max_votes": int(s.get("jedi_bear_max_votes", -9)),
    }


def merge_persist_optimized_all(asset: str, results: dict[str, dict], replace_asset: bool = True) -> dict[str, Any]:
    """
    results: output of optimize_all_algos — { algo_id: to_dict() | {"error": ...} }
    Merges best params into by_asset[asset]. If replace_asset, replaces that asset's
    block entirely before applying results; else merges with existing algos.
    """
    st = load_store()
    asset = (asset or "BTC").upper()
    if replace_asset:
        st.setdefault("by_asset", {})[asset] = {}
    else:
        st.setdefault("by_asset", {})[asset] = dict(
            (st.get("by_asset") or {}).get(asset, {}) or {}
        )
    patch = st["by_asset"][asset]
    n_ok, n_err = 0, 0
    for aid, r in (results or {}).items():
        if not isinstance(r, dict) or r.get("error"):
            n_err += 1
            continue
        best = r.get("best") or {}
        params = best.get("params")
        if not isinstance(params, dict):
            n_err += 1
            continue
        if params:
            patch[aid.upper()] = params
            n_ok += 1
    save_store(st)
    return {"ok": True, "asset": asset, "n_written": n_ok, "n_skipped": n_err, "path": str(_path())}


def merge_persist_one(asset: str, algo_id: str, opt_result: dict) -> dict[str, Any]:
    st = load_store()
    best = (opt_result or {}).get("best") or {}
    params = best.get("params")
    if not isinstance(params, dict) or not params:
        return {"ok": False, "error": "no params in result.best"}
    a, aid = (asset or "BTC").upper(), (algo_id or "").upper()
    st.setdefault("by_asset", {})[a] = dict((st.get("by_asset") or {}).get(a) or {})
    st["by_asset"][a][aid] = params
    save_store(st)
    return {"ok": True, "asset": a, "algo": aid}


def clear_asset(asset: str) -> None:
    st = load_store()
    st.get("by_asset", {}).pop((asset or "").upper(), None)
    save_store(st)
