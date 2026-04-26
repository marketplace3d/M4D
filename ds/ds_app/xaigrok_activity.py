"""
ds_app/xaigrok_activity.py — XAIGROK Market Activity Gate

Single data-point: is the market ALIVE or DEAD?

Input priority (day-trade safe mode):
  1) tick_score  — RVOL × ATR percentile rank from signal_log.db (primary signal)
  2) grok_score  — optional weak overlay (low weight, disabled by default)

Combined activity_score (0–1):
  ≥ 0.55  → ALIVE  (gate OPEN,  trade normally)
  0.35–0.55 → SLOW (gate OPEN,  half-size)
  < 0.35  → DEAD   (gate CLOSED, skip entries, exit sooner)

Historical test: quintile Sharpe analysis from signal_log.db outcomes.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import pathlib
import sqlite3
import sys
import time
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd

log = logging.getLogger("xaigrok_activity")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

_HERE    = pathlib.Path(__file__).resolve().parent
_DS_ROOT = _HERE.parent

SIGNAL_DB  = _DS_ROOT / "data" / "signal_log.db"
OUT        = _DS_ROOT / "data" / "activity_report.json"

DEAD_THRESH  = 0.35
SLOW_THRESH  = 0.55
ANNUAL_5M    = 252 * 288   # 5m bars per year
ANNUAL_4H    = 252 * 6

# Day-trade weighting: algorithmic market inputs dominate.
# Sentiment is capped as a weak, optional overlay (hallucination + latency risk).
W_TICK  = 0.96
W_GROK  = 0.04
# When vol/liquidity regime is confirmed, sentiment can contribute more,
# but only as a directional amplifier on top of strong market participation.
W_GROK_CONFIRMED = 0.20
W_TICK_CONFIRMED = 0.80


# ── env / Grok key ────────────────────────────────────────────────────────────
def _load_env():
    base = _DS_ROOT.parent
    for p in (base / "M3D" / ".env.local", base / ".env.local"):
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                if k.strip() and v.strip():
                    os.environ[k.strip()] = v.strip()

_load_env()
XAI_KEY  = os.environ.get("API_XAI_YODA_KEY", "")
XAI_URL  = "https://api.x.ai/v1/responses"
XAI_NEWS_ENABLED = os.environ.get("M3D_NEWS_PULSE", "0") == "1"

# Fast cheap model for high-frequency pulse (~$0.05/day at 5-min cadence)
PULSE_MODEL    = "grok-4-1-fast-non-reasoning"
# Deeper model for hourly narrative scan
NARRATIVE_MODEL = "grok-4.20-0309-non-reasoning"

SENTIMENT_DB = _DS_ROOT / "data" / "sentiment_pulse.db"
SENTIMENT_MA_WINDOW = 9      # ~9 minutes when sampled each minute
SENTIMENT_LOOKBACK = 15      # robust smoothing context

# ── Prompt: sentiment TREND not precision ─────────────────────────────────────
# Goal: build a time series of direction readings. WE compute the trend.
# Ask only what Grok can actually see on X: direction of trader chatter.
PULSE_PROMPT = """Search X right now for posts about: ES, NQ, S&P, Nasdaq, futures, markets.

Is trader sentiment on X RISING, FALLING, or FLAT compared to the last hour?

Return ONLY this JSON, nothing else:
{"direction": "<RISING|FALLING|FLAT>", "pace": "<FAST|SLOW>", "note": "<5 words max>"}"""


# ── Responses API caller (correct format for xAI) ─────────────────────────────
def _grok_call(prompt: str, model: str, max_tokens: int = 80) -> Optional[dict]:
    if not XAI_NEWS_ENABLED:
        return None
    if not XAI_KEY:
        return None
    import requests
    try:
        resp = requests.post(
            XAI_URL,
            headers={"Authorization": f"Bearer {XAI_KEY}", "Content-Type": "application/json"},
            json={
                "model": model,
                "input": prompt,                          # Responses API field
                "search_parameters": {"mode": "on"},      # live X search
                "temperature": 0.1,
            },
            timeout=25,
        )
        resp.raise_for_status()
        data = resp.json()
        raw = ""
        for item in data.get("output", []):
            for c in item.get("content", []):
                if c.get("type") == "text":
                    raw += c["text"]
        raw = raw.strip().strip("`")
        if raw.startswith("json"):
            raw = raw[4:].strip()
        return json.loads(raw)
    except Exception as exc:
        log.warning("Grok call failed (%s): %s", model, exc)
        return None


# ── Pulse time-series store ───────────────────────────────────────────────────
def _init_pulse_db() -> sqlite3.Connection:
    SENTIMENT_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(SENTIMENT_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sentiment_pulse (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            ts        INTEGER NOT NULL,
            direction INTEGER NOT NULL,   -- +1 RISING, 0 FLAT, -1 FALLING
            pace      INTEGER NOT NULL,   -- 2 FAST, 1 SLOW
            note      TEXT,
            model     TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sp_ts ON sentiment_pulse(ts)")
    conn.commit()
    return conn


DIR_MAP  = {"RISING": 1,  "FLAT": 0, "FALLING": -1}
PACE_MAP = {"FAST": 2, "SLOW": 1}


def store_pulse(raw: dict, model: str) -> None:
    conn = _init_pulse_db()
    conn.execute(
        "INSERT INTO sentiment_pulse (ts, direction, pace, note, model) VALUES (?,?,?,?,?)",
        (
            int(time.time()),
            DIR_MAP.get(raw.get("direction", "FLAT"), 0),
            PACE_MAP.get(raw.get("pace", "SLOW"), 1),
            raw.get("note", ""),
            model,
        ),
    )
    conn.commit()
    conn.close()


def compute_sentiment_trend(n: int = 12) -> dict:
    """
    Read last n pulse readings. Compute trend (slope) and mean direction.
    n=12 at 5-min cadence = 1-hour window.
    Returns: {slope, mean_direction, readings, trend_label}
    """
    if not SENTIMENT_DB.exists():
        return {"slope": 0.0, "mean_direction": 0.0, "readings": [], "trend_label": "NO_DATA"}
    conn = sqlite3.connect(SENTIMENT_DB)
    rows = conn.execute(
        "SELECT ts, direction, pace, note FROM sentiment_pulse ORDER BY ts DESC LIMIT ?", (n,)
    ).fetchall()
    conn.close()
    if not rows:
        return {"slope": 0.0, "mean_direction": 0.0, "readings": [], "trend_label": "NO_DATA"}

    rows = list(reversed(rows))  # oldest first
    dirs = [r[1] for r in rows]
    mean_dir = sum(dirs) / len(dirs)

    # linear slope over index
    if len(dirs) >= 3:
        x = list(range(len(dirs)))
        xm = sum(x) / len(x)
        ym = mean_dir
        num = sum((x[i] - xm) * (dirs[i] - ym) for i in range(len(dirs)))
        den = sum((x[i] - xm) ** 2 for i in range(len(dirs)))
        slope = num / den if den > 0 else 0.0
    else:
        slope = 0.0

    if slope > 0.05:
        label = "BUILDING"
    elif slope < -0.05:
        label = "FADING"
    elif mean_dir > 0.2:
        label = "BULLISH"
    elif mean_dir < -0.2:
        label = "BEARISH"
    else:
        label = "NEUTRAL"

    return {
        "slope":          round(slope, 4),
        "mean_direction": round(mean_dir, 3),
        "n_readings":     len(rows),
        "trend_label":    label,
        "latest_note":    rows[-1][3] if rows else "",
        "readings": [
            {"ts": r[0], "direction": r[1], "pace": r[2], "note": r[3]}
            for r in rows[-6:]   # last 6 for display
        ],
    }


def pulse_grok() -> Optional[dict]:
    """Single pulse reading — call every 5 min. Stores to time series."""
    raw = _grok_call(PULSE_PROMPT, PULSE_MODEL, max_tokens=60)
    if raw:
        store_pulse(raw, PULSE_MODEL)
        log.info("Pulse: direction=%s pace=%s note=%s",
                 raw.get("direction"), raw.get("pace"), raw.get("note"))
    return raw


def _smoothed_sentiment_score(fallback_score: float) -> float:
    """
    Smooth minute-cadence sentiment to weed out anomalies.
    Uses recent direction/pace readings from sentiment_pulse.db and an EWMA.
    """
    if not SENTIMENT_DB.exists():
        return fallback_score
    try:
        conn = sqlite3.connect(SENTIMENT_DB)
        rows = conn.execute(
            "SELECT direction, pace FROM sentiment_pulse ORDER BY ts DESC LIMIT ?",
            (SENTIMENT_LOOKBACK,),
        ).fetchall()
        conn.close()
        if len(rows) < 5:
            return fallback_score

        # oldest -> newest
        rows = list(reversed(rows))
        alpha = 2.0 / (SENTIMENT_MA_WINDOW + 1.0)
        ewma = float(rows[0][0]) * (1.0 + 0.25 * max(0, int(rows[0][1]) - 1))
        for d, p in rows[1:]:
            val = float(d) * (1.0 + 0.25 * max(0, int(p) - 1))
            ewma = alpha * val + (1.0 - alpha) * ewma

        latest = float(rows[-1][0]) * (1.0 + 0.25 * max(0, int(rows[-1][1]) - 1))
        # Anomaly guard: if latest print jumps too far from the MA, damp it.
        if abs(latest - ewma) > 0.9:
            ewma = 0.75 * ewma + 0.25 * latest

        # map [-1.5..1.5] -> [0..1], then clamp to sentiment safety bounds
        mapped = 0.5 + (ewma / 3.0)
        mapped = max(0.40, min(0.60, mapped))
        return mapped
    except Exception:
        return fallback_score


def query_grok_activity() -> Optional[dict]:
    """Compatibility wrapper — returns grok_score for activity gate."""
    raw = pulse_grok()
    if not raw:
        return None
    # map direction → 0-1 score for activity gate
    dir_val  = DIR_MAP.get(raw.get("direction", "FLAT"), 0)
    pace_val = PACE_MAP.get(raw.get("pace", "SLOW"), 1)
    score = 0.5 + dir_val * 0.25 + (pace_val - 1) * 0.10
    score = max(0.0, min(1.0, score))
    # Additional hard cap to prevent sentiment from becoming a dominant signal.
    score = max(0.40, min(0.60, score))
    score = _smoothed_sentiment_score(score)
    return {
        "activity": score,
        "status":   raw.get("direction", "FLAT"),
        "reason":   raw.get("note", ""),
        "raw":      raw,
        "ma_window": SENTIMENT_MA_WINDOW,
    }


# ── tick activity from signal_log ─────────────────────────────────────────────
def compute_tick_activity(
    conn: sqlite3.Connection,
    lookback_bars: int = 500,
    symbols: list[str] | None = None,
    timeframe: str = "5m",
) -> dict:
    """
    Score current market tick activity: 0-1.

    Uses rolling percentile rank of RVOL and ATR% across all tracked instruments.
    Mean of the last `lookback_bars` bars per symbol, then median across symbols.
    """
    sym_clause = ""
    params: list = [timeframe]
    if symbols:
        placeholders = ",".join("?" * len(symbols))
        sym_clause = f" AND symbol IN ({placeholders})"
        params.extend(symbols)

    query = f"""
        SELECT ts, symbol, rvol, atr_pct
        FROM signal_log
        WHERE timeframe=? {sym_clause}
        ORDER BY ts DESC
        LIMIT {lookback_bars * (len(symbols) if symbols else 8)}
    """
    df = pd.read_sql_query(query, conn, params=params)
    if df.empty:
        return {"tick_score": 0.5, "rvol_prank": 0.5, "atr_prank": 0.5, "n_bars": 0}

    # Per-symbol rolling percentile rank then median across symbols
    scores = []
    for sym, g in df.groupby("symbol"):
        g = g.sort_values("ts")
        rvol = g["rvol"].fillna(1.0).values
        atr  = g["atr_pct"].fillna(0.0).values
        if len(rvol) < 20:
            continue
        # latest bar percentile vs lookback window
        rvol_prank = float(np.mean(rvol[-1] >= rvol))
        atr_prank  = float(np.mean(atr[-1]  >= atr))
        scores.append((rvol_prank, atr_prank))

    if not scores:
        return {"tick_score": 0.5, "rvol_prank": 0.5, "atr_prank": 0.5, "n_bars": len(df)}

    rvol_med = float(np.median([s[0] for s in scores]))
    atr_med  = float(np.median([s[1] for s in scores]))
    tick     = round(0.60 * rvol_med + 0.40 * atr_med, 4)

    return {
        "tick_score": tick,
        "rvol_prank": round(rvol_med, 4),
        "atr_prank":  round(atr_med, 4),
        "n_bars": len(df),
    }


def _gate_label(score: float) -> str:
    if score >= SLOW_THRESH:
        return "ALIVE"
    if score >= DEAD_THRESH:
        return "SLOW"
    return "DEAD"


def _gate_status(score: float) -> str:
    return "CLOSED" if score < DEAD_THRESH else "OPEN"


def _kelly_size_mult(score: float) -> float:
    """Scale position size by activity. DEAD=0, SLOW=0.5, ALIVE=1.0, HOT=1.2"""
    if score < DEAD_THRESH:
        return 0.0
    if score < SLOW_THRESH:
        return round(0.5 + 0.5 * (score - DEAD_THRESH) / (SLOW_THRESH - DEAD_THRESH), 3)
    hot_thresh = 0.80
    if score >= hot_thresh:
        return 1.2
    return 1.0


# ── historical quintile test ───────────────────────────────────────────────────
def historical_quintile_test(conn: sqlite3.Connection, outcome_col: str = "outcome_4h_pct") -> dict:
    """
    Compute activity_score for every bar in signal_log.
    Divide into 5 quintiles. Show Sharpe per quintile.
    Gate = kill Q1 (lowest activity). Measure improvement.
    """
    log.info("Loading signal_log for quintile test (this takes ~30s)...")
    df = pd.read_sql_query(
        "SELECT ts, symbol, timeframe, rvol, atr_pct, jedi_score, outcome_4h_pct, outcome_1h_pct "
        "FROM signal_log WHERE timeframe='5m' AND outcome_4h_pct IS NOT NULL "
        "ORDER BY ts ASC",
        conn,
    )
    if df.empty:
        return {"error": "no data"}

    log.info("Loaded %d rows", len(df))

    # Per-symbol rolling percentile rank (expanding window)
    def _add_prank(g: pd.DataFrame) -> pd.DataFrame:
        g = g.sort_values("ts").reset_index(drop=True)
        rvol = g["rvol"].fillna(1.0).values
        atr  = g["atr_pct"].fillna(0.0).values
        n = len(rvol)
        rp = np.zeros(n)
        ap = np.zeros(n)
        win = 500
        for i in range(n):
            lo = max(0, i - win)
            rp[i] = np.mean(rvol[i] >= rvol[lo:i+1])
            ap[i] = np.mean(atr[i]  >= atr[lo:i+1])
        g["rvol_prank"] = rp
        g["atr_prank"]  = ap
        return g

    parts = []
    for sym, g in df.groupby("symbol"):
        parts.append(_add_prank(g))
    df = pd.concat(parts, ignore_index=True)

    df["activity_score"] = 0.60 * df["rvol_prank"] + 0.40 * df["atr_prank"]
    df["quintile"]       = pd.qcut(df["activity_score"], q=5, labels=["Q1","Q2","Q3","Q4","Q5"])

    annual = ANNUAL_5M

    def _sharpe(r):
        r = r.dropna().values
        if len(r) < 20:
            return None
        sd = r.std(ddof=1)
        if sd == 0:
            return None
        return round(float(r.mean() / sd * np.sqrt(annual)), 3)

    quintiles = []
    for q in ["Q1","Q2","Q3","Q4","Q5"]:
        sub = df[df["quintile"] == q]
        quintiles.append({
            "quintile": q,
            "n_bars": len(sub),
            "activity_mean": round(float(sub["activity_score"].mean()), 3),
            "sharpe_4h": _sharpe(sub["outcome_4h_pct"]),
            "sharpe_1h": _sharpe(sub["outcome_1h_pct"]),
            "win_rate": round(float((sub["outcome_4h_pct"] > 0).mean()), 3),
        })

    baseline   = _sharpe(df["outcome_4h_pct"])
    gated      = _sharpe(df[df["quintile"] != "Q1"]["outcome_4h_pct"])
    gated_q12  = _sharpe(df[~df["quintile"].isin(["Q1","Q2"])]["outcome_4h_pct"])
    pct_killed_q1  = round(float((df["quintile"] == "Q1").mean()) * 100, 1)
    pct_killed_q12 = round(float(df["quintile"].isin(["Q1","Q2"]).mean()) * 100, 1)

    # Activity threshold scan: find best threshold by Sharpe
    best_thresh = DEAD_THRESH
    best_sharpe = baseline or -999.0
    for thresh in np.arange(0.10, 0.70, 0.025):
        s = _sharpe(df[df["activity_score"] >= thresh]["outcome_4h_pct"])
        if s is not None and s > best_sharpe:
            best_sharpe = s
            best_thresh = float(round(thresh, 3))

    return {
        "quintiles": quintiles,
        "baseline_sharpe": baseline,
        "sharpe_gate_q1_off": gated,
        "sharpe_gate_q12_off": gated_q12,
        "improvement_q1": round((gated or 0) - (baseline or 0), 3),
        "improvement_q12": round((gated_q12 or 0) - (baseline or 0), 3),
        "pct_killed_q1": pct_killed_q1,
        "pct_killed_q12": pct_killed_q12,
        "optimal_threshold": best_thresh,
        "optimal_sharpe": round(best_sharpe, 3),
        "n_total": len(df),
    }


# ── hour-of-day activity profile ─────────────────────────────────────────────
def activity_hour_profile(conn: sqlite3.Connection) -> list[dict]:
    """Median activity score by UTC hour — shows which hours are structurally dead."""
    df = pd.read_sql_query(
        "SELECT ts, rvol, atr_pct FROM signal_log WHERE timeframe='5m' AND rvol IS NOT NULL",
        conn,
    )
    if df.empty:
        return []
    df["hour"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.hour
    df["activity"] = 0.60 * df["rvol"].clip(0, 5) / 5.0 + 0.40 * df["atr_pct"].clip(0, 3) / 3.0
    out = []
    for h in range(24):
        sub = df[df["hour"] == h]["activity"]
        out.append({
            "hour": h,
            "activity_median": round(float(sub.median()), 3) if len(sub) > 10 else None,
            "n": len(sub),
        })
    return out


# ── main entry point ──────────────────────────────────────────────────────────
def run(
    skip_grok: bool = True,
    skip_historical: bool = False,
    symbols: list[str] | None = None,
) -> dict:
    if not SIGNAL_DB.exists():
        return {"error": f"signal_log.db not found: {SIGNAL_DB}"}

    conn = sqlite3.connect(SIGNAL_DB)

    tick = compute_tick_activity(conn, symbols=symbols)
    tick_score = tick["tick_score"]

    grok_raw   = None
    grok_score = tick_score  # fallback
    if not skip_grok and XAI_NEWS_ENABLED:
        grok_raw = query_grok_activity()
        if grok_raw and "activity" in grok_raw:
            grok_score = float(grok_raw["activity"])

    # Confirmation regime: only allow stronger sentiment contribution when
    # both volatility and participation are clearly present.
    vol_confirmed = tick["atr_prank"] >= 0.65
    liq_confirmed = tick["rvol_prank"] >= 0.70
    market_confirmed = vol_confirmed and liq_confirmed and tick_score >= 0.60

    # Sentiment is only "strong" if clearly directional after safety clamp.
    sentiment_extreme = (grok_score >= 0.58) or (grok_score <= 0.42)
    sentiment_boost_on = bool(grok_raw) and market_confirmed and sentiment_extreme

    if grok_raw:
        if sentiment_boost_on:
            activity = round(W_TICK_CONFIRMED * tick_score + W_GROK_CONFIRMED * grok_score, 4)
        else:
            activity = round(W_TICK * tick_score + W_GROK * grok_score, 4)
    else:
        activity = tick_score
    status   = _gate_label(activity)
    gate     = _gate_status(activity)
    mult     = _kelly_size_mult(activity)

    report: dict = {
        "ts": int(time.time()),
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "current": {
            "activity_score": activity,
            "tick_score": tick_score,
            "grok_score": round(grok_score, 4) if grok_raw else None,
            "rvol_prank": tick["rvol_prank"],
            "atr_prank":  tick["atr_prank"],
            "status": status,
            "gate": gate,
            "kelly_size_mult": mult,
            "reason": (grok_raw or {}).get("reason", "algo-first (tick-only) mode"),
            "weights": {
                "tick": W_TICK_CONFIRMED if sentiment_boost_on else W_TICK,
                "sentiment": W_GROK_CONFIRMED if sentiment_boost_on else W_GROK,
            },
            "confirmation": {
                "vol_confirmed": vol_confirmed,
                "liquidity_confirmed": liq_confirmed,
                "market_confirmed": market_confirmed,
                "sentiment_extreme": sentiment_extreme,
                "sentiment_boost_on": sentiment_boost_on,
            },
        },
        "thresholds": {
            "dead":  DEAD_THRESH,
            "slow":  SLOW_THRESH,
            "alive": SLOW_THRESH,
        },
        "grok_raw": grok_raw,
    }

    if not skip_historical:
        log.info("Running historical quintile test...")
        report["historical"] = historical_quintile_test(conn)
        report["hour_profile"] = activity_hour_profile(conn)

    conn.close()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2))
    log.info("activity_report.json written → %s", OUT)
    log.info(
        "CURRENT: activity=%.3f  status=%s  gate=%s  kelly_mult=%.2f",
        activity, status, gate, mult,
    )
    return report


# ── integration helpers (called from star_optimizer, walk_forward) ─────────────
def gate_from_report() -> dict:
    """
    Fast read from cached report. Returns gate dict for runtime use.
    Returns {'gate': 'OPEN', 'mult': 1.0, 'status': 'ALIVE'} on missing/stale.
    """
    default = {"gate": "OPEN", "mult": 1.0, "status": "ALIVE", "activity_score": 0.6}
    if not OUT.exists():
        return default
    try:
        data = json.loads(OUT.read_text())
        age  = time.time() - data.get("ts", 0)
        if age > 3600:  # stale after 1h
            log.warning("activity_report.json is %.0f minutes old — using default gate", age / 60)
            return default
        c = data.get("current", {})
        return {
            "gate":           c.get("gate", "OPEN"),
            "mult":           c.get("kelly_size_mult", 1.0),
            "status":         c.get("status", "ALIVE"),
            "activity_score": c.get("activity_score", 0.6),
        }
    except Exception:
        return default


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="XAIGROK Activity Gate")
    ap.add_argument("--no-grok",       action="store_true", help="Skip Grok API call (tick-only)")
    ap.add_argument("--no-historical", action="store_true", help="Skip historical quintile test")
    ap.add_argument("--symbols",       nargs="*",           help="Restrict to these symbols")
    args = ap.parse_args()

    result = run(
        skip_grok=args.no_grok,
        skip_historical=args.no_historical,
        symbols=args.symbols,
    )
    print(json.dumps(result.get("current", {}), indent=2))
