"""
ds_app/paper_config.py — Paper Trading Configuration (P0-C)

Single source of truth for mode parameters.
Consumed by delta_ops.py, any live/paper execution adapter.

Modes:
  PADAWAN  — new/small accounts. Survives. Never donates to MM.
  NORMAL   — full system. Regime-gated. Quality filtered.
  EUPHORIA — fat-pitch only. All gates green + elevated conviction.
"""
from __future__ import annotations
import json, sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_DS_ROOT_PC = _HERE.parent
if str(_DS_ROOT_PC) not in sys.path:
    sys.path.insert(0, str(_DS_ROOT_PC))

from ds_app.delta_ops import PADAWAN, NORMAL, EUPHORIA, ModeConfig  # noqa: E402

_DS_ROOT = Path(__file__).resolve().parent.parent
_OUT     = _DS_ROOT / "data" / "paper_trading_config.json"


def build_config() -> dict:
    def _mc(m: ModeConfig) -> dict:
        return {
            "name":            m.name,
            "kelly_mult":      m.kelly_mult,
            "max_lots":        m.max_lots,
            "entry_thr":       m.entry_thr,
            "decay_thr_pct":   0.40,              # SCORE_DECAY fires when score < 40% of entry
            "cis_threshold":   m.cis_threshold,
            "accel_bars":      m.accel_bars,
            "reentry_window":  m.reentry_window,
            "jedi_min":        m.jedi_min,
        }

    cfg = {
        "modes": {
            "PADAWAN":  _mc(PADAWAN),
            "NORMAL":   _mc(NORMAL),
            "EUPHORIA": _mc(EUPHORIA),
        },
        "gates": {
            "SQUEEZE_LOCK":    {"enabled": True,  "param": "squeeze==1"},
            "ATR_RANK_LOW":    {"enabled": True,  "param": "atr_rank<0.30"},
            "HOUR_KILLS":      {"enabled": True,  "param": "utc_hour in {0,1,3,4,5,12,13,20,21,22,23}"},
            "RVOL_EXHAUSTION": {"enabled": True,  "param": "rvol>90th_pct_last_100_bars"},
            "LOW_JEDI":        {"enabled": True,  "param": "abs(jedi_raw)<4"},
        },
        "cis_signals": {
            "SQUEEZE_FIRED":   "squeeze==1 while in trend",
            "REGIME_FLIP":     "regime changed from entry regime",
            "JEDI_REVERSAL":   "jedi_raw crossed to opposite sign (>2)",
            "SCORE_DECAY":     "soft_score < 40% of entry score",
            "ATR_COLLAPSE":    "atr_rank < 20th pct",
        },
        "padawan_rules": [
            "Kelly cap: 0.25× (never exceed quarter-Kelly)",
            "Max 1.5 lots total (3 half-lot positions)",
            "Max 3 trades per day across all symbols",
            "ALL 5 gate vetos must be clear before entry",
            "CIS exit threshold: 2 of 5 signals",
            "Re-entry window: 12 bars (1h) after CIS exit",
            "No EUPHORIA scaling — flat sizing only",
            "Required regime: TRENDING or BREAKOUT only",
            "Soft-score entry threshold: 0.35",
            "Minimum jedi_raw: ±4",
        ],
        "euphoria_trigger": {
            "jedi_raw_min":    18,
            "rvol_min":        2.0,
            "activity_gate":   "HOT",
            "cross_asset":     "RISK_ON",
            "score_min":       0.50,
            "all_gates_clear": True,
            "kelly_mult":      2.5,
            "cis_threshold":   3,
            "note":            "Fat pitch. All in. Max 3×.",
        },
        "delta_ops_exit_rules": [
            "NO STOP PRICES — no donations to MM stop hunters",
            "SCALE-OUT 0.5 lot on deceleration (score↓ OR rvol↓ > 10% over accel_bars)",
            "SCALE-IN 0.5 lot on acceleration (score↑ AND rvol↑ > 5% over accel_bars)",
            "FULL EXIT when CIS >= cis_threshold (invalidation-based, not price-based)",
            "RE-ENTRY allowed if: CIS cleared + soft_score >= entry_thr within reentry_window",
            "Re-entry treated as fresh trade (lot count reset)",
        ],
        "generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    }
    return cfg


if __name__ == "__main__":
    cfg = build_config()
    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(json.dumps(cfg, indent=2))
    print(f"paper_trading_config.json → {_OUT}")
    print("\nPADAWAN rules:")
    for r in cfg["padawan_rules"]:
        print(f"  • {r}")
    print("\nEUPHORIA trigger:")
    for k, v in cfg["euphoria_trigger"].items():
        print(f"  {k}: {v}")
