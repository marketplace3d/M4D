"""
iopt_search.py — DELTA OPS parameter optimizer
Usage:
    python ds_app/iopt_search.py --mode EUPHORIA --top 10 --n 200
    python ds_app/iopt_search.py --mode MAX --top 10 --n 200
    python ds_app/iopt_search.py --mode ALL --top 10 --n 200

Drop this file into ds/ds_app/ then run from ds/ with venv active.
"""

import argparse
import json
import random
import sys
import time
from copy import copy
from dataclasses import asdict
from pathlib import Path

# ── path setup ───────────────────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent.parent))
from ds_app.delta_ops import run, ModeConfig, EUPHORIA, MAX  # noqa: E402

# ── search grids ─────────────────────────────────────────────────────────────

EUPHORIA_GRID = {
    "entry_thr":        [0.10, 0.12, 0.15, 0.18, 0.20, 0.22],
    "jedi_min":         [6, 8, 10, 12],
    "cis_threshold":    [1, 2],
    "accel_bars":       [1, 2, 3],
    "reentry_window":   [4, 6, 8, 12],
    "reentry_lot_mult": [1.5, 2.0, 2.5, 3.0],
    "horizon_bars":     [6, 12, 24],
    "be_bars":          [0, 2, 3, 5],
    "max_lots":         [2.0, 2.5, 3.0, 4.0],
}
EUPHORIA_MIN_TRADES = 50

MAX_GRID = {
    "entry_thr":        [0.25, 0.28, 0.30, 0.32, 0.35],
    "jedi_min":         [8, 10, 12],
    "accel_bars":       [1, 2],
    "reentry_window":   [3, 4, 6],
    "reentry_lot_mult": [2.0, 3.0, 4.0],
    "horizon_bars":     [4, 6, 8, 12],
    "be_bars":          [1, 2, 3],
    "max_lots":         [4.0, 5.0, 6.0],
}
MAX_MIN_TRADES = 20

# ── result keys to capture ────────────────────────────────────────────────────

RESULT_KEYS = [
    "sharpe",
    "win_rate",
    "n_trades",
    "reentry_sharpe",
    "breakeven_stops",
    "harvested_lots",
    "scale_in_events",   # may not exist in older run() — handled gracefully
]

# ── targets (for pass/fail annotation) ───────────────────────────────────────

TARGETS = {
    "EUPHORIA": {"sharpe": 5.0, "win_rate": 0.50, "n_trades": 50, "reentry_sharpe": 8.0},
    "MAX":      {"sharpe": 15.0, "win_rate": 0.55, "n_trades": 20, "scale_in_events": 1},
}


# ── core search ───────────────────────────────────────────────────────────────

def search(
    base_mode: ModeConfig,
    grid: dict,
    min_trades: int,
    n_samples: int,
    top_n: int,
    verbose: bool = True,
) -> list[dict]:
    """Random search over grid. Returns top_n results sorted by Sharpe."""
    keys = list(grid.keys())
    combos = [
        dict(zip(keys, [random.choice(grid[k]) for k in keys]))
        for _ in range(n_samples)
    ]

    results = []
    t0 = time.time()

    for i, params in enumerate(combos):
        cfg = ModeConfig(**{**asdict(base_mode), **params, "name": base_mode.name})
        try:
            r = run(cfg)
        except Exception as exc:
            if verbose:
                print(f"  [SKIP] combo {i+1}: {exc}", flush=True)
            continue

        n_trades = r.get("n_trades", 0) or 0
        if n_trades < min_trades:
            continue

        sharpe = r.get("sharpe")
        if sharpe is None:
            continue

        row = {"params": params}
        for k in RESULT_KEYS:
            row[k] = r.get(k)

        results.append(row)

        if verbose and (i + 1) % 10 == 0:
            elapsed = time.time() - t0
            eta = elapsed / (i + 1) * (n_samples - i - 1)
            best = max((x["sharpe"] for x in results), default=float("nan"))
            print(
                f"  [{i+1:>4}/{n_samples}] kept={len(results):>4}  "
                f"best_sharpe={best:.3f}  eta={eta/60:.1f}m",
                flush=True,
            )

    results.sort(key=lambda x: -(x["sharpe"] or -999))
    return results[:top_n]


def annotate_targets(results: list[dict], mode_name: str) -> list[dict]:
    """Add pass/fail flags vs success targets."""
    tgt = TARGETS.get(mode_name, {})
    for r in results:
        flags = {}
        for k, threshold in tgt.items():
            val = r.get(k)
            flags[f"target_{k}"] = (val is not None and val >= threshold)
        r["target_met"] = all(flags.values())
        r.update(flags)
    return results


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="DELTA OPS IOPT search")
    parser.add_argument(
        "--mode", choices=["EUPHORIA", "MAX", "ALL"], default="ALL",
        help="Which mode to optimize (default: ALL)"
    )
    parser.add_argument(
        "--n", type=int, default=200,
        help="Random samples per mode (default: 200 ≈ 2h)"
    )
    parser.add_argument(
        "--top", type=int, default=10,
        help="Top N configs to return (default: 10)"
    )
    parser.add_argument(
        "--seed", type=int, default=42,
        help="Random seed for reproducibility"
    )
    parser.add_argument(
        "--out_dir", type=str, default="data",
        help="Output directory for JSON results (default: data/)"
    )
    args = parser.parse_args()

    random.seed(args.seed)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    modes_to_run = (
        ["EUPHORIA", "MAX"] if args.mode == "ALL" else [args.mode]
    )

    for mode_name in modes_to_run:
        print(f"\n{'='*60}")
        print(f"  IOPT SEARCH — {mode_name}  (n={args.n}, seed={args.seed})")
        print(f"{'='*60}")

        if mode_name == "EUPHORIA":
            base, grid, min_t = EUPHORIA, EUPHORIA_GRID, EUPHORIA_MIN_TRADES
        else:
            base, grid, min_t = MAX, MAX_GRID, MAX_MIN_TRADES

        results = search(
            base_mode=base,
            grid=grid,
            min_trades=min_t,
            n_samples=args.n,
            top_n=args.top,
            verbose=True,
        )

        results = annotate_targets(results, mode_name)

        out_path = out_dir / f"iopt_{mode_name.lower()}.json"
        out_path.write_text(json.dumps(
            {
                "mode": mode_name,
                "n_sampled": args.n,
                "seed": args.seed,
                "min_trades_filter": min_t,
                "baseline": {
                    "EUPHORIA": {"sharpe": -0.91, "win_rate": 0.506, "n_trades": 326},
                    "MAX":      {"sharpe": 10.71, "win_rate": 0.552, "n_trades": 67},
                }[mode_name],
                "targets": TARGETS[mode_name],
                "top_results": results,
            },
            indent=2,
        ))
        print(f"\n  ✓ Wrote {out_path}")

        # ── console summary ──
        print(f"\n  TOP {min(args.top, len(results))} for {mode_name}:")
        print(f"  {'Rank':>4}  {'Sharpe':>8}  {'Win%':>6}  {'Trades':>7}  "
              f"{'ReEntrySharpe':>13}  {'ScaleIns':>8}  Target  Params")
        print("  " + "-"*110)
        for rank, r in enumerate(results, 1):
            p = r["params"]
            re_sh = r.get("reentry_sharpe")
            sc_in = r.get("scale_in_events")
            print(
                f"  {rank:>4}  {r['sharpe']:>8.3f}  "
                f"{(r.get('win_rate') or 0)*100:>5.1f}%  "
                f"{r.get('n_trades') or 0:>7d}  "
                f"{re_sh if re_sh is not None else 'N/A':>13}  "
                f"{sc_in if sc_in is not None else 'N/A':>8}  "
                f"{'✓' if r.get('target_met') else '✗':>6}  "
                f"entry={p.get('entry_thr')} jedi={p.get('jedi_min')} "
                f"cis={p.get('cis_threshold','-')} accel={p.get('accel_bars')} "
                f"hor={p.get('horizon_bars')} be={p.get('be_bars')} "
                f"re_win={p.get('reentry_window')} re_mult={p.get('reentry_lot_mult')} "
                f"lots={p.get('max_lots')}"
            )

    print("\n  Done.\n")


if __name__ == "__main__":
    main()
