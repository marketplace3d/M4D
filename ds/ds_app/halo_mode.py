"""
ds_app/halo_mode.py — HALO Mode: Stealth Execution Layer

DOCTRINE: A consistent high-Sharpe bot is detectable. Prime brokers / exchange
market makers identify "informed flow" and widen spreads, slow feeds, or
front-run predictable patterns. HALO breaks the fingerprint without destroying edge.

HALO does NOT reduce conviction. It randomizes the EXPRESSION of conviction.

COMPONENTS:
  1. TIMING JITTER     — entry delayed 0–3 bars after signal fires (random per trade)
  2. SIZE NOISE        — ±15% random variation on Kelly units (still within mode bounds)
  3. SKIP RATE         — 15% of valid signals randomly skipped (human-like selectivity)
  4. SPLIT ENTRY       — 60% initial lot, 40% one bar later (never all-at-once)
  5. SCALE VARIANCE    — scale-in size: 0.3–0.7 lot (not always 0.5)
  6. EXIT STAGGER      — CIS exit: fill over 1–2 bars (not instant full-size)

SEAL / NINJA ENTRIES:
  Human traders don't always enter on the exact bar a signal fires.
  They "watch it develop", then enter 1-2 bars later. HALO mimics this.
  Result: entry price slightly worse, but pattern fingerprint breaks.

WHAT HALO DOES NOT DO:
  - Does not skip high-conviction (EUPHORIA) signals — too rare to waste
  - Does not change CIS exit logic — exits stay clean
  - Does not affect re-entry logic — re-entry is already "human" (delayed)
  - Does not randomize when ALL 5 gates just cleared AND jedi >= 15

PARAMETERS (tunable):
  jitter_bars     : [0, 1, 2, 3]   uniform random
  size_noise_pct  : ±15%
  skip_rate       : 0.15 (15%)
  split_ratio     : (0.55, 0.65) uniform random first lot fraction
  scale_lot_range : (0.3, 0.7)

HALO is a LIVE execution wrapper only.
Backtesting with HALO = invalid (randomness inflates variance).
Run HALO in paper first to confirm slippage impact is < 0.5 Sharpe.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Optional


@dataclass
class HaloDecision:
    """Returned by halo_entry() — tells execution adapter what to do."""
    action: str          # "ENTER", "SKIP", "WAIT"
    delay_bars: int      # 0 = now, N = wait N bars then re-check
    lot_fraction: float  # fraction of mode.max_lots to use for first fill
    split_remainder: float  # remaining fraction to fill next bar (0 = no split)
    scale_lot: float     # lot size for any scale-in events
    note: str            # human-readable reason


@dataclass
class HaloConfig:
    enabled: bool        = True
    jitter_max_bars: int = 3     # max entry delay bars
    size_noise_pct: float = 0.15 # ±15% size variation
    skip_rate: float      = 0.15 # 15% random skip
    split_ratio_min: float = 0.55
    split_ratio_max: float = 0.65
    scale_lot_min: float  = 0.30
    scale_lot_max: float  = 0.70
    euphoria_override: bool = True  # never skip EUPHORIA signals


HALO = HaloConfig()


def halo_entry(
    score: float,
    jedi_raw: float,
    mode_name: str,
    halo: HaloConfig = HALO,
    rng: Optional[random.Random] = None,
) -> HaloDecision:
    """
    Given a valid entry signal, apply HALO stealth layer.
    Returns a HaloDecision telling the execution adapter exactly what to do.
    """
    if rng is None:
        rng = random.Random()

    if not halo.enabled:
        return HaloDecision(
            action="ENTER", delay_bars=0,
            lot_fraction=1.0, split_remainder=0.0,
            scale_lot=0.5, note="HALO disabled",
        )

    # EUPHORIA override — never skip or delay fat pitches
    is_euphoria = (mode_name == "EUPHORIA" or abs(jedi_raw) >= 15)
    if is_euphoria and halo.euphoria_override:
        split = rng.uniform(halo.split_ratio_min, halo.split_ratio_max)
        return HaloDecision(
            action="ENTER", delay_bars=0,
            lot_fraction=split, split_remainder=round(1.0 - split, 2),
            scale_lot=0.5, note="EUPHORIA — no skip/delay, split only",
        )

    # Random skip
    if rng.random() < halo.skip_rate:
        return HaloDecision(
            action="SKIP", delay_bars=0,
            lot_fraction=0, split_remainder=0,
            scale_lot=0, note=f"HALO skip ({halo.skip_rate*100:.0f}% skip rate)",
        )

    # Timing jitter
    delay = rng.randint(0, halo.jitter_max_bars)
    if delay > 0:
        return HaloDecision(
            action="WAIT", delay_bars=delay,
            lot_fraction=0, split_remainder=0,
            scale_lot=0, note=f"HALO jitter: wait {delay} bar(s)",
        )

    # Size noise
    noise = 1.0 + rng.uniform(-halo.size_noise_pct, halo.size_noise_pct)
    noise = round(max(0.75, min(1.25, noise)), 3)

    # Split entry
    split = rng.uniform(halo.split_ratio_min, halo.split_ratio_max)
    first_lot  = round(split * noise, 3)
    second_lot = round((1.0 - split) * noise, 3)

    # Scale lot variance
    scale_lot = round(rng.uniform(halo.scale_lot_min, halo.scale_lot_max), 2)

    return HaloDecision(
        action="ENTER", delay_bars=0,
        lot_fraction=first_lot,
        split_remainder=second_lot,
        scale_lot=scale_lot,
        note=f"HALO split={split:.2f}  noise={noise:.2f}  scale={scale_lot}",
    )


def halo_exit(
    cis_total: int,
    lots_in: float,
    halo: HaloConfig = HALO,
    rng: Optional[random.Random] = None,
) -> tuple[float, str]:
    """
    Returns (lots_to_exit_now, note).
    Exit stagger: fill over 1-2 bars instead of instant.
    If lots_in <= 1: exit all (no point splitting tiny position).
    """
    if rng is None:
        rng = random.Random()
    if not halo.enabled or lots_in <= 1.0:
        return lots_in, "full exit"
    # Stagger: exit 60-75% now, rest next bar
    frac = rng.uniform(0.60, 0.75)
    now  = round(lots_in * frac, 2)
    return now, f"HALO stagger: exit {now:.2f}/{lots_in:.2f} now, {lots_in-now:.2f} next bar"


# ── HALO fingerprint score (how predictable are we?) ─────────────────────────

def fingerprint_score(
    entry_times_utc_seconds: list[int],
    lot_sizes: list[float],
) -> dict:
    """
    Estimates how detectable the trading pattern is.
    Lower score = more human-like = safer.
    """
    import math
    n = len(entry_times_utc_seconds)
    if n < 10:
        return {"n": n, "score": None, "verdict": "insufficient data"}

    # Time regularity: std of inter-arrival seconds (high = irregular = good)
    gaps = [entry_times_utc_seconds[i+1] - entry_times_utc_seconds[i]
            for i in range(n-1)]
    gap_cv = (sum((g - sum(gaps)/len(gaps))**2 for g in gaps) / len(gaps))**0.5 / (sum(gaps)/len(gaps))

    # Size regularity: coefficient of variation of lot sizes (high = irregular = good)
    mean_lot = sum(lot_sizes) / n
    size_cv  = (sum((l - mean_lot)**2 for l in lot_sizes) / n)**0.5 / mean_lot if mean_lot > 0 else 0

    # Hour concentration: entropy of entry hours (high entropy = less predictable)
    hour_counts = {}
    for t in entry_times_utc_seconds:
        h = (t % 86400) // 3600
        hour_counts[h] = hour_counts.get(h, 0) + 1
    probs = [c / n for c in hour_counts.values()]
    entropy = -sum(p * math.log(p + 1e-9) for p in probs)
    max_entropy = math.log(24)
    hour_entropy_norm = entropy / max_entropy  # 0-1, higher = better

    # Clamp CVs to [0,1] — CV > 1 already means "very irregular", no need to scale higher
    gap_cv_norm  = min(gap_cv,  1.0)
    size_cv_norm = min(size_cv, 1.0)

    # Weighted sum of [0,1] components → [0,1] → scale to [0,100]
    raw   = gap_cv_norm * 0.30 + size_cv_norm * 0.30 + hour_entropy_norm * 0.40
    score = round(raw * 100, 1)

    return {
        "n":                   n,
        "gap_cv":              round(gap_cv, 3),
        "size_cv":             round(size_cv, 3),
        "hour_entropy_norm":   round(hour_entropy_norm, 3),
        "fingerprint_score":   score,
        "verdict": (
            "SAFE — irregular enough to avoid detection" if score > 60 else
            "WARN — pattern emerging, increase jitter"   if score > 35 else
            "DANGER — highly predictable, MM will see you"
        ),
    }


if __name__ == "__main__":
    import json
    rng = random.Random(42)
    print("HALO MODE — sample entry decisions:\n")
    for score, jedi, mode in [
        (0.38, 6, "PADAWAN"),
        (0.52, 16, "EUPHORIA"),
        (0.40, 5, "NORMAL"),
        (0.36, 4, "PADAWAN"),
        (0.45, 9, "NORMAL"),
    ]:
        d = halo_entry(score, jedi, mode, rng=rng)
        print(f"  score={score} jedi={jedi:+3d} mode={mode:8s} → {d.action:6s} "
              f"delay={d.delay_bars} lot={d.lot_fraction:.2f}+{d.split_remainder:.2f}  [{d.note}]")

    print("\nFingerprint score example (HALO on vs off):")
    import time
    # Predictable: every 300s, always 1.0 lot
    pred_times = [1700000000 + i*300 for i in range(50)]
    pred_lots  = [1.0] * 50
    fp_pred = fingerprint_score(pred_times, pred_lots)
    print(f"  No HALO:   {fp_pred}")

    # HALO: irregular intervals, varied sizes
    halo_times = [1700000000 + sum(rng.randint(180, 600) for _ in range(i+1)) for i in range(50)]
    halo_lots  = [round(rng.uniform(0.8, 1.2), 2) for _ in range(50)]
    fp_halo = fingerprint_score(halo_times, halo_lots)
    print(f"  With HALO: {fp_halo}")
