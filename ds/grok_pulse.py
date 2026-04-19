#!/usr/bin/env python3
"""
M3D GROK PULSE DAEMON
─────────────────────
Polls Grok live search every 60 seconds for market-moving events in the last
3 minutes. Grok has real-time X/Twitter + web access — it is the pulse.

Writes to:  ds/data/pulse_latest.json   ← Django endpoint reads this
            ds/data/pulse_history.json  ← rolling 24h (1440 entries)

macOS: fires osascript desktop notification on urgency=NOW triggers.

Usage:
  python ds/grok_pulse.py                         # default 60s poll
  python ds/grok_pulse.py --interval 30           # 30s poll
  python ds/grok_pulse.py --watchlist BTC,ETH,SPY # custom symbols
  python ds/grok_pulse.py --once                  # single run, then exit

Key: API_XAI_YODA_KEY from repo `.env.local` or `M3D/.env.local` (loaded by go3d.sh or this script).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import pathlib
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

import urllib.request
import urllib.error

# ── Config ────────────────────────────────────────────────────────────────────

ROOT = pathlib.Path(__file__).parent.parent          # repo root (M4D/)
ENV_FILE = ROOT / "M3D" / ".env.local"
ENV_FILE_ROOT = ROOT / ".env.local"
DATA_DIR = pathlib.Path(__file__).parent / "data"

MAX_HISTORY   = 1440   # 24h at 60s intervals
MAX_LATEST    = 50     # keep last 50 triggers in pulse_latest.json

DEFAULT_WATCHLIST = [
    # Crypto
    "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "DOT",
    # Macro / indices / ETFs
    "SPY", "QQQ", "GLD", "USO", "TLT", "VIX", "DXY",
    # Key stocks (high-impact news movers)
    "TSLA", "NVDA", "AAPL", "META", "MSFT", "AMZN", "GOOGL",
]

GROK_MODEL   = "grok-4.20-reasoning"
GROK_URL     = "https://api.x.ai/v1/responses"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [PULSE] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pulse")

# ── Load .env.local ───────────────────────────────────────────────────────────

def _load_env():
    for path in (ENV_FILE, ENV_FILE_ROOT):
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())


# ── Grok call ─────────────────────────────────────────────────────────────────

PULSE_PROMPT = """You have live access to X (Twitter) and the web right now.

Search for market-moving events from the LAST 3 MINUTES ONLY.

Return a JSON array of triggers. Each trigger:
{{
  "trigger_class": "CATALYST|REGIME_SHIFT|MOMENTUM|REVERSAL|MACRO_PRINT|WHALE|TWEET_STORM|REGULATORY",
  "urgency": "NOW|5MIN|1HR|EOD",
  "direction": "LONG|SHORT|HEDGE|EXIT",
  "ticker": "BTCUSDT or null for market-wide",
  "sector": "CRYPTO|TECH|ENERGY|FINANCIALS|HEALTHCARE|MACRO|COMMODITIES or null",
  "catalyst_type": "EARNINGS|FDA|M&A|MACRO_PRINT|TWEET_STORM|WHALE_MOVE|REGULATORY|GEOPOLITICAL|RATES|LIQUIDATION or null",
  "confidence": 0-100,
  "source_confidence": 0-100,
  "gaming_detected": true/false,
  "gaming_flags": ["reason if gamed"],
  "entry_window_min": minutes before priced in,
  "target_pct": estimated move size or null,
  "stop_pct": suggested stop or null,
  "source": "X_POST|NEWS_WIRE|CHAIN_DATA|MACRO_PRINT|FILING|OPTIONS_FLOW",
  "raw_headline": "exact text"
}}

CONFIDENCE scoring:
- confidence: how likely this moves price materially (0-100)
- source_confidence: how real/credible the source is (0-100)
  - Deduct heavily for: anonymous accounts, new domains, coordinated posting, inconsistent data

GAMING DETECTION (set gaming_detected=true if you see):
- Multiple X accounts posting identical/near-identical text simultaneously
- Story appearing on 5+ low-credibility sites at the same time
- On-chain volume doesn't match exchange volume claims
- Newly created accounts amplifying a narrative
- Unverified "insider" claims with no corroboration

Focus on symbols: {watchlist}

Return ONLY valid JSON array []. Return [] if nothing material in last 3 minutes.
Do NOT include old news. Do NOT fabricate — if uncertain, set confidence < 50."""


def _grok_call(prompt: str, api_key: str) -> list[dict]:
    """POST to xAI /v1/responses. Returns parsed trigger list."""
    payload = json.dumps({
        "model": GROK_MODEL,
        "input": prompt,
    }).encode()

    req = urllib.request.Request(
        GROK_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        log.error("Grok HTTP %s: %s", e.code, e.read()[:200])
        return []
    except Exception as e:
        log.error("Grok call failed: %s", e)
        return []

    if not raw or not raw.strip():
        log.warning("Grok returned empty HTTP body (check API key / xAI status)")
        return []

    try:
        body = json.loads(raw.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as e:
        log.warning("Grok response not JSON: %s | head=%r", e, raw[:240])
        return []

    # Parse xAI responses API format
    text = ""
    try:
        for item in body.get("output", []):
            if item.get("type") == "message":
                for c in item.get("content", []):
                    if c.get("type") == "output_text":
                        text = c["text"]
                        break
            if text:
                break
        # fallback: choices format
        if not text:
            text = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        log.warning("Unexpected Grok response shape")
        return []

    return _parse_triggers(text)


def _parse_triggers(text: str) -> list[dict]:
    """Extract JSON array from Grok response text."""
    text = text.strip()

    # Strip markdown fences
    if "```" in text:
        lines = text.split("\n")
        inside = False
        buf = []
        for line in lines:
            if line.strip().startswith("```"):
                inside = not inside
                continue
            if inside:
                buf.append(line)
        text = "\n".join(buf).strip()

    # Find outermost [ ... ]
    start = text.find("[")
    if start == -1:
        return []
    depth = 0
    for i, ch in enumerate(text[start:], start):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                try:
                    chunk = text[start : i + 1].strip()
                    if not chunk:
                        return []
                    return json.loads(chunk)
                except json.JSONDecodeError as e:
                    log.warning(
                        "JSON parse error: %s | snippet=%r",
                        e,
                        text[start : min(len(text), start + 200)],
                    )
                    return []
    return []


# ── Trigger enrichment + validation ──────────────────────────────────────────

VALID_CLASSES   = {"CATALYST","REGIME_SHIFT","MOMENTUM","REVERSAL","MACRO_PRINT","WHALE","TWEET_STORM","REGULATORY"}
VALID_URGENCY   = {"NOW","5MIN","1HR","EOD","NEXT_SESSION"}
VALID_DIRECTION = {"LONG","SHORT","HEDGE","HOLD","EXIT","REDUCE"}


def _enrich(raw: dict) -> dict | None:
    """Validate and enrich a raw trigger from Grok. Returns None to discard."""
    # Required field check
    tc = str(raw.get("trigger_class", "")).upper()
    ug = str(raw.get("urgency", "")).upper()
    di = str(raw.get("direction", "")).upper()

    if tc not in VALID_CLASSES or ug not in VALID_URGENCY or di not in VALID_DIRECTION:
        return None

    conf     = int(raw.get("confidence", 0))
    src_conf = int(raw.get("source_confidence", 0))
    gaming   = bool(raw.get("gaming_detected", False))

    # Discard gamed signals — hard rule
    if gaming:
        log.info("DISCARD (gamed): %s", raw.get("raw_headline", "?")[:80])
        return None

    # Auto-HALO qualification
    halo_auto = (
        not gaming
        and src_conf >= 80
        and conf >= 75
        and ug in ("NOW", "5MIN")
    )

    return {
        "trigger_id":        str(uuid.uuid4()),
        "ts":                datetime.now(timezone.utc).isoformat(),
        "trigger_class":     tc,
        "urgency":           ug,
        "direction":         di,
        "ticker":            raw.get("ticker"),
        "sector":            raw.get("sector"),
        "catalyst_type":     raw.get("catalyst_type"),
        "confidence":        conf,
        "source_confidence": src_conf,
        "gaming_detected":   gaming,
        "gaming_flags":      raw.get("gaming_flags", []),
        "entry_window_min":  raw.get("entry_window_min"),
        "target_pct":        raw.get("target_pct"),
        "stop_pct":          raw.get("stop_pct"),
        "source":            raw.get("source", "NEWS_WIRE"),
        "source_url":        raw.get("source_url"),
        "raw_headline":      str(raw.get("raw_headline", ""))[:300],
        "halo_auto":         halo_auto,
        "outcome":           None,
    }


# ── Storage ───────────────────────────────────────────────────────────────────

def _load_json(path: pathlib.Path, default):
    try:
        return json.loads(path.read_text()) if path.exists() else default
    except Exception:
        return default


def _save_json(path: pathlib.Path, data):
    path.write_text(json.dumps(data, indent=2))


def _persist(triggers: list[dict], run_meta: dict):
    DATA_DIR.mkdir(exist_ok=True)

    # pulse_latest.json — last MAX_LATEST triggers (all runs, most recent first)
    latest_path = DATA_DIR / "pulse_latest.json"
    latest = _load_json(latest_path, {"triggers": [], "runs": []})

    existing = latest.get("triggers", [])
    existing = triggers + existing           # prepend newest
    existing = existing[:MAX_LATEST]
    latest["triggers"] = existing
    latest["runs"] = ([run_meta] + latest.get("runs", []))[:100]
    latest["last_updated"] = run_meta["ts"]
    _save_json(latest_path, latest)

    # pulse_history.json — one entry per run
    history_path = DATA_DIR / "pulse_history.json"
    history = _load_json(history_path, [])
    history = [{"ts": run_meta["ts"], "count": len(triggers), "triggers": triggers}] + history
    history = history[:MAX_HISTORY]
    _save_json(history_path, history)


# ── macOS notification ────────────────────────────────────────────────────────

def _notify(trigger: dict):
    headline = trigger["raw_headline"][:100]
    title    = f"M3D PULSE — {trigger['urgency']} {trigger['direction']}"
    subtitle = f"{trigger.get('ticker','MARKET')} · {trigger['trigger_class']} · {trigger['confidence']}% conf"
    try:
        script = (
            f'display notification "{headline}" '
            f'with title "{title}" '
            f'subtitle "{subtitle}" '
            f'sound name "Ping"'
        )
        subprocess.run(["osascript", "-e", script], timeout=3, capture_output=True)
    except Exception:
        pass   # Non-Mac or osascript unavailable — silent


# ── Single pulse run ──────────────────────────────────────────────────────────

def run_pulse(watchlist: list[str], api_key: str) -> list[dict]:
    ts = datetime.now(timezone.utc).isoformat()
    wl_str = ", ".join(watchlist)
    prompt = PULSE_PROMPT.format(watchlist=wl_str)

    log.info("Querying Grok... (3-min live search, %d symbols)", len(watchlist))
    raw_triggers = _grok_call(prompt, api_key)

    triggers = []
    for raw in raw_triggers:
        t = _enrich(raw)
        if t:
            triggers.append(t)

    run_meta = {
        "ts":           ts,
        "raw_count":    len(raw_triggers),
        "valid_count":  len(triggers),
        "discarded":    len(raw_triggers) - len(triggers),
        "halo_ready":   sum(1 for t in triggers if t["halo_auto"]),
    }

    log.info(
        "→ %d raw / %d valid / %d HALO-ready / %d discarded (gamed/low-conf)",
        run_meta["raw_count"], run_meta["valid_count"],
        run_meta["halo_ready"], run_meta["discarded"],
    )

    _persist(triggers, run_meta)

    # Notify for NOW urgency
    for t in triggers:
        if t["urgency"] == "NOW":
            log.info("🔴 NOW: %s %s — %s", t["direction"], t.get("ticker","MARKET"), t["raw_headline"][:80])
            _notify(t)
        elif t["urgency"] == "5MIN":
            log.info("🟡 5MIN: %s %s — %s", t["direction"], t.get("ticker","MARKET"), t["raw_headline"][:80])

    return triggers


# ── Main loop ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="M3D Grok Pulse Daemon")
    parser.add_argument("--interval",  type=int, default=60,  help="Poll interval in seconds (default: 60)")
    parser.add_argument("--watchlist", type=str, default="",  help="Comma-separated symbols to focus on")
    parser.add_argument("--once",      action="store_true",   help="Run once and exit")
    args = parser.parse_args()

    _load_env()

    api_key = os.environ.get("API_XAI_YODA_KEY", "")
    if not api_key:
        log.error("API_XAI_YODA_KEY not set. Add to .env.local (repo root) or M3D/.env.local")
        sys.exit(1)

    watchlist = DEFAULT_WATCHLIST
    if args.watchlist:
        watchlist = [s.strip().upper() for s in args.watchlist.split(",") if s.strip()]

    log.info("M3D Grok Pulse Daemon starting")
    log.info("  Interval : %ds", args.interval)
    log.info("  Watchlist: %s", ", ".join(watchlist[:10]) + ("..." if len(watchlist) > 10 else ""))
    log.info("  Data dir : %s", DATA_DIR)

    if args.once:
        run_pulse(watchlist, api_key)
        _run_xsocial(watchlist)
        return

    # XSocial runs every 5 minutes (300s) alongside pulse
    xsocial_last = 0.0

    while True:
        try:
            run_pulse(watchlist, api_key)
        except KeyboardInterrupt:
            log.info("Shutting down.")
            break
        except Exception as e:
            log.error("Pulse run failed: %s", e)

        # XSocial mega scan every 5 min
        now = time.time()
        if now - xsocial_last >= 300:
            try:
                _run_xsocial(watchlist)
                xsocial_last = now
            except Exception as e:
                log.error("XSocial scan failed: %s", e)

        try:
            time.sleep(args.interval)
        except KeyboardInterrupt:
            log.info("Shutting down.")
            break


def _run_xsocial(watchlist: list):
    """Fire XSocial mega scan (parallel Grok queries per asset)."""
    try:
        sys.path.insert(0, str(pathlib.Path(__file__).parent))
        from ds_app.xsocial import run_mega_scan
        log.info("XSocial mega scan: %d assets...", len(watchlist))
        snap = run_mega_scan(watchlist=watchlist, max_workers=6)
        log.info("XSocial done: %d assets scored", len(snap.get("assets", {})))
    except Exception as e:
        log.error("XSocial import/run error: %s", e)


if __name__ == "__main__":
    main()
