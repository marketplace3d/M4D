"""
ictsmc_backtest.py — ICT-style signals (ict_signals.add_ict_signals) + simple PnL sim
with explicit opt *levels* for trade / entry / exit / retest (API-driven).

- trade:   master switch; if off, no positions.
- entry:   which filters to require (bias, KZ, T1, require OB|FVG retest context).
- retest:  `strict` = require v_ict_ob (classic tap zone); `loose` = OB or FVG in lookback; `min_ob_lookback` for OB series.
- exit:    ATR stop / ATR take-profit / max hold bars in *interval* bars.
"""
from __future__ import annotations

import json
import math
import pathlib
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .data_fetch import fetch_ohlcv
from .ict_signals import add_ict_signals

_DS = pathlib.Path(__file__).resolve().parent.parent / "data"
@dataclass
class IctEntryOpt:
    use_bias: bool = True
    use_killzone: bool = True
    use_t1: bool = False
    use_whacker_gate: bool = False
    """If True, same as v_ict_gate in ict_signals (bias+kz+ob|fvg)."""

    @classmethod
    def from_dict(cls, d: dict | None) -> "IctEntryOpt":
        if not d:
            return cls()
        return cls(
            use_bias=bool(d.get("use_bias", True)),
            use_killzone=bool(d.get("use_killzone", True)),
            use_t1=bool(d.get("use_t1", False)),
            use_whacker_gate=bool(d.get("use_whacker_gate", False)),
        )


@dataclass
class IctRetestOpt:
    mode: str = "loose"  # "strict" = OB present at bar, "loose" = OR FVG
    min_ob_lookback: int = 50
    displace_mult: float = 1.5
    max_touches: int = 1
    at_zone_mult: float = 1.0
    fvg_lookback: int = 40

    @classmethod
    def from_dict(cls, d: dict | None) -> "IctRetestOpt":
        if not d:
            return cls()
        return cls(
            mode=str(d.get("mode") or ("strict" if d.get("strict") in (True, 1, "1", "strict") else "loose")),
            min_ob_lookback=int(d.get("ob_lookback", d.get("min_ob_lookback", 50))),
            displace_mult=float(d.get("displace_mult", 1.5)),
            max_touches=int(d.get("max_touches", 1)),
            at_zone_mult=float(d.get("at_zone_mult", 1.0)),
            fvg_lookback=int(d.get("fvg_lookback", 40)),
        )


@dataclass
class IctExitOpt:
    max_hold_bars: int = 5
    stop_atr: float = 1.5
    take_profit_atr: float = 2.0
    """Exit when (price move from entry) exceeds stop_atr*ATR or take_profit_atr*ATR in favour."""

    @classmethod
    def from_dict(cls, d: dict | None) -> "IctExitOpt":
        if not d:
            return cls()
        return cls(
            max_hold_bars=int(d.get("max_hold_bars", d.get("hold_bars", 5))),
            stop_atr=float(d.get("stop_atr", 1.5)),
            take_profit_atr=float(d.get("take_profit_atr", 2.0)),
        )


@dataclass
class IctsmcRunOpt:
    trade: bool = True
    entry: IctEntryOpt = field(default_factory=IctEntryOpt)
    retest: IctRetestOpt = field(default_factory=IctRetestOpt)
    exit: IctExitOpt = field(default_factory=IctExitOpt)

    @classmethod
    def from_dict(cls, d: dict | None) -> "IctsmcRunOpt":
        if not d:
            return cls()
        return cls(
            trade=bool(d.get("trade", True)),
            entry=IctEntryOpt.from_dict(d.get("entry") if isinstance(d.get("entry"), dict) else None),
            retest=IctRetestOpt.from_dict(d.get("retest") if isinstance(d.get("retest"), dict) else None),
            exit=IctExitOpt.from_dict(d.get("exit") if isinstance(d.get("exit"), dict) else None),
        )


def _df_to_ict_input(df: pd.DataFrame, asset: str) -> pd.DataFrame:
    ix = df.index
    if not isinstance(ix, pd.DatetimeIndex):
        ix = pd.to_datetime(ix, utc=True)
    else:
        if ix.tz is None:
            ix = ix.tz_localize("UTC")
        else:
            ix = ix.tz_convert("UTC")
    ts = (ix.astype("int64") // 10**9).to_numpy()
    c = df["Close"].astype(float)
    h, lo = df["High"].astype(float), df["Low"].astype(float)
    prev_c = c.shift(1)
    tr = pd.concat([(h - lo).abs(), (h - prev_c).abs(), (lo - prev_c).abs()], axis=1).max(axis=1)
    atr = tr.ewm(span=14, adjust=False).mean()
    atr_pct = (atr / c.replace(0, np.nan)).fillna(0.0)
    return pd.DataFrame(
        {
            "symbol": asset,
            "ts": ts,
            "open": df["Open"].astype(float).values,
            "high": h.values,
            "low": lo.values,
            "close": c.values,
            "atr_pct": atr_pct.values.astype(float),
        }
    )


def _entry_mask(ict: pd.DataFrame, opt: IctsmcRunOpt) -> np.ndarray:
    n = len(ict)
    e, r, et = opt.entry, opt.retest, opt.exit
    bias = ict["v_ict_bias"].fillna(0).values.astype(int)
    m = np.ones(n, dtype=bool)
    if e.use_whacker_gate:
        m &= ict["v_ict_gate"].fillna(0).values == 1
    else:
        if e.use_bias:
            m &= bias != 0
        if e.use_killzone:
            m &= ict["v_ict_kz"].fillna(0).values == 1
        if e.use_t1:
            m &= ict["ict_t1_level"].fillna(0).values == 1
        ob = ict["v_ict_ob"].fillna(0).values.astype(int)
        fv = ict["v_ict_fvg"].fillna(0).values.astype(int)
        if r.mode == "strict":
            m &= ob == 1
        else:
            m &= (ob + fv).clip(0, 1) == 1
    return m


def _simulate(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    atr: np.ndarray,
    bias: np.ndarray,
    entry_mask: np.ndarray,
    ex: IctExitOpt,
) -> list[dict]:
    """One position at a time; direction from v_ict_bias at entry bar."""
    n = len(close)
    trades: list[dict] = []
    i = 0
    while i < n - 1:
        if not entry_mask[i] or int(bias[i]) == 0:
            i += 1
            continue
        side = 1 if int(bias[i]) > 0 else -1
        e0 = float(close[i])
        a0 = max(float(atr[i]), 1e-9)
        sl = e0 - side * ex.stop_atr * a0
        tp = e0 + side * ex.take_profit_atr * a0
        jmax = min(n - 1, i + ex.max_hold_bars)
        exited = False
        for j in range(i + 1, jmax + 1):
            hj, lj = float(high[j]), float(low[j])
            if side == 1:
                if lj <= sl:
                    trades.append(
                        {"entry_i": int(i), "exit_i": int(j), "side": "LONG", "ret_pct": (sl - e0) / e0 * 100, "exit": "stop"},
                    )
                    i = j + 1
                    exited = True
                    break
                if hj >= tp:
                    trades.append(
                        {"entry_i": int(i), "exit_i": int(j), "side": "LONG", "ret_pct": (tp - e0) / e0 * 100, "exit": "tp"},
                    )
                    i = j + 1
                    exited = True
                    break
            else:
                if hj >= sl:
                    trades.append(
                        {"entry_i": int(i), "exit_i": int(j), "side": "SHORT", "ret_pct": (e0 - sl) / e0 * 100, "exit": "stop"},
                    )
                    i = j + 1
                    exited = True
                    break
                if lj <= tp:
                    trades.append(
                        {"entry_i": int(i), "exit_i": int(j), "side": "SHORT", "ret_pct": (e0 - tp) / e0 * 100, "exit": "tp"},
                    )
                    i = j + 1
                    exited = True
                    break
        if not exited:
            c_end = float(close[jmax])
            r = (c_end - e0) / e0 * 100.0 * side
            trades.append(
                {
                    "entry_i": int(i), "exit_i": int(jmax), "side": "LONG" if side == 1 else "SHORT",
                    "ret_pct": round(r, 4), "exit": "time",
                }
            )
            i = jmax + 1
    return trades


def run_ictsmc_backtest(
    asset: str,
    start: str,
    end: str,
    interval: str = "1d",
    opt: dict | None = None,
) -> dict[str, Any]:
    """
    Public entry: fetch OHLCV → ict signals → build entry mask from opt → simulate exits.
    """
    o = IctsmcRunOpt.from_dict(opt)
    if not o.trade:
        return {
            "ok": True,
            "skipped": True,
            "reason": "opt.trade is false — no simulated trades",
            "opt_applied": _opt_to_json(o),
        }

    df = fetch_ohlcv(asset, start, end, interval=interval)
    if df is None or df.empty or len(df) < 100:
        return {
            "ok": False,
            "error": f"Insufficient data ({0 if df is None else len(df)} bars) — need ~100+ for session ICT levels",
        }

    prep = _df_to_ict_input(df, asset.upper())
    try:
        ict = add_ict_signals(
            prep,
            ob_lookback=o.retest.min_ob_lookback,
        )
    except Exception as exc:
        return {"ok": False, "error": f"add_ict_signals: {exc}"}

    ict = ict.reset_index(drop=True)
    m = _entry_mask(ict, o)
    close = ict["close"].values.astype(float)
    high = ict["high"].values.astype(float)
    low = ict["low"].values.astype(float)
    bias = ict["v_ict_bias"].fillna(0).values.astype(int)
    atr = (ict["atr_pct"].values * close).astype(float)

    trs = _simulate(close, high, low, atr, bias, m, o.exit)
    rets = [t["ret_pct"] for t in trs]
    n_t = len(rets)
    if n_t < 1:
        return {
            "ok": True,
            "asset": asset,
            "start": start,
            "end": end,
            "interval": interval,
            "n_trades": 0,
            "trades": [],
            "opt_applied": _opt_to_json(o),
            "note": "No entries — loosen entry/retest filters or extend date range.",
        }

    arr = np.array(rets, dtype=float)
    win_rate = float((arr > 0).mean() * 100.0)
    total_ret = float(arr.sum())
    sd = float(arr.std(ddof=1)) if n_t > 1 else 0.0
    sharpe = float(arr.mean() / sd * math.sqrt(max(n_t, 1))) if sd > 1e-9 else 0.0

    ex_break = {k: int(sum(1 for t in trs if t.get("exit") == k)) for k in ("stop", "tp", "time")}

    return {
        "ok": True,
        "asset": asset.upper(),
        "start": start,
        "end": end,
        "interval": interval,
        "n_trades": n_t,
        "win_rate": round(win_rate, 2),
        "total_pnl_pct": round(total_ret, 4),
        "sharpe_per_trade": round(sharpe, 4),
        "exit_breakdown": ex_break,
        "trades": trs[:200],
        "opt_applied": _opt_to_json(o),
    }


def _opt_to_json(o: IctsmcRunOpt) -> dict:
    return {
        "trade": o.trade,
        "entry": asdict(o.entry),
        "retest": {**asdict(o.retest), "mode": o.retest.mode},
        "exit": asdict(o.exit),
    }


def load_opt_preset(name: str = "default") -> dict | None:
    """Load optional JSON preset from ds/data/ictsmc_opt_defaults.json if present."""
    p = _DS / "ictsmc_opt_defaults.json"
    if not p.is_file():
        return None
    try:
        raw = json.loads(p.read_text())
        if isinstance(raw, dict) and name in raw:
            return raw[name]
    except (json.JSONDecodeError, OSError, TypeError):
        pass
    return None
