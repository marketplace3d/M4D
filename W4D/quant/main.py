"""
main.py — WorldQuant-style quant system entry point

Wires together:
  data.py        → synthetic universe generation
  signals.py     → 12-signal alpha library
  ensemble.py    → regime detection + IC-weighted combiner
  optimizer.py   → portfolio construction (alpha-scaled or MVO)
  risk.py        → pre-trade checks + circuit breakers
  backtester.py  → event-driven simulation with full analytics

Usage:
  python main.py                  # default run
  python main.py --optimizer mvo  # use Mean-Variance optimiser
  python main.py --instruments 200 --days 1008  # larger universe
"""
import sys
import time
import numpy as np
import pandas as pd

from data       import generate_universe
from signals    import ALL_SIGNALS
from ensemble   import SignalPipeline
from backtester import Backtester, BacktestConfig, TransactionCostModel
from risk       import RiskLimits


def run(
    n_instruments: int = 100,
    n_days:        int = 756,
    optimizer:     str = "alpha",    # "alpha" | "mvo"
    rebalance_freq:int = 5,
    seed:          int = 42,
    verbose:       bool = True,
) -> tuple[Backtester, object]:

    t0 = time.time()

    print("╔══════════════════════════════════════════════════════╗")
    print("║    WORLDQUANT-STYLE SYSTEMATIC QUANT SYSTEM         ║")
    print("╠══════════════════════════════════════════════════════╣")
    print(f"║  Universe : {n_instruments} instruments × {n_days} days")
    print(f"║  Signals  : {len(ALL_SIGNALS)} alpha signals across 4 families")
    print(f"║  Optimizer: {optimizer.upper()}")
    print(f"║  Rebalance: every {rebalance_freq} trading days")
    print("╚══════════════════════════════════════════════════════╝\n")

    # ── 1. Generate universe ─────────────────────────────────────────
    print("[1/4] Generating synthetic universe...")
    univ = generate_universe(n_instruments=n_instruments,
                             n_days=n_days, seed=seed)
    print(f"      {len(univ.dates)} trading days, "
          f"{len(univ.instruments)} instruments, "
          f"{len(univ.fundamentals)} fundamental observations")

    # ── 2. Build signal pipeline ─────────────────────────────────────
    print("\n[2/4] Building signal pipeline...")
    pipeline = SignalPipeline(
        signal_list=ALL_SIGNALS,
        ic_half_life=60,
        fwd_horizon=5,
    )
    pipeline.run(univ, verbose=verbose)

    # ── 3. Configure and run backtester ──────────────────────────────
    print("[3/4] Running backtest...\n")
    cfg = BacktestConfig(
        initial_nav    = 10_000_000,
        rebalance_freq = rebalance_freq,
        warmup_days    = 63,
        optimizer      = optimizer,
        max_positions  = 40,
        alpha_pct      = 0.20,
        gross_limit    = 1.4,
        net_limit      = 0.10,
        max_position   = 0.05,
        turnover_limit = 0.35,
        verbose        = verbose,
        print_freq     = 63,
    )
    tc = TransactionCostModel(
        commission_pct    = 0.0005,
        spread_pct        = 0.0010,
        market_impact_pct = 0.0005,
        slippage_vol_mult = 0.10,
    )
    rl = RiskLimits(
        max_gross_exposure = 1.5,
        max_drawdown_pct   = 0.12,
        kill_drawdown_pct  = 0.25,
        daily_loss_reduce  = 0.025,
        daily_loss_kill    = 0.050,
    )

    bt = Backtester(pipeline=pipeline, universe=univ,
                    config=cfg, tc_model=tc, risk_limits=rl)
    bt.run()

    # ── 4. Analytics ─────────────────────────────────────────────────
    print("\n[4/4] Computing analytics...")
    analytics = bt.performance()
    analytics.print_report()

    elapsed = time.time() - t0
    print(f"\n  Total runtime: {elapsed:.1f}s")

    return bt, analytics


# ── Signal family IC breakdown ────────────────────────────────────────────

def print_ic_breakdown(bt: Backtester):
    ic_df = bt.pipeline.ic_df
    print("\n  Detailed IC breakdown:")
    print(f"  {'Signal':<22} {'Family':<12} {'Mean IC':>8} {'IC Vol':>8} {'ICIR':>8}")
    print("  " + "─" * 62)
    from signals import SIGNAL_MAP
    for sig_name in ic_df.columns:
        sig = SIGNAL_MAP.get(sig_name)
        fam = sig.family if sig else "—"
        ic_mean = ic_df[sig_name].mean()
        ic_vol  = ic_df[sig_name].std()
        icir    = ic_mean / ic_vol if ic_vol > 1e-8 else 0
        print(f"  {sig_name:<22} {fam:<12} {ic_mean:>8.4f} "
              f"{ic_vol:>8.4f} {icir:>8.3f}")


# ── Rolling Sharpe diagnostics ────────────────────────────────────────────

def rolling_diagnostics(analytics, window: int = 63):
    df = analytics.df
    r  = df["ret"]
    roll_sharpe = r.rolling(window).apply(
        lambda x: x.mean() / x.std() * np.sqrt(252) if x.std() > 0 else 0)
    roll_dd = df["nav"].rolling(window).apply(
        lambda x: (x.iloc[-1] / x.max() - 1))

    print(f"\n  Rolling {window}d diagnostics (last 5 windows):")
    print(f"  {'Date':<12} {'Sharpe':>8} {'Drawdown':>10} "
          f"{'Gross':>8} {'Net':>6}")
    print("  " + "─" * 48)
    step = max(1, window // 2)
    for i in range(-5, 0):
        idx = min(len(df)-1, len(df) + i * step)
        date = df.index[idx]
        sr   = roll_sharpe.iloc[idx]
        dd   = roll_dd.iloc[idx]
        gr   = df["gross"].iloc[idx]
        nt   = df["net"].iloc[idx]
        print(f"  {str(date.date()):<12} {sr:>8.3f} "
              f"{dd*100:>9.2f}%  {gr:>7.2f}x  {nt:>+6.3f}")


# ── Entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Parse simple CLI args
    args = sys.argv[1:]
    optimizer    = "mvo"   if "--optimizer" in args and \
                             args[args.index("--optimizer")+1] == "mvo" \
                          else "alpha"
    n_inst = int(args[args.index("--instruments")+1]) \
             if "--instruments" in args else 100
    n_days = int(args[args.index("--days")+1]) \
             if "--days" in args else 756

    bt, analytics = run(
        n_instruments = n_inst,
        n_days        = n_days,
        optimizer     = optimizer,
        rebalance_freq= 5,
        seed          = 42,
        verbose       = True,
    )

    print_ic_breakdown(bt)
    rolling_diagnostics(analytics, window=63)
