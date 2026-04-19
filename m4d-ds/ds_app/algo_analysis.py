"""
algo_analysis.py — Deep analysis layer for M4D
================================================
Three analyses that tell you if an edge is REAL:

1. MONTE CARLO     — randomize trade order 1000×, show outcome distribution
                     If the real equity curve is in the top 10% of random → edge exists.
                     If it's median → luck.

2. WALK-FORWARD    — roll OOS window across history, show per-period consistency
                     An edge that only works in one window is a curve fit.
                     An edge that works in 7/10 windows is a real signal.

3. MAE / MFE       — per-trade max adverse / max favorable excursion
                     Shows if your stop is in the right place.
                     Shows if you're exiting too early (MFE >> exit price).

4. REGIME BREAKDOWN — split returns by vol regime (VIX proxy = realized vol)
                     Shows where the edge lives and where it dies.

5. PARAMETER SURFACE — 2-axis sensitivity map (returns heatmap over param grid)
                     Shows if edge is a ridge (robust) or a spike (overfit).

All functions return dicts safe for JsonResponse + PIL image bytes.
Interface: same input contract as _run_one() — df, params, trades DataFrame.
"""

from __future__ import annotations

import math
import random
from io import BytesIO
from typing import Any

import numpy as np
import pandas as pd


# ── Monte Carlo ───────────────────────────────────────────────────────────────

def monte_carlo_trades(
    trades: pd.DataFrame,
    n_simulations: int = 1000,
    initial_capital: float = 100_000.0,
) -> dict:
    """
    Shuffle trade order N times, compute terminal equity each time.
    Returns stats + percentile ranks of actual equity curve vs simulations.

    Key question: is the real return in the top decile of random orderings?
    If yes → sequencing matters, edge exists.
    If no → random luck, not skill.
    """
    if trades is None or len(trades) == 0:
        return {"ok": False, "reason": "no trades"}

    try:
        pnl_col = "PnL" if "PnL" in trades.columns else "pnl"
        pnls = trades[pnl_col].dropna().tolist()
    except Exception:
        return {"ok": False, "reason": "no PnL column"}

    if len(pnls) < 5:
        return {"ok": False, "reason": f"only {len(pnls)} trades — need ≥5"}

    real_total = sum(pnls)
    real_equity = [initial_capital]
    for p in pnls:
        real_equity.append(real_equity[-1] + p)

    # Real max drawdown
    peak = real_equity[0]
    real_mdd = 0.0
    for v in real_equity:
        if v > peak:
            peak = v
        dd = (peak - v) / peak
        if dd > real_mdd:
            real_mdd = dd

    # Simulations
    sim_finals: list[float] = []
    sim_mdds: list[float] = []

    for _ in range(n_simulations):
        shuffled = pnls[:]
        random.shuffle(shuffled)
        eq = initial_capital
        peak = initial_capital
        mdd = 0.0
        for p in shuffled:
            eq += p
            if eq > peak:
                peak = eq
            dd = (peak - eq) / peak if peak > 0 else 0
            if dd > mdd:
                mdd = dd
        sim_finals.append(eq)
        sim_mdds.append(mdd)

    sim_finals.sort()
    sim_mdds.sort()

    def percentile_rank(value: float, distribution: list[float]) -> float:
        return sum(1 for v in distribution if v < value) / len(distribution) * 100

    return_pct = (real_total / initial_capital) * 100
    sim_returns = [(f - initial_capital) / initial_capital * 100 for f in sim_finals]

    p_rank_return = percentile_rank(real_total + initial_capital, sim_finals)
    p_rank_mdd = 100 - percentile_rank(real_mdd, sim_mdds)  # lower DD = better

    verdict = "STRONG EDGE" if p_rank_return >= 75 else \
              "EDGE EXISTS" if p_rank_return >= 55 else \
              "MARGINAL" if p_rank_return >= 45 else "LUCK — NO EDGE"

    return {
        "ok": True,
        "n_trades": len(pnls),
        "n_simulations": n_simulations,
        "real_return_pct": round(return_pct, 2),
        "real_max_dd_pct": round(real_mdd * 100, 2),
        "sim_return_p10": round(np.percentile(sim_returns, 10), 2),
        "sim_return_p25": round(np.percentile(sim_returns, 25), 2),
        "sim_return_p50": round(np.percentile(sim_returns, 50), 2),
        "sim_return_p75": round(np.percentile(sim_returns, 75), 2),
        "sim_return_p90": round(np.percentile(sim_returns, 90), 2),
        "percentile_rank_return": round(p_rank_return, 1),
        "percentile_rank_mdd": round(p_rank_mdd, 1),
        "verdict": verdict,
        "real_equity_curve": [round(v, 2) for v in real_equity],
        "sim_p10_curve": None,  # not computed for brevity
    }


def monte_carlo_chart(mc_result: dict) -> bytes:
    """Draw Monte Carlo distribution chart with Pillow. Returns PNG bytes."""
    if not mc_result.get("ok"):
        return b""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return b""

    W, H = 900, 400
    left, right, top, bot = 70, 30, 40, 60
    pw, ph = W - left - right, H - top - bot

    img = Image.new("RGB", (W, H), (5, 9, 17))
    draw = ImageDraw.Draw(img)

    # Draw percentile bars
    p_vals = [
        ("p10", mc_result["sim_return_p10"], (80, 80, 120)),
        ("p25", mc_result["sim_return_p25"], (100, 100, 160)),
        ("p50", mc_result["sim_return_p50"], (140, 140, 200)),
        ("p75", mc_result["sim_return_p75"], (100, 100, 160)),
        ("p90", mc_result["sim_return_p90"], (80, 80, 120)),
        ("REAL", mc_result["real_return_pct"], (34, 211, 238)),
    ]

    all_vals = [v for _, v, _ in p_vals]
    vmin, vmax = min(all_vals) * 1.2, max(all_vals) * 1.2
    if vmin == vmax:
        vmin, vmax = vmin - 1, vmax + 1

    def y_of(v: float) -> int:
        return top + ph - int((v - vmin) / (vmax - vmin) * ph)

    # Grid
    for k in range(5):
        yy = top + k * ph // 4
        draw.line([(left, yy), (left + pw, yy)], fill=(30, 45, 60), width=1)

    # Bars
    bar_w = pw // (len(p_vals) + 1)
    zero_y = y_of(0)
    draw.line([(left, zero_y), (left + pw, zero_y)], fill=(80, 80, 80), width=1)

    for i, (label, val, color) in enumerate(p_vals):
        x = left + (i + 1) * bar_w - bar_w // 2
        y = y_of(val)
        if val >= 0:
            draw.rectangle([x - bar_w // 3, y, x + bar_w // 3, zero_y], fill=color)
        else:
            draw.rectangle([x - bar_w // 3, zero_y, x + bar_w // 3, y], fill=(180, 60, 60))
        draw.text((x - 10, H - bot + 5), label, fill=(100, 130, 160))
        draw.text((x - 15, y - 14), f"{val:+.1f}%", fill=color)

    draw.text((left, 8), f"MONTE CARLO · {mc_result['n_simulations']} sims · {mc_result['n_trades']} trades · "
              f"REAL at p{mc_result['percentile_rank_return']:.0f} · {mc_result['verdict']}", fill=(200, 220, 240))
    draw.text((left, H - 18), "Sim return distribution (p10/p25/p50/p75/p90) vs REAL (cyan)", fill=(80, 100, 120))

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# ── Walk-Forward ──────────────────────────────────────────────────────────────

def walk_forward(
    df: pd.DataFrame,
    features_fn,
    params,
    make_strategy_fn,
    n_windows: int = 6,
    is_pct: float = 0.70,
    flat_eod: bool = False,
    min_trades: int = 3,
) -> dict:
    """
    Roll a train/test window across the full bar history.
    Train on is_pct of each window, test on remaining 30%.
    Returns per-window stats + consistency score.

    A real edge: boom_rank_score > 0 in ≥ 60% of windows.
    A curve fit: only positive in 1–2 windows.
    """
    from backtesting import Backtest

    n = len(df)
    if n < 100:
        return {"ok": False, "reason": "not enough bars for walk-forward"}

    window_size = n // n_windows
    if window_size < 50:
        return {"ok": False, "reason": "windows too small"}

    results = []
    for i in range(n_windows):
        start = i * window_size
        end = min(start + window_size, n)
        split = start + int((end - start) * is_pct)

        df_train = df.iloc[start:split]
        df_test = df.iloc[split:end]

        if len(df_test) < 20:
            continue

        try:
            feat = features_fn(df_test, params)
            strat = make_strategy_fn(
                feat, params.hold_bars, params.stop_loss_pct,
                flat_eod, params.exit_mode,
                getattr(params, "break_even_offset_pct", 0.05),
            )
            bt = Backtest(df_test, strat, cash=100_000, commission=0.0015,
                          spread=0.0008, exclusive_orders=True, finalize_trades=True)
            stats = bt.run()
            ret = float(stats.get("Return [%]", 0) or 0)
            win = float(stats.get("Win Rate [%]", 0) or 0)
            dd = abs(float(stats.get("Max. Drawdown [%]", 0) or 0))
            trades = int(stats.get("# Trades", 0) or 0)
            score = ret - 0.35 * dd + 0.05 * win if trades >= min_trades else None

            results.append({
                "window": i + 1,
                "bars_train": len(df_train),
                "bars_test": len(df_test),
                "return_pct": round(ret, 2),
                "win_rate": round(win, 1),
                "max_dd": round(dd, 2),
                "trades": trades,
                "boom_rank_score": round(score, 3) if score is not None else None,
                "pass": score is not None and score > 0,
            })
        except Exception:
            continue

    if not results:
        return {"ok": False, "reason": "all windows failed"}

    scored = [r for r in results if r["boom_rank_score"] is not None]
    pass_count = sum(1 for r in scored if r["pass"])
    consistency = pass_count / len(scored) if scored else 0

    verdict = "ROBUST EDGE" if consistency >= 0.7 else \
              "CONSISTENT" if consistency >= 0.5 else \
              "INCONSISTENT" if consistency >= 0.3 else "CURVE FIT"

    return {
        "ok": True,
        "n_windows": len(results),
        "windows_with_trades": len(scored),
        "windows_passed": pass_count,
        "consistency_pct": round(consistency * 100, 1),
        "verdict": verdict,
        "mean_score": round(float(np.mean([r["boom_rank_score"] for r in scored])), 3) if scored else None,
        "windows": results,
    }


def walk_forward_chart(wf_result: dict) -> bytes:
    """Walk-forward per-window bar chart. Returns PNG bytes."""
    if not wf_result.get("ok") or not wf_result.get("windows"):
        return b""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return b""

    windows = wf_result["windows"]
    W, H = 900, 380
    left, right, top, bot = 60, 20, 40, 55
    pw, ph = W - left - right, H - top - bot

    img = Image.new("RGB", (W, H), (5, 9, 17))
    draw = ImageDraw.Draw(img)

    scores = [r["boom_rank_score"] or 0 for r in windows]
    if not scores:
        return b""

    vmin = min(min(scores) * 1.3, -1)
    vmax = max(max(scores) * 1.3, 1)

    def y_of(v: float) -> int:
        return top + ph - int((v - vmin) / (vmax - vmin) * ph)

    zero_y = y_of(0)
    draw.line([(left, zero_y), (left + pw, zero_y)], fill=(80, 80, 80), width=2)

    bar_w = pw // (len(windows) + 1)
    for i, r in enumerate(windows):
        sc = r["boom_rank_score"] or 0
        x = left + (i + 1) * bar_w
        y = y_of(sc)
        color = (74, 222, 128) if r["pass"] else (239, 68, 68)
        if sc >= 0:
            draw.rectangle([x - bar_w // 3, y, x + bar_w // 3, zero_y], fill=color)
        else:
            draw.rectangle([x - bar_w // 3, zero_y, x + bar_w // 3, y], fill=color)
        draw.text((x - 6, H - bot + 5), f"W{r['window']}", fill=(100, 130, 160))
        draw.text((x - 12, y - 14 if sc >= 0 else y + 2), f"{sc:+.2f}", fill=color)
        draw.text((x - 8, H - bot + 18), f"{r['trades']}T", fill=(60, 80, 100))

    draw.text((left, 8),
              f"WALK-FORWARD · {wf_result['n_windows']} windows · "
              f"{wf_result['windows_passed']}/{wf_result['windows_with_trades']} passed · "
              f"{wf_result['consistency_pct']}% consistent · {wf_result['verdict']}",
              fill=(200, 220, 240))

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# ── MAE / MFE Analysis ────────────────────────────────────────────────────────

def mae_mfe_analysis(
    trades: pd.DataFrame,
    df: pd.DataFrame,
) -> dict:
    """
    Max Adverse Excursion (MAE) and Max Favorable Excursion (MFE) per trade.

    MAE: how far against you did the trade go before closing?
         If most MAE > stop → stop is too tight.
         If most MAE < stop/2 → you have room to tighten stop.

    MFE: how far in your favour did the trade go before you exited?
         If MFE >> exit return → you're leaving money on the table (exit too early).
         If MFE ≈ exit return → you're capturing most of the move.

    Requires OHLCV bars to compute bar-by-bar excursion.
    """
    if trades is None or len(trades) == 0:
        return {"ok": False, "reason": "no trades"}
    if df is None or len(df) == 0:
        return {"ok": False, "reason": "no bar data"}

    required = {"EntryBar", "ExitBar", "EntryPrice", "ReturnPct"}
    if not required.issubset(trades.columns):
        return {"ok": False, "reason": f"missing columns: {required - set(trades.columns)}"}

    close = df["Close"].values
    high = df["High"].values
    low = df["Low"].values
    n_bars = len(close)

    rows = []
    for _, t in trades.iterrows():
        try:
            eb = int(t["EntryBar"])
            xb = int(t["ExitBar"])
            entry_px = float(t["EntryPrice"])
            ret_pct = float(t["ReturnPct"])
        except Exception:
            continue

        if eb >= n_bars or xb > n_bars or xb <= eb:
            continue

        trade_high = float(np.max(high[eb:xb + 1]))
        trade_low = float(np.min(low[eb:xb + 1]))

        mae_pct = (entry_px - trade_low) / entry_px * 100  # worst point against
        mfe_pct = (trade_high - entry_px) / entry_px * 100  # best point for

        captured = ret_pct / mfe_pct if mfe_pct > 0 else 1.0  # how much of MFE you kept

        rows.append({
            "entry_bar": eb,
            "exit_bar": xb,
            "entry_px": round(entry_px, 4),
            "ret_pct": round(ret_pct * 100, 3),
            "mae_pct": round(mae_pct, 3),
            "mfe_pct": round(mfe_pct, 3),
            "captured_pct": round(min(captured * 100, 200), 1),
            "winner": ret_pct > 0,
        })

    if not rows:
        return {"ok": False, "reason": "could not compute MAE/MFE for any trade"}

    mae_vals = [r["mae_pct"] for r in rows]
    mfe_vals = [r["mfe_pct"] for r in rows]
    captured_vals = [r["captured_pct"] for r in rows]

    avg_capture = float(np.mean(captured_vals))
    exit_quality = "EXCELLENT" if avg_capture >= 75 else \
                   "GOOD" if avg_capture >= 55 else \
                   "LEAVING MONEY" if avg_capture >= 35 else "EXIT TOO EARLY"

    avg_mae = float(np.mean(mae_vals))
    stop_verdict = "STOP TOO TIGHT" if avg_mae > 1.5 else \
                   "STOP OK" if avg_mae > 0.4 else "STOP VERY TIGHT"

    return {
        "ok": True,
        "n_trades": len(rows),
        "mae_mean": round(avg_mae, 3),
        "mae_p75": round(float(np.percentile(mae_vals, 75)), 3),
        "mae_p90": round(float(np.percentile(mae_vals, 90)), 3),
        "mfe_mean": round(float(np.mean(mfe_vals)), 3),
        "mfe_p75": round(float(np.percentile(mfe_vals, 75)), 3),
        "captured_mean_pct": round(avg_capture, 1),
        "exit_quality": exit_quality,
        "stop_verdict": stop_verdict,
        "trades": rows,
    }


def mae_mfe_chart(mf_result: dict) -> bytes:
    """MAE vs MFE scatter chart. Returns PNG bytes."""
    if not mf_result.get("ok") or not mf_result.get("trades"):
        return b""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return b""

    trades = mf_result["trades"]
    W, H = 900, 520
    left, right, top, bot = 70, 30, 40, 60
    pw, ph = W - left - right, H - top - bot

    img = Image.new("RGB", (W, H), (5, 9, 17))
    draw = ImageDraw.Draw(img)

    maes = [t["mae_pct"] for t in trades]
    mfes = [t["mfe_pct"] for t in trades]
    max_val = max(max(maes, default=1), max(mfes, default=1)) * 1.1 or 1

    def x_of(mae: float) -> int:
        return left + int(mae / max_val * pw)

    def y_of(mfe: float) -> int:
        return top + ph - int(mfe / max_val * ph)

    # Grid lines
    for k in range(1, 5):
        v = max_val * k / 4
        xx = x_of(v)
        yy = y_of(v)
        draw.line([(xx, top), (xx, top + ph)], fill=(20, 35, 50), width=1)
        draw.line([(left, yy), (left + pw, yy)], fill=(20, 35, 50), width=1)

    # Diagonal: MAE == MFE line (breakeven zone)
    draw.line([(left, top + ph), (left + pw, top)], fill=(60, 60, 80), width=1)

    # Scatter
    for t in trades:
        x = x_of(t["mae_pct"])
        y = y_of(t["mfe_pct"])
        color = (74, 222, 128) if t["winner"] else (239, 68, 68)
        draw.ellipse([x - 4, y - 4, x + 4, y + 4], fill=color, outline=color)

    # Axes labels
    draw.text((left, 8),
              f"MAE/MFE · {mf_result['n_trades']} trades · "
              f"Avg capture {mf_result['captured_mean_pct']}% · "
              f"{mf_result['exit_quality']} · {mf_result['stop_verdict']}",
              fill=(200, 220, 240))
    draw.text((left + pw // 2 - 20, H - 20), "MAE % (adverse)", fill=(100, 120, 140))
    draw.text((5, top + ph // 2), "MFE %", fill=(100, 120, 140))
    draw.text((left + 4, top + 4), "← exits early (money left)", fill=(60, 80, 100))
    draw.text((left + pw - 120, top + ph - 18), "tight stop →", fill=(60, 80, 100))

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# ── Regime Breakdown ──────────────────────────────────────────────────────────

def regime_breakdown(
    trades: pd.DataFrame,
    df: pd.DataFrame,
    vol_fast: int = 10,
    vol_slow: int = 60,
) -> dict:
    """
    Classify each trade's entry bar into vol regime: LOW / MID / HIGH
    using rolling realized vol ratio (fast/slow ATR proxy).
    Shows where the edge lives.
    """
    if trades is None or len(trades) == 0:
        return {"ok": False, "reason": "no trades"}

    close = df["Close"].values
    high = df["High"].values
    low = df["Low"].values
    n = len(close)

    prev = np.roll(close, 1); prev[0] = close[0]
    tr = np.maximum.reduce([np.abs(high - low), np.abs(high - prev), np.abs(low - prev)])

    def ewm_series(data: np.ndarray, span: int) -> np.ndarray:
        alpha = 2.0 / (span + 1)
        out = np.empty_like(data)
        out[0] = data[0]
        for i in range(1, len(data)):
            out[i] = alpha * data[i] + (1 - alpha) * out[i - 1]
        return out

    atr_fast = ewm_series(tr, vol_fast)
    atr_slow = ewm_series(tr, vol_slow)
    vol_ratio = np.divide(atr_fast, atr_slow, out=np.ones_like(atr_fast), where=atr_slow > 0)

    # Classify regime per bar
    p33 = float(np.percentile(vol_ratio, 33))
    p67 = float(np.percentile(vol_ratio, 67))

    def regime(ratio: float) -> str:
        if ratio <= p33:
            return "LOW VOL (compression)"
        elif ratio <= p67:
            return "MID VOL"
        else:
            return "HIGH VOL (expansion)"

    buckets: dict[str, list[float]] = {
        "LOW VOL (compression)": [],
        "MID VOL": [],
        "HIGH VOL (expansion)": [],
    }

    for _, t in trades.iterrows():
        try:
            eb = int(t["EntryBar"])
            ret = float(t.get("ReturnPct", 0) or 0) * 100
            if 0 <= eb < n:
                r = regime(vol_ratio[eb])
                buckets[r].append(ret)
        except Exception:
            continue

    summary = {}
    for reg, rets in buckets.items():
        if rets:
            summary[reg] = {
                "n_trades": len(rets),
                "mean_return": round(float(np.mean(rets)), 3),
                "win_rate": round(sum(1 for r in rets if r > 0) / len(rets) * 100, 1),
                "total_return": round(float(sum(rets)), 2),
            }
        else:
            summary[reg] = {"n_trades": 0}

    # Find best regime
    best = max(
        [(k, v) for k, v in summary.items() if v.get("n_trades", 0) > 0],
        key=lambda x: x[1].get("mean_return", -999),
        default=(None, {}),
    )

    return {
        "ok": True,
        "regimes": summary,
        "best_regime": best[0],
        "verdict": f"Edge strongest in: {best[0]}" if best[0] else "No clear regime preference",
    }
