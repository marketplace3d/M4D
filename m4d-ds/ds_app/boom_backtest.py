from __future__ import annotations

from dataclasses import dataclass
from itertools import product
import math

import numpy as np
import pandas as pd
from backtesting import Backtest, Strategy

# Default single-symbol bench when `scan=0` (no Google-era sample data).
BOOM_DEFAULT_BENCH_SYMBOL = "SPY"
# yfinance: 5m data must be within ~60 days — period=6mo with interval=5m returns empty.
BOOM_DEFAULT_INTRADAY_PERIOD = "60d"
# Daily (and liquid scan on 1d): six calendar months of bars.
BOOM_DEFAULT_DAILY_PERIOD = "6mo"
# Default multi-name universe when `scan=1` and `symbols` is empty (breadth for stat power).
BOOM_LIQUID_UNIVERSE_DEFAULT = (
    "SPY",
    "QQQ",
    "IWM",
    "XLF",
    "XLE",
    "SMH",
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "META",
    "TSLA",
    "AMD",
    "GOOGL",
    "NFLX",
)


@dataclass(frozen=True)
class BoomParams:
    squeeze_len: int
    darvas_lookback: int
    rvol_mult: float
    hold_bars: int
    grok_x_weight: float = 0.45
    min_vote: int = 3
    stop_loss_pct: float = 0.7
    signal_source: str = "arrows"
    atr_mult: float = 1.05
    first_half_only: bool = False
    exit_mode: str = "ema13"
    break_even_offset_pct: float = 0.05


# Sweep grids (single source of truth for HTML/PDF/JSON manifest and docs).
BOOM_GRID_LIQUID_NARROW = ([14, 20], [10, 20], [1.2, 1.5], [3, 6])
BOOM_GRID_LIQUID_WIDE = (
    [12, 14, 20, 26],
    [8, 10, 15, 20],
    [1.2, 1.35, 1.5, 1.75],
    [3, 5, 8],
)
BOOM_GRID_DAILY = ([14, 20, 30], [10, 20, 30], [1.2, 1.5, 2.0], [5, 8, 12])
# Positional BoomParams fields (squeeze, darvas, rvol, hold) are gridded; these are fixed per sweep.
BOOM_LIQUID_SWEEP_FIXED = {"grok_x_weight": 0.45, "min_vote": 3, "stop_loss_pct": 0.65}
BOOM_DAILY_SWEEP_FIXED = {"grok_x_weight": 0.45, "min_vote": 3, "stop_loss_pct": 0.7}


def boom_expansion_param_list(
    *,
    liquid_scan: bool,
    wide_grid: bool,
    signal_source: str,
    atr_mult: float,
    first_half_only: bool,
    exit_mode: str,
    break_even_offset_pct: float,
) -> list[BoomParams]:
    """Cartesian BOOM expansion params (same grids as `run_boom_expansion_grid`)."""
    if liquid_scan:
        grid_axes = BOOM_GRID_LIQUID_WIDE if wide_grid else BOOM_GRID_LIQUID_NARROW
        grid = product(*grid_axes)
        fx = BOOM_LIQUID_SWEEP_FIXED
    else:
        grid = product(*BOOM_GRID_DAILY)
        fx = BOOM_DAILY_SWEEP_FIXED
    return [
        BoomParams(
            a,
            b,
            c,
            d,
            fx["grok_x_weight"],
            fx["min_vote"],
            fx["stop_loss_pct"],
            signal_source=signal_source,
            atr_mult=atr_mult,
            first_half_only=first_half_only,
            exit_mode=exit_mode,
            break_even_offset_pct=break_even_offset_pct,
        )
        for a, b, c, d in grid
    ]


def boom_signal_energy_model_doc() -> dict:
    """
    Human + machine-readable description of BOOM "energy" (conviction) in `_boom_features`.
    Exposed in JSON manifest as `signal_energy_model`; stays in sync with code in this module.
    """
    return {
        "schema_version": 1,
        "code": "ds_app.boom_backtest:_boom_features",
        "note": (
            "Dashboard 'ENERGY CUE' widgets elsewhere are not this backtest; here energy is "
            "the vote/score stack below."
        ),
        "boom_vote": {
            "description": "Integer count of Boolean conditions; Darvas path also requires boom_vote >= min_vote.",
            "components": [
                {
                    "id": "squeeze_compressed",
                    "contributes": 1,
                    "definition": "Bollinger bands fully inside Keltner channels (BB/KC squeeze).",
                },
                {
                    "id": "squeeze_release",
                    "contributes": 1,
                    "definition": "Prior bar squeezed; this bar does not (expansion begins).",
                },
                {
                    "id": "relative_volume",
                    "contributes": 1,
                    "definition": "volume / 20-bar mean volume > rvol_mult parameter.",
                    "baseline_bars": 20,
                },
                {
                    "id": "trend",
                    "contributes": 2,
                    "definition": "Close > EMA(50).",
                    "ema_span": 50,
                },
            ],
            "max_raw_vote": 5,
        },
        "boom_score": {
            "description": (
                "Continuous blend before ATR gate; grok_x_weight mixes toward trend-only as a "
                "placeholder for external sentiment (X API, etc.)."
            ),
            "weights_on_boolean_components": {
                "squeeze_release": 0.35,
                "darvas_breakout": 0.30,
                "rvol_ratio_clamped_0_2": 0.20,
                "trend_close_above_ema50": 0.15,
            },
            "rvol_ratio": "min(rvol / rvol_mult, 2.0)",
            "grok_x_blend": "(1 - grok_x_weight) * base_score + grok_x_weight * trend",
        },
        "darvas_breakout": {
            "definition": "High > max(high.shift(1), rolling lookback); classic Darvas box lift.",
        },
        "slingshot_long_arrows": {
            "definition": "EMA(38) > EMA(62), prior close below EMA(38), current close above EMA(38).",
            "ema_fast": 38,
            "ema_slow": 62,
        },
        "entry_masks": {
            "darvas": (
                "darvas_breakout & (rvol > rvol_mult) & trend & (boom_vote >= min_vote) "
                "& atr_gate [& first_half_mask if first_half_only]"
            ),
            "arrows": "slingshot_long & atr_gate [& first_half_mask if first_half_only]",
        },
        "atr_gate": {
            "definition": "Wilder-style EWM TR: fast span 14 vs base span 50 on same series; require fast > atr_mult * base.",
        },
        "exit_stack_code": "ds_app.boom_backtest:_make_strategy (stop, BE lock, ema13|holdbars, flat_eod)",
    }


def boom_run_record(
    *,
    url_params: dict,
    liquid_scan: bool,
    wide_grid: bool,
    result: dict,
    limit_top: int,
) -> dict:
    """Full option manifest for iteration, notebooks, and future API clients (e.g. X sentiment)."""
    if liquid_scan:
        axes = BOOM_GRID_LIQUID_WIDE if wide_grid else BOOM_GRID_LIQUID_NARROW
        sweep_fixed = dict(BOOM_LIQUID_SWEEP_FIXED)
    else:
        axes = BOOM_GRID_DAILY
        sweep_fixed = dict(BOOM_DAILY_SWEEP_FIXED)
    squeezes, darvas, rvols, holds = axes
    combos = len(squeezes) * len(darvas) * len(rvols) * len(holds)
    return {
        "schema_version": 1,
        "url_params": url_params,
        "limit_top": int(limit_top),
        "execution_constants": {
            "backtest_cash": 100_000,
            "commission": 0.0015,
            "spread": 0.0008,
            "exclusive_orders": True,
            "finalize_trades": True,
            "atr_fast_ewm_span": 14,
            "atr_base_ewm_span": 50,
            "first_half_et": {
                "start": "09:30",
                "end_exclusive": "12:45",
                "tz": "America/New_York",
            },
            "trend_ema_span": 50,
            "slingshot_ema_fast": 38,
            "slingshot_ema_slow": 62,
            "exit_ema_span": 13,
            "rvol_baseline_length": 20,
            "boom_vote_trend_multiplier": 2,
            "break_even_offset_pct": 0.05,
        },
        "sweep": {
            "liquid_scan": liquid_scan,
            "wide_grid": wide_grid,
            "axes": {
                "squeeze_len": list(squeezes),
                "darvas_lookback": list(darvas),
                "rvol_mult": list(rvols),
                "hold_bars": list(holds),
            },
            "combinations_per_symbol": combos,
            "total_runs": int(result.get("tested", 0)),
            "fixed_across_sweep": sweep_fixed,
            "ranking": {
                "score": "return_pct - 0.35 * abs(max_dd_pct) + 0.05 * win_rate_pct",
                "rank_pool": "rows with trades >= min_trades if any exist, else all rows",
            },
        },
        "result_summary": {
            k: result[k]
            for k in (
                "dataset",
                "data_source",
                "timeframe",
                "period",
                "flat_eod",
                "symbols",
                "wide_grid",
                "tested",
                "eligible",
                "meets_min_count",
                "min_trades",
                "signal_source",
                "exit_mode",
                "atr_mult",
                "first_half_only",
                "break_even_offset_pct",
            )
            if k in result
        },
        "top": result.get("top", []),
        "analysis": result.get("analysis", {}),
        "future_channels": {
            "x_sentiment": {
                "param": "BoomParams.grok_x_weight",
                "code_hook": "_boom_features: grok_x_weight scales internal score vs trend placeholder",
                "note": "Wire real X API / sentiment series into a time-aligned feature column when available.",
            },
        },
        "signal_energy_model": boom_signal_energy_model_doc(),
    }


def _rolling_squeeze(close: pd.Series, high: pd.Series, low: pd.Series, length: int) -> pd.Series:
    basis = close.rolling(length).mean()
    dev = close.rolling(length).std(ddof=0) * 2.0
    upper_bb = basis + dev
    lower_bb = basis - dev
    tr = (high - low).abs()
    avg_range = tr.ewm(span=length, adjust=False).mean()
    ema = close.ewm(span=length, adjust=False).mean()
    upper_kc = ema + avg_range * 2.0
    lower_kc = ema - avg_range * 2.0
    return (upper_bb < upper_kc) & (lower_bb > lower_kc)


def _darvas_breakout(high: pd.Series, lookback: int) -> pd.Series:
    box_high = high.shift(1).rolling(lookback).max()
    return high > box_high


def _rvol(volume: pd.Series, length: int = 20) -> pd.Series:
    return volume / volume.rolling(length).mean()


def _median_bar_spacing_seconds(index: pd.Index) -> float | None:
    """Typical seconds between consecutive timestamps; None if unknown."""
    if len(index) < 2:
        return None
    dt = pd.DatetimeIndex(index)
    deltas = dt.to_series().diff().dt.total_seconds().iloc[1:]
    if deltas.empty:
        return None
    med = float(deltas.median())
    return med if math.isfinite(med) else None


def _first_half_market_mask(index: pd.Index) -> pd.Series:
    """
    US RTH first half: 09:30 <= t < 12:45 America/New_York.

    For **daily or coarser** bars (median spacing >= 6h), timestamps from yfinance are
    often midnight UTC/`NaT`-aligned and **never** fall in that window if we localize naively,
    which would drop **all** entries. One bar = full session → return all True.
    """
    spacing = _median_bar_spacing_seconds(index)
    if spacing is not None and spacing >= 6 * 3600:
        return pd.Series(True, index=index)

    dt = pd.DatetimeIndex(index)
    if dt.tz is None:
        dt_ny = dt.tz_localize("UTC").tz_convert("America/New_York")
    else:
        dt_ny = dt.tz_convert("America/New_York")
    mins = (dt_ny.hour * 60) + dt_ny.minute
    # US regular session first half: 09:30 to <12:45 ET.
    first_half = (mins >= 570) & (mins < 765)
    return pd.Series(first_half, index=index)


def _boom_features(df: pd.DataFrame, p: BoomParams) -> pd.DataFrame:
    out = df.copy()
    squeeze = _rolling_squeeze(out["Close"], out["High"], out["Low"], p.squeeze_len).fillna(False)
    breakout = _darvas_breakout(out["High"], p.darvas_lookback).fillna(False)
    rvol = _rvol(out["Volume"]).fillna(0.0)
    trend = (out["Close"] > out["Close"].ewm(span=50, adjust=False).mean()).fillna(False)
    release = (~squeeze) & squeeze.shift(1, fill_value=False)
    out["boom_vote"] = (
        squeeze.astype(int)
        + release.astype(int)
        + (rvol > p.rvol_mult).astype(int)
        + trend.astype(int) * 2
    )
    # grok_x_weight is a future external sentiment channel; keep pluggable now.
    out["boom_score"] = (
        0.35 * release.astype(float)
        + 0.30 * breakout.astype(float)
        + 0.20 * (rvol / max(1.0, p.rvol_mult)).clip(0, 2)
        + 0.15 * trend.astype(float)
    ) * (1.0 - p.grok_x_weight) + p.grok_x_weight * trend.astype(float)

    ema_fast = out["Close"].ewm(span=38, adjust=False).mean()
    ema_slow = out["Close"].ewm(span=62, adjust=False).mean()
    ema13 = out["Close"].ewm(span=13, adjust=False).mean()
    prev_close = out["Close"].shift(1)
    slingshot_long = (ema_fast > ema_slow) & (prev_close < ema_fast) & (out["Close"] > ema_fast)
    arrow_entry = slingshot_long.fillna(False)
    out["exit_ema13"] = ((prev_close >= ema13.shift(1)) & (out["Close"] < ema13)).fillna(False)

    darvas_entry = breakout & (rvol > p.rvol_mult) & trend & (out["boom_vote"] >= int(p.min_vote))

    if p.signal_source == "darvas":
        entry = darvas_entry
    else:
        entry = arrow_entry
    prev_close = out["Close"].shift(1)
    tr = pd.concat(
        [
            (out["High"] - out["Low"]).abs(),
            (out["High"] - prev_close).abs(),
            (out["Low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr_fast = tr.ewm(span=14, adjust=False).mean()
    atr_base = atr_fast.ewm(span=50, adjust=False).mean()
    atr_gate = atr_fast > (atr_base * float(p.atr_mult))
    entry = entry & atr_gate.fillna(False)
    if p.first_half_only:
        entry = entry & _first_half_market_mask(out.index).fillna(False)
    out["entry"] = entry.fillna(False)
    out["ema13"] = ema13
    return out


def _make_strategy(
    feat_df: pd.DataFrame,
    hold_bars: int,
    stop_loss_pct: float,
    flat_eod: bool,
    exit_mode: str,
    break_even_offset_pct: float,
):
    class BoomExpansionStrategy(Strategy):
        _feat = feat_df
        _hold = hold_bars
        _stop_loss_pct = stop_loss_pct
        _flat_eod = flat_eod
        _exit_mode = exit_mode
        _break_even_offset_pct = break_even_offset_pct

        def init(self):
            self.hold_for = 0
            self.entry_price = None
            self.entry_day = None
            self.break_even_armed = False

        def next(self):
            idx = len(self.data) - 1
            if idx < 0:
                return
            now_day = pd.Timestamp(self.data.index[idx]).date()
            close_now = float(self.data.Close[-1])
            if self.position:
                if self._flat_eod and self.entry_day is not None and now_day != self.entry_day:
                    self.position.close()
                    self.hold_for = 0
                    self.entry_price = None
                    self.entry_day = None
                    self.break_even_armed = False
                    return
                if self.entry_price and close_now > self.entry_price:
                    # Protect capital quickly: once trade moves green, lift stop to entry.
                    self.break_even_armed = True
                stop_px = None
                if self.entry_price:
                    stop_px = self.entry_price * (1.0 - self._stop_loss_pct / 100.0)
                    if self.break_even_armed:
                        lock_px = self.entry_price * (1.0 + self._break_even_offset_pct / 100.0)
                        stop_px = max(stop_px, lock_px)
                if stop_px is not None and close_now <= stop_px:
                    self.position.close()
                    self.hold_for = 0
                    self.entry_price = None
                    self.entry_day = None
                    self.break_even_armed = False
                    return
                if self._exit_mode == "ema13" and bool(self._feat["exit_ema13"].iloc[idx]):
                    self.position.close()
                    self.hold_for = 0
                    self.entry_price = None
                    self.entry_day = None
                    self.break_even_armed = False
                    return
                self.hold_for += 1
                if self._exit_mode == "holdbars" and self.hold_for >= self._hold:
                    self.position.close()
                    self.hold_for = 0
                    self.entry_price = None
                    self.entry_day = None
                    self.break_even_armed = False
                return
            if bool(self._feat["entry"].iloc[idx]):
                self.buy()
                self.hold_for = 0
                self.entry_price = close_now
                self.entry_day = now_day
                self.break_even_armed = False

    return BoomExpansionStrategy


def _run_one(
    df: pd.DataFrame, p: BoomParams, symbol: str = BOOM_DEFAULT_BENCH_SYMBOL, flat_eod: bool = False
) -> dict:
    feat = _boom_features(df, p)
    strat = _make_strategy(
        feat, p.hold_bars, p.stop_loss_pct, flat_eod, p.exit_mode, p.break_even_offset_pct
    )
    # spread approximates slippage for quick realism before tick-model fills.
    bt = Backtest(
        df,
        strat,
        cash=100_000,
        commission=0.0015,
        spread=0.0008,
        exclusive_orders=True,
        finalize_trades=True,
    )
    stats = bt.run()
    return {
        "symbol": symbol,
        "squeeze_len": p.squeeze_len,
        "darvas_lookback": p.darvas_lookback,
        "rvol_mult": p.rvol_mult,
        "hold_bars": p.hold_bars,
        "grok_x_weight": p.grok_x_weight,
        "min_vote": p.min_vote,
        "stop_loss_pct": p.stop_loss_pct,
        "signal_source": p.signal_source,
        "exit_mode": p.exit_mode,
        "break_even_offset_pct": p.break_even_offset_pct,
        "atr_mult": p.atr_mult,
        "first_half_only": p.first_half_only,
        "return_pct": float(stats.get("Return [%]", 0.0)),
        "win_rate_pct": float(stats.get("Win Rate [%]", 0.0)),
        "max_dd_pct": abs(float(stats.get("Max. Drawdown [%]", 0.0))),
        "trades": int(stats.get("# Trades", 0)),
    }


def boom_params_for_viz(
    timeframe: str,
    squeeze_len: int,
    darvas_lookback: int,
    rvol_mult: float,
    hold_bars: int,
    *,
    signal_source: str,
    atr_mult: float,
    first_half_only: bool,
    exit_mode: str,
    break_even_offset_pct: float,
) -> BoomParams:
    """Same liquid vs daily risk defaults as `run_boom_expansion_grid`."""
    t = str(timeframe).strip().lower()
    intraday = t not in ("1d", "d", "daily", "1day")
    fx = BOOM_LIQUID_SWEEP_FIXED if intraday else BOOM_DAILY_SWEEP_FIXED
    return BoomParams(
        squeeze_len,
        darvas_lookback,
        rvol_mult,
        hold_bars,
        fx["grok_x_weight"],
        fx["min_vote"],
        fx["stop_loss_pct"],
        signal_source=signal_source,
        atr_mult=atr_mult,
        first_half_only=first_half_only,
        exit_mode=exit_mode,
        break_even_offset_pct=break_even_offset_pct,
    )


def run_boom_visual_bundle(
    symbol: str,
    timeframe: str,
    period: str,
    p: BoomParams,
    *,
    flat_eod: bool,
    max_bars: int = 600,
) -> dict:
    """
    Single-symbol BOOM run for charting: price, 13 EMA, and `_trades` entry/exit bars
    (indices refer to the last `max_bars` slice, not the full download).
    """
    sym = symbol.strip().upper()
    frames, data_src = _load_universe_frames([sym], timeframe, period)
    if sym not in frames:
        raise ValueError(f"No bars for {sym} ({timeframe}/{period})")
    df_full = frames[sym]
    mb = max(50, int(max_bars))
    df = df_full.tail(mb) if len(df_full) > mb else df_full
    feat = _boom_features(df, p)
    strat = _make_strategy(
        feat, p.hold_bars, p.stop_loss_pct, flat_eod, p.exit_mode, p.break_even_offset_pct
    )
    bt = Backtest(
        df,
        strat,
        cash=100_000,
        commission=0.0015,
        spread=0.0008,
        exclusive_orders=True,
        finalize_trades=True,
    )
    stats = bt.run()
    raw = stats._trades
    trades = raw.copy() if raw is not None and len(raw) > 0 else pd.DataFrame()
    return {
        "symbol": sym,
        "df": df,
        "feat": feat,
        "trades": trades,
        "stats": stats,
        "data_source": data_src,
        "timeframe": timeframe,
        "period": period,
        "bars": len(df),
    }


def _normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        # yfinance may return (field, ticker) multi-index for single ticker downloads.
        df = df.copy()
        df.columns = [str(c[0]) for c in df.columns]
    cols = {str(c).lower(): c for c in df.columns}
    mapping = {
        cols.get("open"): "Open",
        cols.get("high"): "High",
        cols.get("low"): "Low",
        cols.get("close"): "Close",
        cols.get("volume"): "Volume",
    }
    out = df.rename(columns={k: v for k, v in mapping.items() if k})
    keep = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in out.columns]
    out = out[keep].dropna()
    if not isinstance(out.index, pd.DatetimeIndex):
        out.index = pd.to_datetime(out.index, errors="coerce")
    out = out[~out.index.isna()]
    return out


def synthetic_ohlcv_bars(n: int = 400, *, seed: int = 42) -> pd.DataFrame:
    """Deterministic OHLCV for offline tests and yfinance fallback (no bundled ticker CSV)."""
    n = max(int(n), 150)
    rng = np.random.default_rng(seed)
    r = rng.normal(0.0003, 0.012, n)
    close = 100.0 * np.exp(np.cumsum(r))
    open_ = np.empty(n, dtype=float)
    open_[0] = float(close[0])
    open_[1:] = close[:-1]
    noise = rng.uniform(0.002, 0.012, n)
    high = np.maximum(open_, close) * (1.0 + noise)
    low = np.minimum(open_, close) / (1.0 + noise)
    vol = rng.uniform(1e6, 5e6, n)
    idx = pd.date_range("2018-01-01", periods=n, freq="B", tz="UTC")
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol},
        index=idx,
    )


def _load_universe_frames(
    universe: list[str], timeframe: str, period: str
) -> tuple[dict[str, pd.DataFrame], str]:
    """Fetch symbols via yfinance; if nothing usable, fill first requested symbol with synthetic bars."""
    frames: dict[str, pd.DataFrame] = {}
    try:
        import yfinance as yf

        for sym in universe:
            try:
                df = yf.download(
                    tickers=sym,
                    period=period,
                    interval=timeframe,
                    progress=False,
                    auto_adjust=False,
                    prepost=False,
                    threads=False,
                )
                nd = _normalize_ohlcv(df)
                if len(nd) >= 120:
                    frames[sym] = nd
            except Exception:
                continue
    except Exception:
        pass

    if not frames:
        sym0 = universe[0] if universe else BOOM_DEFAULT_BENCH_SYMBOL
        frames[sym0] = synthetic_ohlcv_bars(400, seed=42)
        return frames, "synthetic"
    return frames, "yfinance"


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _stdev_sample(xs: list[float]) -> float:
    if len(xs) < 2:
        return 0.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def _finite_float(x) -> float:
    try:
        v = float(x)
        return v if math.isfinite(v) else 0.0
    except Exception:
        return 0.0


def run_boom_expansion_grid(
    limit_top: int = 12,
    timeframe: str = "1d",
    period: str = "6mo",
    liquid_scan: bool = False,
    flat_eod: bool = False,
    min_trades: int = 1,
    signal_source: str = "arrows",
    symbols_override: list[str] | None = None,
    wide_grid: bool = False,
    atr_mult: float = 1.05,
    first_half_only: bool = False,
    exit_mode: str = "ema13",
    break_even_offset_pct: float = 0.05,
) -> dict:
    universe = [BOOM_DEFAULT_BENCH_SYMBOL]
    if liquid_scan:
        if symbols_override:
            universe = [s.strip().upper() for s in symbols_override if s.strip()]
        else:
            universe = list(BOOM_LIQUID_UNIVERSE_DEFAULT)
    frames, data_source = _load_universe_frames(universe, timeframe, period)

    param_list = boom_expansion_param_list(
        liquid_scan=liquid_scan,
        wide_grid=wide_grid,
        signal_source=signal_source,
        atr_mult=atr_mult,
        first_half_only=first_half_only,
        exit_mode=exit_mode,
        break_even_offset_pct=break_even_offset_pct,
    )
    rows = []
    for sym, df in frames.items():
        for p in param_list:
            rows.append(_run_one(df, p, symbol=sym, flat_eod=flat_eod))

    meets_min = [r for r in rows if int(r.get("trades", 0)) >= int(min_trades)]
    rank_pool = meets_min if meets_min else rows

    ranked = sorted(
        rank_pool,
        key=lambda r: (
            _finite_float(r["return_pct"])
            - 0.35 * abs(_finite_float(r["max_dd_pct"]))
            + 0.05 * _finite_float(r["win_rate_pct"])
        ),
        reverse=True,
    )
    top = ranked[:limit_top]
    best = top[0] if top else None

    def _avg(key: str) -> float:
        vals = [_finite_float(r[key]) for r in rows]
        return _mean(vals) if vals else 0.0

    # Stats labeled "eligible" use only rows that satisfy min_trades (no fallback).
    el_rows = meets_min
    el_traded = [x for x in el_rows if int(x.get("trades", 0)) > 0]
    top_bucket = ranked[:limit_top]
    tb_traded = [x for x in top_bucket if int(x.get("trades", 0)) > 0]

    def _rows_avg(rs: list[dict], key: str) -> float:
        if not rs:
            return 0.0
        return _mean([_finite_float(r[key]) for r in rs])

    per_sym_all: dict[str, list[dict]] = {}
    for r in rows:
        per_sym_all.setdefault(r["symbol"], []).append(r)
    per_symbol_stats: list[dict] = []
    for sym in sorted(per_sym_all.keys()):
        rs = per_sym_all[sym]
        rets = [_finite_float(x["return_pct"]) for x in rs]
        rs_ok = [x for x in rs if int(x.get("trades", 0)) >= int(min_trades)]
        rs_traded = [x for x in rs if int(x.get("trades", 0)) > 0]
        win_vals = [_finite_float(x["win_rate_pct"]) for x in rs_traded]
        per_symbol_stats.append(
            {
                "symbol": sym,
                "runs": len(rs),
                "meets_min_runs": len(rs_ok),
                "avg_return_pct": _mean(rets),
                "std_return_pct": _stdev_sample(rets),
                "avg_win_rate_pct": _mean(win_vals) if win_vals else 0.0,
                "avg_max_dd_pct": _rows_avg(rs, "max_dd_pct"),
                "avg_trades": _rows_avg(rs, "trades"),
            }
        )

    # Input ranking signal: average score contribution of value buckets.
    by_squeeze = {}
    by_darvas = {}
    by_rvol = {}
    by_hold = {}
    for r in rows:
        rank_score = (
            _finite_float(r["return_pct"])
            - 0.35 * abs(_finite_float(r["max_dd_pct"]))
            + 0.05 * _finite_float(r["win_rate_pct"])
        )
        by_squeeze.setdefault(r["squeeze_len"], []).append(rank_score)
        by_darvas.setdefault(r["darvas_lookback"], []).append(rank_score)
        by_rvol.setdefault(r["rvol_mult"], []).append(rank_score)
        by_hold.setdefault(r["hold_bars"], []).append(rank_score)

    def _rank(d: dict) -> list[dict]:
        out = []
        for k, vals in d.items():
            out.append({"value": k, "score": sum(vals) / len(vals)})
        return sorted(out, key=lambda x: x["score"], reverse=True)

    analysis = {
        "best": best,
        "avg_return_pct": _avg("return_pct"),
        "avg_win_rate_pct": _avg("win_rate_pct"),
        "avg_max_dd_pct": _avg("max_dd_pct"),
        "avg_trades": _avg("trades"),
        "avg_eligible_return_pct": _rows_avg(el_rows, "return_pct"),
        "avg_eligible_win_rate_pct": (
            _mean([_finite_float(x["win_rate_pct"]) for x in el_traded]) if el_traded else 0.0
        ),
        "avg_eligible_max_dd_pct": _rows_avg(el_rows, "max_dd_pct"),
        "avg_eligible_trades": _rows_avg(el_rows, "trades"),
        "top_bucket_avg": {
            "return_pct": _rows_avg(top_bucket, "return_pct"),
            "win_rate_pct": (
                _mean([_finite_float(x["win_rate_pct"]) for x in tb_traded]) if tb_traded else 0.0
            ),
            "max_dd_pct": _rows_avg(top_bucket, "max_dd_pct"),
            "trades": _rows_avg(top_bucket, "trades"),
        },
        "per_symbol": per_symbol_stats,
        "ranked_inputs": {
            "squeeze_len": _rank(by_squeeze),
            "darvas_lookback": _rank(by_darvas),
            "rvol_mult": _rank(by_rvol),
            "hold_bars": _rank(by_hold),
        },
        "surface": {
            "runs_total": len(rows),
            "symbols_loaded": len(frames),
            "param_sets_per_symbol": len(param_list),
            "trades_observed_total": int(sum(int(r.get("trades", 0)) for r in rows)),
            "interpretation": (
                "Low trades on one symbol×param is normal; pool many symbols and/or relax gates. "
                "trades_observed_total sums every backtest run in this sweep (not unique trades in one chart)."
            ),
        },
    }
    if liquid_scan:
        ds_label = "yfinance-movers" if symbols_override else "yfinance-liquid"
        if data_source == "synthetic":
            ds_label += "+synthetic"
        if symbols_override:
            ds_label += ":" + ",".join(sorted(frames.keys()))
    else:
        ds_label = (
            "synthetic-bench"
            if data_source == "synthetic"
            else f"yfinance-{BOOM_DEFAULT_BENCH_SYMBOL.lower()}"
        )
    return {
        "dataset": ds_label,
        "data_source": data_source,
        "timeframe": timeframe,
        "period": period,
        "flat_eod": bool(flat_eod),
        "symbols": sorted(frames.keys()),
        "wide_grid": bool(wide_grid),
        "tested": len(rows),
        "eligible": len(rank_pool),
        "meets_min_count": len(meets_min),
        "min_trades": int(min_trades),
        "signal_source": signal_source,
        "exit_mode": exit_mode,
        "break_even_offset_pct": float(break_even_offset_pct),
        "atr_mult": float(atr_mult),
        "first_half_only": bool(first_half_only),
        "top": top,
        "analysis": analysis,
    }

