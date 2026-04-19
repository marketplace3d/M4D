#!/usr/bin/env python3
"""
BOOM → vectorbt, standalone (no Django runserver).

Reuses `run_boom_darvas_vectorbt_grid` from `ds_app.boom_vectorbt` so behavior
matches `/vectorbt-boom/` (Darvas path: squeeze + release + RVOL + trend vote,
ATR gate, first-half filter, EMA13 exit, optional stop).

Run from anywhere:

  python /path/to/m4d-ds/scripts/boom_vbt_standalone.py
  python /path/to/m4d-ds/scripts/boom_vbt_standalone.py --symbol QQQ --json

Or from m4d-ds with PYTHONPATH:

  cd m4d-ds && PYTHONPATH=. python scripts/boom_vbt_standalone.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from ds_app.boom_vectorbt import run_boom_darvas_vectorbt_grid  # noqa: E402


def _parse_ints(s: str) -> tuple[int, ...]:
    return tuple(int(x.strip()) for x in s.split(",") if x.strip())


def _parse_floats(s: str) -> tuple[float, ...]:
    return tuple(float(x.strip()) for x in s.split(",") if x.strip())


def main() -> int:
    ap = argparse.ArgumentParser(
        description="BOOM Darvas vectorbt screen (same engine as /vectorbt-boom/).",
    )
    ap.add_argument("--symbol", default="SPY")
    ap.add_argument("--interval", default="5m", help="yfinance interval, e.g. 5m, 1d")
    ap.add_argument("--period", default="60d", help="yfinance period (5m ~60d cap)")
    ap.add_argument(
        "--sq",
        default="14",
        help="Squeeze lengths, comma-separated (grid = Cartesian product)",
    )
    ap.add_argument("--dv", default="10", help="Darvas lookbacks, comma-separated")
    ap.add_argument("--rvol", default="1.2", help="RVOL thresholds, comma-separated")
    ap.add_argument("--min-vote", type=int, default=3)
    ap.add_argument(
        "--atr-mult",
        type=float,
        default=1.05,
        help="ATR gate; use 0 to disable (screening default in app is often 0)",
    )
    ap.add_argument(
        "--no-first-half",
        action="store_true",
        help="Disable US RTH first-half session filter",
    )
    ap.add_argument("--max-combos", type=int, default=500)
    ap.add_argument("--fees", type=float, default=0.0015)
    ap.add_argument(
        "--sl-stop",
        type=float,
        default=0.0065,
        help="Stop loss as fraction (0.0065 ≈ 0.65%%); 0 = off",
    )
    ap.add_argument("--json", action="store_true", help="Print JSON summary")
    args = ap.parse_args()

    sl = None if float(args.sl_stop) <= 0 else float(args.sl_stop)

    out = run_boom_darvas_vectorbt_grid(
        args.symbol.strip().upper(),
        args.interval,
        args.period,
        squeeze_lens=_parse_ints(args.sq),
        darvas_lookbacks=_parse_ints(args.dv),
        rvol_thresholds=_parse_floats(args.rvol),
        min_vote=int(args.min_vote),
        atr_mult=float(args.atr_mult),
        first_half_only=not args.no_first_half,
        max_combos=int(args.max_combos),
        init_cash=100_000.0,
        fees=float(args.fees),
        sl_stop=sl,
    )

    if args.json:
        print(json.dumps(out, indent=2, default=str))
        return 0

    print("=== BOOM vectorbt (standalone) ===")
    print(f"symbol={out['symbol']} tf={out['timeframe']} period={out['period']} bars={out['bars']}")
    print(f"data_source={out['data_source']} grid_size={out['grid_size']} combos_with_trades={out['combos_with_trades']}")
    print(f"min_vote={out['min_vote']} atr_mult={out['atr_mult']} first_half={out['first_half_only']}")
    if out.get("top_sharpe"):
        top = out["top_sharpe"][0]
        print("\nTop Sharpe row:")
        for k in (
            "squeeze_len",
            "darvas_lookback",
            "rvol_mult",
            "total_return_pct",
            "sharpe",
            "max_dd_pct",
            "trades",
        ):
            if k in top:
                print(f"  {k}: {top[k]}")
    print(f"\n{out.get('note', '')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
