"""
Monte Carlo sizing comparison for ICTSMC-style profiles.

Compares:
- quarter Kelly (0.25)
- half Kelly (0.5)
- fixed fractional risk (e.g. 0.75% per trade)

Outputs distribution stats for terminal equity and max drawdown.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass


@dataclass
class SimConfig:
    n_paths: int = 2000
    n_trades: int = 220
    start_equity: float = 100_000.0
    win_prob: float = 0.54
    rr: float = 1.9
    max_risk_pct: float = 0.01
    fixed_risk_pct: float = 0.0075
    kelly_cap: float = 0.25
    edge: float = 74.0


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def edge_to_prob(edge: float) -> float:
    # Keep realistic bounds to avoid overfit optimism.
    p = 0.5 + (edge - 50.0) * 0.0055
    return clamp(p, 0.48, 0.82)


def kelly_fraction(win_prob: float, rr: float, fractional: float, cap: float) -> float:
    q = 1.0 - win_prob
    b = max(0.5, rr)
    raw = (b * win_prob - q) / b
    return clamp(raw * fractional, 0.0, cap)


def run_path(cfg: SimConfig, mode: str, fractional_kelly: float = 0.5) -> tuple[float, float]:
    eq = cfg.start_equity
    peak = eq
    max_dd = 0.0

    for _ in range(cfg.n_trades):
        if mode == "fixed":
            risk_pct = cfg.fixed_risk_pct
        else:
            p = cfg.win_prob
            # slight uncertainty noise each trade
            p_noisy = clamp(random.gauss(p, 0.03), 0.45, 0.8)
            kf = kelly_fraction(p_noisy, cfg.rr, fractional_kelly, cfg.kelly_cap)
            risk_pct = clamp(kf * 4.0, 0.0, cfg.max_risk_pct)

        r = cfg.rr if random.random() < cfg.win_prob else -1.0
        pnl = eq * risk_pct * r
        eq = max(1.0, eq + pnl)

        peak = max(peak, eq)
        dd = (peak - eq) / peak if peak > 0 else 0.0
        max_dd = max(max_dd, dd)

    return eq, max_dd


def summarize(vals: list[float]) -> dict[str, float]:
    s = sorted(vals)
    n = len(s)
    def pct(p: float) -> float:
        i = int((n - 1) * p)
        return s[i]
    mean = sum(s) / n
    return {
        "mean": mean,
        "p10": pct(0.10),
        "p50": pct(0.50),
        "p90": pct(0.90),
    }


def simulate(cfg: SimConfig, mode: str, fractional_kelly: float = 0.5) -> dict[str, float]:
    end_eq = []
    max_dd = []
    for _ in range(cfg.n_paths):
        e, d = run_path(cfg, mode, fractional_kelly=fractional_kelly)
        end_eq.append(e)
        max_dd.append(d)
    eq_stats = summarize(end_eq)
    dd_stats = summarize(max_dd)
    return {
        "end_equity_mean": round(eq_stats["mean"], 2),
        "end_equity_p10": round(eq_stats["p10"], 2),
        "end_equity_p50": round(eq_stats["p50"], 2),
        "end_equity_p90": round(eq_stats["p90"], 2),
        "max_dd_mean_pct": round(dd_stats["mean"] * 100, 2),
        "max_dd_p90_pct": round(dd_stats["p90"] * 100, 2),
    }


def main() -> None:
    random.seed(42)
    cfg = SimConfig()

    out = {
        "config": cfg.__dict__,
        "quarter_kelly": simulate(cfg, mode="kelly", fractional_kelly=0.25),
        "half_kelly": simulate(cfg, mode="kelly", fractional_kelly=0.5),
        "fixed_fraction": simulate(cfg, mode="fixed"),
    }

    print(out)


if __name__ == "__main__":
    main()
