"""
ds_app/views.py — Django REST endpoints for algo backtesting + optimization.

Endpoints:
  GET  /v1/algos/                          List all 27 algos with metadata
  GET  /v1/algos/<id>/                     Single algo metadata + default params
  POST /v1/backtest/                        Run backtest for algo/asset/date range
  POST /v1/optimize/                        Run walk-forward param optimization
  POST /v1/optimize/all/                    Optimize all (or subset) of algos
  GET  /v1/signals/?asset=X                Live votes for all 27 algos on latest data
  GET  /health/                            Health check
"""
from __future__ import annotations

import json
import logging
import os
import pathlib
import time
from datetime import datetime, timedelta

# ── Load .env.local at import time (fallback when launcher hasn't sourced it) ─
def _load_env_local():
    """Load M3D/.env.local then repo .env.local (later file overrides on duplicate keys)."""
    base = pathlib.Path(__file__).parent.parent.parent
    for env_file in (base / "M3D" / ".env.local", base / ".env.local"):
        if not env_file.exists():
            continue
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip()
                if k and v:
                    os.environ[k] = v

_load_env_local()

import numpy as np
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .algos_crypto import ALGO_REGISTRY, ALL_ALGO_IDS, compute_live_votes
from .backtest import run_backtest
from .legend_algos import LEGEND_REGISTRY, LEGEND_IDS, score_symbol, legend_composite_score
from .mtf import score_mtf, jedi_gate_score
from .data_fetch import fetch_ohlcv
from .optimizer import optimize_algo, optimize_all_algos, PARAM_GRIDS

logger = logging.getLogger(__name__)


def _json_body(request) -> dict:
    try:
        return json.loads(request.body)
    except Exception:
        return {}


def _err(msg: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"error": msg}, status=status)


# ── /health/ ──────────────────────────────────────────────────────────────────

@require_GET
def health(request):
    return JsonResponse({"status": "ok", "algos": len(ALL_ALGO_IDS), "version": "v2-crypto"})


# ── /v1/algos/ ────────────────────────────────────────────────────────────────

@require_GET
def algos_list(request):
    """List all 27 algos with bank, name, default params, stop/hold config."""
    data = []
    for algo_id, meta in ALGO_REGISTRY.items():
        grid = PARAM_GRIDS.get(algo_id, {})
        default_params = {k: v[0] for k, v in grid.items()} if grid else {}
        data.append({
            "id": algo_id,
            "bank": meta["bank"],
            "name": meta["name"],
            "stop_pct": meta["stop_pct"],
            "hold_bars": meta["hold_bars"],
            "default_params": default_params,
            "param_grid": grid,
        })
    return JsonResponse({"algos": data, "count": len(data)})


@require_GET
def algo_detail(request, algo_id: str):
    algo_id = algo_id.upper()
    if algo_id not in ALGO_REGISTRY:
        return _err(f"Unknown algo: {algo_id}")
    meta = ALGO_REGISTRY[algo_id]
    grid = PARAM_GRIDS.get(algo_id, {})
    default_params = {k: v[0] for k, v in grid.items()} if grid else {}
    return JsonResponse({
        "id": algo_id,
        "bank": meta["bank"],
        "name": meta["name"],
        "stop_pct": meta["stop_pct"],
        "hold_bars": meta["hold_bars"],
        "default_params": default_params,
        "param_grid": grid,
    })


# ── /v1/backtest/ ─────────────────────────────────────────────────────────────

@csrf_exempt
@require_POST
def backtest(request):
    """
    POST body:
        {
          "algo": "DON_BO",
          "asset": "BTC",
          "start": "2022-01-01",
          "end": "2024-01-01",
          "params": {}   // optional param overrides
        }
    """
    body = _json_body(request)
    algo = body.get("algo", "").upper()
    asset = body.get("asset", "BTC").upper()
    start = body.get("start", "2022-01-01")
    end = body.get("end", datetime.utcnow().strftime("%Y-%m-%d"))
    params = body.get("params", {})

    if not algo:
        return _err("'algo' is required")
    if algo not in ALGO_REGISTRY:
        return _err(f"Unknown algo: {algo}. Valid: {ALL_ALGO_IDS}")

    try:
        # Use the existing run_backtest infrastructure but route through algos_crypto
        result = _run_crypto_backtest(algo, asset, start, end, params)
        return JsonResponse(result)
    except ValueError as exc:
        return _err(str(exc))
    except Exception as exc:
        logger.exception("Backtest error: %s", exc)
        return _err(f"Internal error: {exc}", status=500)


def _run_crypto_backtest(algo_id: str, asset: str, start: str, end: str, params: dict) -> dict:
    """
    Run a single backtest using algos_crypto feature builders + backtesting.py.
    """
    from backtesting import Backtest, Strategy
    import math

    from .algos_crypto import build_features, ALGO_REGISTRY
    from .data_fetch import fetch_ohlcv

    meta = ALGO_REGISTRY[algo_id]
    stop_pct = float(params.get("stop_loss_pct", meta["stop_pct"]))
    hold_bars = int(params.get("hold_bars", meta["hold_bars"]))

    df = fetch_ohlcv(asset, start, end)
    if df.empty or len(df) < 30:
        raise ValueError(f"Insufficient data: {len(df)} bars for {asset} {start}→{end}")

    feat_df = build_features(df, algo_id, params)

    class CryptoStrategy(Strategy):
        _feat = feat_df
        _hold = hold_bars
        _stop_pct = stop_pct

        def init(self):
            self._hold_count = 0
            self._entry_px = None

        def next(self):
            idx = len(self.data) - 1
            close_now = float(self.data.Close[-1])

            if self.position:
                # Stop loss
                if self._entry_px and close_now <= self._entry_px * (1 - self._stop_pct / 100):
                    self.position.close()
                    self._hold_count = 0
                    self._entry_px = None
                    return
                # Algo exit
                try:
                    if bool(self._feat["exit_sig"].iloc[idx]):
                        self.position.close()
                        self._hold_count = 0
                        self._entry_px = None
                        return
                except IndexError:
                    pass
                self._hold_count += 1
                if self._hold_count >= self._hold:
                    self.position.close()
                    self._hold_count = 0
                    self._entry_px = None
                return

            # Entry
            try:
                if bool(self._feat["entry"].iloc[idx]):
                    self.buy()
                    self._hold_count = 0
                    self._entry_px = close_now
            except IndexError:
                pass

    bt = Backtest(df, CryptoStrategy, cash=100_000, commission=0.001, exclusive_orders=True)
    stats = bt.run()

    def _s(key, default=0.0):
        try:
            v = float(stats[key])
            return v if math.isfinite(v) else default
        except Exception:
            return default

    # equity curve
    try:
        eq_series = stats["_equity_curve"]["Equity"]
        equity_curve = [{"t": str(t)[:10], "v": round(float(v), 2)} for t, v in zip(eq_series.index, eq_series)]
    except Exception:
        equity_curve = []

    # trades
    trades = []
    try:
        tdf = stats["_trades"]
        if tdf is not None and not tdf.empty:
            for _, row in tdf.iterrows():
                trades.append({
                    "entry_time": str(row.get("EntryTime", ""))[:10],
                    "exit_time": str(row.get("ExitTime", ""))[:10],
                    "entry_price": round(float(row.get("EntryPrice", 0)), 4),
                    "exit_price": round(float(row.get("ExitPrice", 0)), 4),
                    "pnl": round(float(row.get("PnL", 0)), 2),
                    "return_pct": round(float(row.get("ReturnPct", 0)) * 100, 2),
                    "size": round(float(row.get("Size", 0)), 4),
                })
    except Exception:
        pass

    return {
        "algo": algo_id,
        "asset": asset,
        "start": start,
        "end": end,
        "params": params,
        "win_rate": round(_s("Win Rate [%]"), 2),
        "total_return": round(_s("Return [%]"), 2),
        "sharpe": round(_s("Sharpe Ratio"), 4),
        "max_drawdown": round(abs(_s("Max. Drawdown [%]")), 2),
        "num_trades": int(_s("# Trades")),
        "equity_curve": equity_curve,
        "trades": trades,
    }


# ── /v1/optimize/ ─────────────────────────────────────────────────────────────

@csrf_exempt
@require_POST
def optimize(request):
    """
    POST body:
        {
          "algo": "DON_BO",
          "asset": "BTC",
          "start": "2021-01-01",
          "end": "2024-01-01",
          "is_pct": 0.75,       // optional
          "min_trades": 10,     // optional
          "top_n": 10           // optional
        }
    """
    body = _json_body(request)
    algo = body.get("algo", "").upper()
    asset = body.get("asset", "BTC").upper()
    start = body.get("start", "2021-01-01")
    end = body.get("end", datetime.utcnow().strftime("%Y-%m-%d"))
    is_pct = float(body.get("is_pct", 0.75))
    min_trades = int(body.get("min_trades", 10))
    top_n = int(body.get("top_n", 10))

    if not algo:
        return _err("'algo' is required")
    if algo not in ALGO_REGISTRY:
        return _err(f"Unknown algo: {algo}. Valid: {ALL_ALGO_IDS}")

    try:
        result = optimize_algo(algo, asset, start, end, is_pct=is_pct,
                               min_trades=min_trades, top_n=top_n)
        return JsonResponse(result.to_dict())
    except ValueError as exc:
        return _err(str(exc))
    except Exception as exc:
        logger.exception("Optimize error: %s", exc)
        return _err(f"Internal error: {exc}", status=500)


@csrf_exempt
@require_POST
def optimize_all(request):
    """
    POST body:
        {
          "asset": "BTC",
          "start": "2021-01-01",
          "end": "2024-01-01",
          "algos": ["DON_BO", "EMA_CROSS"],   // optional, omit for all 27
          "is_pct": 0.75,
          "min_trades": 10,
          "top_n": 5
        }
    """
    body = _json_body(request)
    asset = body.get("asset", "BTC").upper()
    start = body.get("start", "2021-01-01")
    end = body.get("end", datetime.utcnow().strftime("%Y-%m-%d"))
    algo_ids = [a.upper() for a in body.get("algos", [])] or None
    is_pct = float(body.get("is_pct", 0.75))
    min_trades = int(body.get("min_trades", 10))
    top_n = int(body.get("top_n", 5))

    try:
        results = optimize_all_algos(
            asset, start, end, algo_ids=algo_ids,
            is_pct=is_pct, min_trades=min_trades, top_n=top_n,
        )
        return JsonResponse({"asset": asset, "start": start, "end": end, "results": results})
    except Exception as exc:
        logger.exception("Optimize-all error: %s", exc)
        return _err(f"Internal error: {exc}", status=500)


# ── /v1/signals/ ─────────────────────────────────────────────────────────────

@require_GET
def signals(request):
    """
    GET /v1/signals/?asset=BTC&days=200
    Returns live votes for all 27 algos using recent OHLCV data.
    """
    asset = request.GET.get("asset", "BTC").upper()
    days = int(request.GET.get("days", 200))

    end = datetime.utcnow().strftime("%Y-%m-%d")
    start = (datetime.utcnow() - timedelta(days=days + 10)).strftime("%Y-%m-%d")

    try:
        df = fetch_ohlcv(asset, start, end)
        if df.empty or len(df) < 30:
            return _err(f"Insufficient data for {asset}")

        votes = compute_live_votes(df)

        algo_list = []
        for algo_id, v in votes.items():
            algo_list.append({
                "id": algo_id,
                "name": v.get("name", algo_id),
                "bank": v.get("bank", "?"),
                "vote": v.get("vote", 0),
                "score": v.get("score", 0.0),
            })

        jedi = votes.get("JEDI", {})
        return JsonResponse({
            "asset": asset,
            "as_of": end,
            "jedi_vote": jedi.get("vote", 0),
            "jedi_raw": jedi.get("raw_score", 0),
            "jedi_score_pct": round(jedi.get("score", 0.0) * 100, 1),
            "algos": algo_list,
        })
    except ValueError as exc:
        return _err(str(exc))
    except Exception as exc:
        logger.exception("Signals error: %s", exc)
        return _err(f"Internal error: {exc}", status=500)


# ── /v1/legend/ ───────────────────────────────────────────────────────────────

# Default universe — 40 most liquid US stocks (fast to scan)
_DEFAULT_UNIVERSE = [
    "AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","V","MA",
    "AVGO","COST","LLY","UNH","XOM","HD","ABBV","PG","MRK","JNJ",
    "TXN","QCOM","AMD","NFLX","CRM","ADBE","ORCL","INTU","NOW","SNOW",
    "GS","MS","BAC","WFC","COIN","PLTR","SHOP","SQ","UBER","PYPL",
]

def _fix_yf_columns(df) -> "pd.DataFrame":
    """
    Flatten yfinance MultiIndex columns to simple strings.
    Handles both old (flat) and new (MultiIndex Price/Ticker) formats.
    """
    import pandas as pd
    if isinstance(df.columns, pd.MultiIndex):
        # New yfinance: outer level = Price, inner = Ticker
        # OR outer = Ticker, inner = Price — detect by checking level values
        lvl0 = list(df.columns.get_level_values(0))
        price_cols = {"Open","High","Low","Close","Volume","Adj Close"}
        if lvl0[0] in price_cols:
            # (Price, Ticker) format — take outer level
            df.columns = df.columns.get_level_values(0)
        else:
            # (Ticker, Price) format — take inner level
            df.columns = df.columns.get_level_values(1)
    # Drop duplicate columns (can happen with some yfinance versions)
    df = df.loc[:, ~df.columns.duplicated()]
    return df

def _yf_single(symbol: str, start: str, end: str):
    """Download a single symbol and return a clean flat-column DataFrame."""
    import yfinance as yf
    df = yf.download(symbol, start=start, end=end, progress=False,
                     auto_adjust=True, multi_level_index=False)
    if df.empty:
        return df
    return _fix_yf_columns(df)

def _to_python(v):
    """Convert numpy scalars to native Python for JSON serialization."""
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    return v

def _signal_row(sig) -> dict:
    return {
        "signal": bool(sig.signal),
        "score": round(float(sig.score), 3),
        "reason": str(sig.reason),
        "entry_zone": float(sig.entry_zone) if sig.entry_zone else 0.0,
        "target": float(sig.target) if sig.target else 0.0,
        "stop": float(sig.stop) if sig.stop else 0.0,
    }

@require_GET
def legend_scan(request):
    """
    GET /v1/legend/scan/?symbols=AAPL,MSFT&top=20
    Batch-downloads all symbols in one yfinance call, runs 9 LEGEND algos each.
    Optional: ?symbols= comma-separated override; ?top= max results.
    """
    import yfinance as yf
    import pandas as pd

    raw = request.GET.get("symbols", "")
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()] or _DEFAULT_UNIVERSE
    top_n = int(request.GET.get("top", 30))
    end = datetime.utcnow().strftime("%Y-%m-%d")
    # 2 years — need 565+ trading bars for MA200 to have valid values
    start = (datetime.utcnow() - timedelta(days=760)).strftime("%Y-%m-%d")

    # One batch call for all symbols
    try:
        all_syms = list(set(symbols + ["SPY"]))
        raw_data = yf.download(
            all_syms, start=start, end=end,
            progress=False, auto_adjust=True, multi_level_index=True,
        )
    except Exception as exc:
        logger.exception("yfinance batch download failed: %s", exc)
        return _err(f"Data fetch error: {exc}", status=500)

    def _extract(sym: str):
        """Extract single-symbol flat-column DataFrame from batch result."""
        try:
            if isinstance(raw_data.columns, pd.MultiIndex):
                lvl0 = list(raw_data.columns.get_level_values(0))
                price_cols = {"Open","High","Low","Close","Volume","Adj Close"}
                if lvl0[0] in price_cols:
                    # (Price, Ticker) format
                    df = raw_data.xs(sym, axis=1, level=1, drop_level=True)
                else:
                    # (Ticker, Price) format
                    df = raw_data.xs(sym, axis=1, level=0, drop_level=True)
            else:
                df = raw_data.copy()
            df = df.dropna(how="all")
            # Ensure Open column exists (needed by SE, RT algos)
            if "Open" not in df.columns and "open" in df.columns:
                df = df.rename(columns={"open":"Open","high":"High","low":"Low","close":"Close","volume":"Volume"})
            return df
        except Exception as exc:
            logger.debug("_extract %s failed: %s", sym, exc)
            return None

    spy_df = _extract("SPY")

    results = []
    failed = 0
    for sym in symbols:
        try:
            df = _extract(sym)
            if df is None or df.empty or len(df) < 100:
                failed += 1
                continue
            if not {"Open","High","Low","Close","Volume"}.issubset(df.columns):
                logger.warning("Legend scan %s missing cols: %s", sym, list(df.columns))
                failed += 1
                continue
            signals_map = score_symbol(df, spy_df)
            comp = legend_composite_score(signals_map)
            firing = [sig.algo_id for sig in signals_map.values() if sig.signal]
            results.append({
                "symbol": sym,
                "composite": round(comp, 3),
                "firing": firing,
                "count": len(firing),
                "signals": {k: _signal_row(v) for k, v in signals_map.items()},
            })
        except Exception as exc:
            logger.warning("Legend scan %s error: %s", sym, exc)
            failed += 1

    results.sort(key=lambda r: r["composite"], reverse=True)
    return JsonResponse({
        "as_of": end,
        "scanned": len(symbols),
        "failed": failed,
        "results": results[:top_n],
    })


@require_GET
def legend_symbol(request, symbol: str):
    """
    GET /v1/legend/<symbol>/
    Full LEGEND scoring for a single symbol.
    """
    symbol = symbol.upper()
    end = datetime.utcnow().strftime("%Y-%m-%d")
    start = (datetime.utcnow() - timedelta(days=760)).strftime("%Y-%m-%d")

    try:
        df = _yf_single(symbol, start, end)
        if df.empty or len(df) < 60:
            return _err(f"Insufficient data for {symbol}")
        if not {"Open","High","Low","Close","Volume"}.issubset(df.columns):
            return _err(f"Missing OHLCV columns for {symbol} — got: {list(df.columns)}")

        spy_df = _yf_single("SPY", start, end)
        signals_map = score_symbol(df, spy_df if not spy_df.empty else None)
        comp = legend_composite_score(signals_map)

        return JsonResponse({
            "symbol": symbol,
            "composite": round(comp, 3),
            "as_of": end,
            "signals": {k: _signal_row(v) for k, v in signals_map.items()},
        })
    except Exception as exc:
        logger.exception("Legend symbol %s: %s", symbol, exc)
        return _err(f"Internal error: {exc}", status=500)


# ── /v1/chart/ — stock OHLCV for LiveChart (yfinance) ────────────────────────

@require_GET
def chart_ohlcv(request, symbol: str):
    """
    GET /v1/chart/<symbol>/?tf=1h&limit=300
    Returns OHLCV bars for a stock symbol via yfinance.
    tf: 1m 5m 15m 30m 1h 4h 1d
    """
    import yfinance as yf
    symbol = symbol.upper()
    tf     = request.GET.get("tf", "1d")
    limit  = min(int(request.GET.get("limit", 300)), 500)

    # Map frontend tf → yfinance interval + period
    yf_interval = {
        "1m": "1m",  "5m": "5m", "15m": "15m", "30m": "30m",
        "1h": "60m", "4h": "1h", "1d": "1d",
    }.get(tf, "1d")

    yf_period = {
        "1m": "7d",  "5m": "60d", "15m": "60d", "30m": "60d",
        "1h": "730d","4h": "730d","1d": "730d",
    }.get(tf, "730d")

    try:
        df = yf.download(symbol, period=yf_period, interval=yf_interval,
                         progress=False, auto_adjust=True, multi_level_index=False)
        if df.empty:
            return _err(f"No data for {symbol}")
        df = _fix_yf_columns(df)
        if not {"Open","High","Low","Close","Volume"}.issubset(df.columns):
            return _err(f"Missing columns for {symbol}")

        df = df.dropna(subset=["Close"]).tail(limit)
        bars = []
        for ts, row in df.iterrows():
            import pandas as pd
            if isinstance(ts, pd.Timestamp):
                t = int(ts.timestamp())
            else:
                try:
                    t = int(pd.Timestamp(ts).timestamp())
                except Exception:
                    continue
            bars.append({
                "time": t,
                "open":   round(float(row["Open"]),   4),
                "high":   round(float(row["High"]),   4),
                "low":    round(float(row["Low"]),    4),
                "close":  round(float(row["Close"]),  4),
                "volume": round(float(row["Volume"]), 2),
            })
        return JsonResponse({"symbol": symbol, "tf": tf, "bars": bars})
    except Exception as exc:
        logger.exception("chart_ohlcv %s: %s", symbol, exc)
        return _err(f"Internal error: {exc}", status=500)


# ── /v1/mtf/ ──────────────────────────────────────────────────────────────────

@require_GET
def mtf_score(request, symbol: str):
    """
    GET /v1/mtf/<symbol>/
    Multi-timeframe alignment score for a crypto symbol (e.g. BTC, ETH).
    """
    symbol = symbol.upper()
    try:
        result = score_mtf(symbol)
        return JsonResponse(result.to_dict())
    except Exception as exc:
        logger.exception("MTF score error: %s", exc)
        return _err(f"Internal error: {exc}", status=500)


# ── /v1/jedi/ ─────────────────────────────────────────────────────────────────

@require_GET
def jedi_score(request):
    """
    GET /v1/jedi/?asset=BTC&days=200
    Full JEDI gate composite: bank_A + bank_B + bank_C + MTF + sentiment.
    Returns go/no-go signal + breakdown.
    """
    asset = request.GET.get("asset", "BTC").upper()
    days = int(request.GET.get("days", 200))
    sentiment = float(request.GET.get("sentiment", 0.5))

    end = datetime.utcnow().strftime("%Y-%m-%d")
    start = (datetime.utcnow() - timedelta(days=days + 10)).strftime("%Y-%m-%d")

    try:
        df = fetch_ohlcv(asset, start, end)
        if df.empty or len(df) < 30:
            return _err(f"Insufficient data for {asset}")

        votes = compute_live_votes(df)

        # Bank scores: fraction of bank algos firing long
        from .algos_crypto import ALGO_REGISTRY
        bank_a_ids = [k for k, v in ALGO_REGISTRY.items() if v["bank"] == "A"]
        bank_b_ids = [k for k, v in ALGO_REGISTRY.items() if v["bank"] == "B"]
        bank_c_ids = [k for k, v in ALGO_REGISTRY.items() if v["bank"] == "C"]

        def _bank_score(ids):
            if not ids:
                return 0.0
            long_count = sum(1 for i in ids if votes.get(i, {}).get("vote", 0) == 1)
            return round(long_count / len(ids), 4)

        bank_a = _bank_score(bank_a_ids)
        bank_b = _bank_score(bank_b_ids)
        bank_c = _bank_score(bank_c_ids)

        mtf = score_mtf(asset)
        result = jedi_gate_score(bank_a, bank_b, bank_c, mtf, sentiment)

        result["asset"] = asset
        result["as_of"] = end
        result["bank_scores"] = {"A": bank_a, "B": bank_b, "C": bank_c}
        result["council_votes"] = {k: v.get("vote", 0) for k, v in votes.items()}

        return JsonResponse(result)
    except Exception as exc:
        logger.exception("JEDI score error: %s", exc)
        return _err(f"Internal error: {exc}", status=500)


# ── /v1/rank/ ─────────────────────────────────────────────────────────────────

_RANK_UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOGE",
                  "LINK", "DOT", "MATIC", "UNI", "ATOM", "LTC", "NEAR"]

@require_GET
def algo_rank(request):
    """
    GET /v1/rank/?assets=BTC,ETH&start=2022-01-01&end=2024-12-31&min_trades=5
    Run all algo × asset combos in parallel, rank by Sharpe.
    Returns flat list sorted by sharpe desc.
    """
    import math
    from concurrent.futures import ThreadPoolExecutor, as_completed

    raw_assets = request.GET.get("assets", "")
    assets = [a.strip().upper() for a in raw_assets.split(",") if a.strip()] or _RANK_UNIVERSE
    assets = assets[:20]  # cap at 20 to avoid timeouts
    start  = request.GET.get("start", "2022-01-01")
    end    = request.GET.get("end", datetime.utcnow().strftime("%Y-%m-%d"))
    min_trades = int(request.GET.get("min_trades", 3))

    combos = [(algo_id, asset) for algo_id in ALL_ALGO_IDS for asset in assets]

    def _run(algo_id, asset):
        try:
            r = _run_crypto_backtest(algo_id, asset, start, end, {})
            if r["num_trades"] < min_trades:
                return None
            sharpe = r["sharpe"]
            if not math.isfinite(sharpe):
                return None
            return {
                "algo": algo_id,
                "asset": asset,
                "bank": ALGO_REGISTRY[algo_id]["bank"],
                "name": ALGO_REGISTRY[algo_id]["name"],
                "sharpe": round(sharpe, 3),
                "total_return": round(r["total_return"], 2),
                "win_rate": round(r["win_rate"], 2),
                "max_drawdown": round(r["max_drawdown"], 2),
                "num_trades": r["num_trades"],
                "rank_score": round(r["total_return"] - 0.35 * abs(r["max_drawdown"]) + 0.05 * r["win_rate"], 3),
            }
        except Exception:
            return None

    results = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(_run, a, s): (a, s) for a, s in combos}
        for fut in as_completed(futures):
            row = fut.result()
            if row is not None:
                results.append(row)

    results.sort(key=lambda r: r["sharpe"], reverse=True)

    return JsonResponse({
        "as_of": end,
        "assets": assets,
        "algos": len(ALL_ALGO_IDS),
        "combos_run": len(combos),
        "results_returned": len(results),
        "results": results,
    })


# ── xAI API helpers ───────────────────────────────────────────────────────────

def _xai_parse_response(body: dict) -> str:
    """Extract text from xAI Responses API output — handles format variations."""
    # xAI Responses API: output[*].content[*].text  (type=output_text)
    try:
        for out in body.get("output", []):
            for chunk in out.get("content", []):
                if chunk.get("type") == "output_text" and chunk.get("text"):
                    return chunk["text"].strip()
    except (KeyError, TypeError):
        pass
    # Chat Completions fallback
    try:
        return body["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        pass
    raw = body.get("text") or body.get("response") or ""
    if isinstance(raw, str) and raw:
        return raw.strip()
    raise ValueError(f"Unrecognised xAI response shape — keys: {list(body.keys())}")


def _xai_responses_call(prompt: str, model: str, key: str) -> str:
    """Text-only Responses API call."""
    import urllib.request
    payload = json.dumps({"model": model, "input": prompt}).encode()
    req = urllib.request.Request(
        "https://api.x.ai/v1/responses",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=35) as resp:
        return _xai_parse_response(json.loads(resp.read()))


def _xai_vision_call(text_prompt: str, image_b64: str, model: str, key: str) -> str:
    """
    Multimodal Responses API call: image + text → analysis.
    image_b64: raw base64 string (no data: prefix — we add it).
    """
    import urllib.request
    # Detect image format from base64 header bytes
    import base64 as _b64
    header = _b64.b64decode(image_b64[:16] + "==")
    mime = "image/png" if header[:4] == b'\x89PNG' else "image/jpeg"

    payload = json.dumps({
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{image_b64}"},
                    },
                    {"type": "text", "text": text_prompt},
                ],
            }
        ],
    }).encode()
    req = urllib.request.Request(
        "https://api.x.ai/v1/responses",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        return _xai_parse_response(json.loads(resp.read()))


# ── /v1/ai/advice/ ────────────────────────────────────────────────────────────

@csrf_exempt
def sitrep(request):
    """
    POST /v1/ai/sitrep/
    Body: {
      "jedi": 12, "regime": "BULL", "long_algos": 18, "short_algos": 5,
      "model": "grok-4.20-reasoning", "full_context": true,
      "council_votes": {"NS":1, "CI":1, ...},
      "assets": [{"symbol":"BTC","jedi_score":18}, ...]   // all 130+ assets
    }
    Builds a comprehensive M3D battlefield SITREP and fires to Grok.
    full_context=true → include all classified assets in prompt (richer but longer).
    full_context=false → top/bottom 12 only (faster).
    """
    import urllib.request
    import urllib.error

    if request.method not in ("POST", "GET"):
        from django.http import HttpResponseNotAllowed
        return HttpResponseNotAllowed(["POST", "GET"])

    if request.method == "POST":
        body = _json_body(request)
    else:
        body = {}

    jedi        = body.get("jedi", int(request.GET.get("jedi", 0)))
    regime      = body.get("regime", request.GET.get("regime", "NEUTRAL"))
    long_algos  = body.get("long_algos", int(request.GET.get("long_algos", 0)))
    short_algos = body.get("short_algos", int(request.GET.get("short_algos", 0)))
    model       = body.get("model", request.GET.get("model", "grok-4.20-reasoning"))
    full_ctx    = body.get("full_context", True)
    assets_raw  = body.get("assets", [])           # list of {symbol, jedi_score}
    council_raw = body.get("council_votes", {})    # {algo_id: vote}

    # ── Classify assets into tiers ────────────────────────────────────────────
    tiers: dict = {"surge": [], "rising": [], "rumbling": [], "flat": [],
                   "fading": [], "crash": []}
    for a in assets_raw:
        sym = a.get("symbol", "?")
        j   = float(a.get("jedi_score", 0))
        if j > 12:       tiers["surge"].append((sym, j))
        elif j > 6:      tiers["rising"].append((sym, j))
        elif j > 2:      tiers["rumbling"].append((sym, j))
        elif j >= -2:    tiers["flat"].append((sym, j))
        elif j >= -6:    tiers["fading"].append((sym, j))
        else:            tiers["crash"].append((sym, j))

    def _fmt(lst, n=20):
        if not lst: return "none"
        top = sorted(lst, key=lambda x: -x[1])[:n]
        return ", ".join(f"{s}({j:+.0f})" for s, j in top)

    total_assets = len(assets_raw)

    # Council vote breakdown
    long_ids  = [k for k, v in council_raw.items() if v == 1]
    short_ids = [k for k, v in council_raw.items() if v == -1]
    flat_ids  = [k for k, v in council_raw.items() if v == 0]

    if full_ctx:
        asset_block = (
            f"🚀 SURGE  (JEDI>12, {len(tiers['surge'])} assets): {_fmt(tiers['surge'], 20)}\n"
            f"📈 RISING (JEDI 6-12, {len(tiers['rising'])} assets): {_fmt(tiers['rising'], 15)}\n"
            f"🌋 RUMBLE (JEDI 2-6, {len(tiers['rumbling'])} assets): {_fmt(tiers['rumbling'], 12)}\n"
            f"⬜ FLAT   ({len(tiers['flat'])} assets): {_fmt(tiers['flat'], 8)}\n"
            f"📉 FADING ({len(tiers['fading'])} assets): {_fmt(tiers['fading'], 10)}\n"
            f"💥 CRASH  (JEDI<-6, {len(tiers['crash'])} assets): {_fmt(tiers['crash'], 10)}\n"
        )
    else:
        # Abbreviated: just top/bottom 8
        asset_block = (
            f"TOP SURGE: {_fmt(tiers['surge'], 8)}\n"
            f"TOP RISING: {_fmt(tiers['rising'], 8)}\n"
            f"TOP CRASH: {_fmt(tiers['crash'], 8)}\n"
            f"({total_assets} assets tracked total)\n"
        )

    council_block = (
        f"LONG ({len(long_ids)}): {', '.join(long_ids[:12]) or 'none'}\n"
        f"SHORT ({len(short_ids)}): {', '.join(short_ids[:12]) or 'none'}\n"
        f"FLAT ({len(flat_ids)}): {len(flat_ids)} algos neutral\n"
    ) if council_raw else f"Council: {long_algos}L / {short_algos}S\n"

    prompt = (
        f"You are YODA — M3D battlefield commander. Full market SITREP requested.\n\n"
        f"COUNCIL STATE:\n"
        f"JEDI master score: {jedi}/27 | Regime: {regime}\n"
        f"{council_block}\n"
        f"MARKET SNAPSHOT ({total_assets} assets tracked):\n"
        f"{asset_block}\n"
        f"Deliver a 5-point SITREP in EXACTLY this format:\n"
        f"1. MARKET CHARACTER: [2-line description of current market condition]\n"
        f"2. PRIME OPPORTUNITY: [single best trade setup right now with asset + condition]\n"
        f"3. HIDDEN RISK: [the biggest danger that most traders are missing]\n"
        f"4. SECTOR ROTATION: [where money is moving — what's accumulating, what's being dumped]\n"
        f"5. POSTURE: [AGGRESSIVE/MODERATE/DEFENSIVE/CASH — with one-line rationale]\n\n"
        f"JEDI OVERRIDE: [if JEDI conflicts with any of the above, flag it here]\n"
        f"CONFIDENCE: [0-100]%"
    )

    xai_key = os.environ.get("API_XAI_YODA_KEY", "")
    if not xai_key:
        return JsonResponse({"ok": False, "sitrep": "", "error": "API_XAI_YODA_KEY not configured"})

    try:
        answer = _xai_responses_call(prompt, model, xai_key)
        return JsonResponse({
            "ok": True, "sitrep": answer, "model": model,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "assets_tracked": total_assets,
            "tiers": {k: len(v) for k, v in tiers.items()},
        })
    except (urllib.error.URLError, OSError) as exc:
        return JsonResponse({"ok": False, "sitrep": "", "error": f"xAI not reachable: {exc}"})
    except Exception as exc:
        logger.exception("SITREP error: %s", exc)
        return JsonResponse({"ok": False, "sitrep": "", "error": str(exc)})


@csrf_exempt
def chart_vision(request):
    """
    POST /v1/ai/vision/
    Body: {
      "image_b64": "<base64 PNG/JPEG>",     // chart screenshot
      "symbol": "BTC", "tf": "1h",
      "jedi": 12, "regime": "BULL",
      "model": "grok-4.20-reasoning"
    }
    Grok reads the chart image + M3D context, returns tactical analysis.
    2M context window — full chart visible to the model.
    """
    import urllib.request, urllib.error

    if request.method != "POST":
        from django.http import HttpResponseNotAllowed
        return HttpResponseNotAllowed(["POST"])

    body    = _json_body(request)
    img_b64 = body.get("image_b64", "")
    symbol  = body.get("symbol", "?").upper()
    tf      = body.get("tf", "1h")
    jedi    = body.get("jedi", 0)
    regime  = body.get("regime", "NEUTRAL")
    model   = body.get("model", "grok-4.20-reasoning")

    if not img_b64:
        return _err("image_b64 is required")

    prompt = (
        f"You are YODA — M3D quant analyst with chart vision capability.\n"
        f"Chart context: {symbol} on {tf} timeframe | JEDI score {jedi}/27 | Regime {regime}\n\n"
        f"Analyze this trading chart and provide:\n"
        f"1. TREND: Current trend direction + strength (1-10)\n"
        f"2. KEY LEVELS: Critical support/resistance visible on chart\n"
        f"3. PATTERN: Any recognisable chart pattern (name + reliability)\n"
        f"4. INDICATORS: What the visible indicators show (BB width, momentum, squeeze)\n"
        f"5. SIGNAL: LONG / FLAT / SHORT — with one-line entry condition\n"
        f"6. RISK: Key invalidation level\n\n"
        f"Cross-reference with M3D JEDI={jedi} council signal. Flag any divergence."
    )

    xai_key = os.environ.get("API_XAI_YODA_KEY", "")
    if not xai_key:
        return JsonResponse({"ok": False, "analysis": "", "error": "API_XAI_YODA_KEY not configured"})

    try:
        analysis = _xai_vision_call(prompt, img_b64, model, xai_key)
        return JsonResponse({
            "ok": True, "analysis": analysis,
            "symbol": symbol, "tf": tf, "model": model,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        })
    except (urllib.error.URLError, OSError) as exc:
        return JsonResponse({"ok": False, "analysis": "", "error": f"xAI not reachable: {exc}"})
    except Exception as exc:
        logger.exception("Chart vision error: %s", exc)
        return JsonResponse({"ok": False, "analysis": "", "error": str(exc)})


@csrf_exempt
def generate_image(request):
    """
    POST /v1/ai/image/
    Body: {"prompt": "...", "model": "aurora"}
    Returns {ok, url, b64_json} — xAI Aurora image generation.
    Use for site visuals: algo guardians, regime banners, JEDI orb art.
    """
    import urllib.request, urllib.error

    if request.method != "POST":
        from django.http import HttpResponseNotAllowed
        return HttpResponseNotAllowed(["POST"])

    body   = _json_body(request)
    prompt = body.get("prompt", "")
    model  = body.get("model", "aurora")
    n      = int(body.get("n", 1))

    if not prompt:
        return _err("prompt is required")

    xai_key = os.environ.get("API_XAI_YODA_KEY", "")
    if not xai_key:
        return JsonResponse({"ok": False, "error": "API_XAI_YODA_KEY not configured"})

    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "n": min(n, 4),
        "response_format": "url",
    }).encode()

    try:
        req = urllib.request.Request(
            "https://api.x.ai/v1/images/generations",
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {xai_key}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            body_resp = json.loads(resp.read())
        urls = [d.get("url", "") for d in body_resp.get("data", [])]
        return JsonResponse({"ok": True, "urls": urls, "model": model,
                             "timestamp": datetime.utcnow().isoformat() + "Z"})
    except (urllib.error.URLError, OSError) as exc:
        return JsonResponse({"ok": False, "urls": [], "error": f"xAI not reachable: {exc}"})
    except Exception as exc:
        logger.exception("Image generation error: %s", exc)
        return JsonResponse({"ok": False, "urls": [], "error": str(exc)})


@csrf_exempt
def batch_create(request):
    """
    POST /v1/ai/batch/
    Body: {"name": "m3d_overnight", "queries": ["q1","q2","q3","q4","sitrep"]}
    Creates a named xAI batch for overnight low-cost intel processing.
    Uses xai_sdk if available, else gracefully degrades.
    Each query runs with full M3D context injected at runtime.
    Returns {ok, batch_id, status, scheduled_qs}.
    """
    if request.method != "POST":
        from django.http import HttpResponseNotAllowed
        return HttpResponseNotAllowed(["POST"])

    body    = _json_body(request)
    name    = body.get("name", f"m3d_batch_{datetime.utcnow().strftime('%Y%m%d_%H%M')}")
    queries = body.get("queries", ["q1", "q2", "q3", "q4", "sitrep"])

    try:
        from xai_sdk import Client  # type: ignore
        client = Client(api_key=os.environ.get("API_XAI_YODA_KEY", ""))
        batch = client.batch.create(batch_name=name)
        return JsonResponse({
            "ok": True, "batch_id": str(batch),
            "name": name, "scheduled_qs": queries,
            "status": "created",
            "note": "Batch will process overnight at discounted rates",
        })
    except ImportError:
        return JsonResponse({
            "ok": False,
            "error": "xai_sdk not installed — run: pip install xai-sdk",
            "name": name, "scheduled_qs": queries,
        })
    except Exception as exc:
        logger.exception("Batch create error: %s", exc)
        return JsonResponse({"ok": False, "error": str(exc)})


@csrf_exempt
def maxcogviz_alpha(request):
    """
    POST /v1/ai/maxcogviz/
    THE MEGA QUERY — 12-dimensional structured market intelligence.
    Fires in parallel to: xAI Grok-4.20 + Claude Sonnet (optional) + Gemini (optional).
    Returns synthesised MAXCOGVIZ ALPHA JSON for radar visualization + 3D-ready output.

    Body: {
      "jedi": 12, "regime": "BULL", "long_algos": 18, "short_algos": 5,
      "models": ["grok", "claude", "gemini"],   // which models to query (default: ["grok"])
      "assets_snapshot": [{"symbol":"BTC","jedi_score":18},...],
      "council_votes": {"NS":1, ...}
    }

    12 ALPHA DIMENSIONS:
      macro_slope     – Yield curve, DXY, rate-of-change of macro indicators
      money_flow      – Where institutional capital is actually moving
      geopolitical    – War, sanctions, supply chain disruption, political risk
      pandemic        – Health events, economic shutdown risk, supply shock
      energy          – Oil, gas, rare earth, food → inflation driver
      central_bank    – Fed/ECB/BOJ/PBOC divergence, pivot probability
      crypto_native   – On-chain, ETF flows, halving, regulatory cycle
      sentiment_wave  – Fear/greed across 1d/1w/1m timeframes
      velocity        – Rate of change of all indicators (acceleration)
      black_swan      – Tail risk radar, known unknowns, 3σ events
      tech_disruption – AI displacement, sector disruption, creative destruction
      alpha_signal    – Synthesised across all 11 dimensions
    """
    import urllib.request, urllib.error
    from concurrent.futures import ThreadPoolExecutor, as_completed

    if request.method not in ("POST", "GET"):
        from django.http import HttpResponseNotAllowed
        return HttpResponseNotAllowed(["POST", "GET"])

    body = _json_body(request) if request.method == "POST" else {}

    jedi        = body.get("jedi", int(request.GET.get("jedi", 0)))
    regime      = body.get("regime", request.GET.get("regime", "NEUTRAL"))
    long_a      = body.get("long_algos", 0)
    short_a     = body.get("short_algos", 0)
    models_req  = body.get("models", ["grok"])
    assets_snap = body.get("assets_snapshot", [])
    council_raw = body.get("council_votes", {})

    # Build asset tier summary
    surge  = sorted([a for a in assets_snap if a.get("jedi_score",0) > 12],  key=lambda x: -x["jedi_score"])[:10]
    crash  = sorted([a for a in assets_snap if a.get("jedi_score",0) < -6],  key=lambda x:  x["jedi_score"])[:6]
    surge_str = ", ".join(f"{a['symbol']}({a['jedi_score']:+.0f})" for a in surge) or "none"
    crash_str = ", ".join(f"{a['symbol']}({a['jedi_score']:+.0f})" for a in crash) or "none"
    long_ids  = [k for k,v in council_raw.items() if v ==  1][:9]
    short_ids = [k for k,v in council_raw.items() if v == -1][:9]

    SCHEMA = '''{
  "timestamp": "<ISO-8601>",
  "alpha_composite": <-10 to +10, float>,
  "confidence": <0-100, int>,
  "posture": "<FULL_RISK_ON|RISK_ON|NEUTRAL|RISK_OFF|CRISIS>",
  "ground_slope": "<STEEP_RISE|RISING|FLAT|FALLING|CLIFF_EDGE>",

  "dimensions": {
    "macro_slope":    {"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>","horizon":"30d"},
    "money_flow":     {"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>","hot_sector":"<sector>"},
    "geopolitical":   {"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>","hotspot":"<region>"},
    "pandemic":       {"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>"},
    "energy":         {"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>","key_commodity":"<name>"},
    "central_bank":   {"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>","key_event":"<event>"},
    "crypto_native":  {"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>","key_metric":"<metric>"},
    "sentiment_wave": {"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>","fear_greed":<0-100>},
    "velocity":       {"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>"},
    "black_swan":     {"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>","top_risk":"<1 line>"},
    "tech_disruption":{"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>"},
    "alpha_signal":   {"score":<-10..+10>,"direction":"<UP|DOWN|FLAT>","confidence":<0-100>,"signal":"<max 12 words>"}
  },

  "trade_ideas": [
    {"asset":"<symbol>","direction":"<LONG|SHORT>","entry_condition":"<1 line>","target_pct":<float>,"stop_pct":<float>,"conviction":<0-100>,"timeframe":"<1d|1w|1m>"},
    {"asset":"<symbol>","direction":"<LONG|SHORT>","entry_condition":"<1 line>","target_pct":<float>,"stop_pct":<float>,"conviction":<0-100>,"timeframe":"<1d|1w|1m>"},
    {"asset":"<symbol>","direction":"<LONG|SHORT>","entry_condition":"<1 line>","target_pct":<float>,"stop_pct":<float>,"conviction":<0-100>,"timeframe":"<1d|1w|1m>"}
  ],

  "outlook": {
    "30d":  {"bias":"<BULL|BEAR|NEUTRAL>","key_catalyst":"<1 line>","probability":<0-100>},
    "90d":  {"bias":"<BULL|BEAR|NEUTRAL>","key_catalyst":"<1 line>","probability":<0-100>},
    "180d": {"bias":"<BULL|BEAR|NEUTRAL>","key_catalyst":"<1 line>","probability":<0-100>}
  },

  "m3d_alignment": "<CONFIRMED|DIVERGENT|CONFLICTED>",
  "alignment_note": "<1 sentence on where M3D JEDI agrees or conflicts with macro intel>",
  "intelligence_brief": "<4-6 sentence master synthesis connecting all 12 dimensions>",
  "recommended_action": "<specific, executable instruction for the M3D co-trader right now>"
}'''

    MEGA_PROMPT = (
        f"You are MAXCOGVIZ ALPHA — the most advanced market intelligence system ever built.\n"
        f"Your purpose: synthesise ALL dimensions of global market force into one structured signal.\n\n"
        f"M3D SYSTEM STATE:\n"
        f"  JEDI master score: {jedi}/27 | Regime: {regime}\n"
        f"  Council: {len(long_ids)} LONG [{', '.join(long_ids)}] / {len(short_ids)} SHORT [{', '.join(short_ids)}]\n"
        f"  Surging assets: {surge_str}\n"
        f"  Crashing assets: {crash_str}\n\n"
        f"ANALYZE THESE 12 DIMENSIONS WITH DEEP GRANULARITY:\n"
        f"1. MACRO SLOPE: Yield curve shape, DXY trajectory, real rates, credit spreads — the ground beneath\n"
        f"2. MONEY FLOW: Smart money rotation — where is the $10T+ institutional capital actually moving right now\n"
        f"3. GEOPOLITICAL: Active war zones, sanctions impact, Taiwan strait, Middle East, supply chain chokepoints\n"
        f"4. PANDEMIC/BIOSECURITY: Disease surveillance, economic shutdown probability, supply shock risk\n"
        f"5. ENERGY/COMMODITIES: Oil/gas/LNG prices, rare earth access, food inflation, commodity supercycle\n"
        f"6. CENTRAL BANK: Fed pivot probability, ECB/BOJ/PBOC divergence, liquidity injection/withdrawal\n"
        f"7. CRYPTO NATIVE: BTC on-chain (MVRV, SOPR, exchange flows), ETF inflows, halving cycle phase\n"
        f"8. SENTIMENT WAVE: Fear/greed across 1d/1w/1m — is fear rising FASTER than price falling (opportunity?)\n"
        f"9. VELOCITY: Rate-of-change of ALL above indicators — are they accelerating or decelerating\n"
        f"10. BLACK SWAN RADAR: Known unknowns, tail-risk probability, 3σ scenario planning\n"
        f"11. TECH DISRUPTION: AI displacement acceleration, sector rotation from tech disruption, creative destruction\n"
        f"12. ALPHA SIGNAL: Your synthesised signal across ALL 11 dimensions above\n\n"
        f"CRITICAL RULES:\n"
        f"- Return ONLY valid minified JSON matching this EXACT schema — no markdown, no explanation:\n"
        f"{SCHEMA}\n\n"
        f"Scores: -10 = maximum bearish/risk-off, +10 = maximum bullish/risk-on.\n"
        f"Be decisive. Real scores, not 0s. Use your full reasoning capability.\n"
        f"The co-trader's financial decisions depend on your accuracy."
    )

    xai_key = os.environ.get("API_XAI_YODA_KEY", "")

    # ── Run models in parallel ──────────────────────────────────────────────
    def _call_grok():
        if not xai_key:
            return "grok", None, "API_XAI_YODA_KEY not set"
        try:
            txt = _xai_responses_call(MEGA_PROMPT, "grok-4.20-reasoning", xai_key)
            return "grok", _parse_mcv_json(txt), None
        except Exception as exc:
            return "grok", None, str(exc)

    def _call_claude():
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            return "claude", None, "ANTHROPIC_API_KEY not set"
        try:
            import urllib.request as _ur
            payload = json.dumps({
                "model": "claude-sonnet-4-6",
                "max_tokens": 1500,
                "messages": [{"role": "user", "content": MEGA_PROMPT}],
            }).encode()
            req = _ur.Request(
                "https://api.anthropic.com/v1/messages",
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                },
                method="POST",
            )
            with _ur.urlopen(req, timeout=45) as resp:
                body = json.loads(resp.read())
            txt = body["content"][0]["text"]
            return "claude", _parse_mcv_json(txt), None
        except Exception as exc:
            return "claude", None, str(exc)

    def _call_gemini():
        key = os.environ.get("GOOGLE_GEMINI_KEY", "")
        if not key:
            return "gemini", None, "GOOGLE_GEMINI_KEY not set"
        try:
            import urllib.request as _ur
            payload = json.dumps({
                "contents": [{"parts": [{"text": MEGA_PROMPT}]}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1500},
            }).encode()
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}"
            req = _ur.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
            with _ur.urlopen(req, timeout=45) as resp:
                body = json.loads(resp.read())
            txt = body["candidates"][0]["content"]["parts"][0]["text"]
            return "gemini", _parse_mcv_json(txt), None
        except Exception as exc:
            return "gemini", None, str(exc)

    MODEL_FUNCS = {"grok": _call_grok, "claude": _call_claude, "gemini": _call_gemini}
    requested = [m for m in models_req if m in MODEL_FUNCS]
    if not requested:
        requested = ["grok"]

    model_results: dict = {}
    errors: dict = {}

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(MODEL_FUNCS[m]): m for m in requested}
        for fut in as_completed(futures):
            name, data, err = fut.result()
            if data:
                model_results[name] = data
            if err:
                errors[name] = err

    if not model_results:
        return JsonResponse({"ok": False, "error": f"All models failed: {errors}"}, status=503)

    # ── Synthesise: average scores across models if multiple responded ──────
    synthesised = _synthesise_mcv(model_results)

    # ── Persist hourly snapshot ───────────────────────────────────────────────
    _persist_mcv_snapshot(synthesised, jedi, regime)

    return JsonResponse({
        "ok": True,
        "synthesised": synthesised,
        "models_responded": list(model_results.keys()),
        "model_results": model_results,
        "errors": errors,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    })


def _parse_mcv_json(text: str) -> dict | None:
    """Extract and parse JSON from model response — strips markdown fences."""
    import re
    # Strip ```json ... ``` or ``` ... ``` fences
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text.strip(), flags=re.MULTILINE)
    # Find outermost {...}
    start = text.find('{')
    if start == -1:
        return None
    depth = 0
    for i, c in enumerate(text[start:], start):
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i+1])
                except json.JSONDecodeError:
                    return None
    return None


def _synthesise_mcv(results: dict) -> dict:
    """Average dimension scores across multiple model responses."""
    if len(results) == 1:
        return list(results.values())[0]

    # Average numeric fields in dimensions
    dims = {}
    all_dims = set()
    for r in results.values():
        all_dims.update(r.get("dimensions", {}).keys())

    for dim in all_dims:
        scores = [r["dimensions"][dim]["score"] for r in results.values() if dim in r.get("dimensions", {})]
        confs  = [r["dimensions"][dim]["confidence"] for r in results.values() if dim in r.get("dimensions", {})]
        # Use the Grok result's text fields as canonical
        canonical = next((r["dimensions"].get(dim, {}) for r in results.values() if "dimensions" in r), {})
        dims[dim] = {
            **canonical,
            "score":      round(sum(scores) / len(scores), 2),
            "confidence": round(sum(confs) / len(confs)),
        }

    # Average composite
    composites = [r.get("alpha_composite", 0) for r in results.values()]
    base = list(results.values())[0]
    return {
        **base,
        "dimensions": dims,
        "alpha_composite": round(sum(composites) / len(composites), 2),
        "multi_model": True,
        "model_count": len(results),
    }


def _persist_mcv_snapshot(data: dict, jedi: int, regime: str):
    """Append to hourly snapshot file (last 168 = 1 week)."""
    import pathlib
    snap_file = pathlib.Path(__file__).parent.parent / "data" / "maxcogviz_history.json"
    try:
        snap_file.parent.mkdir(exist_ok=True)
        history = json.loads(snap_file.read_text()) if snap_file.exists() else []
        history.append({
            "ts": datetime.utcnow().isoformat() + "Z",
            "jedi": jedi, "regime": regime,
            "alpha_composite": data.get("alpha_composite", 0),
            "ground_slope": data.get("ground_slope", "FLAT"),
            "posture": data.get("posture", "NEUTRAL"),
            "dimensions": {k: v.get("score", 0) for k, v in data.get("dimensions", {}).items()},
        })
        snap_file.write_text(json.dumps(history[-168:]))  # keep 1 week
    except Exception:
        pass


@csrf_exempt
def algo_weights_optimize(request):
    """
    POST /v1/algo/weights/optimize/
    Dynamic JEDI weight optimizer — MoE per strategy vote.

    Computes per-algo weights using layered methodology:
      Layer 1: Equal baseline (1/27)
      Layer 2: Regime × Bank multipliers (A=momentum, B=structure, C=swing)
      Layer 3: MAXCOGVIZ macro dimension adjustments (if provided)
      Layer 4: IC-based Bayesian update from backtest results (if provided)
      Layer 5: Confidence (MoE) — scale vote by signal strength

    Returns weighted JEDI alongside equal-weight JEDI for comparison.

    Body: {
      "regime": "BULL",
      "long_algos": 18, "short_algos": 5,
      "council_votes": {"NS": 1, "CI": 1, ...},
      "council_scores": {"NS": 0.82, "CI": 0.71, ...},  // signal confidence 0-1
      "mcv_dimensions": {"macro_slope": {"score": 4.2}, ...},  // from MAXCOGVIZ
      "backtest_results": {"NS": {"sharpe": 1.8, "win_rate": 58}, ...}  // optional IC
    }
    """
    if request.method not in ("POST",):
        from django.http import HttpResponseNotAllowed
        return HttpResponseNotAllowed(["POST"])

    body   = _json_body(request)
    regime = body.get("regime", "NEUTRAL")
    votes  = body.get("council_votes", {})
    scores = body.get("council_scores", {})   # signal confidence 0-1
    mcv    = body.get("mcv_dimensions", {})   # MAXCOGVIZ output
    bt     = body.get("backtest_results", {}) # {algo_id: {sharpe, win_rate}}

    # ── Layer 2: Regime × Bank multipliers ────────────────────────────────────
    # Rationale:
    #   BULL  → momentum algos (A) excel, swing (C) less relevant
    #   BEAR  → defensive swing (C) excels, pure momentum (A) dangerous
    #   NEUTRAL → structure algos (B) cut through noise best
    REGIME_BANK = {
        'BULL':    {'A': 1.30, 'B': 1.00, 'C': 0.70},
        'NEUTRAL': {'A': 0.90, 'B': 1.25, 'C': 1.00},
        'BEAR':    {'A': 0.55, 'B': 1.05, 'C': 1.45},
    }
    bank_mult = REGIME_BANK.get(regime, {'A': 1.0, 'B': 1.0, 'C': 1.0})

    weights: dict[str, float] = {}
    reasons: dict[str, list[str]] = {}

    for algo_id in ALL_ALGO_IDS:
        bank = ALGO_REGISTRY.get(algo_id, {}).get('bank', 'B')
        w = bank_mult.get(bank, 1.0)
        reasons[algo_id] = [f"regime={regime} bank={bank} ×{bank_mult.get(bank,1.0):.2f}"]
        weights[algo_id] = w

    # ── Layer 3: MAXCOGVIZ macro adjustments ──────────────────────────────────
    if mcv:
        def _dim(key): return float((mcv.get(key) or {}).get('score', 0))

        velocity  = _dim('velocity')
        geo       = _dim('geopolitical')
        money     = _dim('money_flow')
        black_sw  = _dim('black_swan')
        macro_sl  = _dim('macro_slope')
        sentiment = _dim('sentiment_wave')
        central_b = _dim('central_bank')

        for algo_id in ALL_ALGO_IDS:
            bank = ALGO_REGISTRY.get(algo_id, {}).get('bank', 'B')
            adj = 1.0

            if bank == 'A':  # BOOM — entry precision / momentum
                if money > 4:    adj *= 1.0 + (money - 4) * 0.04;  reasons[algo_id].append(f"💰flow+{money:.1f}")
                if velocity > 4: adj *= 1.0 + (velocity - 4) * 0.03; reasons[algo_id].append(f"⚡vel+{velocity:.1f}")
                if geo < -4:     adj *= max(0.4, 1.0 + geo * 0.04);   reasons[algo_id].append(f"⚔geo{geo:.1f}")
                if macro_sl < -3:adj *= max(0.5, 1.0 + macro_sl * 0.03); reasons[algo_id].append(f"🏔slope{macro_sl:.1f}")

            elif bank == 'B':  # STRAT — structure / positioning
                if black_sw > 4: adj *= 1.0 + (black_sw - 4) * 0.04; reasons[algo_id].append(f"🦢bswan+{black_sw:.1f}")
                if abs(geo) > 5: adj *= 1.0 + abs(geo) * 0.02;        reasons[algo_id].append(f"⚔geo±{abs(geo):.1f}")

            elif bank == 'C':  # LEGEND — swing / 1-6M
                if central_b < -3: adj *= 1.0 + abs(central_b) * 0.04; reasons[algo_id].append(f"🏦cb{central_b:.1f}")
                if sentiment < -4: adj *= 1.0 + abs(sentiment) * 0.03;  reasons[algo_id].append(f"🌊sent{sentiment:.1f}")
                if macro_sl < -5:  adj *= 1.2;                           reasons[algo_id].append("🏔cliff-defensive")

            weights[algo_id] *= adj

    # ── Layer 4: IC-based Bayesian update from backtests ──────────────────────
    if bt:
        for algo_id, m in bt.items():
            if algo_id not in weights:
                continue
            sharpe = float(m.get('sharpe', 0))
            wr     = float(m.get('win_rate', 50)) / 100
            # Approximate IC = sharpe × (win_rate - 0.5) × 2, clipped
            ic = max(-0.5, min(1.5, sharpe * (wr - 0.5) * 2))
            if ic > 0.1:
                mul = 1.0 + ic * 0.4
                weights[algo_id] *= mul
                reasons[algo_id].append(f"IC+{ic:.2f}")
            elif sharpe < -0.3:
                mul = max(0.2, 1.0 + sharpe * 0.25)
                weights[algo_id] *= mul
                reasons[algo_id].append(f"sharpe{sharpe:.2f}↓")

    # ── Layer 5: MoE confidence scaling ───────────────────────────────────────
    moe_weights: dict[str, float] = {}
    for algo_id in ALL_ALGO_IDS:
        confidence = float(scores.get(algo_id, 0.5))
        confidence = max(0.1, min(1.0, confidence))
        moe_weights[algo_id] = weights[algo_id] * confidence

    # ── Normalise both weight sets ─────────────────────────────────────────────
    def _norm(d):
        t = sum(d.values())
        return {k: round(v / t, 5) for k, v in d.items()} if t > 0 else d

    norm_weights     = _norm(weights)
    norm_moe_weights = _norm(moe_weights)

    # ── Weighted JEDI (scale to -27..+27) ────────────────────────────────────
    def _weighted_jedi(w, v):
        """w: normalised weights, v: votes dict"""
        s = sum(w.get(k, 1/27) * float(v.get(k, 0)) for k in ALL_ALGO_IDS)
        # s is in [-1, 1] range → scale to JEDI range
        return round(s * 27, 2)

    equal_jedi    = _weighted_jedi({k: 1/len(ALL_ALGO_IDS) for k in ALL_ALGO_IDS}, votes)
    weighted_jedi = _weighted_jedi(norm_weights, votes)
    moe_jedi      = _weighted_jedi(norm_moe_weights, votes)

    # ── Build boost/suppress summary ─────────────────────────────────────────
    sorted_w = sorted(norm_weights.items(), key=lambda x: x[1], reverse=True)
    equal_w  = 1 / len(ALL_ALGO_IDS)
    boosts   = [{"algo": k, "weight": w, "factor": round(w / equal_w, 2),
                 "bank": ALGO_REGISTRY.get(k, {}).get("bank", "?"),
                 "name": ALGO_REGISTRY.get(k, {}).get("name", k),
                 "reasons": reasons.get(k, [])}
                for k, w in sorted_w if w > equal_w * 1.1][:8]
    suppress = [{"algo": k, "weight": w, "factor": round(w / equal_w, 2),
                 "bank": ALGO_REGISTRY.get(k, {}).get("bank", "?"),
                 "name": ALGO_REGISTRY.get(k, {}).get("name", k),
                 "reasons": reasons.get(k, [])}
                for k, w in sorted_w if w < equal_w * 0.9][:8]

    # Full per-algo detail
    algo_detail = []
    for algo_id in ALL_ALGO_IDS:
        meta = ALGO_REGISTRY.get(algo_id, {})
        ew   = equal_w
        w    = norm_weights.get(algo_id, ew)
        mw   = norm_moe_weights.get(algo_id, ew)
        algo_detail.append({
            "id": algo_id,
            "bank": meta.get("bank", "?"),
            "name": meta.get("name", algo_id),
            "vote": int(votes.get(algo_id, 0)),
            "confidence": float(scores.get(algo_id, 0.5)),
            "equal_weight": round(ew, 5),
            "weight": w,
            "moe_weight": mw,
            "factor": round(w / ew, 3),
            "weighted_contrib": round(w * float(votes.get(algo_id, 0)), 5),
            "reasons": reasons.get(algo_id, []),
        })

    return JsonResponse({
        "ok": True,
        "regime": regime,
        "method": f"regime+{'mcv+' if mcv else ''}{'ic+' if bt else ''}moe",
        "bank_multipliers": bank_mult,
        "equal_jedi":    equal_jedi,
        "weighted_jedi": weighted_jedi,
        "moe_jedi":      moe_jedi,
        "jedi_delta":    round(weighted_jedi - equal_jedi, 2),
        "weights":       norm_weights,
        "moe_weights":   norm_moe_weights,
        "boosts":        boosts,
        "suppressions":  suppress,
        "algo_detail":   algo_detail,
        "timestamp":     datetime.utcnow().isoformat() + "Z",
    })


@require_GET
def pulse_latest(request):
    """
    GET /v1/ai/pulse/
    Returns the latest Grok Pulse triggers from ds/data/pulse_latest.json.
    Written by ds/grok_pulse.py daemon (every 60s).

    Query params:
      urgency=NOW,5MIN   — filter by urgency (comma-sep)
      direction=LONG     — filter by direction
      min_conf=60        — minimum confidence
      limit=20           — max triggers to return
    """
    import pathlib
    pulse_file = pathlib.Path(__file__).parent.parent / "data" / "pulse_latest.json"

    if not pulse_file.exists():
        return JsonResponse({
            "ok": True,
            "triggers": [],
            "runs": [],
            "last_updated": None,
            "daemon_running": False,
            "message": "Pulse daemon not yet run. Start: python ds/grok_pulse.py",
        })

    try:
        data = json.loads(pulse_file.read_text())
    except Exception as exc:
        return JsonResponse({"ok": False, "triggers": [], "error": str(exc)})

    triggers = data.get("triggers", [])

    # Filters
    urgency_filter = request.GET.get("urgency", "")
    direction_filter = request.GET.get("direction", "")
    min_conf = int(request.GET.get("min_conf", 0))
    limit = int(request.GET.get("limit", 50))

    if urgency_filter:
        allowed = {u.strip().upper() for u in urgency_filter.split(",")}
        triggers = [t for t in triggers if t.get("urgency") in allowed]
    if direction_filter:
        allowed_d = {d.strip().upper() for d in direction_filter.split(",")}
        triggers = [t for t in triggers if t.get("direction") in allowed_d]
    if min_conf:
        triggers = [t for t in triggers if t.get("confidence", 0) >= min_conf]

    triggers = triggers[:limit]

    # Freshness check — warn if last run > 3 minutes ago
    last_updated = data.get("last_updated")
    stale = False
    if last_updated:
        try:
            from datetime import timezone
            lu = datetime.fromisoformat(last_updated.replace("Z", "+00:00"))
            age_s = (datetime.now(timezone.utc) - lu).total_seconds()
            stale = age_s > 180
        except Exception:
            pass

    return JsonResponse({
        "ok": True,
        "triggers": triggers,
        "runs": data.get("runs", [])[:10],
        "last_updated": last_updated,
        "stale": stale,
        "daemon_running": not stale,
        "total": len(data.get("triggers", [])),
        "returned": len(triggers),
    })


@csrf_exempt
def pulse_trigger_now(request):
    """
    POST /v1/ai/pulse/run/
    Manually fire one pulse fetch synchronously (for testing / on-demand).
    """
    if request.method != "POST":
        from django.http import HttpResponseNotAllowed
        return HttpResponseNotAllowed(["POST"])

    import pathlib
    import sys

    # Import pulse module from ds/
    pulse_path = pathlib.Path(__file__).parent.parent
    if str(pulse_path) not in sys.path:
        sys.path.insert(0, str(pulse_path))

    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("grok_pulse", pulse_path / "grok_pulse.py")
        gp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gp)

        gp._load_env()
        api_key = os.environ.get("API_XAI_YODA_KEY", "")
        if not api_key:
            return _err("API_XAI_YODA_KEY not set")

        body = _json_body(request)
        watchlist = body.get("watchlist", gp.DEFAULT_WATCHLIST)

        triggers = gp.run_pulse(watchlist, api_key)
        return JsonResponse({
            "ok": True,
            "triggers": triggers,
            "count": len(triggers),
            "halo_ready": sum(1 for t in triggers if t.get("halo_auto")),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        })
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@require_GET
def maxcogviz_history(request):
    """GET /v1/ai/maxcogviz/history/ — last 168 hourly snapshots."""
    import pathlib
    snap_file = pathlib.Path(__file__).parent.parent / "data" / "maxcogviz_history.json"
    try:
        history = json.loads(snap_file.read_text()) if snap_file.exists() else []
        return JsonResponse({"ok": True, "history": history, "count": len(history)})
    except Exception as exc:
        return JsonResponse({"ok": False, "history": [], "error": str(exc)})


# ── /v1/ai/xsocial/ ──────────────────────────────────────────────────────────

@require_GET
def xsocial_latest(request):
    """
    GET /v1/ai/xsocial/
    Returns latest XSocial mega scan snapshot.
    Query params: ?stale_ok=1 to suppress staleness flag.
    """
    from .xsocial import load_latest
    import pathlib, time as _time
    snap = load_latest()
    if not snap:
        return JsonResponse({"ok": False, "error": "no_data", "assets": {}, "macro": {}})
    age = int(_time.time()) - snap.get("ts", 0)
    return JsonResponse({
        "ok": True,
        "assets": snap.get("assets", {}),
        "macro": snap.get("macro", {}),
        "ts": snap.get("ts"),
        "age_seconds": age,
        "stale": age > 300,
    })


@csrf_exempt
def xsocial_run(request):
    """
    POST /v1/ai/xsocial/run/
    Body (optional): {"watchlist": ["BTC","ETH",...]}
    Triggers a full mega scan immediately in-process.
    """
    if request.method not in ("POST", "GET"):
        return JsonResponse({"error": "method"}, status=405)
    body = _json_body(request)
    watchlist = body.get("watchlist") or None
    try:
        from .xsocial import run_mega_scan
        snap = run_mega_scan(watchlist=watchlist)
        return JsonResponse({"ok": True, "ts": snap["ts"], "count": len(snap["assets"])})
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@csrf_exempt
def xsocial_asset(request, symbol: str):
    """
    GET /v1/ai/xsocial/<symbol>/
    Returns XSocial scores for a single asset + pulse_signal float.
    """
    from .xsocial import load_latest, pulse_signal_for
    snap = load_latest()
    if not snap:
        return JsonResponse({"ok": False, "error": "no_data"})
    asset_data = snap.get("assets", {}).get(symbol.upper(), {})
    signal = pulse_signal_for(symbol.upper(), snap)
    return JsonResponse({"ok": True, "symbol": symbol.upper(),
                         "data": asset_data, "pulse_signal": signal})


# ── /v1/algo/holly/ ───────────────────────────────────────────────────────────

@require_GET
def holly_scan(request):
    """GET /v1/algo/holly/ — Holly EV scanner: top algos + live signals."""
    try:
        from .holly import run_holly
        top_k = int(request.GET.get("top_k", 3))
        result = run_holly(top_k=top_k)
        return JsonResponse({"ok": True, **result})
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc), "top_algos": [], "signals": {}}, status=500)


# ── /v1/algo/stat-arb/ ───────────────────────────────────────────────────────

@require_GET
def stat_arb_scan(request):
    """GET /v1/algo/stat-arb/ — Cointegration pairs scanner (ARB expert)."""
    try:
        from .stat_arb import run_stat_arb
        result = run_stat_arb()
        return JsonResponse({"ok": True, **result})
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc), "pairs": [], "signals": []}, status=500)


# ── /v1/algo/funding/ ────────────────────────────────────────────────────────

@require_GET
def funding_scan(request):
    """GET /v1/algo/funding/ — Live funding rate scanner across Binance+Bybit."""
    try:
        from .funding import run_funding_scan
        result = run_funding_scan()
        return JsonResponse({"ok": True, **result})
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc), "rows": [], "signals": []}, status=500)


# ── Risk Gate ─────────────────────────────────────────────────────────────────

@csrf_exempt
def risk_gate(request):
    """POST /v1/risk/gate/
    Body: { signals: [{ symbol, alpha, direction, confidence, regime, expert_weights, proposed_size? }] }
    Returns: { ok, results: [{ symbol, status, approved_size, reasons, checks }], portfolio, pods }
    """
    if request.method == "GET":
        from .risk_gate import gate_status_snapshot
        return JsonResponse({"ok": True, **gate_status_snapshot()})

    try:
        body = json.loads(request.body)
        from .risk_gate import AlphaSignal, run_gate, gate_status_snapshot
        raw = body.get("signals", [])
        signals = [
            AlphaSignal(
                symbol=s["symbol"],
                alpha=float(s["alpha"]),
                direction=s.get("direction", "FLAT"),
                confidence=float(s.get("confidence", 0.5)),
                regime=s.get("regime", "UNKNOWN"),
                expert_weights=s.get("expert_weights", {}),
                proposed_size=float(s.get("proposed_size", 0.02)),
            )
            for s in raw
        ]
        results = run_gate(signals)
        snap    = gate_status_snapshot()
        return JsonResponse({
            "ok": True,
            "results": [
                {
                    "symbol":        r.symbol,
                    "status":        r.status,
                    "approved_size": r.approved_size,
                    "reasons":       r.reasons,
                    "checks":        r.checks,
                }
                for r in results
            ],
            **snap,
        })
    except Exception as exc:
        logger.exception("risk_gate error")
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@csrf_exempt
def risk_pnl(request):
    """POST /v1/risk/pnl/ — Record realized PnL to update daily halt state.
    Body: { pnl_pct: -0.005 }
    GET  /v1/risk/pnl/ — returns current daily PnL state.
    """
    from .risk_gate import record_pnl, reset_halt, gate_status_snapshot
    if request.method == "GET":
        return JsonResponse({"ok": True, **gate_status_snapshot()})
    try:
        body = json.loads(request.body)
        if body.get("reset"):
            reset_halt()
        else:
            record_pnl(float(body.get("pnl_pct", 0.0)))
        return JsonResponse({"ok": True, **gate_status_snapshot()})
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@require_GET
def yoda_query(request):
    """
    GET /v1/ai/yoda/?q=q1&jedi=12&regime=BULL&long_algos=18&short_algos=5
                     &asset=BTC&surge_assets=BTC,ETH&rising_assets=SOL,BNB
    q: q1=ThreatMatrix | q2=FakeNewsPunisher | q3=SurgersSignal | q4=TradingConditions
    Uses xAI Grok (API_XAI_YODA_KEY) — rate limit: 2 req/min caller-side.
    Returns {ok, answer, q, timestamp}.
    """
    import urllib.request
    import urllib.error

    q          = request.GET.get("q", "q1")
    jedi       = request.GET.get("jedi", "0")
    regime     = request.GET.get("regime", "NEUTRAL")
    long_c     = request.GET.get("long_algos", "0")
    short_c    = request.GET.get("short_algos", "0")
    asset      = request.GET.get("asset", "BTC").upper()
    surge_list = request.GET.get("surge_assets", "")
    rising_list = request.GET.get("rising_assets", "")
    model      = request.GET.get("model", "grok-4.20-reasoning")

    # ── Strategic prompt library ──────────────────────────────────────────────
    prompts = {
        "q1": (
            "You are YODA — M3D strategic threat analyst. "
            f"Intel: JEDI={jedi}/27, regime={regime}, bulls={long_c}, bears={short_c}. "
            f"Surging: {surge_list or 'none'}. Rising: {rising_list or 'none'}.\n\n"
            "Respond in EXACTLY this format (3 bullets per section, 1 line each):\n"
            "🏔 ENEMY ON THE HILLS (macro/external threats):\n"
            "• [threat]\n• [threat]\n• [threat]\n\n"
            "🏕 ENEMY IN THE CAMP (internal/structural risks):\n"
            "• [risk]\n• [risk]\n• [risk]\n\n"
            "❓ KNOWN UNKNOWNS (intel gaps):\n"
            "• [unknown]\n• [unknown]\n• [unknown]\n\n"
            "THREAT LEVEL: [LOW/MEDIUM/HIGH/CRITICAL]\n"
            "ONE ACTION: [single most important thing to do now]"
        ),
        "q2": (
            "You are YODA — M3D fake news punisher and signal authenticator. "
            f"Intel: asset={asset}, regime={regime}, JEDI={jedi}/27.\n\n"
            "Analyze the current market narrative environment. Respond EXACTLY:\n"
            "📢 DOMINANT NARRATIVE: [what media/twitter is pushing right now]\n"
            "🎭 PUMPED (noise): [what's emotionally amplified, not data-driven]\n"
            "🔇 SUPPRESSED (signal): [what actually matters that's being ignored]\n"
            "🤖 GAMED SIGNAL: [any technical pattern being front-run or faked]\n"
            "NOISE SCORE: [0-100]% noise in current market narrative\n"
            "FILTER RULE: [one-line rule to cut through noise right now]"
        ),
        "q3": (
            "You are YODA — M3D momentum hunter. "
            f"Intel: JEDI={jedi}/27, regime={regime}, bulls={long_c}/27. "
            f"SURGING (JEDI>12): {surge_list or 'none'}. RISING (JEDI 6-12): {rising_list or 'none'}.\n\n"
            "Respond EXACTLY:\n"
            "🚀 SURGERS (breakout NOW):\n"
            "• [asset]: [1-line rationale]\n\n"
            "📈 RISERS (steady momentum):\n"
            "• [asset]: [1-line rationale]\n\n"
            "🌋 RUMBLINGS (early accumulation — watch list):\n"
            "• [asset/sector]: [1-line rationale]\n\n"
            "⚠ TRAPS (looks like surge but isn't):\n"
            "• [asset/pattern]: [why it's a trap]\n\n"
            "PRIME TRADE: [single best opportunity with entry condition]"
        ),
        "q4": (
            "You are YODA — M3D signal optimizer and trading conditions analyst. "
            f"System state: JEDI={jedi}/27, regime={regime}, "
            f"long_algos={long_c}, short_algos={short_c}, focus_asset={asset}.\n\n"
            "Iterative optimization brief — respond EXACTLY:\n"
            "CONDITIONS: [2-line description of current market character]\n"
            "OPTIMAL BANK: [A=BOOM/B=STRAT/C=LEGEND — which is in its element now + why]\n"
            "BEST TIMEFRAME: [1m/5m/15m/1h/4h/1d and why]\n"
            "SIGNAL QUALITY: [0-100]% clean signal vs noise right now\n"
            "ITER OPT #1: [single highest-value change to improve signal right now]\n"
            "ITER OPT #2: [second highest-value change]\n"
            "CONFIDENCE: [0-100]%"
        ),
    }

    prompt = prompts.get(q, prompts["q1"])

    xai_key = os.environ.get("API_XAI_YODA_KEY", "")
    if not xai_key:
        return JsonResponse({"ok": False, "answer": "", "q": q,
                             "error": "API_XAI_YODA_KEY not configured"})

    try:
        answer = _xai_responses_call(prompt, model, xai_key)
        return JsonResponse({
            "ok": True, "answer": answer, "q": q,
            "model": model, "timestamp": datetime.utcnow().isoformat() + "Z",
        })
    except (urllib.error.URLError, OSError) as exc:
        return JsonResponse({"ok": False, "answer": "", "q": q, "error": f"xAI not reachable: {exc}"})
    except Exception as exc:
        logger.exception("YODA query error: %s", exc)
        return JsonResponse({"ok": False, "answer": "", "q": q, "error": str(exc)})


@require_GET
def ai_advice(request):
    """
    GET /v1/ai/advice/?asset=BTC&jedi=12&regime=BULL&model=qwen2.5:14b
    Routes to local Ollama (qwen/gemma) or xAI Grok (grok-3 / grok-3-mini).
    Returns {advice, model, ok, sentiment_score}.

    sentiment_score: float -1.0 to +1.0 extracted from AI response.
    Safety-bracketed: weight capped at 35% of final signal blend.
    Ollama gracefully degrades if not running.
    """
    import urllib.request
    import urllib.error
    import re

    asset   = request.GET.get("asset", "BTC").upper()
    jedi    = request.GET.get("jedi", "0")
    regime  = request.GET.get("regime", "NEUTRAL")
    model   = request.GET.get("model", "qwen2.5:14b")
    long_c  = request.GET.get("long_algos", "0")
    short_c = request.GET.get("short_algos", "0")

    is_grok = model.startswith("grok-")

    # Grok gets an extra instruction to embed a sentiment score line
    sentiment_instruction = (
        "\nAt the end, on its own line write exactly: "
        "SENTIMENT: <number from -1.0 (extreme fear) to +1.0 (extreme greed)>"
    )

    prompt = (
        f"You are YODA, a quant trading analyst for the M3D system (27-algo council).\n"
        f"Current state: asset={asset}, JEDI score={jedi}/27, regime={regime}, "
        f"long_algos={long_c}, short_algos={short_c}.\n"
        f"Give a brief (3-4 bullet points) tactical assessment: "
        f"market posture, key risks, suggested action (long/flat/hedge), "
        f"and one algo to watch. Be concise and data-driven."
        + (sentiment_instruction if is_grok else "")
    )

    def _parse_sentiment(text: str) -> float | None:
        """Extract SENTIMENT: X.X from Grok response. Returns None if not found."""
        m = re.search(r"SENTIMENT:\s*([+-]?\d+(?:\.\d+)?)", text, re.IGNORECASE)
        if m:
            val = float(m.group(1))
            # clamp to [-1, 1]
            return max(-1.0, min(1.0, val))
        return None

    def _bracketed_sentiment(raw: float, jedi_val: int) -> float:
        """
        Safety-bracket the sentiment signal.
        - Base weight: 35% of blended signal
        - When |JEDI| > 10 (strong quant signal), reduce sentiment influence to 20%
        - When |JEDI| > 15 (very strong), reduce to 10% — quant overwhelms sentiment
        - Sentiment alone can NEVER flip a strong quant signal.
        Returns effective sentiment contribution in [-0.45, +0.45].
        """
        abs_j = abs(jedi_val)
        if abs_j > 15:
            cap = 0.10
        elif abs_j > 10:
            cap = 0.20
        else:
            cap = 0.35
        return max(-cap, min(cap, raw * cap))

    # ── xAI Grok path (Responses API) ────────────────────────────────────────
    if is_grok:
        xai_key = os.environ.get("API_XAI_YODA_KEY", "")
        if not xai_key:
            return JsonResponse({"ok": False, "advice": "", "sentiment_score": None,
                                 "error": "API_XAI_YODA_KEY not set in environment"})
        try:
            advice = _xai_responses_call(prompt, model, xai_key)
            raw_sent = _parse_sentiment(advice)
            sentiment = None
            if raw_sent is not None:
                try:
                    jedi_int = int(float(jedi))
                except ValueError:
                    jedi_int = 0
                sentiment = _bracketed_sentiment(raw_sent, jedi_int)
                advice = re.sub(r"\nSENTIMENT:.*$", "", advice, flags=re.IGNORECASE).strip()
            return JsonResponse({
                "ok": True, "advice": advice, "model": model,
                "sentiment_score": sentiment, "raw_sentiment": raw_sent,
            })
        except (urllib.error.URLError, OSError) as exc:
            return JsonResponse({"ok": False, "advice": "", "sentiment_score": None,
                                 "error": f"xAI API not reachable: {exc}"})
        except Exception as exc:
            logger.exception("xAI Grok advice error: %s", exc)
            return JsonResponse({"ok": False, "advice": "", "sentiment_score": None, "error": str(exc)})

    # ── Ollama path ───────────────────────────────────────────────────────────
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 280},
    }).encode()

    try:
        req = urllib.request.Request(
            "http://localhost:11434/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = json.loads(resp.read())
        advice = body.get("response", "").strip()
        return JsonResponse({"ok": True, "advice": advice, "model": model, "sentiment_score": None})
    except (urllib.error.URLError, OSError) as exc:
        return JsonResponse({"ok": False, "advice": "", "sentiment_score": None,
                             "error": f"Ollama not reachable: {exc}"})
    except Exception as exc:
        logger.exception("AI advice error: %s", exc)
        return JsonResponse({"ok": False, "advice": "", "sentiment_score": None, "error": str(exc)})


# ── Trade-Ideas Scanner ───────────────────────────────────────────────────────

@require_GET
def scanner_run(request):
    """GET /v1/scanner/?crypto=1&stocks=1 — full scan, returns top 100 alerts."""
    crypto = request.GET.get("crypto", "1") != "0"
    stocks = request.GET.get("stocks", "1") != "0"
    try:
        from .scanner import run_full_scan
        result = run_full_scan(crypto=crypto, stocks=stocks)
        return JsonResponse({"ok": True, **result})
    except Exception as exc:
        logger.exception("scanner_run")
        return JsonResponse({"ok": False, "error": str(exc), "alerts": []}, status=500)


@require_GET
def scanner_crypto(request):
    """GET /v1/scanner/crypto/ — crypto only scan."""
    try:
        from .scanner import run_crypto_scan
        alerts = run_crypto_scan()
        return JsonResponse({"ok": True, "alerts": alerts, "total": len(alerts), "ts": int(time.time())})
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc), "alerts": []}, status=500)


@require_GET
def scanner_stocks(request):
    """GET /v1/scanner/stocks/ — stock watchlist scan via Alpaca."""
    try:
        from .scanner import run_stock_scan
        alerts = run_stock_scan()
        return JsonResponse({"ok": True, "alerts": alerts, "total": len(alerts), "ts": int(time.time())})
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc), "alerts": []}, status=500)


# ── Futures / Crypto DB (Databento + Binance) ────────────────────────────────

import sqlite3 as _sqlite3
from datetime import timezone
_FUTURES_DB = pathlib.Path(__file__).parent.parent / "data" / "futures.db"


@require_GET
def bars_symbols(request):
    """GET /v1/bars/symbols/ — list all symbols and bar counts in futures.db"""
    if not _FUTURES_DB.exists():
        return JsonResponse({"ok": False, "error": "futures.db not found"}, status=404)
    conn = _sqlite3.connect(_FUTURES_DB)
    result = {}
    for tf in ("1m", "5m"):
        try:
            rows = conn.execute(
                f"SELECT symbol, COUNT(*), MIN(ts), MAX(ts) FROM bars_{tf} GROUP BY symbol ORDER BY symbol"
            ).fetchall()
            result[tf] = [
                {"symbol": sym, "bars": cnt,
                 "from": datetime.fromtimestamp(f, tz=timezone.utc).strftime("%Y-%m-%d"),
                 "to":   datetime.fromtimestamp(l, tz=timezone.utc).strftime("%Y-%m-%d")}
                for sym, cnt, f, l in rows
            ]
        except Exception:
            result[tf] = []
    conn.close()
    total = sum(r["bars"] for tf_rows in result.values() for r in tf_rows)
    db_mb = round(_FUTURES_DB.stat().st_size / 1024 / 1024, 1)
    return JsonResponse({"ok": True, "symbols": result, "total_bars": total, "db_mb": db_mb})


@require_GET
def bars_query(request):
    """GET /v1/bars/?symbol=BTC&tf=5m&from=2024-01-01&to=2024-06-01&limit=500"""
    if not _FUTURES_DB.exists():
        return JsonResponse({"ok": False, "error": "futures.db not found"}, status=404)
    sym   = request.GET.get("symbol", "BTC").upper()
    tf    = request.GET.get("tf", "5m")
    limit = int(request.GET.get("limit", 500))
    from_dt = request.GET.get("from")
    to_dt   = request.GET.get("to")
    table = f"bars_{tf}"
    try:
        conn = _sqlite3.connect(_FUTURES_DB)
        q = f"SELECT ts,open,high,low,close,volume FROM {table} WHERE symbol=?"
        params: list = [sym]
        if from_dt:
            params.append(int(datetime.strptime(from_dt, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()))
            q += " AND ts>=?"
        if to_dt:
            params.append(int(datetime.strptime(to_dt, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()))
            q += " AND ts<=?"
        q += f" ORDER BY ts DESC LIMIT {limit}"
        rows = conn.execute(q, params).fetchall()
        conn.close()
        bars = [{"ts": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in reversed(rows)]
        return JsonResponse({"ok": True, "symbol": sym, "tf": tf, "bars": bars, "count": len(bars)})
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@require_GET
def bars_fetch(request):
    """GET /v1/bars/fetch/?sym=ZB&years=2 — trigger Databento fetch for a new symbol"""
    sym   = request.GET.get("sym", "").upper()
    years = int(request.GET.get("years", 2))
    if not sym:
        return JsonResponse({"ok": False, "error": "sym required"}, status=400)
    try:
        from .databento_fetch import fetch_symbol, SYMBOLS
        from datetime import date, timedelta
        if sym not in SYMBOLS:
            return JsonResponse({"ok": False, "error": f"Unknown: {sym}. Available: {list(SYMBOLS.keys())}"}, status=400)
        end   = str(date.today() - timedelta(days=1))
        start = str(date.today() - timedelta(days=365 * years))
        n = fetch_symbol(sym, start, end, dry_run=False)
        return JsonResponse({"ok": True, "symbol": sym, "bars_added": n})
    except Exception as exc:
        logger.exception("bars_fetch")
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Star-Ray Optimizer API ─────────────────────────────────────────────────────
_STAR_REPORT = pathlib.Path(__file__).parent.parent / "data" / "star_report.json"

@require_GET
def star_report(request):
    """GET /api/star-report/ — serve cached star_report.json"""
    if not _STAR_REPORT.exists():
        return JsonResponse({"ok": False, "error": "No report. Run: python ds_app/star_optimizer.py"}, status=404)
    try:
        data = json.loads(_STAR_REPORT.read_text())
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def star_rerun(request):
    """POST /api/star-rerun/?horizon=4h — trigger star_optimizer.py in background"""
    import subprocess, sys
    horizon = request.GET.get("horizon", "4h")
    script  = pathlib.Path(__file__).parent / "star_optimizer.py"
    try:
        subprocess.Popen(
            [sys.executable, str(script), "--horizon", horizon],
            cwd=str(script.parent.parent),
        )
        resp = JsonResponse({"ok": True, "message": f"star_optimizer.py launched (horizon={horizon})"})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── PCA + Ensemble ────────────────────────────────────────────────────────────
_PCA_REPORT      = pathlib.Path(__file__).parent.parent / "data" / "pca_report.json"
_ENSEMBLE_REPORT = pathlib.Path(__file__).parent.parent / "data" / "ensemble_report.json"


def _serve_json(path: pathlib.Path, run_hint: str):
    if not path.exists():
        return JsonResponse({"ok": False, "error": f"No report. Run: {run_hint}"}, status=404)
    try:
        data = json.loads(path.read_text())
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@require_GET
def pca_report(request):
    """GET /v1/ai/pca/ — PCA report on 23-signal return matrix"""
    return _serve_json(_PCA_REPORT, "python ds_app/pca_signals.py")


@require_GET
def ensemble_report(request):
    """GET /v1/ai/ensemble/ — Sharpe-weighted vs equal-weight ensemble"""
    return _serve_json(_ENSEMBLE_REPORT, "python ds_app/sharpe_ensemble.py")


def pca_run(request):
    """POST /v1/ai/pca/run/ — trigger pca_signals.py in background"""
    import subprocess, sys
    script = pathlib.Path(__file__).parent / "pca_signals.py"
    try:
        subprocess.Popen([sys.executable, str(script)], cwd=str(script.parent.parent))
        resp = JsonResponse({"ok": True, "message": "pca_signals.py launched"})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def ensemble_run(request):
    """POST /v1/ai/ensemble/run/ — trigger sharpe_ensemble.py in background"""
    import subprocess, sys
    script = pathlib.Path(__file__).parent / "sharpe_ensemble.py"
    try:
        subprocess.Popen([sys.executable, str(script)], cwd=str(script.parent.parent))
        resp = JsonResponse({"ok": True, "message": "sharpe_ensemble.py launched"})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── XAIGROK Activity Gate ─────────────────────────────────────────────────────
_ACTIVITY_REPORT = pathlib.Path(__file__).parent.parent / "data" / "activity_report.json"


@require_GET
def sentiment_pulse(request):
    """GET /v1/ai/sentiment/ — latest pulse reading + computed trend"""
    try:
        from .xaigrok_activity import compute_sentiment_trend, pulse_grok, SENTIMENT_DB
        refresh = request.GET.get("refresh") == "1"
        if refresh:
            pulse_grok()   # fire one reading immediately, non-blocking enough for a single call
        trend = compute_sentiment_trend(n=int(request.GET.get("n", 12)))
        resp = JsonResponse({"ok": True, "trend": trend, "db": str(SENTIMENT_DB)})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@require_GET
def activity_current(request):
    """GET /v1/ai/activity/ — current market activity score + gate status"""
    if not _ACTIVITY_REPORT.exists():
        return JsonResponse(
            {"ok": False, "error": "No report. Run: python ds_app/xaigrok_activity.py --no-historical"},
            status=404,
        )
    try:
        data = json.loads(_ACTIVITY_REPORT.read_text())
        from .xaigrok_activity import compute_sentiment_trend
        trend = compute_sentiment_trend(n=12)
        resp = JsonResponse({
            "ok": True,
            "current": data.get("current", {}),
            "thresholds": data.get("thresholds", {}),
            "grok_raw": data.get("grok_raw"),
            "trend": trend,
            "ts": data.get("ts"),
            "generated_at": data.get("generated_at"),
        })
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@require_GET
def activity_report_view(request):
    """GET /v1/ai/activity/report/ — full historical quintile analysis"""
    if not _ACTIVITY_REPORT.exists():
        return JsonResponse(
            {"ok": False, "error": "No report. Run: python ds_app/xaigrok_activity.py"},
            status=404,
        )
    try:
        data = json.loads(_ACTIVITY_REPORT.read_text())
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def activity_run(request):
    """POST /v1/ai/activity/run/ — trigger xaigrok_activity.py in background"""
    import subprocess, sys
    no_grok = request.GET.get("no_grok", "0") == "1"
    script  = pathlib.Path(__file__).parent / "xaigrok_activity.py"
    cmd = [sys.executable, str(script)]
    if no_grok:
        cmd.append("--no-grok")
    try:
        subprocess.Popen(cmd, cwd=str(script.parent.parent))
        resp = JsonResponse({"ok": True, "message": "xaigrok_activity.py launched"})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Cross-Asset Spread Engine ─────────────────────────────────────────────────

_CROSS_ASSET_REPORT = pathlib.Path(__file__).parent.parent / "data" / "cross_asset_report.json"


@require_GET
def cross_asset_report(request):
    """GET /v1/cross/report/ — latest cross-asset spread dimensions"""
    if not _CROSS_ASSET_REPORT.exists():
        return JsonResponse({"ok": False, "error": "No report. Run: POST /v1/cross/run/"}, status=404)
    try:
        data = json.loads(_CROSS_ASSET_REPORT.read_text())
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def cross_asset_run(request):
    """POST /v1/cross/run/ — recompute cross-asset report (sync, fast ~1s)"""
    try:
        from .cross_asset import run_cross_asset
        report = run_cross_asset()
        resp = JsonResponse(report)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Walk-Forward Validation ───────────────────────────────────────────────────

_WF_REPORT = pathlib.Path(__file__).parent.parent / "data" / "walkforward_report.json"


@require_GET
def walkforward_report(request):
    """GET /v1/walkforward/ — latest walk-forward validation report"""
    if not _WF_REPORT.exists():
        return JsonResponse({"ok": False, "error": "No report. POST /v1/walkforward/run/"}, status=404)
    try:
        data = json.loads(_WF_REPORT.read_text())
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def walkforward_run(request):
    """POST /v1/walkforward/run/ — run walk-forward engine (async ~60s)"""
    import subprocess, sys
    script = pathlib.Path(__file__).parent / "walkforward.py"
    try:
        subprocess.Popen([sys.executable, str(script)], cwd=str(script.parent.parent))
        resp = JsonResponse({"ok": True, "message": "walkforward.py launched (~60s)"})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Trade Quality Gate ────────────────────────────────────────────────────────

_GATE_REPORT = pathlib.Path(__file__).parent.parent / "data" / "gate_report.json"


@require_GET
def gate_report(request):
    """GET /v1/gate/report/ — latest trade quality gate backtest report"""
    if not _GATE_REPORT.exists():
        return JsonResponse({"ok": False, "error": "No report. POST /v1/gate/run/"}, status=404)
    try:
        data = json.loads(_GATE_REPORT.read_text())
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def gate_run(request):
    """POST /v1/gate/run/ — run trade quality gate backtest (async ~5min)"""
    import subprocess, sys
    script = pathlib.Path(__file__).parent / "trade_quality_gate.py"
    try:
        subprocess.Popen([sys.executable, str(script)], cwd=str(script.parent.parent))
        resp = JsonResponse({"ok": True, "message": "trade_quality_gate.py launched (~5min)"})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Delta Ops Position Manager ────────────────────────────────────────────────

_DELTA_REPORT = pathlib.Path(__file__).parent.parent / "data" / "delta_ops_report.json"


@require_GET
def delta_ops_report(request):
    """GET /v1/delta/report/ — latest Delta Ops simulation report"""
    if not _DELTA_REPORT.exists():
        return JsonResponse({"ok": False, "error": "No report. POST /v1/delta/run/"}, status=404)
    try:
        data = json.loads(_DELTA_REPORT.read_text())
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def delta_ops_run(request):
    """POST /v1/delta/run/?mode=PADAWAN|NORMAL|EUPHORIA"""
    import subprocess, sys
    mode = request.GET.get("mode", "PADAWAN").upper()
    if mode not in ("PADAWAN", "NORMAL", "EUPHORIA", "MAX"):
        return JsonResponse({"ok": False, "error": "mode must be PADAWAN|NORMAL|EUPHORIA"}, status=400)
    script = pathlib.Path(__file__).parent / "delta_ops.py"
    try:
        subprocess.Popen([sys.executable, str(script), "--mode", mode],
                         cwd=str(script.parent.parent))
        resp = JsonResponse({"ok": True, "message": f"delta_ops.py launched mode={mode} (~5min)"})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


_HOLDOUT_REPORT = pathlib.Path(__file__).parent.parent / "data" / "holdout_report.json"


def holdout_report(request):
    """GET /v1/holdout/ — re-entry holdout validation results"""
    if not _HOLDOUT_REPORT.exists():
        return JsonResponse({"ok": False, "error": "No report. POST /v1/holdout/run/"}, status=404)
    try:
        data = json.loads(_HOLDOUT_REPORT.read_text())
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def holdout_run(request):
    """POST /v1/holdout/run/?mode=PADAWAN — run holdout validation"""
    import subprocess, sys
    mode = request.GET.get("mode", "PADAWAN").upper()
    if mode not in ("PADAWAN", "NORMAL", "EUPHORIA", "MAX"):
        return JsonResponse({"ok": False, "error": "mode must be PADAWAN|NORMAL|EUPHORIA"}, status=400)
    script = pathlib.Path(__file__).parent / "delta_ops.py"
    try:
        subprocess.Popen([sys.executable, str(script), "--mode", mode, "--holdout"],
                         cwd=str(script.parent.parent))
        resp = JsonResponse({"ok": True, "message": f"holdout validation launched mode={mode} (~3min)"})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Alpaca Paper Trading Adapter ──────────────────────────────────────────────

@require_GET
def paper_status(request):
    """GET /v1/paper/status/ — account + open positions + recent trades"""
    try:
        from ds_app.alpaca_paper import get_status
        data = get_status()
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def paper_run(request):
    """POST /v1/paper/run/?mode=PADAWAN&dry=1 — run one trade cycle"""
    mode    = request.GET.get("mode", "PADAWAN").upper()
    dry_run = request.GET.get("dry", "0") == "1"
    if mode not in ("PADAWAN", "NORMAL", "EUPHORIA", "MAX"):
        return JsonResponse({"ok": False, "error": "mode must be PADAWAN|NORMAL|EUPHORIA"}, status=400)
    try:
        from ds_app.alpaca_paper import run_cycle
        result = run_cycle(mode, dry_run=dry_run)
        resp = JsonResponse(result)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@require_GET
def paper_score(request):
    """GET /v1/paper/score/?symbol=BTC — live score for one symbol"""
    symbol = request.GET.get("symbol", "BTC").upper()
    try:
        from ds_app.alpaca_paper import load_bars, score_symbol, check_gates
        from ds_app.delta_ops import PADAWAN
        df = load_bars(symbol)
        if df is None:
            return JsonResponse({"ok": False, "error": f"No bars for {symbol}"}, status=404)
        sc = score_symbol(df)
        gates_pass, killed = check_gates(sc, PADAWAN)
        sc["gates_pass"] = gates_pass
        sc["gates_killed"] = killed
        sc.pop("votes", None)
        resp = JsonResponse({"symbol": symbol, **sc})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Cost-Adjusted Sharpe ──────────────────────────────────────────────────────

@require_GET
def cost_adjust(request):
    """GET /v1/cost/adjust/?sharpe=15.86&n_trades=1310 — cost-adjusted Sharpe estimate"""
    try:
        from ds_app.cost_model import augment_report, ROUND_TRIP_COST, SLIPPAGE_PCT, COMMISSION_PCT
        raw_sharpe = float(request.GET.get("sharpe", 0))
        n_trades   = int(request.GET.get("n_trades", 0))
        rep = augment_report({"sharpe": raw_sharpe, "n_trades": n_trades})
        rep["cost_model"]["round_trip_pct"] = round(ROUND_TRIP_COST * 100, 3)
        resp = JsonResponse(rep["cost_model"])
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── MTF Confirmation Layer ────────────────────────────────────────────────────

@require_GET
def mtf_scan(request):
    """GET /v1/mtf/?symbol=BTC&side=buy — MTF confirmation for symbol"""
    symbol = request.GET.get("symbol", "").upper()
    side   = request.GET.get("side", "buy").lower()
    if not symbol:
        return JsonResponse({"ok": False, "error": "symbol required"}, status=400)
    try:
        from ds_app.mtf_confirm import mtf_confirm
        mtf, mult = mtf_confirm(symbol, side)
        resp = JsonResponse({"symbol": symbol, "side": side, "mtf": mtf, "size_mult": mult})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── IBKR Paper Trading ────────────────────────────────────────────────────────

@require_GET
def ibkr_test(request):
    """GET /v1/ibkr/test/ — test TWS/Gateway connection"""
    try:
        from ds_app.ibkr_paper import test_connection
        data = test_connection()
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@require_GET
def ibkr_status(request):
    """GET /v1/ibkr/status/ — account + positions + trade log"""
    try:
        from ds_app.ibkr_paper import get_status
        data = get_status()
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def ibkr_run(request):
    """POST /v1/ibkr/run/?mode=PADAWAN&asset=FUTURES&dry=1"""
    mode  = request.GET.get("mode",  "PADAWAN").upper()
    asset = request.GET.get("asset", "FUTURES").upper()
    dry   = request.GET.get("dry",   "0") == "1"
    if mode not in ("PADAWAN", "NORMAL", "EUPHORIA", "MAX"):
        return JsonResponse({"ok": False, "error": "mode must be PADAWAN|NORMAL|EUPHORIA|MAX"}, status=400)
    if asset not in ("CRYPTO", "FUTURES", "STOCKS"):
        return JsonResponse({"ok": False, "error": "asset must be CRYPTO|FUTURES|STOCKS"}, status=400)
    try:
        from ds_app.ibkr_paper import run_cycle
        result = run_cycle(mode, asset, dry_run=dry)
        resp = JsonResponse(result)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@require_GET
def ibkr_score(request):
    """GET /v1/ibkr/score/?symbol=BTC — live score (no order placed)"""
    symbol = request.GET.get("symbol", "BTC").upper()
    try:
        from ds_app.alpaca_paper import load_bars, score_symbol, check_gates
        from ds_app.delta_ops import PADAWAN
        from ds_app.obi_signal import get_obi
        df = load_bars(symbol)
        if df is None:
            return JsonResponse({"ok": False, "error": f"No bars for {symbol}"}, status=404)
        sc = score_symbol(df)
        gates_pass, killed = check_gates(sc, PADAWAN)
        sc["gates_pass"]   = gates_pass
        sc["gates_killed"] = killed
        sc.pop("votes", None)
        try:
            sc["obi"] = get_obi(symbol)
        except Exception:
            pass
        resp = JsonResponse({"symbol": symbol, **sc})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── OBI Signal ────────────────────────────────────────────────────────────────

@require_GET
def obi_scan(request):
    """GET /v1/obi/?symbol=BTC — order book imbalance signal"""
    symbol = request.GET.get("symbol", "").upper()
    try:
        from ds_app.obi_signal import get_obi, get_all_obi
        if symbol:
            data = get_obi(symbol)
        else:
            data = get_all_obi()
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Funding Rate Signal ───────────────────────────────────────────────────────

@require_GET
def funding_signals(request):
    """GET /v1/funding/signals/ — cached funding rate signals for all tracked symbols"""
    try:
        from ds_app.funding_signal import get_all_signals
        sigs = get_all_signals()
        resp = JsonResponse({"signals": sigs, "count": len(sigs)})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def funding_refresh(request):
    """POST /v1/funding/refresh/ — force-refresh funding rates from Binance"""
    try:
        from ds_app.funding_signal import refresh_funding
        data = refresh_funding()
        resp = JsonResponse({"ok": True, "count": len(data.get("signals", {}))})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── IC Decay Monitor ──────────────────────────────────────────────────────────

_IC_REPORT = pathlib.Path(__file__).parent.parent / "data" / "ic_monitor.json"


@require_GET
def ic_report(request):
    """GET /v1/ic/report/ — rolling IC decay report per signal"""
    if not _IC_REPORT.exists():
        return JsonResponse({"ok": False, "error": "No report. POST /v1/ic/run/"}, status=404)
    try:
        data = json.loads(_IC_REPORT.read_text())
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def ic_run(request):
    """POST /v1/ic/run/ — compute rolling IC decay (~30s)"""
    import subprocess, sys
    script = pathlib.Path(__file__).parent / "ic_monitor.py"
    try:
        subprocess.Popen([sys.executable, str(script)], cwd=str(script.parent.parent))
        resp = JsonResponse({"ok": True, "message": "ic_monitor.py launched (~30s)"})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── HMM Regime Posterior ──────────────────────────────────────────────────────

_HMM_REPORT = pathlib.Path(__file__).parent.parent / "data" / "hmm_regime.json"


@require_GET
def hmm_report(request):
    """GET /v1/hmm/report/ — latest HMM fit report"""
    if not _HMM_REPORT.exists():
        return JsonResponse({"ok": False, "error": "No report. POST /v1/hmm/fit/"}, status=404)
    try:
        data = json.loads(_HMM_REPORT.read_text())
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def hmm_fit(request):
    """POST /v1/hmm/fit/?symbols=BTC,ETH — (re)fit HMM models (async, ~2min)"""
    import subprocess, sys
    syms_raw = request.GET.get("symbols", "")
    syms_arg = syms_raw.split(",") if syms_raw else []
    script   = pathlib.Path(__file__).parent / "hmm_regime.py"
    try:
        cmd = [sys.executable, str(script)] + syms_arg
        subprocess.Popen(cmd, cwd=str(script.parent.parent))
        resp = JsonResponse({"ok": True, "message": f"hmm_regime.py launched symbols={syms_arg or 'all'} (~2min per symbol)"})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@require_GET
def hmm_proba(request):
    """GET /v1/hmm/proba/?symbol=BTC — live regime probability vector"""
    symbol = request.GET.get("symbol", "BTC").upper()
    try:
        from ds_app.hmm_regime import posterior_proba
        from ds_app.alpaca_paper import load_bars
        df = load_bars(symbol)
        if df is None:
            return JsonResponse({"ok": False, "error": f"No bars for {symbol}"}, status=404)
        proba = posterior_proba(df, symbol)
        resp = JsonResponse({"symbol": symbol, "probabilities": proba})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── IC Half-Life Tracker (P3-B) ────────────────────────────────────────────────

def ic_halflife_report(request):
    """GET /v1/ic/halflife/ — latest IC half-life report (cached)"""
    try:
        from ds_app.ic_halflife import load_latest
        data = load_latest()
        if data is None:
            return JsonResponse({"ok": False, "error": "No report — POST /v1/ic/halflife/run/ first"}, status=404)
        resp = JsonResponse({"ok": True, **data})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def ic_halflife_run(request):
    """POST /v1/ic/halflife/run/ — compute IC half-life for all signals"""
    if request.method not in ("POST", "GET"):
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        from ds_app.ic_halflife import run
        data = run()
        resp = JsonResponse({"ok": True, **data})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Capacity / Turnover Model (P3-C) ──────────────────────────────────────────

def capacity_report(request):
    """GET /v1/capacity/ — latest liquidity capacity report (cached)"""
    try:
        from ds_app.capacity_model import load_latest
        data = load_latest()
        if data is None:
            return JsonResponse({"ok": False, "error": "No report — POST /v1/capacity/run/ first"}, status=404)
        resp = JsonResponse({"ok": True, **data})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def capacity_run(request):
    """POST /v1/capacity/run/?symbols=BTC,ETH — run capacity model"""
    if request.method not in ("POST", "GET"):
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        from ds_app.capacity_model import run
        syms_raw = request.GET.get("symbols", "")
        syms = [s.strip().upper() for s in syms_raw.split(",") if s.strip()] or None
        data = run(syms)
        resp = JsonResponse({"ok": True, **data})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Signal Discovery Engine (P3-A) ────────────────────────────────────────────

def discovery_report(request):
    """GET /v1/discovery/ — latest signal discovery report (cached)"""
    try:
        from ds_app.signal_discovery import load_latest
        data = load_latest()
        if data is None:
            return JsonResponse({"ok": False, "error": "No report — POST /v1/discovery/run/ first"}, status=404)
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def discovery_run(request):
    """POST /v1/discovery/run/?symbol=BTC&lag=12 — run signal discovery"""
    if request.method not in ("POST", "GET"):
        return JsonResponse({"error": "POST required"}, status=405)
    try:
        from ds_app.signal_discovery import run
        symbol = request.GET.get("symbol", "BTC").upper()
        lag    = int(request.GET.get("lag", "12"))
        data   = run(symbol, lag)
        resp   = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Open Interest Signal ───────────────────────────────────────────────────────

def oi_report(request):
    """GET /v1/oi/ — latest OI signal report"""
    try:
        from ds_app.oi_signal import run
        data = run()
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def oi_refresh(request):
    """POST /v1/oi/refresh/ — force refresh OI signal"""
    try:
        from ds_app.oi_signal import run
        data = run(force=True)
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Fear & Greed Index ─────────────────────────────────────────────────────────

def fng_report(request):
    """GET /v1/fng/ — latest Fear & Greed report"""
    try:
        from ds_app.fear_greed import run
        data = run()
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def fng_refresh(request):
    """POST /v1/fng/refresh/ — force refresh Fear & Greed"""
    try:
        from ds_app.fear_greed import run
        data = run(force=True)
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


# ── Liquidations Stream ────────────────────────────────────────────────────────

def liq_report(request):
    """GET /v1/liq/ — liquidation pressure summary (last 30 min, all symbols)"""
    try:
        from ds_app.liquidations import liq_summary, get_liq_pressure
        symbol = request.GET.get("symbol")
        if symbol:
            data = get_liq_pressure(symbol.upper())
        else:
            data = liq_summary()
        resp = JsonResponse(data)
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


def liq_daemon_status(request):
    """GET /v1/liq/status/ — check if liquidation daemon DB has recent data"""
    try:
        import sqlite3, time as _t
        from ds_app.liquidations import DB_PATH
        if not DB_PATH.exists():
            return JsonResponse({"ok": False, "running": False, "error": "no DB"})
        conn = sqlite3.connect(str(DB_PATH))
        since = int(_t.time()) - 120  # last 2 min
        recent = conn.execute(
            "SELECT COUNT(*) FROM liquidations WHERE ts>=?", (since,)
        ).fetchone()[0]
        total = conn.execute("SELECT COUNT(*) FROM liquidations").fetchone()[0]
        latest = conn.execute("SELECT MAX(ts) FROM liquidations").fetchone()[0]
        conn.close()
        resp = JsonResponse({
            "ok":           True,
            "running":      recent > 0,
            "recent_2min":  recent,
            "total_stored": total,
            "latest_ts":    latest,
        })
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@require_GET
def paper_pending(request):
    """GET /v1/paper/pending/?mode=PADAWAN — scan tracked symbols, score only, no execution."""
    try:
        from ds_app.alpaca_paper import (
            load_bars, score_symbol, check_gates, MODES, SYMBOL_MAP,
            ASSET_MODE, EQUITY_SYMBOLS_DEFAULT, CME_SYMBOLS_DEFAULT,
        )
        mode_name = request.GET.get("mode", os.environ.get("PAPER_MODE", "PADAWAN")).upper()
        mode = MODES.get(mode_name, MODES["PADAWAN"])

        if ASSET_MODE == "STOCKS":
            default_syms = EQUITY_SYMBOLS_DEFAULT
        elif ASSET_MODE == "FUTURES":
            default_syms = CME_SYMBOLS_DEFAULT
        else:
            default_syms = "BTC,ETH,SOL,BNB,AVAX,LINK"

        raw_syms = os.environ.get("PAPER_SYMBOLS", default_syms).split(",")
        # For stocks/futures don't filter by SYMBOL_MAP (crypto only)
        sym_filter = (lambda s: s in SYMBOL_MAP) if ASSET_MODE == "CRYPTO" else (lambda s: bool(s))
        candidates = []
        for raw_sym in [s.strip() for s in raw_syms if sym_filter(s.strip())]:
            try:
                df = load_bars(raw_sym)
                if df is None:
                    candidates.append({"symbol": raw_sym, "error": "no bars"})
                    continue
                sc = score_symbol(df)
                gates_pass, killed = check_gates(sc, mode, symbol=raw_sym)
                above_thr = sc["soft_score"] >= mode.entry_thr and abs(sc["jedi_raw"]) >= mode.jedi_min
                entry_dir = ("LONG" if sc["jedi_raw"] > 0 else "SHORT") if above_thr else None
                above = above_thr and gates_pass
                vote_map = {k: int(v.get("vote", 0)) for k, v in sc["votes"].items() if k != "JEDI"}
                alpaca_sym = SYMBOL_MAP.get(raw_sym, raw_sym)  # stocks use raw symbol directly
                candidates.append({
                    "symbol":          raw_sym,
                    "alpaca_symbol":   alpaca_sym,
                    "regime":          sc["regime"],
                    "soft_score":      sc["soft_score"],
                    "jedi_raw":        sc["jedi_raw"],
                    "atr_rank":        sc["atr_rank"],
                    "rvol_now":        sc["rvol_now"],
                    "squeeze":         sc["squeeze"],
                    "price":           sc["price"],
                    "gates_pass":      gates_pass,
                    "killed":          killed,
                    "entry_dir":       entry_dir,
                    "above_threshold": above,
                    "votes":           vote_map,
                })
            except Exception as exc:
                candidates.append({"symbol": raw_sym, "error": str(exc)})
        candidates.sort(key=lambda x: (-int(x.get("above_threshold", False)), -abs(x.get("soft_score", 0))))
        resp = JsonResponse({"ok": True, "mode": mode_name, "pending": candidates})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)


@csrf_exempt
def paper_approve(request):
    """POST /v1/paper/approve/ {symbol, mode} — fire paper order for one symbol."""
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    body = _json_body(request)
    symbol = body.get("symbol", "").upper().strip()
    mode_name = body.get("mode", "PADAWAN").upper()
    if not symbol:
        return JsonResponse({"error": "symbol required"}, status=400)
    try:
        import subprocess
        env = dict(os.environ)
        env["PAPER_SYMBOLS"] = symbol
        env["PAPER_MODE"] = mode_name
        script = pathlib.Path(__file__).parent / "alpaca_paper.py"
        subprocess.Popen([sys.executable, str(script), mode_name], env=env)
        resp = JsonResponse({"ok": True, "symbol": symbol, "mode": mode_name, "message": "cycle launched"})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=500)


@require_GET
def paper_equity(request):
    """GET /v1/paper/equity/ — cumulative P&L time series for equity curve chart."""
    try:
        import sqlite3 as _sq
        db_path = pathlib.Path(__file__).parent.parent / "data" / "paper_trades.db"
        if not db_path.exists():
            resp = JsonResponse({"ok": True, "points": []})
            resp["Access-Control-Allow-Origin"] = "*"
            return resp
        conn = _sq.connect(str(db_path))
        rows = conn.execute(
            "SELECT ts, pnl_usd FROM trades WHERE pnl_usd IS NOT NULL ORDER BY id"
        ).fetchall()
        conn.close()
        cumulative = 0.0
        points = []
        for ts, pnl in rows:
            cumulative += float(pnl or 0)
            points.append({"ts": ts, "pnl": round(cumulative, 2)})
        resp = JsonResponse({"ok": True, "points": points})
        resp["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=500)
