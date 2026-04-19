import math
import os
import tempfile
import urllib.error
import urllib.request
import base64
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt

from .boom_backtest import (
    BOOM_DEFAULT_BENCH_SYMBOL,
    BOOM_DEFAULT_DAILY_PERIOD,
    BOOM_DEFAULT_INTRADAY_PERIOD,
    BOOM_LIQUID_UNIVERSE_DEFAULT,
    boom_run_record,
    boom_params_for_viz,
    run_boom_visual_bundle,
    _normalize_ohlcv,
    run_boom_expansion_grid,
    synthetic_ohlcv_bars,
)
from .boom_vectorbt import run_boom_darvas_vectorbt_grid, run_boom_expansion_vectorbt_grid
from .algo_signals import SIGNAL_REGISTRY, run_signal_grid, grid_combo_count, boom_rank_score
from .boom_backtest import _load_universe_frames, _make_strategy
from .algo_optimizer import optimize_signal, optimize_signal_multisymbol, importance_report, SEARCH_SPACES
from .bar_cache import (
    load_universe_parallel, cache_stats, cache_invalidate,
    run_swarm, scan_atr_compression,
    CACHE_DB, MAX_WORKERS,
)

PING_JSON = {"ok": True, "stack": "django"}


def _boom_export_query(
    scan: bool,
    timeframe: str,
    period: str,
    flat_eod: bool,
    min_trades: int,
    signal_source: str,
    symbols_override: list[str] | None,
    wide_grid: bool,
    atr_mult: float,
    first_half_only: bool,
    exit_mode: str,
    break_even_offset_pct: float,
) -> str:
    q: dict[str, str] = {
        "scan": "1" if scan else "0",
        "tf": timeframe,
        "period": period,
        "eod": "1" if flat_eod else "0",
        "min_trades": str(min_trades),
        "signal": signal_source,
        "exit": exit_mode,
        "be_off": str(break_even_offset_pct),
        "atr_mult": str(atr_mult),
        "first_half": "1" if first_half_only else "0",
    }
    if symbols_override:
        q["symbols"] = ",".join(symbols_override)
    if wide_grid:
        q["wide"] = "1"
    return urlencode(q)


def _safe_float(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return float(default)


def _vectorbt_boom_url_with(request, **overrides: str | None) -> str:
    """Rebuild /vectorbt-boom/ query string, overriding GET keys (None = drop key)."""
    q = request.GET.copy()
    for k, v in overrides.items():
        if v is None:
            q.pop(k, None)
        else:
            q[k] = v
    return "/vectorbt-boom/?" + q.urlencode()


def _sanitize_for_json(obj):
    """Make BOOM manifest safe for strict JSON clients (no NaN; numpy scalars flattened)."""
    if obj is None:
        return None
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {str(k): _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_for_json(v) for v in obj]
    try:
        import numpy as np

        if isinstance(obj, np.generic):
            return _sanitize_for_json(obj.item())
        if isinstance(obj, np.ndarray):
            return _sanitize_for_json(obj.tolist())
    except ImportError:
        pass
    return obj


def _render_boom_pngs(top_rows: list[dict]) -> dict[str, bytes]:
    """Build quick visual charts for BOOM report."""
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return {"returns_png": b"", "risk_png": b""}

    rows = top_rows[:10]
    if not rows:
        return {"returns_png": b"", "risk_png": b""}

    labels = [f"#{i + 1}" for i in range(len(rows))]
    returns = [_safe_float(r.get("return_pct")) for r in rows]
    wins = [_safe_float(r.get("win_rate_pct")) for r in rows]
    dds = [abs(_safe_float(r.get("max_dd_pct"))) for r in rows]

    out: dict[str, bytes] = {}

    fig, ax = plt.subplots(figsize=(7.2, 2.8), dpi=140)
    ax.bar(labels, returns, color="#22d3ee", alpha=0.9, label="Return %")
    ax.plot(labels, wins, color="#4ade80", marker="o", linewidth=1.8, label="Win %")
    ax.set_title("Top configs: Return vs Win Rate")
    ax.set_ylabel("Percent")
    ax.grid(alpha=0.25, linestyle="--")
    ax.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    buf = BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    out["returns_png"] = buf.getvalue()

    fig, ax = plt.subplots(figsize=(7.2, 2.8), dpi=140)
    ax.scatter(dds, returns, c=wins, cmap="viridis", s=65, alpha=0.9)
    for i, lbl in enumerate(labels):
        ax.annotate(lbl, (dds[i], returns[i]), textcoords="offset points", xytext=(4, 3), fontsize=7)
    ax.set_title("Risk/Reward Map (color = Win %)")
    ax.set_xlabel("Abs Max Drawdown %")
    ax.set_ylabel("Return %")
    ax.grid(alpha=0.25, linestyle="--")
    fig.tight_layout()
    buf = BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    out["risk_png"] = buf.getvalue()

    return out


def _ensure_isolated_mplconfigdir() -> None:
    """Use a clean MPL config dir to avoid UnicodeDecodeError from a corrupt ~/.matplotlib cache."""
    if os.environ.get("MPLCONFIGDIR"):
        return
    d = os.path.join(tempfile.gettempdir(), "m4d_ds_mpl_config")
    try:
        os.makedirs(d, exist_ok=True)
    except OSError:
        return
    os.environ["MPLCONFIGDIR"] = d


def _render_boom_trade_chart_pil(bundle: dict) -> tuple[bytes, str | None]:
    """Draw PNG with Pillow (primary path for /boom-visual/; matplotlib optional)."""
    try:
        from PIL import Image, ImageDraw
    except ImportError as e:
        return b"", str(e)

    try:
        df = bundle["df"]
        feat = bundle["feat"]
        trades = bundle["trades"]
        sym = bundle["symbol"]
        tf = bundle.get("timeframe", "")
        per = bundle.get("period", "")
        src = bundle.get("data_source", "")

        n = int(len(df))
        if n < 2:
            return b"", "not enough bars to plot"

        close = df["Close"].to_numpy(dtype=float, copy=False)
        ema = None
        if "ema13" in feat.columns:
            ema = feat["ema13"].to_numpy(dtype=float, copy=False)

        finite = [float(x) for x in close if math.isfinite(x)]
        if ema is not None:
            finite.extend(float(x) for x in ema if math.isfinite(x))
        if len(finite) < 2:
            return b"", "non-finite price data"
        ymin, ymax = min(finite), max(finite)
        pad = (ymax - ymin) * 0.06 or 0.01
        ymin, ymax = ymin - pad, ymax + pad

        W, H = 1000, 500
        left, right, top, bot = 72, 28, 52, 72
        pw, ph = W - left - right, H - top - bot

        def x_of(i: int) -> float:
            return left + (i / max(1, n - 1)) * pw

        def y_of(v: float) -> float:
            return top + ph - ((v - ymin) / max(1e-12, ymax - ymin)) * ph

        img = Image.new("RGB", (W, H), (22, 27, 34))
        draw = ImageDraw.Draw(img)
        grid = (48, 54, 61)
        for k in range(6):
            yy = top + k * ph / 5
            draw.line([(left, yy), (left + pw, yy)], fill=grid, width=1)

        def poly(xs_y: list[tuple[float, float]], fill: tuple[int, int, int], width: int = 2) -> None:
            if len(xs_y) < 2:
                return
            draw.line(xs_y, fill=fill, width=width)

        lc = [(x_of(i), y_of(float(close[i]))) for i in range(n) if math.isfinite(float(close[i]))]
        poly(lc, (37, 99, 235), 2)
        if ema is not None:
            le = [(x_of(i), y_of(float(ema[i]))) for i in range(n) if math.isfinite(float(ema[i]))]
            poly(le, (249, 115, 22), 2)

        sz = 7
        if trades is not None and len(trades) > 0:
            for _, t in trades.iterrows():
                try:
                    eb = int(t["EntryBar"])
                    xb = int(t["ExitBar"])
                except (KeyError, TypeError, ValueError):
                    continue
                if 0 <= eb < n and math.isfinite(float(close[eb])):
                    px, py = x_of(eb), y_of(float(close[eb]))
                    draw.polygon([(px, py - sz), (px - sz, py + sz // 2), (px + sz, py + sz // 2)], fill=(34, 197, 94), outline=(22, 101, 52))
                if 0 <= xb < n and math.isfinite(float(close[xb])):
                    px, py = x_of(xb), y_of(float(close[xb]))
                    draw.polygon([(px, py + sz), (px - sz, py - sz // 2), (px + sz, py - sz // 2)], fill=(239, 68, 68), outline=(153, 27, 27))

        title = f"BOOM visual — {sym}  |  {n} bars  {tf}  {per}  {src}"
        draw.text((left, 12), title, fill=(230, 237, 243))
        draw.text((left, H - 48), "Bar index left→right (full window)", fill=(139, 148, 158))

        buf = BytesIO()
        img.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
        return (data, None) if data else (b"", "Pillow produced empty PNG")
    except Exception as e:
        return b"", f"{type(e).__name__}: {e}"


def _render_boom_trade_chart(bundle: dict) -> tuple[bytes, str | None]:
    """Price + 13 EMA + trade markers. **Pillow first** (avoids fragile matplotlib installs); matplotlib optional."""
    n = int(len(bundle["df"]))
    if n < 2:
        return b"", "not enough bars to plot"

    pil_data, pil_err = _render_boom_trade_chart_pil(bundle)
    if pil_data:
        return pil_data, None

    mpl_err: str | None = None
    df = bundle["df"]
    feat = bundle["feat"]
    trades = bundle["trades"]
    sym = bundle["symbol"]
    tf = bundle.get("timeframe", "")
    per = bundle.get("period", "")
    src = bundle.get("data_source", "")

    _ensure_isolated_mplconfigdir()
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np

        x = np.arange(n, dtype=np.float64)
        close = df["Close"].to_numpy(dtype=np.float64, copy=False)

        fig, ax = plt.subplots(figsize=(14, 6), dpi=110)
        ax.plot(x, close, color="#2563eb", lw=1.1, label="Close", zorder=1)
        if "ema13" in feat.columns:
            ema13 = feat["ema13"].to_numpy(dtype=np.float64, copy=False)
            ax.plot(
                x,
                ema13,
                color="#f97316",
                lw=0.95,
                alpha=0.95,
                label="13 EMA",
                zorder=2,
            )
        if trades is not None and len(trades) > 0:
            for _, t in trades.iterrows():
                try:
                    eb = int(t["EntryBar"])
                    xb = int(t["ExitBar"])
                except (KeyError, TypeError, ValueError):
                    continue
                if 0 <= eb < n:
                    ax.scatter(
                        x[eb],
                        float(close[eb]),
                        color="#22c55e",
                        s=42,
                        marker="^",
                        zorder=5,
                        edgecolors="#166534",
                        linewidths=0.5,
                    )
                if 0 <= xb < n:
                    ax.scatter(
                        x[xb],
                        float(close[xb]),
                        color="#ef4444",
                        s=42,
                        marker="v",
                        zorder=5,
                        edgecolors="#991b1b",
                        linewidths=0.5,
                    )

        tick_step = max(1, n // 12)
        tick_ix = list(range(0, n, tick_step))
        if tick_ix[-1] != n - 1:
            tick_ix.append(n - 1)
        ax.set_xticks([float(i) for i in tick_ix])

        def _lbl(i: int) -> str:
            try:
                ts = df.index[i]
                if hasattr(ts, "strftime"):
                    return ts.strftime("%m-%d %H:%M")[:14]
            except Exception:
                pass
            return str(df.index[i])[:14]

        ax.set_xticklabels([_lbl(i) for i in tick_ix], rotation=30, ha="right", fontsize=7)

        subtitle = f"{n} bars · {tf} · {per} · {src}"
        ax.set_title(f"BOOM visual — {sym}\n{subtitle}", fontsize=11)
        ax.set_xlabel("Bar index (see tick labels for time)")
        ax.legend(loc="upper left", fontsize=8, framealpha=0.92)
        ax.grid(True, alpha=0.25)

        buf = BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight")
        plt.close(fig)
        data = buf.getvalue()
        if data:
            return data, None
        mpl_err = "matplotlib savefig returned empty bytes"
    except Exception as e:
        mpl_err = f"{type(e).__name__}: {e}"
        try:
            import matplotlib.pyplot as _plt

            _plt.close("all")
        except Exception:
            pass

    return (
        b"",
        f"Chart failed. Pillow: {pil_err}. Matplotlib: {mpl_err}. Fix: cd m4d-ds && pip install pillow",
    )


def _trade_chart_ctx_from_params(
    request,
    *,
    symbol: str,
    timeframe: str,
    period: str,
    p,
) -> dict[str, object]:
    """
    Price + EMA13 + entry/exit markers via backtesting.py (same as /boom-visual/).
    vectorbt screens params faster; this chart is for verifying the *discrete* BOOM strategy.
    """
    flat_eod = request.GET.get("chart_eod", request.GET.get("eod", "0")) in (
        "1",
        "true",
        "yes",
        "on",
    )
    mb = max(50, int(request.GET.get("max_bars", "280")))
    bundle = run_boom_visual_bundle(
        symbol.strip().upper(),
        timeframe,
        period,
        p,
        flat_eod=flat_eod,
        max_bars=mb,
    )
    png, cerr = _render_boom_trade_chart(bundle)
    st = bundle["stats"]
    cap = (
        "backtesting.py (same engine as /boom-visual/): "
        f"Return {float(st.get('Return [%]', 0) or 0):.2f}% · "
        f"Trades {int(st.get('# Trades', 0) or 0)} · "
        f"Win {float(st.get('Win Rate [%]', 0) or 0):.1f}% · "
        f"Max DD {float(st.get('Max. Drawdown [%]', 0) or 0):.2f}%"
    )
    return {
        "chart_b64": base64.b64encode(png).decode("ascii") if png else "",
        "chart_error": cerr or "",
        "chart_symbol": bundle["symbol"],
        "chart_caption": cap,
        "chart_bars": int(bundle.get("bars", 0)),
    }


def _run_signal_visual_bundle(
    signal_name: str,
    df,
    symbol: str,
    timeframe: str,
    period: str,
    flat_eod: bool,
    max_bars: int,
    param_overrides: dict,
) -> dict:
    """Run any SIGNAL_REGISTRY signal through backtesting.py and return a chart-ready bundle."""
    reg = SIGNAL_REGISTRY[signal_name]
    default_p = reg["default_params"]
    fields = {f: getattr(default_p, f) for f in default_p.__dataclass_fields__}
    fields.update(param_overrides)
    p = reg["params_cls"](**fields)

    mb = max(50, int(max_bars))
    df_slice = df.tail(mb) if len(df) > mb else df

    feat = reg["features_fn"](df_slice, p)
    strat = _make_strategy(
        feat,
        p.hold_bars,
        p.stop_loss_pct,
        flat_eod,
        p.exit_mode,
        getattr(p, "break_even_offset_pct", 0.05),
    )
    from backtesting import Backtest
    bt = Backtest(df_slice, strat, cash=100_000, commission=0.0015, spread=0.0008,
                  exclusive_orders=True, finalize_trades=True)
    stats = bt.run()
    raw = stats._trades
    trades = raw.copy() if raw is not None and len(raw) > 0 else __import__("pandas").DataFrame()
    return {
        "symbol": symbol.upper(),
        "df": df_slice,
        "feat": feat,
        "trades": trades,
        "stats": stats,
        "data_source": "yfinance",
        "timeframe": timeframe,
        "period": period,
        "bars": len(df_slice),
        "signal_name": signal_name,
        "params": {f: getattr(p, f) for f in p.__dataclass_fields__},
    }


def home(request):
    return render(request, "ds_app/home.html", {"ping_preview": PING_JSON})


def ping(request):
    return JsonResponse(PING_JSON)


def backtesting_page(request):
    """Smoke-check backtesting.py install and run a tiny strategy."""
    ctx = {
        "ok": False,
        "version": None,
        "error": None,
        "stats": {},
    }
    try:
        import backtesting
        from backtesting import Backtest, Strategy
        from backtesting.lib import crossover
        from backtesting.test import SMA

        class SmaCross(Strategy):
            def init(self):
                close = self.data.Close
                self.ma1 = self.I(SMA, close, 10)
                self.ma2 = self.I(SMA, close, 20)

            def next(self):
                if crossover(self.ma1, self.ma2):
                    self.buy()
                elif crossover(self.ma2, self.ma1):
                    self.sell()

        bars = None
        try:
            import yfinance as yf

            raw = yf.download(
                tickers=BOOM_DEFAULT_BENCH_SYMBOL,
                period="2y",
                interval="1d",
                progress=False,
                auto_adjust=False,
                prepost=False,
                threads=False,
            )
            bars = _normalize_ohlcv(raw)
            if len(bars) < 120:
                bars = None
        except Exception:
            bars = None
        if bars is None:
            bars = synthetic_ohlcv_bars(400, seed=7)

        # Keep it quick; this is only a health/smoke page.
        bt = Backtest(bars.tail(350), SmaCross, commission=0.002, exclusive_orders=True)
        stats = bt.run()
        ctx["ok"] = True
        ctx["version"] = backtesting.__version__
        ctx["stats"] = {
            "Start": str(stats.get("Start", "")),
            "End": str(stats.get("End", "")),
            "Return [%]": str(round(float(stats.get("Return [%]", 0.0)), 2)),
            "Win Rate [%]": str(round(float(stats.get("Win Rate [%]", 0.0)), 2)),
            "# Trades": str(int(stats.get("# Trades", 0))),
            "Max. Drawdown [%]": str(round(float(stats.get("Max. Drawdown [%]", 0.0)), 2)),
        }
    except Exception as e:
        ctx["error"] = str(e)
    return render(request, "ds_app/backtesting.html", ctx)


def vectorbt_page(request):
    """Smoke-check vectorbt install with a tiny MA crossover portfolio."""
    ctx = {
        "ok": False,
        "version": None,
        "error": None,
        "stats": {},
    }
    try:
        import vectorbt as vbt
        from vectorbt.data.custom import SyntheticData

        close = SyntheticData.download("SYNT", start="2024-01-01", end="2024-06-01").get("Close")
        fast = vbt.MA.run(close, 10)
        slow = vbt.MA.run(close, 30)
        entries = fast.ma_crossed_above(slow)
        exits = fast.ma_crossed_below(slow)
        pf = vbt.Portfolio.from_signals(close, entries, exits, init_cash=100.0, fees=0.001)
        stats = pf.stats()

        ctx["ok"] = True
        ctx["version"] = vbt.__version__
        ctx["stats"] = {
            "Start": str(stats.get("Start", "")),
            "End": str(stats.get("End", "")),
            "Total Return [%]": str(round(float(stats.get("Total Return [%]", 0.0)), 2)),
            "Win Rate [%]": str(round(float(stats.get("Win Rate [%]", 0.0)), 2)),
            "Total Trades": str(int(stats.get("Total Trades", 0))),
            "Max Drawdown [%]": str(round(float(stats.get("Max Drawdown [%]", 0.0)), 2)),
        }
    except Exception as e:
        ctx["error"] = str(e)
    return render(request, "ds_app/vectorbt.html", ctx)


def vectorbt_boom_page(request):
    """vectorbt: Cartesian Darvas-style BOOM grid (thousands of param combos) for fast screening."""
    want_json = request.GET.get("format", "").lower() == "json"
    symbol = request.GET.get("symbol", BOOM_DEFAULT_BENCH_SYMBOL).strip().upper()
    timeframe = request.GET.get("tf", "1d").strip()
    intraday = timeframe.lower() not in ("1d", "d", "daily", "1day")
    period = request.GET.get(
        "period", BOOM_DEFAULT_INTRADAY_PERIOD if intraday else BOOM_DEFAULT_DAILY_PERIOD
    ).strip()
    max_combos = max(10, min(int(request.GET.get("max_combos", "500")), 50_000))
    min_vote = int(request.GET.get("min_vote", "2"))
    atr_mult = float(request.GET.get("atr_mult", "0"))
    first_half_default = "1" if intraday else "0"
    first_half_only = request.GET.get("first_half", first_half_default) in (
        "1",
        "true",
        "yes",
        "on",
    )
    sl_raw = (request.GET.get("sl_stop", "0") or "").strip().lower()
    sl_stop = None if sl_raw in ("0", "", "none", "off") else float(sl_raw)

    # Screening defaults: permissive ATR/RVOL/vote + slightly wider SQ/DV sweep (~3×3×6 combos).
    sq_lo = int(request.GET.get("sq_min", "10"))
    sq_hi = int(request.GET.get("sq_max", "22"))
    sq_step = max(1, int(request.GET.get("sq_step", "6")))
    dv_lo = int(request.GET.get("dv_min", "8"))
    dv_hi = int(request.GET.get("dv_max", "18"))
    dv_step = max(1, int(request.GET.get("dv_step", "5")))
    rvol_n = max(3, min(int(request.GET.get("rvol_n", "6")), 48))
    rvol_lo = float(request.GET.get("rvol_lo", "1.0"))
    rvol_hi = float(request.GET.get("rvol_hi", "2.0"))

    squeeze_lens = tuple(range(sq_lo, sq_hi + 1, sq_step)) or (14,)
    darvas_lookbacks = tuple(range(dv_lo, dv_hi + 1, dv_step)) or (10,)
    if rvol_n <= 1:
        rvol_thresholds = (rvol_lo,)
    else:
        step = (rvol_hi - rvol_lo) / (rvol_n - 1)
        rvol_thresholds = tuple(round(rvol_lo + i * step, 3) for i in range(rvol_n))

    grid_product = len(squeeze_lens) * len(darvas_lookbacks) * len(rvol_thresholds)
    hold_viz = int(request.GET.get("hold", "5"))
    max_bars = max(50, int(request.GET.get("max_bars", "280")))
    be_off = float(request.GET.get("be_off", "0.05"))

    ctx = {
        "ok": False,
        "error": None,
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "max_combos": max_combos,
        "min_vote": min_vote,
        "atr_mult": atr_mult,
        "first_half_only": first_half_only,
        "sl_stop_display": "" if sl_stop is None else str(sl_stop),
        "sq_min": sq_lo,
        "sq_max": sq_hi,
        "sq_step": sq_step,
        "dv_min": dv_lo,
        "dv_max": dv_hi,
        "dv_step": dv_step,
        "rvol_n": rvol_n,
        "rvol_lo": rvol_lo,
        "rvol_hi": rvol_hi,
        "grid_product": grid_product,
        "result": None,
        "vb_retry_looser_atr_url": None,
        "hold_viz": hold_viz,
        "max_bars": max_bars,
        "be_off": be_off,
        "chart_b64": "",
        "chart_error": "",
        "chart_caption": "",
        "chart_bars": 0,
        "chart_requested": request.GET.get("chart", "").lower() in ("1", "true", "yes", "on"),
    }
    try:
        res = run_boom_darvas_vectorbt_grid(
            symbol,
            timeframe,
            period,
            squeeze_lens=squeeze_lens,
            darvas_lookbacks=darvas_lookbacks,
            rvol_thresholds=rvol_thresholds,
            min_vote=min_vote,
            atr_mult=atr_mult,
            first_half_only=first_half_only,
            max_combos=max_combos,
            sl_stop=sl_stop,
        )
        ctx["ok"] = True
        ctx["result"] = res
        if (
            int(res.get("combos_with_trades", 0)) == 0
            and float(res.get("atr_mult", 0.0)) >= 1.04
            and not intraday
        ):
            ctx["vb_retry_looser_atr_url"] = _vectorbt_boom_url_with(request, atr_mult="1.0")
        if want_json:
            return JsonResponse(_sanitize_for_json(res))
        if res.get("top_sharpe") and request.GET.get("chart", "").lower() in (
            "1",
            "true",
            "yes",
            "on",
        ):
            try:
                r0 = res["top_sharpe"][0]
                p = boom_params_for_viz(
                    timeframe,
                    int(r0["squeeze_len"]),
                    int(r0["darvas_lookback"]),
                    float(r0["rvol_mult"]),
                    hold_viz,
                    signal_source="darvas",
                    atr_mult=float(res["atr_mult"]),
                    first_half_only=bool(res["first_half_only"]),
                    exit_mode="ema13",
                    break_even_offset_pct=be_off,
                )
                ctx.update(
                    _trade_chart_ctx_from_params(
                        request, symbol=symbol, timeframe=timeframe, period=period, p=p
                    )
                )
            except Exception as e:
                ctx["chart_error"] = str(e)
    except Exception as e:
        if want_json:
            return JsonResponse({"ok": False, "error": str(e)}, status=500)
        ctx["error"] = str(e)
    return render(request, "ds_app/vectorbt_boom.html", ctx)


def vectorbt_expansion_page(request):
    """vectorbt: full BOOM expansion grids (same params as /boom-backtest/) in one shot per symbol."""
    want_json = request.GET.get("format", "").lower() == "json"
    scan = request.GET.get("scan", "0") in ("1", "true", "yes", "on")
    timeframe = request.GET.get("tf", "5m" if scan else "1d")
    period = request.GET.get(
        "period", BOOM_DEFAULT_INTRADAY_PERIOD if scan else BOOM_DEFAULT_DAILY_PERIOD
    ).strip()
    max_combos = max(10, min(int(request.GET.get("max_combos", "500")), 50_000))
    limit_top = max(3, min(int(request.GET.get("limit_top", "12")), 50))
    min_trades = int(request.GET.get("min_trades", "1" if scan else "5"))
    signal_source = request.GET.get("signal", "darvas").strip().lower()
    if signal_source not in ("arrows", "darvas"):
        signal_source = "darvas"
    exit_mode = request.GET.get("exit", "ema13").strip().lower()
    if exit_mode not in ("ema13", "holdbars"):
        exit_mode = "ema13"
    sym_raw = request.GET.get("symbols", "").strip()
    symbols_list = [s.strip().upper() for s in sym_raw.split(",") if s.strip()]
    symbols_override = symbols_list if symbols_list else None
    wide_grid = request.GET.get("wide", "0") in ("1", "true", "yes", "on")
    atr_mult = float(request.GET.get("atr_mult", "1.05" if scan else "1.0"))
    first_half_only = request.GET.get("first_half", "1" if scan else "0") in (
        "1",
        "true",
        "yes",
        "on",
    )
    break_even_offset_pct = float(request.GET.get("be_off", "0.05"))
    symbol = request.GET.get("symbol", BOOM_DEFAULT_BENCH_SYMBOL).strip().upper()
    max_bars = max(50, int(request.GET.get("max_bars", "280")))
    rank_mode = request.GET.get("rank", "boom").strip().lower()
    if rank_mode not in ("boom", "calmar"):
        rank_mode = "boom"

    expansion_json_q: dict[str, str] = {
        "format": "json",
        "tf": timeframe,
        "period": period,
        "max_combos": str(max_combos),
        "limit_top": str(limit_top),
        "min_trades": str(min_trades),
        "signal": signal_source,
        "exit": exit_mode,
        "atr_mult": str(atr_mult),
        "be_off": str(break_even_offset_pct),
        "symbol": symbol,
        "max_bars": str(max_bars),
        "rank": rank_mode,
    }
    if scan:
        expansion_json_q["scan"] = "1"
    if wide_grid:
        expansion_json_q["wide"] = "1"
    if first_half_only:
        expansion_json_q["first_half"] = "1"
    if sym_raw:
        expansion_json_q["symbols"] = sym_raw
    expansion_json_url = "/vectorbt-expansion/?" + urlencode(expansion_json_q)

    ctx = {
        "ok": False,
        "error": None,
        "scan": scan,
        "timeframe": timeframe,
        "period": period,
        "max_combos": max_combos,
        "limit_top": limit_top,
        "min_trades": min_trades,
        "signal_source": signal_source,
        "exit_mode": exit_mode,
        "wide_grid": wide_grid,
        "symbols_param": sym_raw,
        "atr_mult": atr_mult,
        "first_half_only": first_half_only,
        "break_even_offset_pct": break_even_offset_pct,
        "symbol": symbol,
        "max_bars": max_bars,
        "result": None,
        "chart_b64": "",
        "chart_error": "",
        "chart_caption": "",
        "chart_bars": 0,
        "chart_requested": request.GET.get("chart", "").lower() in ("1", "true", "yes", "on"),
        "rank_mode": rank_mode,
        "expansion_json_url": expansion_json_url,
    }
    try:
        res = run_boom_expansion_vectorbt_grid(
            timeframe=timeframe,
            period=period,
            liquid_scan=scan,
            wide_grid=wide_grid,
            symbols_override=symbols_override,
            bench_symbol=symbol,
            max_combos=max_combos,
            limit_top=limit_top,
            signal_source=signal_source,
            exit_mode=exit_mode,
            atr_mult=atr_mult,
            first_half_only=first_half_only,
            break_even_offset_pct=break_even_offset_pct,
            min_trades=min_trades,
            rank_mode=rank_mode,
        )
        ctx["ok"] = True
        ctx["result"] = res
        if want_json:
            return JsonResponse(_sanitize_for_json(res))
        if res.get("top") and request.GET.get("chart", "").lower() in ("1", "true", "yes", "on"):
            try:
                r0 = res["top"][0]
                sym_ch = str(r0.get("symbol") or symbol).strip().upper()
                p = boom_params_for_viz(
                    timeframe,
                    int(r0["squeeze_len"]),
                    int(r0["darvas_lookback"]),
                    float(r0["rvol_mult"]),
                    int(r0["hold_bars"]),
                    signal_source=str(r0["signal_source"]),
                    atr_mult=float(r0["atr_mult"]),
                    first_half_only=bool(r0["first_half_only"]),
                    exit_mode=str(r0["exit_mode"]),
                    break_even_offset_pct=float(r0.get("break_even_offset_pct", break_even_offset_pct)),
                )
                ctx.update(
                    _trade_chart_ctx_from_params(
                        request,
                        symbol=sym_ch,
                        timeframe=timeframe,
                        period=period,
                        p=p,
                    )
                )
            except Exception as e:
                ctx["chart_error"] = str(e)
    except Exception as e:
        if want_json:
            return JsonResponse({"ok": False, "error": str(e)}, status=500)
        ctx["error"] = str(e)
    return render(request, "ds_app/vectorbt_expansion.html", ctx)


def backtrader_page(request):
    """Smoke-check backtrader install with tiny SMA crossover strategy."""
    ctx = {
        "ok": False,
        "version": None,
        "error": None,
        "stats": {},
    }
    try:
        import backtrader as bt
        import pandas as pd
        import numpy as np

        n = 220
        idx = pd.date_range("2024-01-01", periods=n, freq="D")
        base = np.linspace(100, 120, n) + 2 * np.sin(np.linspace(0, 10, n))
        close = pd.Series(base, index=idx)
        open_ = close.shift(1).fillna(close.iloc[0])
        high = pd.concat([open_, close], axis=1).max(axis=1) + 0.3
        low = pd.concat([open_, close], axis=1).min(axis=1) - 0.3
        vol = pd.Series(np.full(n, 1000), index=idx)
        df = pd.DataFrame(
            {"open": open_, "high": high, "low": low, "close": close, "volume": vol},
            index=idx,
        )

        class SmaCross(bt.Strategy):
            params = (("pfast", 10), ("pslow", 30))

            def __init__(self):
                sma1 = bt.ind.SMA(period=self.p.pfast)
                sma2 = bt.ind.SMA(period=self.p.pslow)
                self.crossover = bt.ind.CrossOver(sma1, sma2)

            def next(self):
                if not self.position and self.crossover > 0:
                    self.buy()
                elif self.position and self.crossover < 0:
                    self.sell()

        cerebro = bt.Cerebro(stdstats=False)
        cerebro.addstrategy(SmaCross)
        cerebro.broker.setcash(10000.0)
        cerebro.adddata(bt.feeds.PandasData(dataname=df))
        cerebro.addanalyzer(bt.analyzers.DrawDown, _name="dd")
        cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name="trades")
        results = cerebro.run()
        strat = results[0]
        end_value = cerebro.broker.getvalue()
        dd = strat.analyzers.dd.get_analysis()
        tr = strat.analyzers.trades.get_analysis()
        total_closed = int(getattr(getattr(tr, "total", {}), "closed", 0) or 0)
        won_total = int(getattr(getattr(tr, "won", {}), "total", 0) or 0)
        win_rate = (won_total / total_closed * 100.0) if total_closed else 0.0

        ctx["ok"] = True
        ctx["version"] = getattr(bt, "__version__", "unknown")
        ctx["stats"] = {
            "Start Cash": "10000.0",
            "End Value": str(round(float(end_value), 2)),
            "Return [%]": str(round((float(end_value) / 10000.0 - 1.0) * 100.0, 2)),
            "Closed Trades": str(total_closed),
            "Win Rate [%]": str(round(win_rate, 2)),
            "Max Drawdown [%]": str(round(float(getattr(dd.max, "drawdown", 0.0) or 0.0), 2)),
        }
    except Exception as e:
        ctx["error"] = str(e)
    return render(request, "ds_app/backtrader.html", ctx)


def nautilus_page(request):
    """Smoke-check NautilusTrader install and Rust backend extension import."""
    ctx = {
        "ok": False,
        "version": None,
        "rust_backend": False,
        "error": None,
        "details": {},
    }
    try:
        import platform
        import nautilus_trader as nt

        rust_backend = False
        rust_module = "unavailable"
        try:
            import nautilus_trader.core.nautilus_pyo3 as pyo3_mod  # Rust extension module
            rust_backend = True
            rust_module = getattr(pyo3_mod, "__name__", "nautilus_trader.core.nautilus_pyo3")
        except Exception:
            rust_backend = False

        ctx["ok"] = True
        ctx["version"] = nt.__version__
        ctx["rust_backend"] = rust_backend
        ctx["details"] = {
            "Package": "nautilus_trader",
            "Version": str(nt.__version__),
            "Python": platform.python_version(),
            "Platform": platform.platform(),
            "Rust Extension": rust_module,
            "Backend Status": "READY" if rust_backend else "NOT DETECTED",
        }
    except Exception as e:
        ctx["error"] = str(e)
    return render(request, "ds_app/nautilus.html", ctx)


def boom_optimizer_page(request):
    """Interactive URL builder for BOOM sweep, vectorbt endpoints, and curl/bash snippets."""
    return render(request, "ds_app/boom_optimizer.html")


def boom_backtest_page(request):
    """Darvas + volume + squeeze BOOM expansion parameter sweep."""
    want_json = request.GET.get("format", "").lower() == "json"
    scan = request.GET.get("scan", "0") in ("1", "true", "yes", "on")
    timeframe = request.GET.get("tf", "5m" if scan else "1d")
    period = request.GET.get("period", BOOM_DEFAULT_INTRADAY_PERIOD if scan else BOOM_DEFAULT_DAILY_PERIOD)
    flat_eod = request.GET.get("eod", "1" if scan else "0") in ("1", "true", "yes", "on")
    min_trades = int(request.GET.get("min_trades", "1" if scan else "5"))
    signal_source = request.GET.get("signal", "darvas" if scan else "arrows").strip().lower()
    if signal_source not in ("arrows", "darvas"):
        signal_source = "darvas" if scan else "arrows"
    exit_mode = request.GET.get("exit", "ema13").strip().lower()
    if exit_mode not in ("ema13", "holdbars"):
        exit_mode = "ema13"
    sym_raw = request.GET.get("symbols", "").strip()
    symbols_list = [s.strip().upper() for s in sym_raw.split(",") if s.strip()]
    symbols_override = symbols_list if symbols_list else None
    wide_grid = request.GET.get("wide", "0") in ("1", "true", "yes", "on")
    atr_mult = float(request.GET.get("atr_mult", "1.05" if scan else "1.0"))
    first_half_only = request.GET.get("first_half", "1" if scan else "0") in ("1", "true", "yes", "on")
    break_even_offset_pct = float(request.GET.get("be_off", "0.05"))
    ctx = {
        "ok": False,
        "error": None,
        "dataset": None,
        "tested": 0,
        "top": [],
        "analysis": {},
        "scan": scan,
        "timeframe": timeframe,
        "period": period,
        "flat_eod": flat_eod,
        "symbols": [],
        "eligible": 0,
        "meets_min_count": 0,
        "min_trades": min_trades,
        "signal_source": signal_source,
        "exit_mode": exit_mode,
        "wide_grid": wide_grid,
        "symbols_param": sym_raw,
        "atr_mult": atr_mult,
        "first_half_only": first_half_only,
        "break_even_offset_pct": break_even_offset_pct,
        "visual_qs": "",
    }
    ctx["export_qs"] = _boom_export_query(
        scan,
        timeframe,
        period,
        flat_eod,
        min_trades,
        signal_source,
        symbols_override,
        wide_grid,
        atr_mult,
        first_half_only,
        exit_mode,
        break_even_offset_pct,
    )
    try:
        res = run_boom_expansion_grid(
            limit_top=12,
            timeframe=timeframe,
            period=period,
            liquid_scan=scan,
            flat_eod=flat_eod,
            min_trades=min_trades,
            signal_source=signal_source,
            symbols_override=symbols_override,
            wide_grid=wide_grid,
            atr_mult=atr_mult,
            first_half_only=first_half_only,
            exit_mode=exit_mode,
            break_even_offset_pct=break_even_offset_pct,
        )
        ctx["ok"] = True
        ctx["dataset"] = res["dataset"]
        ctx["tested"] = res["tested"]
        ctx["top"] = res["top"]
        ctx["analysis"] = res.get("analysis", {})
        ctx["symbols"] = res.get("symbols", [])
        ctx["eligible"] = int(res.get("eligible", 0))
        ctx["meets_min_count"] = int(res.get("meets_min_count", 0))
        ctx["signal_source"] = res.get("signal_source", signal_source)
        ctx["exit_mode"] = res.get("exit_mode", exit_mode)
        ctx["wide_grid"] = bool(res.get("wide_grid", wide_grid))
        ctx["atr_mult"] = float(res.get("atr_mult", atr_mult))
        ctx["first_half_only"] = bool(res.get("first_half_only", first_half_only))
        ctx["break_even_offset_pct"] = float(res.get("break_even_offset_pct", break_even_offset_pct))
        vis_sym = symbols_list[0] if symbols_list else ("TSLA" if scan else BOOM_DEFAULT_BENCH_SYMBOL)
        vq: dict[str, str] = {
            "scan": "1" if scan else "0",
            "symbol": vis_sym,
            "tf": timeframe,
            "period": period,
            "eod": "1" if flat_eod else "0",
            "signal": signal_source,
            "exit": exit_mode,
            "be_off": str(break_even_offset_pct),
            "atr_mult": str(atr_mult),
            "first_half": "1" if first_half_only else "0",
        }
        best = res.get("analysis", {}).get("best")
        if best:
            vq["sq"] = str(best.get("squeeze_len", ""))
            vq["dv"] = str(best.get("darvas_lookback", ""))
            vq["rvol"] = str(best.get("rvol_mult", ""))
            vq["hold"] = str(best.get("hold_bars", ""))
        ctx["visual_qs"] = urlencode(vq)
        if want_json:
            url_params = {
                "scan": request.GET.get("scan", "0"),
                "tf": request.GET.get("tf", "5m" if scan else "1d"),
                "period": request.GET.get(
                    "period", BOOM_DEFAULT_INTRADAY_PERIOD if scan else BOOM_DEFAULT_DAILY_PERIOD
                ),
                "eod": request.GET.get("eod", "1" if scan else "0"),
                "min_trades": request.GET.get("min_trades", "1" if scan else "5"),
                "signal": request.GET.get("signal", "darvas" if scan else "arrows"),
                "exit": request.GET.get("exit", "ema13"),
                "be_off": request.GET.get("be_off", "0.05"),
                "symbols": sym_raw,
                "wide": request.GET.get("wide", "0"),
                "atr_mult": request.GET.get("atr_mult", "1.05" if scan else "1.0"),
                "first_half": request.GET.get("first_half", "1" if scan else "0"),
                "format": "json",
            }
            payload = boom_run_record(
                url_params=url_params,
                liquid_scan=scan,
                wide_grid=wide_grid,
                result=res,
                limit_top=12,
            )
            payload["ok"] = True
            return JsonResponse(_sanitize_for_json(payload))
        charts = _render_boom_pngs(ctx["top"])
        ctx["returns_chart_b64"] = (
            base64.b64encode(charts.get("returns_png", b"")).decode("ascii")
            if charts.get("returns_png")
            else ""
        )
        ctx["risk_chart_b64"] = (
            base64.b64encode(charts.get("risk_png", b"")).decode("ascii")
            if charts.get("risk_png")
            else ""
        )
    except Exception as e:
        if want_json:
            return JsonResponse({"ok": False, "error": str(e)}, status=500)
        ctx["error"] = str(e)
    return render(request, "ds_app/boom_backtest.html", ctx)


def boom_visual_page(request):
    """Single-symbol visual backtest — BOOM (darvas/arrows) or any algo_signals signal."""
    # ── signal routing ────────────────────────────────────────────────────────
    signal_param = request.GET.get("signal", "darvas").strip().lower()
    boom_signals = {"darvas", "arrows"}
    is_algo_signal = signal_param in SIGNAL_REGISTRY

    scan = request.GET.get("scan", "1") in ("1", "true", "yes", "on")
    timeframe = request.GET.get("tf", "5m" if scan else "1d")
    period = request.GET.get("period", BOOM_DEFAULT_INTRADAY_PERIOD if scan else BOOM_DEFAULT_DAILY_PERIOD)
    flat_eod = request.GET.get("eod", "1" if scan else "0") in ("1", "true", "yes", "on")
    # Default darvas (squeeze + Darvas box + RVOL vote). "arrows" is slingshot-only — not Darvas breakout.
    signal_source = request.GET.get("signal", "darvas").strip().lower()
    if signal_source not in ("arrows", "darvas"):
        signal_source = "darvas"
    exit_mode = request.GET.get("exit", "ema13").strip().lower()
    if exit_mode not in ("ema13", "holdbars"):
        exit_mode = "ema13"
    atr_mult = float(request.GET.get("atr_mult", "1.05" if scan else "1.0"))
    first_half_only = request.GET.get("first_half", "1" if scan else "0") in ("1", "true", "yes", "on")
    break_even_offset_pct = float(request.GET.get("be_off", "0.05"))
    max_bars = max(50, int(request.GET.get("max_bars", "280")))

    symbol = request.GET.get("symbol", "TSLA" if scan else BOOM_DEFAULT_BENCH_SYMBOL).strip().upper()
    squeeze_len = int(request.GET.get("sq", "14"))
    darvas_lb = int(request.GET.get("dv", "10"))
    rvol_mult = float(request.GET.get("rvol", "1.2"))
    hold_bars = int(request.GET.get("hold", "3" if scan else "5"))

    p = boom_params_for_viz(
        timeframe,
        squeeze_len,
        darvas_lb,
        rvol_mult,
        hold_bars,
        signal_source=signal_source,
        atr_mult=atr_mult,
        first_half_only=first_half_only,
        exit_mode=exit_mode,
        break_even_offset_pct=break_even_offset_pct,
    )

    all_signals = ["darvas", "arrows"] + list(SIGNAL_REGISTRY.keys())
    ctx = {
        "ok": False,
        "error": None,
        "chart_b64": "",
        "symbol": symbol,
        "scan": scan,
        "timeframe": timeframe,
        "period": period,
        "flat_eod": flat_eod,
        "signal_source": signal_param,
        "is_algo_signal": is_algo_signal,
        "all_signals": all_signals,
        "signal_descriptions": {k: v["description"] for k, v in SIGNAL_REGISTRY.items()},
        "exit_mode": exit_mode,
        "atr_mult": atr_mult,
        "first_half_only": first_half_only,
        "break_even_offset_pct": break_even_offset_pct,
        "max_bars": max_bars,
        "squeeze_len": squeeze_len,
        "darvas_lb": darvas_lb,
        "rvol_mult": rvol_mult,
        "hold_bars": hold_bars,
        "stats_summary": {},
        "trade_rows": [],
        "data_source": "",
        "bars": 0,
        "chart_error": "",
    }
    try:
        if is_algo_signal:
            frames, data_src = _load_universe_frames([symbol], timeframe, period)
            if symbol not in frames:
                raise ValueError(f"No bars for {symbol}")
            df_full = frames[symbol]
            # numeric params from GET (only hold_bars, stop_loss_pct supported in URL for now)
            param_overrides: dict = {}
            if request.GET.get("hold"):
                param_overrides["hold_bars"] = int(request.GET["hold"])
            if request.GET.get("stop"):
                param_overrides["stop_loss_pct"] = float(request.GET["stop"])
            bundle = _run_signal_visual_bundle(
                signal_param, df_full, symbol, timeframe, period, flat_eod, max_bars, param_overrides
            )
        else:
            bundle = run_boom_visual_bundle(
                symbol, timeframe, period, p, flat_eod=flat_eod, max_bars=max_bars,
            )
        png, chart_err = _render_boom_trade_chart(bundle)
        ctx["ok"] = True
        ctx["chart_b64"] = base64.b64encode(png).decode("ascii") if png else ""
        ctx["chart_error"] = chart_err or ""
        st = bundle["stats"]
        ctx["stats_summary"] = {
            "return_pct": float(st.get("Return [%]", 0) or 0),
            "trades": int(st.get("# Trades", 0) or 0),
            "win_rate": float(st.get("Win Rate [%]", 0) or 0),
            "max_dd": float(st.get("Max. Drawdown [%]", 0) or 0),
        }
        ctx["data_source"] = bundle.get("data_source", "")
        ctx["bars"] = int(bundle.get("bars", 0))
        tr = bundle["trades"]
        rows: list[dict] = []
        if tr is not None and len(tr) > 0:
            preview = tr.head(40)
            for _, t in preview.iterrows():
                try:
                    rows.append({
                        "entry_bar": int(t["EntryBar"]),
                        "exit_bar": int(t["ExitBar"]),
                        "entry_px": round(float(t["EntryPrice"]), 4),
                        "exit_px": round(float(t["ExitPrice"]), 4),
                        "pnl": round(float(t["PnL"]), 2),
                        "ret_pct": round(float(t["ReturnPct"]), 4),
                    })
                except (KeyError, TypeError, ValueError):
                    continue
        ctx["trade_rows"] = rows
    except Exception as e:
        ctx["error"] = str(e)
    return render(request, "ds_app/boom_visual.html", ctx)


def boom_backtest_pdf(request):
    """Export BOOM sweep summary as a downloadable PDF."""
    scan = request.GET.get("scan", "0") in ("1", "true", "yes", "on")
    timeframe = request.GET.get("tf", "5m" if scan else "1d")
    period = request.GET.get("period", BOOM_DEFAULT_INTRADAY_PERIOD if scan else BOOM_DEFAULT_DAILY_PERIOD)
    flat_eod = request.GET.get("eod", "1" if scan else "0") in ("1", "true", "yes", "on")
    min_trades = int(request.GET.get("min_trades", "1" if scan else "5"))
    signal_source = request.GET.get("signal", "darvas" if scan else "arrows").strip().lower()
    if signal_source not in ("arrows", "darvas"):
        signal_source = "darvas" if scan else "arrows"
    exit_mode = request.GET.get("exit", "ema13").strip().lower()
    if exit_mode not in ("ema13", "holdbars"):
        exit_mode = "ema13"
    sym_raw = request.GET.get("symbols", "").strip()
    symbols_list = [s.strip().upper() for s in sym_raw.split(",") if s.strip()]
    symbols_override = symbols_list if symbols_list else None
    wide_grid = request.GET.get("wide", "0") in ("1", "true", "yes", "on")
    atr_mult = float(request.GET.get("atr_mult", "1.05" if scan else "1.0"))
    first_half_only = request.GET.get("first_half", "1" if scan else "0") in ("1", "true", "yes", "on")
    break_even_offset_pct = float(request.GET.get("be_off", "0.05"))
    try:
        res = run_boom_expansion_grid(
            limit_top=12,
            timeframe=timeframe,
            period=period,
            liquid_scan=scan,
            flat_eod=flat_eod,
            min_trades=min_trades,
            signal_source=signal_source,
            symbols_override=symbols_override,
            wide_grid=wide_grid,
            atr_mult=atr_mult,
            first_half_only=first_half_only,
            exit_mode=exit_mode,
            break_even_offset_pct=break_even_offset_pct,
        )
    except Exception as e:
        return HttpResponse(
            f"Failed to generate BOOM report PDF: {e}",
            status=500,
            content_type="text/plain; charset=utf-8",
        )

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import cm
        from reportlab.pdfgen import canvas
    except Exception as e:
        return HttpResponse(
            f"reportlab import error: {e}",
            status=500,
            content_type="text/plain; charset=utf-8",
        )

    analysis = res.get("analysis", {}) or {}
    best = analysis.get("best", {}) or {}
    top = res.get("top", []) or []
    charts = _render_boom_pngs(top)

    def f2(v, fallback=0.0):
        try:
            return float(v)
        except Exception:
            return float(fallback)

    def i0(v, fallback=0):
        try:
            return int(v)
        except Exception:
            return int(fallback)

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    x_left = 1.5 * cm
    y = height - 1.7 * cm

    c.setTitle("M4D_BOOM_Backtest_Clipsheet")
    c.setFont("Helvetica-Bold", 15)
    c.drawString(x_left, y, "M4D BOOM Backtest Clip Sheet")
    y -= 0.6 * cm

    c.setFont("Helvetica", 9)
    c.drawString(
        x_left,
        y,
        f"Dataset: {res.get('dataset', 'n/a')}   Tested: {res.get('tested', 0)} parameter sets",
    )
    y -= 0.45 * cm
    c.drawString(
        x_left,
        y,
        (
            f"Signal: {res.get('signal_source', 'arrows')}   "
            f"Exit: {res.get('exit_mode', 'ema13')}   "
            f"BE offset: +{float(res.get('break_even_offset_pct', 0.05)):.2f}%   "
            f"ATR gate: > {float(res.get('atr_mult', 1.0)):.2f}x avg   "
            f"First-half only: {bool(res.get('first_half_only', False))}"
        ),
    )
    y -= 0.45 * cm
    if res.get("wide_grid"):
        c.drawString(x_left, y, "Grid: wide (more parameter combinations)")
        y -= 0.45 * cm
    c.drawString(
        x_left,
        y,
        "Score = return - 0.35 * |max drawdown| + 0.05 * win rate",
    )
    y -= 0.75 * cm

    c.setFont("Helvetica-Bold", 11)
    c.drawString(x_left, y, "Best Setup")
    y -= 0.45 * cm
    c.setFont("Helvetica", 9)
    best_line = (
        f"SQ {i0(best.get('squeeze_len'))} | DV {i0(best.get('darvas_lookback'))} | "
        f"RVOL {f2(best.get('rvol_mult')):.2f} | HOLD {i0(best.get('hold_bars'))} | "
        f"GROK-X {f2(best.get('grok_x_weight')):.2f}"
    )
    c.drawString(x_left, y, best_line)
    y -= 0.42 * cm
    perf_line = (
        f"Return {f2(best.get('return_pct')):.2f}%   "
        f"Win {f2(best.get('win_rate_pct')):.2f}%   "
        f"Max DD {f2(best.get('max_dd_pct')):.2f}%   "
        f"Trades {i0(best.get('trades'))}"
    )
    c.drawString(x_left, y, perf_line)
    y -= 0.7 * cm

    c.setFont("Helvetica-Bold", 11)
    c.drawString(x_left, y, "Top Configurations")
    y -= 0.45 * cm

    c.setFont("Helvetica-Bold", 8)
    c.drawString(x_left, y, "#")
    c.drawString(x_left + 0.55 * cm, y, "SYM")
    c.drawString(x_left + 1.45 * cm, y, "SQ")
    c.drawString(x_left + 2.25 * cm, y, "DV")
    c.drawString(x_left + 3.05 * cm, y, "RV")
    c.drawString(x_left + 4.05 * cm, y, "HD")
    c.drawString(x_left + 4.95 * cm, y, "GK")
    c.drawString(x_left + 6.15 * cm, y, "RET%")
    c.drawString(x_left + 8.0 * cm, y, "WIN%")
    c.drawString(x_left + 9.85 * cm, y, "DD%")
    c.drawString(x_left + 11.5 * cm, y, "TR")
    y -= 0.35 * cm

    c.setFont("Helvetica", 8)
    max_rows = min(12, len(top))
    for idx in range(max_rows):
        row = top[idx]
        if y < 2.0 * cm:
            c.showPage()
            y = height - 1.8 * cm
            c.setFont("Helvetica", 8)
        c.drawString(x_left, y, str(idx + 1))
        c.drawString(x_left + 0.55 * cm, y, str(row.get("symbol", ""))[:5])
        c.drawRightString(x_left + 2.05 * cm, y, str(i0(row.get("squeeze_len"))))
        c.drawRightString(x_left + 2.85 * cm, y, str(i0(row.get("darvas_lookback"))))
        c.drawRightString(x_left + 3.75 * cm, y, f"{f2(row.get('rvol_mult')):.2f}")
        c.drawRightString(x_left + 4.65 * cm, y, str(i0(row.get("hold_bars"))))
        c.drawRightString(x_left + 5.75 * cm, y, f"{f2(row.get('grok_x_weight')):.2f}")
        c.drawRightString(x_left + 7.35 * cm, y, f"{f2(row.get('return_pct')):.2f}")
        c.drawRightString(x_left + 9.1 * cm, y, f"{f2(row.get('win_rate_pct')):.2f}")
        c.drawRightString(x_left + 10.85 * cm, y, f"{f2(row.get('max_dd_pct')):.2f}")
        c.drawRightString(x_left + 12.35 * cm, y, str(i0(row.get("trades"))))
        y -= 0.34 * cm

    y -= 0.3 * cm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x_left, y, "Averages")
    y -= 0.4 * cm
    c.setFont("Helvetica", 9)
    c.drawString(
        x_left,
        y,
        (
            f"All runs — Return {f2(analysis.get('avg_return_pct')):.2f}% | "
            f"Win {f2(analysis.get('avg_win_rate_pct')):.2f}% | "
            f"Max DD {f2(analysis.get('avg_max_dd_pct')):.2f}% | "
            f"Trades {f2(analysis.get('avg_trades')):.1f}"
        ),
    )
    y -= 0.4 * cm
    c.drawString(
        x_left,
        y,
        (
            f"Eligible — Return {f2(analysis.get('avg_eligible_return_pct')):.2f}% | "
            f"Win {f2(analysis.get('avg_eligible_win_rate_pct')):.2f}% | "
            f"Max DD {f2(analysis.get('avg_eligible_max_dd_pct')):.2f}% | "
            f"Trades {f2(analysis.get('avg_eligible_trades')):.1f}"
        ),
    )
    y -= 0.4 * cm
    tb = analysis.get("top_bucket_avg") or {}
    c.drawString(
        x_left,
        y,
        (
            f"Top bucket — Return {f2(tb.get('return_pct')):.2f}% | "
            f"Win {f2(tb.get('win_rate_pct')):.2f}% | "
            f"Max DD {f2(tb.get('max_dd_pct')):.2f}% | "
            f"Trades {f2(tb.get('trades')):.1f}"
        ),
    )
    y -= 0.45 * cm
    for ps in (analysis.get("per_symbol") or [])[:8]:
        c.drawString(
            x_left,
            y,
            (
                f"{ps.get('symbol', '?')}: ret {f2(ps.get('avg_return_pct')):.2f}% "
                f"(σ {f2(ps.get('std_return_pct')):.2f}%) · "
                f"win {f2(ps.get('avg_win_rate_pct')):.1f}% · DD {f2(ps.get('avg_max_dd_pct')):.2f}% · "
                f"tr {f2(ps.get('avg_trades')):.1f} · "
                f"n={i0(ps.get('runs'))} (≥min {i0(ps.get('meets_min_runs'))})"
            ),
        )
        y -= 0.34 * cm
    y -= 0.3 * cm

    try:
        from reportlab.lib.utils import ImageReader

        if charts.get("returns_png"):
            c.setFont("Helvetica-Bold", 10)
            c.drawString(x_left, y, "Visual: Return vs Win Rate")
            y -= 0.2 * cm
            c.drawImage(ImageReader(BytesIO(charts["returns_png"])), x_left, y - 5.0 * cm, width=16.8 * cm, height=5.0 * cm, preserveAspectRatio=True, mask="auto")
            y -= 5.4 * cm
        if charts.get("risk_png"):
            if y < 6.3 * cm:
                c.showPage()
                y = height - 1.8 * cm
            c.setFont("Helvetica-Bold", 10)
            c.drawString(x_left, y, "Visual: Risk/Reward Map")
            y -= 0.2 * cm
            c.drawImage(ImageReader(BytesIO(charts["risk_png"])), x_left, y - 5.0 * cm, width=16.8 * cm, height=5.0 * cm, preserveAspectRatio=True, mask="auto")
    except Exception:
        pass

    c.showPage()
    c.save()
    buffer.seek(0)
    return FileResponse(
        buffer,
        as_attachment=True,
        filename="M4D_BOOM_Backtest_Clipsheet.pdf",
        content_type="application/pdf",
    )


@csrf_exempt
def m4d_api_forward(request, upstream_relpath: str):
    """Proxy to `m4d-api` so MISSION embed (`VITE_M4D_API_URL=/`) works on Django :8050."""
    base = getattr(settings, "M4D_API_UPSTREAM", "http://127.0.0.1:3330").rstrip("/")
    path = (upstream_relpath or "").strip("/")
    url = f"{base}/{path}"
    qs = request.META.get("QUERY_STRING", "")
    if qs:
        url = f"{url}?{qs}"

    method = request.method
    data = request.body if method in ("POST", "PUT", "PATCH") else None
    req = urllib.request.Request(url, data=data, method=method)
    ct_in = request.headers.get("Content-Type")
    if ct_in:
        req.add_header("Content-Type", ct_in)

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read()
            status = resp.getcode() or 200
            out_ct = resp.headers.get("Content-Type", "application/octet-stream")
            return HttpResponse(body, status=status, content_type=out_ct)
    except urllib.error.HTTPError as e:
        payload = e.read()
        out_ct = e.headers.get("Content-Type", "text/plain") if e.headers else "text/plain"
        return HttpResponse(payload, status=e.code, content_type=out_ct)
    except Exception as e:
        return HttpResponse(
            str(e).encode("utf-8"),
            status=502,
            content_type="text/plain; charset=utf-8",
        )


@csrf_exempt
def m4d_v1_forward(request, upstream_path: str):
    tail = (upstream_path or "").strip("/")
    rel = "v1" if not tail else f"v1/{tail}"
    return m4d_api_forward(request, rel)


def mission_spa(request, rest: str):
    """Serve Vite MISSION production build (`npm run build:embed`)."""
    if request.method != "GET":
        from django.http import HttpResponseNotAllowed

        return HttpResponseNotAllowed(["GET"])

    root: Path = settings.MISSION_DIST_ROOT
    if not root.is_dir():
        raise Http404(
            "MISSION build missing — run: cd M4D && npm run build:embed → build/mission/"
        )

    root = root.resolve()
    rel = (rest or "").strip("/")
    candidate = (root / rel).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as e:
        raise Http404("invalid path") from e

    if candidate.is_file():
        return FileResponse(candidate.open("rb"))

    index = root / "index.html"
    if index.is_file():
        return FileResponse(index.open("rb"))
    raise Http404("MISSION index.html missing")


def algo_signal_page(request):
    """
    Grid sweep for any signal in SIGNAL_REGISTRY.
    URL: /algo-signal/?signal=ema_ribbon&symbol=NVDA&tf=5m&period=60d&min_trades=5&format=json

    signal      — one of: ema_ribbon, ob_fvg, kc_breakout, accel_range, mfi_cross, stage2, choc_bos
    symbol      — single ticker (default SPY); scan=1 runs full liquid universe
    scan        — 1 = liquid universe sweep; 0 = single symbol
    tf          — timeframe (default 5m for intraday signals, 1d for stage2)
    period      — yfinance period string (default 60d / 6mo)
    min_trades  — minimum trades to be eligible (default 5)
    eod         — 1 = flat end-of-day (intraday only)
    format=json — return raw JSON manifest
    """
    want_json = request.GET.get("format", "").lower() == "json"
    signal_name = request.GET.get("signal", "ema_ribbon").strip().lower()
    if signal_name not in SIGNAL_REGISTRY:
        valid = list(SIGNAL_REGISTRY.keys())
        if want_json:
            return JsonResponse({"ok": False, "error": f"Unknown signal. Valid: {valid}"}, status=400)
        return HttpResponse(f"Unknown signal '{signal_name}'. Valid: {valid}", status=400)

    reg = SIGNAL_REGISTRY[signal_name]
    default_tf = "1d" if reg["timeframe"] == "1d" else "5m"
    default_period = BOOM_DEFAULT_DAILY_PERIOD if reg["timeframe"] == "1d" else BOOM_DEFAULT_INTRADAY_PERIOD

    scan = request.GET.get("scan", "0") in ("1", "true", "yes", "on")
    timeframe = request.GET.get("tf", default_tf)
    period = request.GET.get("period", default_period)
    flat_eod = request.GET.get("eod", "1" if scan else "0") in ("1", "true", "yes", "on")
    min_trades = int(request.GET.get("min_trades", "5"))
    sym_raw = request.GET.get("symbol", request.GET.get("symbols", BOOM_DEFAULT_BENCH_SYMBOL)).strip()
    universe = [s.strip().upper() for s in sym_raw.split(",") if s.strip()] if scan else [sym_raw.upper()]

    try:
        frames, data_source = _load_universe_frames(universe, timeframe, period)
    except Exception as exc:
        if want_json:
            return JsonResponse({"ok": False, "error": str(exc)}, status=500)
        return HttpResponse(f"Data load error: {exc}", status=500)

    all_rows: list[dict] = []
    errors: list[str] = []
    for sym, df in frames.items():
        try:
            rows = run_signal_grid(signal_name, df, symbol=sym, flat_eod=flat_eod, min_trades=min_trades)
            all_rows.extend(rows)
        except Exception as exc:
            errors.append(f"{sym}: {exc}")

    all_rows.sort(key=lambda r: r["boom_rank_score"], reverse=True)
    top = all_rows[:20]

    manifest = {
        "ok": True,
        "signal": signal_name,
        "description": reg["description"],
        "timeframe": timeframe,
        "period": period,
        "data_source": data_source,
        "scan": scan,
        "symbols": list(frames.keys()),
        "combos_per_symbol": grid_combo_count(signal_name),
        "total_rows": len(all_rows),
        "min_trades": min_trades,
        "top": _sanitize_for_json(top),
        "errors": errors,
    }

    if want_json:
        return JsonResponse(manifest)

    return JsonResponse(manifest)  # HTML template can be added later; JSON works for React UI


def algo_optimize_page(request):
    """
    Optuna TPE parameter search — much faster than Cartesian grid.
    Finds high-scoring regions in ~80 trials vs 243+ grid combos.

    URL: /algo-optimize/?signal=ob_fvg&symbol=NVDA&tf=15m&period=60d
         &n_trials=80&min_trades=5&scan=0&importance=0&format=json

    scan=1     → multi-symbol breadth optimization (mean score across universe)
    importance=1 → also return param importance scores
    format=json  → raw JSON (default); omit for same
    """
    want_json = request.GET.get("format", "json").lower() == "json"
    signal_name = request.GET.get("signal", "ob_fvg").strip().lower()

    all_valid = list(SEARCH_SPACES.keys())
    if signal_name not in all_valid:
        return JsonResponse({"ok": False, "error": f"Unknown signal. Valid: {all_valid}"}, status=400)

    reg = SEARCH_SPACES[signal_name]
    is_algo = signal_name in SIGNAL_REGISTRY
    default_tf = "1d" if (is_algo and SIGNAL_REGISTRY.get(signal_name, {}).get("timeframe") == "1d") else "5m"
    default_period = BOOM_DEFAULT_DAILY_PERIOD if default_tf == "1d" else BOOM_DEFAULT_INTRADAY_PERIOD

    scan = request.GET.get("scan", "0") in ("1", "true", "yes", "on")
    timeframe = request.GET.get("tf", default_tf)
    period = request.GET.get("period", default_period)
    flat_eod = request.GET.get("eod", "1" if scan else "0") in ("1", "true", "yes", "on")
    n_trials = min(500, max(10, int(request.GET.get("n_trials", "80"))))
    min_trades = int(request.GET.get("min_trades", "5"))
    timeout = float(request.GET.get("timeout", "90"))
    want_importance = request.GET.get("importance", "0") in ("1", "true", "yes", "on")
    sym_raw = request.GET.get("symbol", request.GET.get("symbols", BOOM_DEFAULT_BENCH_SYMBOL)).strip()
    universe = [s.strip().upper() for s in sym_raw.split(",") if s.strip()] if scan else [sym_raw.upper()]

    try:
        frames, data_source = _load_universe_frames(universe, timeframe, period)
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)

    if not frames:
        return JsonResponse({"ok": False, "error": "No data loaded"}, status=500)

    try:
        if scan and len(frames) > 1:
            top = optimize_signal_multisymbol(
                signal_name, frames, flat_eod=flat_eod,
                n_trials=n_trials, min_trades=min_trades, timeout=timeout,
            )
        else:
            sym = list(frames.keys())[0]
            df = frames[sym]
            top = optimize_signal(
                signal_name, df, symbol=sym, flat_eod=flat_eod,
                n_trials=n_trials, min_trades=min_trades, timeout=timeout,
            )

        importance = {}
        if want_importance and not scan:
            sym = list(frames.keys())[0]
            rpt = importance_report(signal_name, frames[sym], symbol=sym,
                                    n_trials=max(n_trials, 80), min_trades=min_trades)
            importance = rpt.get("param_importance", {})

    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)

    manifest = {
        "ok": True,
        "engine": "optuna-tpe",
        "signal": signal_name,
        "timeframe": timeframe,
        "period": period,
        "data_source": data_source,
        "scan": scan,
        "symbols": list(frames.keys()),
        "n_trials": n_trials,
        "min_trades": min_trades,
        "search_space": {k: list(v) for k, v in SEARCH_SPACES[signal_name].items()},
        "top": _sanitize_for_json(top),
        "param_importance": _sanitize_for_json(importance),
    }
    return JsonResponse(manifest)


def boom_tearsheet_page(request):
    """
    Full backtesting.py tearsheet via Bokeh — equity curve, drawdown, trades on chart.
    URL: /boom-tearsheet/?symbol=NVDA&tf=5m&period=60d&signal=darvas

    Returns an HTML page with embedded interactive Bokeh chart.
    Same params as /boom-visual/. Interface unchanged.
    """
    import traceback

    signal_param = request.GET.get("signal", "darvas").strip().lower()
    is_algo = signal_param in SIGNAL_REGISTRY
    scan = request.GET.get("scan", "1") in ("1", "true", "yes", "on")
    timeframe = request.GET.get("tf", "5m" if scan else "1d")
    period = request.GET.get("period", BOOM_DEFAULT_INTRADAY_PERIOD if scan else BOOM_DEFAULT_DAILY_PERIOD)
    flat_eod = request.GET.get("eod", "1" if scan else "0") in ("1", "true", "yes", "on")
    symbol = request.GET.get("symbol", "TSLA" if scan else BOOM_DEFAULT_BENCH_SYMBOL).strip().upper()
    max_bars = max(50, int(request.GET.get("max_bars", "500")))

    squeeze_len = int(request.GET.get("sq", "14"))
    darvas_lb = int(request.GET.get("dv", "10"))
    rvol_mult = float(request.GET.get("rvol", "1.2"))
    hold_bars = int(request.GET.get("hold", "3"))
    atr_mult = float(request.GET.get("atr_mult", "1.05"))
    first_half_only = request.GET.get("first_half", "1" if scan else "0") in ("1", "true", "yes", "on")
    exit_mode = request.GET.get("exit", "ema13").strip().lower()
    break_even_offset_pct = float(request.GET.get("be_off", "0.05"))
    signal_source = signal_param if signal_param in ("darvas", "arrows") else "darvas"

    try:
        frames, data_source = _load_universe_frames([symbol], timeframe, period)
        if symbol not in frames:
            raise ValueError(f"No bars for {symbol}")
        df_full = frames[symbol]
        mb = max(50, int(max_bars))
        df = df_full.tail(mb) if len(df_full) > mb else df_full

        if is_algo:
            reg = SIGNAL_REGISTRY[signal_param]
            default_p = reg["default_params"]
            fields = {f: getattr(default_p, f) for f in default_p.__dataclass_fields__}
            p_obj = reg["params_cls"](**fields)
            feat = reg["features_fn"](df, p_obj)
            hold_b = p_obj.hold_bars
            sl_pct = p_obj.stop_loss_pct
            ex_mode = p_obj.exit_mode
            be_off = getattr(p_obj, "break_even_offset_pct", 0.05)
        else:
            p_obj = boom_params_for_viz(
                timeframe, squeeze_len, darvas_lb, rvol_mult, hold_bars,
                signal_source=signal_source, atr_mult=atr_mult,
                first_half_only=first_half_only, exit_mode=exit_mode,
                break_even_offset_pct=break_even_offset_pct,
            )
            from .boom_backtest import _boom_features
            feat = _boom_features(df, p_obj)
            hold_b, sl_pct, ex_mode = p_obj.hold_bars, p_obj.stop_loss_pct, p_obj.exit_mode
            be_off = p_obj.break_even_offset_pct

        strat = _make_strategy(feat, hold_b, sl_pct, flat_eod, ex_mode, be_off)

        from backtesting import Backtest
        import warnings, tempfile, os
        bt = Backtest(df, strat, cash=100_000, commission=0.0015, spread=0.0008,
                      exclusive_orders=True, finalize_trades=True)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            stats = bt.run()

        # backtesting.py plot() → Bokeh HTML in a temp file
        tmp = tempfile.NamedTemporaryFile(suffix=".html", delete=False)
        tmp.close()
        bt.plot(filename=tmp.name, open_browser=False)
        with open(tmp.name, "r", encoding="utf-8") as f:
            bokeh_html = f.read()
        os.unlink(tmp.name)

        # Inject M4D nav bar into the Bokeh output
        nav = f"""
<div style="background:#050911;color:#e2e8f0;padding:0.5rem 1.2rem;font-family:'Barlow Condensed',sans-serif;font-size:0.85rem;border-bottom:1px solid #0d1f35;display:flex;gap:1.5rem;align-items:center">
  <a href="/" style="color:#22d3ee;font-weight:700;text-decoration:none;letter-spacing:0.15em">M4D</a>
  <a href="/boom-visual/?symbol={symbol}&tf={timeframe}&period={period}&signal={signal_param}&scan={'1' if scan else '0'}&eod={'1' if flat_eod else '0'}" style="color:#475569;text-decoration:none">← VISUAL</a>
  <span style="color:#475569;font-size:0.75rem">{symbol} · {signal_param.upper()} · {timeframe} · {period} · Trades: {int(stats.get('# Trades',0))} · Return: {float(stats.get('Return [%]',0) or 0):.2f}%</span>
  <a href="/algo-optimize/?signal={signal_param}&symbol={symbol}&tf={timeframe}&period={period}&n_trials=80&format=json" style="color:#818cf8;text-decoration:none;margin-left:auto">OPTIMIZE →</a>
</div>"""
        bokeh_html = bokeh_html.replace("<body>", "<body>" + nav, 1)
        return HttpResponse(bokeh_html, content_type="text/html")

    except Exception as exc:
        err_detail = traceback.format_exc()
        return HttpResponse(
            f"<pre style='background:#0d1117;color:#ef4444;padding:1rem'>{exc}\n\n{err_detail}</pre>",
            content_type="text/html", status=500
        )


def cache_admin_page(request):
    """
    SQLite bar cache admin + ATR compression scanner.
    GET  /cache/              → stats + controls
    GET  /cache/?action=clear → wipe all cache
    GET  /cache/?action=clear&symbol=NVDA → wipe one symbol
    GET  /cache/?action=scan&interval=1d&period=2y → ATR compression scan (full universe)
    GET  /cache/?action=swarm&signal=stage2&interval=1d&period=2y → signal swarm across universe
    All return JSON.
    """
    action = request.GET.get("action", "stats")
    want_json = request.GET.get("format", "json") == "json"

    if action == "stats":
        return JsonResponse({"ok": True, **cache_stats()})

    if action == "clear":
        sym = request.GET.get("symbol", "").strip().upper() or None
        interval = request.GET.get("interval", "").strip() or None
        n = cache_invalidate(symbol=sym, interval=interval)
        return JsonResponse({"ok": True, "deleted": n, "symbol": sym, "interval": interval})

    if action == "scan":
        interval = request.GET.get("interval", "1d")
        period = request.GET.get("period", "2y")
        sym_raw = request.GET.get("symbols", "").strip()
        universe = (
            [s.strip().upper() for s in sym_raw.split(",") if s.strip()]
            or list(BOOM_LIQUID_UNIVERSE_DEFAULT)
        )
        try:
            results = scan_atr_compression(universe, interval=interval, period=period)
            return JsonResponse({
                "ok": True,
                "action": "scan",
                "interval": interval,
                "period": period,
                "symbols_scanned": len(universe),
                "results": _sanitize_for_json(results),
            })
        except Exception as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=500)

    if action == "swarm":
        signal_name = request.GET.get("signal", "stage2").strip().lower()
        interval = request.GET.get("interval", "1d")
        period = request.GET.get("period", "2y")
        min_trades = int(request.GET.get("min_trades", "3"))
        sym_raw = request.GET.get("symbols", "").strip()
        universe = (
            [s.strip().upper() for s in sym_raw.split(",") if s.strip()]
            or list(BOOM_LIQUID_UNIVERSE_DEFAULT)
        )
        if signal_name not in SIGNAL_REGISTRY:
            return JsonResponse({"ok": False, "error": f"Unknown signal: {signal_name}"}, status=400)
        try:
            rows = run_swarm(signal_name, universe, interval=interval, period=period,
                             min_trades=min_trades)
            return JsonResponse({
                "ok": True,
                "action": "swarm",
                "signal": signal_name,
                "interval": interval,
                "period": period,
                "symbols_scanned": len(universe),
                "results_with_trades": len(rows),
                "top": _sanitize_for_json(rows[:20]),
            })
        except Exception as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=500)

    return JsonResponse({"ok": False, "error": f"Unknown action: {action}"}, status=400)


# ═══════════════════════════════════════════════════════════════════════════════
# JEDI-00  —  master ensemble signal views
# ═══════════════════════════════════════════════════════════════════════════════

def jedi_visual_page(request):
    """
    Single-symbol JEDI-00 run with image sheet.

    URL:  /jedi-visual/?symbol=SPY&tf=5m&period=60d[&format=json|png]

    format=png  → returns JEDI-00 image sheet as PNG (6-panel dark dashboard)
    format=json → returns result dict as JSON
    (default)   → JSON (HTML template TBD)

    Params:
      symbol          — ticker (default SPY)
      tf              — timeframe (default 5m)
      period          — yfinance period (default 60d)
      eod             — 1 = flat EOD (default 0)
      first_half      — 1 = first-half session only (default 0)
      min_agree       — council vote threshold (default 3)
      accel_bars      — acceleration window (default 3)
      decel_window    — decel-exit watch window (default 2)
      decel_thresh    — body-shrink threshold (default 0.4)
      kelly_base      — Kelly base fraction (default 0.08)
      stop_pct        — hard stop % (default 0.5)
      profit_target   — partial-close target % (default 0.8)
      hold_bars       — max hold bars (default 6)
      exit_mode       — ema13 | holdbars (default ema13)
    """
    from .jedi_signal import JediParams, jedi_run_one, jedi_image_sheet

    fmt = request.GET.get("format", "json").strip().lower()
    symbol = request.GET.get("symbol", BOOM_DEFAULT_BENCH_SYMBOL).strip().upper()
    # 1m bars for precision decel-exit; yfinance allows 1m for last 7 days
    timeframe = request.GET.get("tf", "1m")
    period = request.GET.get("period", "7d")
    flat_eod = request.GET.get("eod", "0") in ("1", "true", "yes", "on")
    first_half = request.GET.get("first_half", "0") in ("1", "true", "yes", "on")

    p = JediParams(
        min_agree=int(request.GET.get("min_agree", "3")),
        accel_bars=int(request.GET.get("accel_bars", "3")),
        decel_window=int(request.GET.get("decel_window", "2")),
        decel_thresh=float(request.GET.get("decel_thresh", "0.4")),
        kelly_base_fraction=float(request.GET.get("kelly_base", "0.08")),
        stop_loss_pct=float(request.GET.get("stop_pct", "0.5")),
        profit_target_pct=float(request.GET.get("profit_target", "0.8")),
        hold_bars=int(request.GET.get("hold_bars", "6")),
        exit_mode=request.GET.get("exit_mode", "ema13").strip().lower(),
        first_half_only=first_half,
        flat_eod=flat_eod,
    )

    try:
        frames, data_source = _load_universe_frames([symbol], timeframe, period)
        if symbol not in frames:
            raise ValueError(f"No bars returned for {symbol}")
        df = frames[symbol]
    except Exception as exc:
        if fmt == "png":
            return HttpResponse(f"Data error: {exc}", status=500, content_type="text/plain")
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)

    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            result = jedi_run_one(df, p, symbol=symbol, flat_eod=flat_eod)
        stats = result.pop("_stats")
    except Exception as exc:
        if fmt == "png":
            return HttpResponse(f"Backtest error: {exc}", status=500, content_type="text/plain")
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)

    if fmt == "png":
        try:
            png = jedi_image_sheet(df, stats, p, symbol=symbol,
                                   timeframe=timeframe, period=period)
            return HttpResponse(png, content_type="image/png")
        except Exception as exc:
            return HttpResponse(f"Image error: {exc}", status=500, content_type="text/plain")

    manifest = {
        "ok": True,
        "signal": "jedi_00",
        "symbol": symbol,
        "timeframe": timeframe,
        "period": period,
        "data_source": data_source,
        "bars": len(df),
        "image_url": (
            f"/jedi-visual/?symbol={symbol}&tf={timeframe}&period={period}"
            f"&min_agree={p.min_agree}&accel_bars={p.accel_bars}"
            f"&decel_window={p.decel_window}&decel_thresh={p.decel_thresh}"
            f"&kelly_base={p.kelly_base_fraction}&stop_pct={p.stop_loss_pct}"
            f"&profit_target={p.profit_target_pct}&hold_bars={p.hold_bars}"
            f"&exit_mode={p.exit_mode}&format=png"
        ),
        **_sanitize_for_json(result),
    }
    return JsonResponse(manifest)


def jedi_backtest_page(request):
    """
    Multi-symbol JEDI-00 breadth scan.

    URL:  /jedi-backtest/?symbols=SPY,QQQ,NVDA,AAPL&tf=5m&period=60d[&format=json]

    symbols   — comma-separated tickers (default: liquid universe)
    tf        — timeframe (default 5m)
    period    — yfinance period (default 60d)
    optimize  — 1 = run Optuna after grid (default 0)
    trials    — Optuna trial count (default 60)
    min_trades — minimum trades for eligibility (default 5)
    """
    from .jedi_signal import JediParams, jedi_run_one, jedi_run_grid
    from .algo_optimizer import optimize_signal

    timeframe = request.GET.get("tf", "5m")
    period = request.GET.get("period", BOOM_DEFAULT_INTRADAY_PERIOD)
    flat_eod = request.GET.get("eod", "0") in ("1", "true", "yes", "on")
    min_trades = int(request.GET.get("min_trades", "5"))
    run_optuna = request.GET.get("optimize", "0") in ("1", "true", "yes", "on")
    n_trials = int(request.GET.get("trials", "60"))

    sym_raw = request.GET.get("symbols", request.GET.get("symbol", "")).strip()
    universe = (
        [s.strip().upper() for s in sym_raw.split(",") if s.strip()]
        or list(BOOM_LIQUID_UNIVERSE_DEFAULT)[:8]  # cap default scan at 8 symbols
    )

    try:
        frames, data_source = _load_universe_frames(universe, timeframe, period)
    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)

    all_rows: list[dict] = []
    errors: list[str] = []
    optuna_results: list[dict] = []

    for sym, df in frames.items():
        try:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                if run_optuna:
                    rows = optimize_signal("jedi_00", df, symbol=sym, flat_eod=flat_eod,
                                           n_trials=n_trials, min_trades=min_trades)
                else:
                    rows = jedi_run_grid(df, symbol=sym, flat_eod=flat_eod, min_trades=min_trades)
            for r in rows:
                r.pop("_stats", None)
            all_rows.extend(rows[:5])  # top-5 per symbol
        except Exception as exc:
            errors.append(f"{sym}: {exc}")

    all_rows.sort(key=lambda r: r.get("boom_rank_score", -999), reverse=True)
    top = all_rows[:20]

    gate_pass = (
        top and
        top[0].get("boom_rank_score", -999) > 0.0 and
        top[0].get("win_rate_pct", 0) > 35 and
        top[0].get("trades", 0) >= 8
    )

    manifest = {
        "ok": True,
        "signal": "jedi_00",
        "timeframe": timeframe,
        "period": period,
        "data_source": data_source,
        "symbols_scanned": len(frames),
        "symbols": list(frames.keys()),
        "total_rows": len(all_rows),
        "min_trades": min_trades,
        "optimized": run_optuna,
        "gate_pass": gate_pass,
        "gate_rule": "boom_rank_score > 0 AND win_rate > 35% AND trades >= 8",
        "top": _sanitize_for_json(top),
        "errors": errors,
    }
    return JsonResponse(manifest)


# ── Crypto Live endpoint ───────────────────────────────────────────────────────

def crypto_live_view(request):
    """
    GET /crypto/live/
    Reads crypto_lab.sqlite written by crypto_worker.py.
    Returns ranked signal state + running sim stats + recent trades per symbol.
    Sorted by (council_vote × conviction) descending — highest edge at the top.
    """
    import sqlite3 as _sqlite3
    from pathlib import Path as _Path

    db_path = _Path(os.environ.get("M4D_CACHE_DIR", _Path.home() / ".m4d_cache")) / "crypto_lab.sqlite"

    if not db_path.exists():
        return JsonResponse({
            "ok": False,
            "error": "crypto_lab.sqlite not found — is crypto_worker.py running?",
            "symbols": [],
            "last_bar_ts": None,
            "optuna_last_run": None,
        })

    try:
        conn = _sqlite3.connect(str(db_path), check_same_thread=False)
        conn.row_factory = _sqlite3.Row

        # Signal state (one row per symbol)
        state_rows = conn.execute(
            "SELECT * FROM signal_state ORDER BY updated_at DESC"
        ).fetchall()

        # Running stats
        stats_map = {
            r["symbol"]: dict(r)
            for r in conn.execute("SELECT * FROM running_stats").fetchall()
        }

        # Last 5 sim trades per symbol
        trades_map: dict = {}
        for r in conn.execute(
            "SELECT * FROM sim_trades ORDER BY id DESC LIMIT 100"
        ).fetchall():
            sym = r["symbol"]
            if sym not in trades_map:
                trades_map[sym] = []
            if len(trades_map[sym]) < 5:
                trades_map[sym].append(dict(r))

        # Optuna params last-modified time
        optuna_path = db_path.parent / "crypto_best_params.json"
        optuna_ts = int(optuna_path.stat().st_mtime) if optuna_path.exists() else None

        conn.close()

        symbols = []
        last_bar_ts = None

        for row in state_rows:
            sym = row["symbol"]
            st = stats_map.get(sym, {})
            entry = {
                "symbol":        sym,
                "council_vote":  row["council_vote"],
                "conviction":    round(float(row["conviction"] or 0), 3),
                "jedi_entry":    bool(row["jedi_entry"]),
                "sim_state":     row["sim_state"],
                "rvol":          round(float(row["rvol"] or 0), 2),
                "atr_slope":     round(float(row["atr_slope"] or 0), 4),
                "close":         float(row["close"] or 0),
                "ts":            row["ts"],
                "win_rate":      round(float(st.get("win_rate") or 0), 3),
                "trades":        int(st.get("trades") or 0),
                "wins":          int(st.get("wins") or 0),
                "boom_rank_score": round(float(st.get("boom_rank_score") or 0), 3),
                "total_pnl_pct": round(float(st.get("total_pnl_pct") or 0), 2),
                "recent_trades": trades_map.get(sym, []),
            }
            symbols.append(entry)
            if last_bar_ts is None or (row["ts"] and row["ts"] > last_bar_ts):
                last_bar_ts = row["ts"]

        # Sort: highest council_vote × conviction first
        symbols.sort(
            key=lambda x: x["council_vote"] * x["conviction"],
            reverse=True,
        )

        return JsonResponse({
            "ok": True,
            "symbols": symbols,
            "last_bar_ts": last_bar_ts,
            "optuna_last_run": optuna_ts,
            "db_path": str(db_path),
        })

    except Exception as exc:
        return JsonResponse({"ok": False, "error": str(exc), "symbols": []}, status=500)


def engine_pressure_view(request):
    """GET /engine/pressure/ — fireman pressure gauges."""
    p = Path.home() / ".m4d_cache" / "pressure.json"
    if p.exists():
        import json
        return JsonResponse(json.loads(p.read_text()))
    return JsonResponse({"gauges": {"bars": 0, "trades": 0, "optuna_age_min": None}, "updated": 0})


def engine_proposals_view(request):
    """GET /engine/proposals/ — pending proposal queue."""
    p = Path.home() / ".m4d_cache" / "proposals.json"
    if p.exists():
        import json
        return JsonResponse(json.loads(p.read_text()))
    return JsonResponse({"proposals": []})


def engine_council_stats_view(request):
    """GET /engine/council-stats/ — live BRS/win/ret per algo from last backtests."""
    p = Path.home() / ".m4d_cache" / "council_stats.json"
    if p.exists():
        import json
        return JsonResponse(json.loads(p.read_text()))
    return JsonResponse({})


@csrf_exempt
def engine_council_stats_write(request):
    """POST /engine/council-stats/write/ — backtest result writes into council_stats.json."""
    if request.method != 'POST':
        return JsonResponse({"ok": False}, status=405)
    import json, time
    body = json.loads(request.body)
    algo_id = body.get("algo_id")
    if not algo_id:
        return JsonResponse({"ok": False, "error": "missing algo_id"}, status=400)
    p = Path.home() / ".m4d_cache" / "council_stats.json"
    stats = json.loads(p.read_text()) if p.exists() else {}
    stats[algo_id] = {
        "ret":             body.get("ret"),
        "win":             body.get("win"),
        "brs":             body.get("brs"),
        "max_dd":          body.get("max_dd"),
        "trades":          body.get("trades"),
        "symbols_tested":  body.get("symbols_tested", 0),
        "updated":         int(time.time()),
    }
    p.write_text(json.dumps(stats, indent=2))
    return JsonResponse({"ok": True, "algo_id": algo_id})
