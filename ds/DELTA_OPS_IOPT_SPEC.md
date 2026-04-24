# DELTA OPS — IOPT PARAMETER SEARCH SPEC
_Compact brief for Claude parameter optimization. Read this, run the search, return best configs._

---

## CONTEXT

`ds/ds_app/delta_ops.py` — position lifecycle simulator for a crypto signal ensemble.

**Stack**: Django :8000 | SQLite `data/signal_log.db` | Python 3.13 | pandas 2.x  
**Run from**: `cd /Volumes/AI/AI-4D/M4D/ds`  
**Activate venv**: `source /Volumes/AI/AI-4D/M4D/W4D/quant/.venv/bin/activate`  
**Single run**: `python ds_app/delta_ops.py --mode PADAWAN|NORMAL|EUPHORIA|MAX`

---

## CURRENT RESULTS (baseline to beat)

| Mode | Trades | Sharpe | Win% | Re-entry Sharpe | Status |
|------|--------|--------|------|-----------------|--------|
| PADAWAN | 8,216 | 7.40 | 51.3 | 8.25 | STABLE |
| NORMAL | 5,962 | 7.66 | 51.4 | 9.66 | STABLE |
| EUPHORIA | 326 | **-0.91** | 50.6 | — | **FIX TARGET** |
| MAX | 67 | **10.71** | 55.2 | — | GOOD, MAXIMIZE |

**Score distribution (OOS, 986k bars)**:
- p90 = 0.046 · p95 = 0.121 · p99 = 0.224 · p99.5 = 0.304 · p99.9 = 0.442
- jedi_abs: p50=7 · p75=11 · p90=14 · p95=15

---

## ARCHITECTURE (do not change)

```python
@dataclass
class ModeConfig:
    name: str
    kelly_mult: float    # sizing multiplier (cosmetic for sim — doesn't affect Sharpe)
    max_lots: float      # max position size in base_lot units
    entry_thr: float     # soft_score threshold — maps to percentile (see above)
    decay_thr: float     # soft_score below which SCORE_DECAY CIS signal fires
    cis_threshold: int   # 1 or 2: signals required before exit
    accel_bars: int      # window for ACCEL detection (score+rvol both up N bars)
    reentry_window: int  # bars after CIS exit to allow re-entry
    jedi_min: int        # minimum abs(jedi_raw) for entry
    be_bars: int         # bars of continuation before stop locks to entry price
    harvest_on_scale: bool  # book 1 base_lot realized gain on each scale-in
    reentry_lot_mult: float # base_lot multiplier for re-entry trades
    horizon_bars: int    # max hold in 5m bars (6=30m 12=1h 24=2h 48=4h)
```

**CIS signals** (Combined Invalidation Score):
1. SQUEEZE_FIRED — squeeze activated while in position
2. REGIME_FLIP/DEGRADE — regime degraded from entry regime
3. JEDI_REVERSAL/FADE — conviction reversed or halved
4. SCORE_DECAY — soft_score < 40% of entry score
5. ATR_COLLAPSE — atr_rank < 20th pct

**Scale-in rule**: ACCEL = score AND rvol both up >5% vs `accel_bars` ago  
**Pyramid** (EUPHORIA/MAX only): add = `base_lot × 2^scale_in_count`, capped at `max_lots`  
**Harvest**: on scale-in, book `(close_now - entry_price)/entry_price × base_lot` as partial P&L  
**BE stop**: if `close <= entry_price` after `be_bars` lock → exit at 0

**Exit returns**: CIS exits and HORIZON exits use `outcome_1h_pct × lots_in` (1h forward signal proxy)  
**Re-entry**: first entry after CIS exit within `reentry_window` bars → `lots_in = base_lot × reentry_lot_mult`

---

## OBJECTIVE

### Primary: Fix EUPHORIA (Sharpe -0.91 → positive, ideally > 5.0)

**Root cause identified**: `entry_thr=0.22` (top 1% soft_score) hits exhaustion/reversal zone, not continuation. Score extremes = momentum peak. Need to find the sweet spot where high score = quality setup without being the exhaustion top.

**Hypothesis**: Entry threshold should be calibrated differently for EUPHORIA. Either:
- Lower entry_thr (back toward 0.12–0.18) + raise jedi_min (require conviction over raw score)
- Or: use a NARROWBAND — score in [low, high] range (avoids extremes on both ends)
- Or: add `min_rvol` gate (require rvol > threshold for fat-pitch — momentum must have volume)

### Secondary: Maximize MAX (currently Sharpe 10.71, push toward 15+)

MAX has 0 scale-in events in 67 trades — the 6-bar horizon expires before ACCEL fires (needs 2 bars). Either:
- Reduce `accel_bars` to 1 for MAX  
- Or allow scale-in on `horizon_bars/2` check

---

## SEARCH SPACE

### EUPHORIA search (fix -0.91 Sharpe)

```python
EUPHORIA_SEARCH = {
    "entry_thr":       [0.10, 0.12, 0.15, 0.18, 0.20, 0.22],  # current=0.22
    "jedi_min":        [6, 8, 10, 12],                          # current=8
    "cis_threshold":   [1, 2],                                   # current=1
    "accel_bars":      [1, 2, 3],                                # current=2
    "reentry_window":  [4, 6, 8, 12],                            # current=6
    "reentry_lot_mult":[1.5, 2.0, 2.5, 3.0],                    # current=2.0
    "horizon_bars":    [6, 12, 24],                              # current=12
    "be_bars":         [0, 2, 3, 5],                             # current=3
    "max_lots":        [2.0, 2.5, 3.0, 4.0],                    # current=2.5
}
# Keep: kelly_mult=2.5, decay_thr=0.08, harvest_on_scale=True, name="EUPHORIA"
# Constraint: n_trades >= 50 (reject configs with < 50 trades — overfit)
# Constraint: min_trades_for_reentry >= 10 if reentry_sharpe reported
```

### MAX search (push 10.71 → 15+)

```python
MAX_SEARCH = {
    "entry_thr":       [0.25, 0.28, 0.30, 0.32, 0.35],  # current=0.30
    "jedi_min":        [8, 10, 12],                       # current=10
    "accel_bars":      [1, 2],                            # current=2 — 0 scale-ins observed
    "reentry_window":  [3, 4, 6],                         # current=4
    "reentry_lot_mult":[2.0, 3.0, 4.0],                  # current=3.0
    "horizon_bars":    [4, 6, 8, 12],                     # current=6
    "be_bars":         [1, 2, 3],                         # current=2
    "max_lots":        [4.0, 5.0, 6.0],                  # current=5.0
}
# Keep: kelly_mult=4.0, decay_thr=0.12, cis_threshold=1, harvest_on_scale=True
# Constraint: n_trades >= 20 (fat pitch = rare by design)
```

---

## HOW TO RUN THE SEARCH

Write a grid-search script `ds/ds_app/iopt_search.py`:

```python
# Imports from delta_ops — don't re-implement simulate_symbol or run()
# Instead: patch ModeConfig fields and call run(mode) directly
# Output: JSON with top-10 configs per mode sorted by Sharpe

from ds_app.delta_ops import run, ModeConfig, EUPHORIA, MAX
import itertools, json

def search(base_mode: ModeConfig, grid: dict, min_trades: int) -> list[dict]:
    keys = list(grid.keys())
    results = []
    for combo in itertools.product(*[grid[k] for k in keys]):
        params = dict(zip(keys, combo))
        cfg = ModeConfig(**{**vars(base_mode), **params, "name": base_mode.name})
        r = run(cfg)
        if r.get("n_trades", 0) < min_trades:
            continue
        results.append({"params": params, **{k: r[k] for k in ["sharpe","win_rate","n_trades","reentry_sharpe","breakeven_stops","harvested_lots"]}})
    return sorted([x for x in results if x["sharpe"] is not None], key=lambda x: -x["sharpe"])
```

**CLI**: `python ds_app/iopt_search.py --mode EUPHORIA --top 10`  
**Output**: `data/iopt_euphoria.json`, `data/iopt_max.json`

---

## WHAT SUCCESS LOOKS LIKE

```
EUPHORIA target:
  sharpe         >= 5.0       (currently -0.91)
  win_rate       >= 0.50
  n_trades       >= 50
  reentry_sharpe >= 8.0       (re-entry edge must hold)

MAX target:
  sharpe         >= 15.0      (currently 10.71)
  win_rate       >= 0.55
  n_trades       >= 20
  scale_in_events > 0         (pyramid must actually fire)
```

---

## KEY CONSTRAINTS / DO NOT TOUCH

- `simulate_symbol()` logic: CIS checked BEFORE scale-in (critical — prevents scaling into exits)
- `harvest_on_scale` partial return = realized `(close_now - entry_price) / entry_price` NOT forward outcome
- All exit final_return = `outcome_1h_pct × lots_in` (forward signal proxy at exit bar)
- `reentry_lot_mult` applies at entry: `lots_in = base_lot = reentry_lot_mult` for re-entries
- Do NOT change PADAWAN or NORMAL configs — they are stable at Sharpe 7.4/7.7
- `soft_score` is NOT monotonically predictive past p99 — high score = exhaustion risk

---

## ARCHITECTURE NOTES FOR OPTIMIZER

The simulation runs on **986k OOS bars** (top 30% by timestamp) across ~50 crypto symbols.  
`_build_soft_scores()` is the expensive call — **runs once per `run()` call** (no caching between grid iterations).  
A full grid over 6×4×2×3×4×4×3×4×4 = 165,888 combos is too slow.  
**Use random search**: sample 500 random combos per mode, run `run()`, return top configs.

```python
import random
combos = [dict(zip(keys, [random.choice(grid[k]) for k in keys])) for _ in range(500)]
```

Runtime estimate: ~35s per `run()` call → 500 combos ≈ 5 hours. Use `--n 200` for a 2h run.

**Faster option**: pre-compute OOS enriched data ONCE, pass to a patched `simulate_symbol()` directly (bypass the DB read + _enrich() on each call). See `run()` lines 400–430 — extract the prep block.

---

## FILES

| File | Role |
|------|------|
| `ds_app/delta_ops.py` | Main simulator — ModeConfig, simulate_symbol, run() |
| `ds_app/sharpe_ensemble.py` | soft_score = weighted sum of 27 algo signals × regime multipliers |
| `ds_app/trade_quality_gate.py` | _enrich(), _build_soft_scores(), gate functions |
| `ds_app/regime_engine.py` | classify_series() → 7 regimes |
| `data/signal_log.db` | signal_log table: 3.3M rows, cols include outcome_1h_pct, outcome_4h_pct, close, rvol, volume, jedi_raw, squeeze, atr_pct + v_* per algo |
| `data/delta_ops_report.json` | last run output |
| `data/iopt_euphoria.json` | WRITE search results here |
| `data/iopt_max.json` | WRITE search results here |

---

_Generated: 2026-04-24 · Session: breakeven/harvest/MAX pyramid_
