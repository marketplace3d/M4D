"""
sim_universe.py — Run *all* crypto algos on the same OHLCV (sim) and explain wins.

Used by GET /v1/sim/universe/ — answers: which algos / regimes / hours line up with winners.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np
import pandas as pd

from .algos_crypto import ALGO_REGISTRY, ALL_ALGO_IDS, build_features
from .data_fetch import fetch_ohlcv
from .optimized_params_store import params_for_algo
from .optimizer import vectorized_backtest_trades


def _regime_series(df: pd.DataFrame) -> pd.Series:
    try:
        from .sharpe_ensemble import assign_regimes
        return assign_regimes(df)
    except Exception:
        n = len(df)
        return pd.Series(["MIXED"] * n, index=df.index)


def _bucket_stats(pnls: list[float]) -> dict[str, float]:
    if not pnls:
        return {"n": 0, "wins": 0, "losses": 0, "win_rate": 0.0, "sum_pnl_pct": 0.0, "avg_pnl_pct": 0.0}
    arr = np.array(pnls, dtype=float)
    wins = int((arr > 0).sum())
    return {
        "n": len(pnls),
        "wins": wins,
        "losses": len(pnls) - wins,
        "win_rate": round(100.0 * wins / len(pnls), 2),
        "sum_pnl_pct": round(float(arr.sum()), 4),
        "avg_pnl_pct": round(float(arr.mean()), 4),
    }


def _dow_name(d: int) -> str:
    names = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    return names[d] if 0 <= d < 7 else "?"


def _categorize_trades(
    rows: list[dict],
    sample_per: int,
    list_mode: str,  # "off" | "sample" | "all"
) -> dict[str, Any]:
    """Group every sim trade by bank / regime / algo / exit_reason / DOW. Stats + optional trade lists."""
    if not rows:
        return {
            "stats": {},
            "trades": {},
        }

    def _key_bins() -> dict[str, dict[str, list[dict]]]:
        by_bank: dict[str, list[dict]] = defaultdict(list)
        by_regime: dict[str, list[dict]] = defaultdict(list)
        by_algo: dict[str, list[dict]] = defaultdict(list)
        by_exit: dict[str, list[dict]] = defaultdict(list)
        by_dow: dict[str, list[dict]] = defaultdict(list)
        for r in rows:
            by_bank[str(r.get("bank", "?"))].append(r)
            by_regime[str(r.get("regime", "?"))].append(r)
            by_algo[str(r.get("algo", "?"))].append(r)
            by_exit[str(r.get("exit_reason", "") or "unknown")].append(r)
            d = int(r.get("dow", -1))
            if d >= 0:
                by_dow[_dow_name(d)].append(r)
        return {
            "by_bank": dict(by_bank),
            "by_regime": dict(by_regime),
            "by_algo": dict(by_algo),
            "by_exit_reason": dict(by_exit),
            "by_dow": dict(by_dow),
        }

    bins = _key_bins()
    stats: dict[str, Any] = {}
    for gname, groups in bins.items():
        stats[gname] = {}
        for k, g in sorted(groups.items(), key=lambda x: -len(x[1])):
            pnls = [float(r["pnl_pct"]) for r in g]
            stats[gname][k] = _bucket_stats(pnls)

    if list_mode == "off":
        return {"stats": stats, "trades": {}}

    lim = 10_000_000 if list_mode == "all" else max(1, sample_per)
    trades_out: dict[str, Any] = {}
    for gname, groups in bins.items():
        trades_out[gname] = {}
        for k, g in groups.items():
            srt = sorted(g, key=lambda x: (-x["pnl_pct"] if x["win"] else x["pnl_pct"]))
            trades_out[gname][k] = srt if list_mode == "all" else srt[:lim]

    return {"stats": stats, "trades": trades_out}


def _outcome_split(rows: list[dict], sample: int) -> dict[str, Any]:
    w = [r for r in rows if r.get("win")]
    l_ = [r for r in rows if not r.get("win")]
    w.sort(key=lambda x: -x["pnl_pct"])
    l_.sort(key=lambda x: x["pnl_pct"])
    return {
        "wins": {"n": len(w), "trades": w if sample < 0 else w[: max(sample, 1)]},
        "losses": {"n": len(l_), "trades": l_ if sample < 0 else l_[: max(sample, 1)]},
    }


def _competition_league(
    rankable: list[dict],
    by_algo_summary: dict[str, dict],
) -> dict[str, Any]:
    """Leaderboard + bank aggregate 'teams' + tailenders."""
    lb: list[dict] = []
    for i, a in enumerate(rankable[:30], start=1):
        pf = a.get("profit_factor")
        n = a.get("n", 0)
        wr = a.get("win_rate", 0)
        # Composite score: emphasize PF, then sample size, then pnl
        sc = 0.0
        if pf and pf is not None and pf > 0 and n:
            sc = float(pf) * (1.0 + 0.15 * min(np.log(1 + n) / np.log(10), 1.0))
        verdict = f"High PF ({pf}) with n={n}" if pf and n else "Thin sample"
        lb.append({
            "rank": i,
            "score": round(sc, 4),
            "algo_id": a.get("algo_id"),
            "bank": a.get("bank"),
            "name": a.get("name"),
            "profit_factor": pf,
            "n_trades": n,
            "sum_pnl_pct": a.get("sum_pnl_pct"),
            "win_rate": wr,
            "verdict": verdict,
        })

    # Bank team totals
    team: dict[str, dict[str, Any]] = {}
    for aid, s in by_algo_summary.items():
        if "error" in s or s.get("n", 0) < 1:
            continue
        b = s.get("bank", "?")
        t = team.setdefault(b, {"bank": b, "n_trades": 0, "sum_pnl_pct": 0.0, "wins": 0, "algos": 0, "best_algo": None, "best_pf": 0.0})
        t["n_trades"] += int(s.get("n", 0))
        t["sum_pnl_pct"] += float(s.get("sum_pnl_pct", 0) or 0)
        t["wins"] += int(s.get("wins", 0))
        t["algos"] += 1
        pf = s.get("profit_factor") or 0
        if float(pf) > t["best_pf"] and s.get("n", 0) >= 1:
            t["best_pf"] = float(pf)
            t["best_algo"] = aid
    for b, t in team.items():
        t["win_rate"] = round(100.0 * t["wins"] / t["n_trades"], 2) if t["n_trades"] else 0.0
    team_ranked = sorted(team.values(), key=lambda x: x["sum_pnl_pct"], reverse=True)

    return {
        "leaderboard": lb,
        "by_bank_team": {x["bank"]: x for x in team_ranked},
        "bank_order_by_total_pnl": [x["bank"] for x in team_ranked],
        "laggards": [
            {k: a[k] for k in ("algo_id", "bank", "n", "profit_factor", "sum_pnl_pct", "win_rate")}
            for a in rankable[-5:]
        ] if len(rankable) > 5 else [],
    }


def _build_reasoning(
    rankable: list[dict],
    competition: dict,
    reg_win_rank: list[dict],
    med_pf: float,
    n_all: int,
    asset: str,
    interval: str,
) -> dict[str, Any]:
    """Plain-language comparison: who won the sim, who lagged, and why it might generalize (or not)."""
    lines: list[str] = []
    if rankable and len(rankable) >= 2:
        best = rankable[0]
        med = rankable[len(rankable) // 2]
        worst = rankable[-1]
        lines.append(
            f"Among algos with enough samples, {best.get('algo_id')} leads on profit factor "
            f"({best.get('profit_factor')}) and total pnl% ({best.get('sum_pnl_pct')}). "
            f"Median in this pack: {med.get('algo_id')} (PF {med.get('profit_factor')}). "
            f"Tail: {worst.get('algo_id')} (PF {worst.get('profit_factor')})."
        )
    if med_pf and rankable and rankable[0].get("profit_factor") is not None:
        m = float(rankable[0].get("profit_factor") or 0)
        if m > med_pf + 0.1:
            lines.append(f"Top algo clears the median field PF ({med_pf}) — looks structurally different from middle.")
        else:
            lines.append(f"Top algo is not far from median PF — edge may be small or path-dependent on this window.")

    teams = competition.get("by_bank_team") or {}
    bo = competition.get("bank_order_by_total_pnl") or []
    if bo and len(bo) >= 2 and teams:
        b1, b2 = bo[0], bo[1]
        t1, t2 = teams.get(b1), teams.get(b2)
        if t1 and t2 and t1.get("n_trades", 0) and t2.get("n_trades", 0):
            lines.append(
                f"By *bank* (A=break, B=structure, C=mom, D=discovery), team {b1} has the most aggregate pnl% "
                f"({t1.get('sum_pnl_pct', 0):.1f} over {t1.get('n_trades')} leg trades) vs {b2}."
            )
    if reg_win_rank and reg_win_rank[0].get("n", 0) >= 3:
        r0 = reg_win_rank[0]
        lines.append(
            f"Regime {r0.get('regime','?')} at entry has the best win% in this sample (WR {r0.get('win_rate')}%, n={r0.get('n')}) — check if n is large enough to trust."
        )
    lines.append(
        f"Window {asset} {interval}: {n_all} legs total — treat single-window heroes as *hypotheses* until you confirm OOS."
    )
    return {
        "lines": lines,
        "median_profit_factor_field": med_pf,
        "conclusion": (lines[0] if lines else "Insufficient diversity to compare."),
    }


def run_universe_sim(
    asset: str,
    start: str,
    end: str,
    interval: str = "1d",
    algo_ids: list[str] | None = None,
    all_algos: bool = True,
    min_trades_for_rank: int = 3,
    trades_list: str = "sample",
    sample_per_category: int = 20,
) -> dict[str, Any]:
    """
    Long-only sim per algo (same engine as optimize grid). Enriches each trade with
    regime + hour at *entry* for win/loss attribution.
    If ``all_algos`` is False and ``algo_ids`` is empty, returns an error (forces explicit
    "run everything" via all_algos=1 or a comma list in ``algos``).
    """
    asset = (asset or "BTC").upper()
    if algo_ids and len(algo_ids) > 0:
        ids = [a.upper() for a in algo_ids]
    elif all_algos:
        ids = [a.upper() for a in ALL_ALGO_IDS]
    else:
        return {
            "ok": False,
            "error": "Pass algos=DON_BO,EMA_STACK or set all_algos=1 to sim all strategies.",
        }
    df = fetch_ohlcv(asset, start, end, interval=interval)
    if df is None or df.empty or len(df) < 40:
        return {
            "ok": False,
            "error": f"Insufficient data: {0 if df is None else len(df)} bars",
            "asset": asset, "start": start, "end": end, "interval": interval,
        }

    idx = df.index
    if not isinstance(idx, pd.DatetimeIndex):
        try:
            idx = pd.to_datetime(idx)
        except Exception:
            idx = pd.RangeIndex(len(df))
    regimes = _regime_series(df)
    if len(regimes) != len(df):
        regimes = pd.Series(["MIXED"] * len(df), index=df.index)

    all_rows: list[dict] = []
    by_algo_summary: dict[str, dict] = {}

    for algo_id in ids:
        if algo_id not in ALGO_REGISTRY:
            continue
        meta = ALGO_REGISTRY[algo_id]
        stop_pct = float(meta["stop_pct"])
        hold_bars = int(meta["hold_bars"])
        p = params_for_algo(asset, algo_id)
        try:
            feat = build_features(df, algo_id, p)
        except Exception as exc:
            by_algo_summary[algo_id] = {"error": str(exc), "n_trades": 0}
            continue

        close = df["Close"].values.astype(float)
        ent = feat["entry"].values
        exi = feat["exit_sig"].values
        trades = vectorized_backtest_trades(close, ent, exi, stop_pct, hold_bars)

        pnls: list[float] = []
        for t in trades:
            ei = t["entry_i"]
            if ei < 0 or ei >= len(df):
                continue
            try:
                ts = idx[ei]
                if hasattr(ts, "hour"):
                    h_utc = int(ts.hour)
                    dow = int(ts.dayofweek) if hasattr(ts, "dayofweek") else -1
                else:
                    h_utc, dow = -1, -1
            except Exception:
                h_utc, dow = -1, -1
            try:
                reg = str(regimes.iloc[ei]) if ei < len(regimes) else "?"
            except Exception:
                reg = "?"
            pnl = float(t["pnl_pct"])
            ent_date = ""
            try:
                tsv = idx[ei]
                if hasattr(tsv, "strftime"):
                    ent_date = tsv.strftime("%Y-%m-%d")
                else:
                    ent_date = str(tsv)[:10]
            except Exception:
                ent_date = ""
            row = {
                "algo": algo_id,
                "name": meta.get("name", algo_id),
                "bank": meta.get("bank", "?"),
                "pnl_pct": pnl,
                "win": pnl > 0,
                "entry_i": ei,
                "exit_i": t["exit_i"],
                "exit_reason": t.get("exit_reason", ""),
                "hour_utc": h_utc,
                "dow": dow,
                "regime": reg,
                "entry_date": ent_date,
            }
            all_rows.append(row)
            pnls.append(pnl)

        wins = [x for x in pnls if x > 0]
        losses = [x for x in pnls if x <= 0]
        gross_win = sum(wins) if wins else 0.0
        gross_loss = abs(sum(losses)) if losses else 0.0
        pf = round(gross_win / gross_loss, 4) if gross_loss > 1e-9 else None
        st = _bucket_stats(pnls)
        st["algo_id"] = algo_id
        st["bank"] = meta.get("bank", "?")
        st["name"] = meta.get("name", algo_id)
        st["params"] = p
        st["profit_factor"] = pf
        by_algo_summary[algo_id] = st

    # —— Cross-trade attribution (what lines up with winners) ——
    wins_r = [r for r in all_rows if r["win"]]
    loss_r = [r for r in all_rows if not r["win"]]
    n_all = len(all_rows)
    n_w = len(wins_r)
    n_l = len(loss_r)

    by_reg: dict[str, list[float]] = defaultdict(list)
    by_hour: dict[int, list[float]] = defaultdict(list)
    for r in all_rows:
        by_reg[r["regime"]].append(r["pnl_pct"])
        if r["hour_utc"] >= 0:
            by_hour[r["hour_utc"]].append(r["pnl_pct"])

    regime_table = {k: _bucket_stats(v) for k, v in sorted(by_reg.items(), key=lambda x: -len(x[1]))}
    hour_table = {str(h): _bucket_stats(v) for h, v in sorted(by_hour.items(), key=lambda x: x[0])}

    win_hours = [r["hour_utc"] for r in wins_r if r["hour_utc"] >= 0]
    loss_hours = [r["hour_utc"] for r in loss_r if r["hour_utc"] >= 0]
    mean_h_win = round(float(np.mean(win_hours)), 2) if win_hours else None
    mean_h_loss = round(float(np.mean(loss_hours)), 2) if loss_hours else None

    # Best regimes: min sample
    reg_win_rank = []
    for reg, st in regime_table.items():
        if st["n"] < min_trades_for_rank:
            continue
        reg_win_rank.append({"regime": reg, **st})
    reg_win_rank.sort(key=lambda x: (x.get("win_rate", 0), x.get("sum_pnl_pct", 0)), reverse=True)

    # Rank algos
    rankable = []
    for a, s in by_algo_summary.items():
        if s.get("n", 0) < min_trades_for_rank or "error" in s:
            continue
        rankable.append(s)
    rankable.sort(
        key=lambda x: (x.get("profit_factor") or 0, x.get("sum_pnl_pct", 0)),
        reverse=True,
    )

    pfs = [float(x["profit_factor"]) for x in rankable if x.get("profit_factor") is not None]
    med_pf = float(np.median(pfs)) if pfs else 0.0
    competition = _competition_league(rankable, by_algo_summary)

    tl = (trades_list or "sample").lower()
    if tl not in ("off", "sample", "all"):
        tl = "sample"
    categorized = _categorize_trades(all_rows, sample_per_category, tl)
    sp = sample_per_category if tl == "sample" else (10 if tl == "off" else 10_000_000)
    outcome_split = _outcome_split(all_rows, -1 if tl == "all" else sp)

    # Short narrative
    top_algo = rankable[0] if rankable else None
    top_reg = reg_win_rank[0] if reg_win_rank else None
    lines: list[str] = []
    if n_all:
        ovr = 100.0 * n_w / n_all
        lines.append(
            f"All-strategy sim: {n_w}/{n_all} winning trades ({round(ovr,1)}% win rate) on {asset} {interval}."
        )
    if top_algo:
        lines.append(
            f"By profit factor: {top_algo['algo_id']} (PF {top_algo.get('profit_factor')}, "
            f"WR {top_algo.get('win_rate')}%, n={top_algo.get('n')})."
        )
    if top_reg:
        lines.append(
            f"Best regime at entry: {top_reg['regime']} (WR {top_reg['win_rate']}% over {top_reg['n']} trades)."
        )
    if mean_h_win is not None and mean_h_loss is not None and n_w > 3 and n_l > 3:
        lines.append(
            f"Entry hour (UTC) mean: winners {mean_h_win}h vs losers {mean_h_loss}h (exploratory)."
        )

    reason_block = _build_reasoning(
        rankable, competition, reg_win_rank, med_pf, n_all, asset, interval,
    )

    return {
        "ok": True,
        "all_algorithms": bool(all_algos and not (algo_ids and len(algo_ids) > 0)),
        "algorithms_in_run": ids,
        "algorithm_count": len(ids),
        "asset": asset,
        "start": start,
        "end": end,
        "interval": interval,
        "trades_list_mode": tl,
        "sample_per_category": sample_per_category,
        "algos_run": len([a for a in ids if a in by_algo_summary and "error" not in by_algo_summary.get(a, {})]),
        "trades_total": n_all,
        "wins": n_w,
        "losses": n_l,
        "by_algo": dict(sorted(
            by_algo_summary.items(),
            key=lambda kv: (kv[1].get("sum_pnl_pct") or 0)
            if isinstance(kv[1], dict) and "error" not in kv[1] else -1e12,
            reverse=True,
        )),
        "algorithms_ranked": rankable[:20],
        "competition": competition,
        "trades_by_category": categorized,
        "trades_by_outcome": outcome_split,
        "attribution": {
            "regime_at_entry": regime_table,
            "regime_ranked": reg_win_rank[:10],
            "hour_utc": hour_table,
            "mean_entry_hour_utc": {"wins": mean_h_win, "losses": mean_h_loss},
        },
        "what_makes_winning_trades": {
            "summary_lines": lines,
            "highest_profit_factor_algo": top_algo,
            "highest_win_rate_regime": top_reg,
        },
        "reasoning": reason_block,
        "median_profit_factor_among_ranked": round(med_pf, 4),
        "sample_trades": sorted(
            (r for r in all_rows if r["win"]),
            key=lambda x: x["pnl_pct"],
            reverse=True,
        )[:15],
    }
