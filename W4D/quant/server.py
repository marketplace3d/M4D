"""
server.py — W4D Quant API  :4040

Endpoints:
  GET  /health                → { status }
  GET  /v1/run                → trigger full backtest run (cached)
  GET  /v1/summary            → PerformanceAnalytics summary table
  GET  /v1/nav                → NAV curve [{date, nav, ret}]
  GET  /v1/signals            → signal IC breakdown
  GET  /v1/regime             → regime timeline [{date, regime}]
  GET  /v1/regime/dist        → regime distribution pct
  GET  /v1/risk               → risk monitor history
  GET  /v1/weights            → latest portfolio weights
  GET  /v1/walkforward        → walk-forward summary
  GET  /v1/attribution        → P&L attribution by factor
  POST /v1/run/config         → run with custom params body

Start:
  uvicorn server:app --host 127.0.0.1 --port 4040 --reload
"""
from __future__ import annotations
import json
import time
import traceback
import logging
from functools import lru_cache
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("w4d")

from main import run
from walkforward import WalkForwardValidator
from attribution import AttributionEngine

app = FastAPI(title="W4D Quant API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Singleton backtest state ────────────────────────────────────────────────
_state: dict = {}


def _get_or_run(
    n_instruments: int = 100,
    n_days: int = 756,
    optimizer: str = "alpha",
    seed: int = 42,
    force: bool = False,
) -> dict:
    key = f"{n_instruments}_{n_days}_{optimizer}_{seed}"
    if key in _state and not force:
        return _state[key]

    bt, analytics = run(
        n_instruments=n_instruments,
        n_days=n_days,
        optimizer=optimizer,
        seed=seed,
        verbose=False,
    )
    _state[key] = {"bt": bt, "analytics": analytics, "key": key}
    return _state[key]


def _safe_float(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    return float(v)


# ── Health ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "w4d-quant"}


# ── Run / trigger ───────────────────────────────────────────────────────────

@app.get("/v1/run")
def trigger_run(
    instruments: int = Query(100, ge=20, le=500),
    days: int = Query(756, ge=126, le=2520),
    optimizer: str = Query("alpha"),
    seed: int = Query(42),
    force: bool = Query(False),
):
    t0 = time.time()
    s = _get_or_run(instruments, days, optimizer, seed, force=force)
    elapsed = round(time.time() - t0, 2)
    df = s["analytics"].df
    nav = df["nav"]
    total_ret = float(nav.iloc[-1] / nav.iloc[0] - 1) * 100
    return {
        "status": "ok",
        "elapsed_s": elapsed,
        "days": len(df),
        "total_return_pct": round(total_ret, 2),
        "key": s["key"],
    }


# ── Summary ─────────────────────────────────────────────────────────────────

@app.get("/v1/summary")
def summary(
    instruments: int = Query(100),
    days: int = Query(756),
    optimizer: str = Query("alpha"),
    seed: int = Query(42),
):
    s = _get_or_run(instruments, days, optimizer, seed)
    tbl = s["analytics"].summary()
    return tbl.to_dict(orient="records")


# ── NAV curve ───────────────────────────────────────────────────────────────

@app.get("/v1/nav")
def nav_curve(
    instruments: int = Query(100),
    days: int = Query(756),
    optimizer: str = Query("alpha"),
    seed: int = Query(42),
):
    s = _get_or_run(instruments, days, optimizer, seed)
    df = s["analytics"].df[["nav", "ret", "gross", "net"]].copy()
    df.index = df.index.strftime("%Y-%m-%d")
    out = []
    for date, row in df.iterrows():
        out.append({
            "date": date,
            "nav": round(float(row["nav"]), 2),
            "ret": round(float(row["ret"]) * 100, 4),
            "gross": round(float(row["gross"]), 4),
            "net": round(float(row["net"]), 4),
        })
    return out


# ── Signals / IC ────────────────────────────────────────────────────────────

@app.get("/v1/signals")
def signal_ic(
    instruments: int = Query(100),
    days: int = Query(756),
    optimizer: str = Query("alpha"),
    seed: int = Query(42),
):
    s = _get_or_run(instruments, days, optimizer, seed)
    bt = s["bt"]
    ic_df = bt.pipeline.ic_df
    rows = []
    from signals import SIGNAL_MAP
    for col in ic_df.columns:
        sig = SIGNAL_MAP.get(col)
        fam = sig.family if sig else "unknown"
        ic_s = ic_df[col].dropna()
        ic_mean = float(ic_s.mean()) if len(ic_s) else 0.0
        ic_vol = float(ic_s.std()) if len(ic_s) else 0.0
        icir = ic_mean / ic_vol if ic_vol > 1e-8 else 0.0
        rows.append({
            "signal": col,
            "family": fam,
            "mean_ic": round(ic_mean, 5),
            "ic_vol": round(ic_vol, 5),
            "icir": round(icir, 4),
            "n_obs": len(ic_s),
        })
    rows.sort(key=lambda r: abs(r["icir"]), reverse=True)
    return rows


# ── Regime ──────────────────────────────────────────────────────────────────

@app.get("/v1/regime")
def regime_timeline(
    instruments: int = Query(100),
    days: int = Query(756),
    optimizer: str = Query("alpha"),
    seed: int = Query(42),
):
    s = _get_or_run(instruments, days, optimizer, seed)
    reg = s["bt"].pipeline.regimes
    return [
        {"date": str(d.date()), "regime": r.value}
        for d, r in reg.items()
    ]


@app.get("/v1/regime/dist")
def regime_dist(
    instruments: int = Query(100),
    days: int = Query(756),
    optimizer: str = Query("alpha"),
    seed: int = Query(42),
):
    s = _get_or_run(instruments, days, optimizer, seed)
    dist = s["analytics"].regime_breakdown()
    return {str(k.value): round(float(v), 4) for k, v in dist.items()}


# ── Risk ────────────────────────────────────────────────────────────────────

@app.get("/v1/risk")
def risk_history(
    instruments: int = Query(100),
    days: int = Query(756),
    optimizer: str = Query("alpha"),
    seed: int = Query(42),
    last_n: int = Query(252),
):
    s = _get_or_run(instruments, days, optimizer, seed)
    df = s["bt"].monitor.history_df().tail(last_n)
    df.index = df.index.strftime("%Y-%m-%d")
    rows = []
    for date, row in df.iterrows():
        rows.append({
            "date": date,
            "drawdown": round(float(row.get("drawdown", 0)), 4),
            "gross": round(float(row.get("gross", 0)), 4),
            "net": round(float(row.get("net", 0)), 4),
            "var_99": round(float(row.get("var_99", 0)), 4),
            "daily_pnl": round(float(row.get("daily_pnl", 0)), 4),
            "n_pos": int(row.get("n_pos", 0)),
            "alerts": row.get("alerts", []),
        })
    return rows


# ── Portfolio weights ───────────────────────────────────────────────────────

@app.get("/v1/weights")
def latest_weights(
    instruments: int = Query(100),
    days: int = Query(756),
    optimizer: str = Query("alpha"),
    seed: int = Query(42),
    top_n: int = Query(30),
):
    s = _get_or_run(instruments, days, optimizer, seed)
    wl = s["bt"].weight_log
    if not wl:
        return []
    latest = wl[-1].sort_values(key=abs, ascending=False).head(top_n)
    return [
        {"instrument": k, "weight": round(float(v), 5)}
        for k, v in latest.items()
    ]


# ── Walk-forward ────────────────────────────────────────────────────────────

@app.get("/v1/walkforward")
def walkforward(
    instruments: int = Query(50),
    days: int = Query(756),
    seed: int = Query(42),
):
    try:
        from data import generate_universe
        from signals import ALL_SIGNALS

        univ = generate_universe(n_instruments=instruments, n_days=days, seed=seed)
        validator = WalkForwardValidator(
            min_is_days=252,
            oos_days=63,
            rolling_is=False,
        )
        result = validator.run(univ, ALL_SIGNALS, verbose=False)

        folds_out = []
        for f in result.folds:
            try:
                folds_out.append({
                    "fold": int(f.fold),
                    "oos_start": str(pd.Timestamp(f.oos_start).date()),
                    "oos_end": str(pd.Timestamp(f.oos_end).date()),
                    "oos_sharpe": round(float(f.oos_sharpe), 4),
                    "oos_ic": round(float(f.oos_ic), 5),
                    "oos_max_dd_pct": round(float(f.oos_max_dd) * 100, 2),
                    "hit_rate_pct": round(float(f.oos_hit_rate) * 100, 1),
                })
            except Exception as fe:
                logger.error("Fold serialisation error: %s\n%s", fe, traceback.format_exc())

        return {
            "summary": result.summary(),
            "oos_sharpe": round(float(result.aggregate_sharpe), 4),
            "is_sharpe": round(float(result.is_sharpe), 4),
            "degradation": round(float(result.degradation), 4),
            "pbo_pct": round(float(result.pbo_estimate) * 100, 1),
            "max_dd_pct": round(float(result.aggregate_max_dd) * 100, 2),
            "mean_ic": round(float(result.mean_oos_ic), 5),
            "n_folds": len(result.folds),
            "folds": folds_out,
        }
    except Exception as e:
        tb = traceback.format_exc()
        logger.error("Walkforward error: %s\n%s", e, tb)
        raise HTTPException(status_code=500, detail={"error": str(e), "traceback": tb})


# ── Attribution ─────────────────────────────────────────────────────────────

@app.get("/v1/attribution")
def attribution(
    instruments: int = Query(100),
    days: int = Query(756),
    optimizer: str = Query("alpha"),
    seed: int = Query(42),
):
    s = _get_or_run(instruments, days, optimizer, seed)
    bt = s["bt"]
    engine = AttributionEngine(bt)
    result = engine.compute()

    # family IC-to-P&L correlation
    family_contrib = {
        fam: round(float(result.family_df[fam].corr(result.perf_df["ret"])), 4)
        for fam in result.family_df.columns
    }

    return {
        "long_return_pct": round(float(result.long_contrib) * 100, 2),
        "short_return_pct": round(float(result.short_contrib) * 100, 2),
        "tc_drag_pct": round(float(result.tc_drag_pct) * 100, 2),
        "signal_family": family_contrib,
        "regime": {str(k): round(float(v), 4) for k, v in result.regime_ann_returns.items()},
    }


# ── Live data: DB info ──────────────────────────────────────────────────────

@app.get("/v1/live/info")
def live_db_info():
    """What's in futures.db — symbols, bar counts, date ranges."""
    try:
        from data_live import db_info
        return db_info()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Live data: OHLCV daily for a symbol ────────────────────────────────────

@app.get("/v1/live/ohlcv")
def live_ohlcv(
    symbol: str = Query("BTC"),
    table: str = Query("bars_5m"),
    start: str = Query("2024-01-01"),
    end: Optional[str] = Query(None),
    freq: str = Query("1D"),
):
    """
    Return daily (or resampled) OHLCV for one symbol.
    freq: "1D" (daily), "1H", "4H", "1W"
    table: "bars_1m" or "bars_5m"
    """
    try:
        from data_live import load_intraday, _DEFAULT_DB
        bars = load_intraday(
            symbols=[symbol.upper()],
            db_path=_DEFAULT_DB,
            freq=freq,
            start=start,
            end=end,
            table=table,
        )
        if symbol.upper() not in bars:
            raise HTTPException(status_code=404, detail=f"{symbol} not found in {table}")
        b = bars[symbol.upper()]
        out = []
        for i in range(len(b.datetime)):
            out.append({
                "datetime": str(b.datetime[i]),
                "open":  round(float(b.open[i]),  6),
                "high":  round(float(b.high[i]),  6),
                "low":   round(float(b.low[i]),   6),
                "close": round(float(b.close[i]), 6),
                "volume": int(b.volume[i]),
            })
        return {"symbol": symbol.upper(), "freq": freq, "n": len(out), "bars": out}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("live/ohlcv error: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# ── Live backtest on real data ──────────────────────────────────────────────

_live_state: dict = {}

@app.get("/v1/live/run")
def live_run(
    symbols: str = Query("BTC,ETH,SOL,XRP,BNB,ADA,AVAX,DOT,LINK,UNI"),
    table: str = Query("bars_5m"),
    start: str = Query("2024-04-01"),
    end: Optional[str] = Query(None),
    optimizer: str = Query("alpha"),
    force: bool = Query(False),
):
    """
    Run the WorldQuant engine on REAL futures.db data.
    symbols: comma-separated list (default 10 crypto assets)
    table: bars_5m (crypto) or bars_1m (includes futures)
    """
    key = f"{symbols}_{table}_{start}_{end}_{optimizer}"
    if key in _live_state and not force:
        s = _live_state[key]
        return {"status": "cached", "key": key,
                "days": s["n_days"], "symbols": s["symbols"],
                "total_return_pct": s["total_return_pct"]}

    try:
        from data_live import load_daily, _DEFAULT_DB
        from signals import ALL_SIGNALS
        from ensemble import SignalPipeline
        from backtester import Backtester, BacktestConfig, TransactionCostModel
        from risk import RiskLimits

        sym_list = [s.strip().upper() for s in symbols.split(",")]

        t0 = time.time()
        print(f"[live/run] Loading {len(sym_list)} symbols from {table} …")
        univ = load_daily(
            symbols=sym_list, db_path=_DEFAULT_DB,
            bar_table=table, start=start, end=end,
        )

        print(f"[live/run] Building pipeline …")
        pipeline = SignalPipeline(signal_list=ALL_SIGNALS, ic_half_life=60, fwd_horizon=5)
        pipeline.run(univ, verbose=True)

        print(f"[live/run] Running backtest …")
        cfg = BacktestConfig(
            initial_nav=10_000_000,
            rebalance_freq=5,
            warmup_days=63,
            optimizer=optimizer,
            alpha_pct=0.30,
            gross_limit=1.4,
            net_limit=0.15,
            max_position=0.08,
            turnover_limit=0.35,
            verbose=False,
            print_freq=9999,
        )
        tc = TransactionCostModel(
            commission_pct=0.0005, spread_pct=0.0010,
            market_impact_pct=0.0005, slippage_vol_mult=0.10,
        )
        rl = RiskLimits(
            max_gross_exposure=1.5, max_drawdown_pct=0.12,
            kill_drawdown_pct=0.25, daily_loss_reduce=0.025, daily_loss_kill=0.050,
        )
        bt = Backtester(pipeline=pipeline, universe=univ, config=cfg, tc_model=tc, risk_limits=rl)
        bt.run()
        analytics = bt.performance()

        df = analytics.df
        nav = df["nav"]
        total_ret = float(nav.iloc[-1] / nav.iloc[0] - 1) * 100

        _live_state[key] = {
            "bt": bt, "analytics": analytics, "key": key,
            "n_days": len(df), "symbols": list(univ.instruments),
            "total_return_pct": round(total_ret, 2),
        }
        elapsed = round(time.time() - t0, 1)
        return {
            "status": "ok", "elapsed_s": elapsed, "key": key,
            "days": len(df), "symbols": list(univ.instruments),
            "total_return_pct": round(total_ret, 2),
        }
    except Exception as e:
        logger.error("live/run error: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail={"error": str(e), "traceback": traceback.format_exc()})


@app.get("/v1/live/nav")
def live_nav(
    symbols: str = Query("BTC,ETH,SOL,XRP,BNB,ADA,AVAX,DOT,LINK,UNI"),
    table: str = Query("bars_5m"),
    start: str = Query("2024-04-01"),
    end: Optional[str] = Query(None),
    optimizer: str = Query("alpha"),
):
    key = f"{symbols}_{table}_{start}_{end}_{optimizer}"
    if key not in _live_state:
        raise HTTPException(status_code=404, detail="Run /v1/live/run first")
    s = _live_state[key]
    df = s["analytics"].df[["nav", "ret"]].copy()
    df.index = df.index.strftime("%Y-%m-%d")
    return [{"date": d, "nav": round(float(row["nav"]), 2), "ret": round(float(row["ret"]) * 100, 4)}
            for d, row in df.iterrows()]


@app.get("/v1/live/summary")
def live_summary(
    symbols: str = Query("BTC,ETH,SOL,XRP,BNB,ADA,AVAX,DOT,LINK,UNI"),
    table: str = Query("bars_5m"),
    start: str = Query("2024-04-01"),
    end: Optional[str] = Query(None),
    optimizer: str = Query("alpha"),
):
    key = f"{symbols}_{table}_{start}_{end}_{optimizer}"
    if key not in _live_state:
        raise HTTPException(status_code=404, detail="Run /v1/live/run first")
    return _live_state[key]["analytics"].summary().to_dict(orient="records")


@app.get("/v1/live/signals")
def live_signals(
    symbols: str = Query("BTC,ETH,SOL,XRP,BNB,ADA,AVAX,DOT,LINK,UNI"),
    table: str = Query("bars_5m"),
    start: str = Query("2024-04-01"),
    end: Optional[str] = Query(None),
    optimizer: str = Query("alpha"),
):
    key = f"{symbols}_{table}_{start}_{end}_{optimizer}"
    if key not in _live_state:
        raise HTTPException(status_code=404, detail="Run /v1/live/run first")
    from signals import SIGNAL_MAP
    bt = _live_state[key]["bt"]
    ic_df = bt.pipeline.ic_df
    rows = []
    for col in ic_df.columns:
        sig = SIGNAL_MAP.get(col)
        fam = sig.family if sig else "unknown"
        ic_s = ic_df[col].dropna()
        ic_mean = float(ic_s.mean()) if len(ic_s) else 0.0
        ic_vol  = float(ic_s.std())  if len(ic_s) else 0.0
        icir    = ic_mean / ic_vol if ic_vol > 1e-8 else 0.0
        rows.append({"signal": col, "family": fam,
                     "mean_ic": round(ic_mean, 5), "ic_vol": round(ic_vol, 5),
                     "icir": round(icir, 4), "n_obs": len(ic_s)})
    rows.sort(key=lambda r: abs(r["icir"]), reverse=True)
    return rows


# ── Monthly returns ─────────────────────────────────────────────────────────

@app.get("/v1/monthly")
def monthly_returns(
    instruments: int = Query(100),
    days: int = Query(756),
    optimizer: str = Query("alpha"),
    seed: int = Query(42),
):
    s = _get_or_run(instruments, days, optimizer, seed)
    tbl = s["analytics"].monthly_returns()
    result = []
    for year, row in tbl.iterrows():
        months = {}
        for m, v in row.items():
            if not pd.isna(v):
                # columns may be plain ints or (level, month) tuples after unstack
                month_key = int(m[-1]) if isinstance(m, tuple) else int(m)
                months[month_key] = round(float(v) * 100, 2)
        result.append({"year": int(year), "months": months})
    return result
