"""
XSocial Alpha Engine — Grok/xAI mega queries against X (Twitter)
Runs alongside grok_pulse.py, produces per-asset social scores.

Output schema per asset:
  sentiment_velocity  : -1..+1  (acceleration of sentiment, not level)
  smart_money_signal  : -1..+1  (verified traders / institutional discussion)
  retail_fomo         :  0..+1  (danger when >0.7 — overcrowded)
  catalyst_loading    : -1..+1  (upcoming event being priced/discussed)
  narrative_momentum  : -1..+1  (new macro narrative not yet in price)
  composite_x         : -1..+1  (weighted social alpha score)
  gaming_detected     : bool
  confidence          :  0..1
"""

import os, json, time, pathlib, logging, concurrent.futures
from typing import Optional
import requests

log = logging.getLogger("xsocial")

# ── Env ───────────────────────────────────────────────────────────────────────
def _load_env():
    base = pathlib.Path(__file__).parent.parent.parent
    for env_path in (base / "M3D" / ".env.local", base / ".env.local"):
        if not env_path.exists():
            continue
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                kk, vv = k.strip(), v.strip()
                if kk and vv:
                    os.environ[kk] = vv

_load_env()
XAI_KEY = os.environ.get("API_XAI_YODA_KEY", "")
XAI_URL = "https://api.x.ai/v1/responses"

SCAN_MODEL = "grok-4.20-0309-non-reasoning"   # hourly narrative scan

# ── Watchlists ─────────────────────────────────────────────────────────────────
WATCHLIST_CRYPTO = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "AVAX", "MATIC", "LINK", "ARB"]
WATCHLIST_MACRO   = ["SPY", "QQQ", "GLD", "TLT", "DXY", "VIX"]
WATCHLIST_STOCKS  = ["NVDA", "TSLA", "AAPL", "MSFT", "META", "AMZN"]

OUTPUT_DIR = pathlib.Path(__file__).parent.parent / "data"

# ── Per-asset mega query ───────────────────────────────────────────────────────
ASSET_PROMPT = """
You are analyzing X (Twitter) RIGHT NOW for the asset: {asset}

Search X for the last 2 hours of posts, discussions, and sentiment about {asset}.

Return ONLY valid JSON — no markdown, no explanation:
{{
  "asset": "{asset}",
  "sentiment_velocity": <float -1 to 1, RATE OF CHANGE of sentiment — positive = accelerating bullish>,
  "smart_money_signal": <float -1 to 1, verified traders/analysts with institutional-grade takes>,
  "retail_fomo": <float 0 to 1, 0=no fomo, 1=extreme overcrowded retail>,
  "catalyst_loading": <float -1 to 1, upcoming catalyst being discussed — earnings/listing/unlock/macro>,
  "narrative_momentum": <float -1 to 1, new narrative forming that has NOT reached price yet>,
  "composite_x": <float -1 to 1, your weighted social alpha score for {asset}>,
  "top_signals": [<2-3 specific signal strings you found on X>],
  "gaming_detected": <bool, is this synthetic/coordinated pumping?>,
  "confidence": <float 0 to 1, how confident are you in this data quality?>,
  "x_volume_spike": <bool, is X mention volume spiking vs 24h mean?>
}}

Rules:
- sentiment_velocity is the DERIVATIVE (change rate), not the level. Flat bullish = 0. Suddenly turning bullish = +0.8
- If gaming_detected is true, set composite_x to 0
- Confidence should reflect X data quality, not your certainty
"""

MACRO_PROMPT = """
You are analyzing X (Twitter) RIGHT NOW for macro market conditions.

Search X for the last 2 hours: Fed commentary, CPI/jobs reactions, institutional macro takes,
DXY/yield discussion, crypto macro correlation, any systemic risk signals.

Return ONLY valid JSON:
{{
  "macro_regime": "<RISK_ON|RISK_OFF|NEUTRAL>",
  "fed_sentiment": <float -1 to 1>,
  "dollar_pressure": <float -1 to 1, negative = dollar weakening = crypto bullish>,
  "systemic_risk": <float 0 to 1, 0=calm, 1=crisis signals>,
  "institutional_flow": <float -1 to 1, institutions buying/selling risk>,
  "narrative_shift": "<string, dominant new macro narrative on X or null>",
  "top_macro_signals": [<2-3 specific things you found>],
  "confidence": <float 0 to 1>
}}
"""

# ── Grok caller ───────────────────────────────────────────────────────────────
def _grok(prompt: str, timeout: int = 30) -> Optional[dict]:
    if not XAI_KEY:
        log.error("API_XAI_YODA_KEY not set")
        return None
    try:
        r = requests.post(
            XAI_URL,
            headers={"Authorization": f"Bearer {XAI_KEY}", "Content-Type": "application/json"},
            json={
                "model": SCAN_MODEL,
                "input": prompt,                      # Responses API format
                "search_parameters": {"mode": "on"},  # live X search
                "temperature": 0.1,
            },
            timeout=timeout,
        )
        r.raise_for_status()
        data = r.json()
        raw = ""
        for item in data.get("output", []):
            for c in item.get("content", []):
                if c.get("type") == "text":
                    raw += c["text"]
        raw = raw.strip().strip("`")
        if raw.startswith("json"):
            raw = raw[4:].strip()
        return json.loads(raw)
    except json.JSONDecodeError as e:
        log.warning("JSON parse error: %s", e)
        return None
    except Exception as e:
        log.warning("Grok call failed: %s", e)
        return None

# ── Single asset scan ─────────────────────────────────────────────────────────
def scan_asset(symbol: str) -> dict:
    result = _grok(ASSET_PROMPT.format(asset=symbol))
    if not result:
        return {"asset": symbol, "composite_x": 0.0, "confidence": 0.0, "error": "grok_failed"}

    # Hard discard gaming
    if result.get("gaming_detected"):
        result["composite_x"] = 0.0
        log.info(f"[xsocial] {symbol} — gaming detected, zeroed")

    # Clamp all floats to valid range
    for k in ("sentiment_velocity", "smart_money_signal", "catalyst_loading", "narrative_momentum", "composite_x"):
        if k in result:
            result[k] = max(-1.0, min(1.0, float(result[k])))
    for k in ("retail_fomo", "confidence"):
        if k in result:
            result[k] = max(0.0, min(1.0, float(result[k])))

    result["ts"] = int(time.time())
    return result

def scan_macro() -> dict:
    result = _grok(MACRO_PROMPT)
    if not result:
        return {"macro_regime": "UNKNOWN", "confidence": 0.0, "error": "grok_failed"}
    result["ts"] = int(time.time())
    return result

# ── Parallel mega scan ────────────────────────────────────────────────────────
def run_mega_scan(watchlist: list = None, max_workers: int = 6) -> dict:
    """
    Fire parallel Grok queries for all assets + macro.
    Returns full xsocial snapshot.
    """
    if watchlist is None:
        watchlist = WATCHLIST_CRYPTO + WATCHLIST_STOCKS

    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(scan_asset, sym): sym for sym in watchlist}
        futures[ex.submit(scan_macro)] = "__macro__"

        for future in concurrent.futures.as_completed(futures):
            sym = futures[future]
            try:
                results[sym] = future.result()
            except Exception as e:
                results[sym] = {"error": str(e)}
                log.warning(f"[xsocial] {sym} failed: {e}")

    snapshot = {
        "ts": int(time.time()),
        "assets": {k: v for k, v in results.items() if k != "__macro__"},
        "macro": results.get("__macro__", {}),
        "watchlist": watchlist,
    }
    _persist(snapshot)
    log.info(f"[xsocial] Mega scan complete: {len(snapshot['assets'])} assets")
    return snapshot

# ── Persistence ───────────────────────────────────────────────────────────────
XSOCIAL_PATH = OUTPUT_DIR / "xsocial_latest.json"

def _persist(snapshot: dict):
    OUTPUT_DIR.mkdir(exist_ok=True)
    XSOCIAL_PATH.write_text(json.dumps(snapshot, indent=2))

def load_latest() -> Optional[dict]:
    if XSOCIAL_PATH.exists():
        return json.loads(XSOCIAL_PATH.read_text())
    return None

# ── Pulse expert signal extractor ─────────────────────────────────────────────
def pulse_signal_for(symbol: str, snapshot: dict = None) -> float:
    """
    Returns -1..+1 PULSE expert signal for MoE gating.
    Weighting: sentiment_velocity 40% + smart_money 35% + narrative_momentum 25%
    Retail FOMO > 0.75 inverts the signal (contrarian).
    """
    if snapshot is None:
        snapshot = load_latest()
    if not snapshot:
        return 0.0

    a = snapshot.get("assets", {}).get(symbol, {})
    if a.get("error") or a.get("gaming_detected"):
        return 0.0

    sv  = float(a.get("sentiment_velocity", 0))
    sm  = float(a.get("smart_money_signal", 0))
    nm  = float(a.get("narrative_momentum", 0))
    fomo = float(a.get("retail_fomo", 0))
    conf = float(a.get("confidence", 0.5))

    raw = sv * 0.40 + sm * 0.35 + nm * 0.25

    # Contrarian: extreme retail FOMO is a fade signal
    if fomo > 0.75:
        raw *= -0.5

    return max(-1.0, min(1.0, raw * conf))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("Running XSocial mega scan...")
    snap = run_mega_scan()
    print(json.dumps(snap, indent=2))
