"""
ICT Arbitration Bridge — TradingView webhook → Claude API → Ollama fallback
Receives SIGNAL-MASTER JSON alert, routes to LLM for contextual arbitration.

LLM priority:
  1. Claude API (claude-sonnet-4-6) — primary, full reasoning
  2. Ollama gemma4:latest           — local fallback, fast
  3. Ollama qwen2.5:14b             — local fallback, deeper
  4. PASS-THROUGH                   — if all fail, log and return raw score

Run: python arbitration_bridge.py
POST: http://localhost:9100/webhook   (TradingView alert URL)
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import anthropic
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
import uvicorn

# ── Config ────────────────────────────────────────────────────────────────────
PORT            = int(os.getenv("BRIDGE_PORT", 9100))
CLAUDE_MODEL    = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
CLAUDE_TIMEOUT  = int(os.getenv("CLAUDE_TIMEOUT", 8))      # seconds — fast path
OLLAMA_HOST     = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_PRIMARY  = os.getenv("OLLAMA_PRIMARY",  "gemma4:latest")
OLLAMA_BACKUP   = os.getenv("OLLAMA_BACKUP",   "qwen2.5:14b")
OLLAMA_TIMEOUT  = int(os.getenv("OLLAMA_TIMEOUT", 20))
LOG_PATH        = Path(os.getenv("LOG_PATH", "logs/arbitration.jsonl"))
DASHBOARD_URL   = os.getenv("DASHBOARD_URL", "")           # M4D push (optional)
HMAC_SECRET     = os.getenv("TV_HMAC_SECRET", "")          # TradingView webhook secret

LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bridge")

app = FastAPI(title="ICT Arbitration Bridge")

# ── Prompt builder ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an ICT (Inner Circle Trader) signal arbitrator embedded in an algorithmic trading system.
You receive a structured signal from a confluence scorer and must decide: CONFIRM, FADE, or HOLD.

Rules:
- CONFIRM: all structural conditions align, signal is clean, proceed
- FADE: signal fires but structural context is against it — fade/skip
- HOLD: signal is borderline — wait for next candle confirmation before entry

Respond ONLY with valid JSON:
{"decision": "CONFIRM|FADE|HOLD", "confidence": 0-100, "reason": "one sentence max", "risk": "LOW|MEDIUM|HIGH"}

Be concise. No preamble. No markdown. Pure JSON."""


def build_prompt(signal: dict) -> str:
    ticker   = signal.get("ticker", "?")
    side     = signal.get("signal", "?")
    score    = signal.get("score", 0)
    regime   = signal.get("regime", "UNKNOWN")
    price    = signal.get("price", 0)
    atr      = signal.get("atr", 0)
    sl       = signal.get("sl", 0)
    tp       = signal.get("tp", 0)
    comps    = signal.get("components", {})
    ts       = signal.get("time", 0)

    active = [k.upper() for k, v in comps.items() if v == 1]
    inactive = [k.upper() for k, v in comps.items() if v == 0]

    return f"""Signal received at {datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat() if ts else 'now'}:

Ticker: {ticker} | Side: {side} | Score: {score}/100 | Regime: {regime}
Price: {price:.5f} | ATR: {atr:.5f} | SL: {sl:.5f} | TP: {tp:.5f}
R:R implied: {abs(tp - price) / max(abs(sl - price), 1e-10):.1f}

Active components: {', '.join(active) if active else 'none'}
Missing components: {', '.join(inactive) if inactive else 'none'}

Arbitrate this {side} signal."""


# ── LLM callers ───────────────────────────────────────────────────────────────

async def call_claude(prompt: str) -> dict | None:
    """Call Claude API with tight timeout. Returns parsed decision or None."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None
    try:
        client = anthropic.AsyncAnthropic(api_key=api_key)
        msg = await asyncio.wait_for(
            client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=120,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=CLAUDE_TIMEOUT,
        )
        raw = msg.content[0].text.strip()
        return json.loads(raw)
    except (asyncio.TimeoutError, json.JSONDecodeError, Exception) as e:
        log.warning(f"Claude failed: {type(e).__name__}: {e}")
        return None


async def call_ollama(model: str, prompt: str) -> dict | None:
    """Call local Ollama with system+user format. Returns parsed decision or None."""
    payload = {
        "model": model,
        "prompt": f"{SYSTEM_PROMPT}\n\n{prompt}",
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 120},
    }
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            r = await client.post(f"{OLLAMA_HOST}/api/generate", json=payload)
            r.raise_for_status()
            raw = r.json().get("response", "").strip()
            # Strip any markdown fences Ollama sometimes adds
            if raw.startswith("```"):
                raw = raw.split("```")[1].lstrip("json").strip()
            return json.loads(raw)
    except (json.JSONDecodeError, httpx.HTTPError, Exception) as e:
        log.warning(f"Ollama {model} failed: {type(e).__name__}: {e}")
        return None


async def arbitrate(signal: dict) -> dict:
    """
    Run arbitration waterfall:
    1. Claude API → 2. gemma4 → 3. qwen2.5 → 4. pass-through
    Returns decision dict with source field.
    """
    prompt = build_prompt(signal)
    score  = signal.get("score", 0)

    # 1. Claude
    result = await call_claude(prompt)
    if result:
        result["source"] = "claude"
        return result

    # 2. Ollama primary (gemma4)
    result = await call_ollama(OLLAMA_PRIMARY, prompt)
    if result:
        result["source"] = f"ollama:{OLLAMA_PRIMARY}"
        return result

    # 3. Ollama backup (qwen2.5)
    result = await call_ollama(OLLAMA_BACKUP, prompt)
    if result:
        result["source"] = f"ollama:{OLLAMA_BACKUP}"
        return result

    # 4. Pass-through — score-based heuristic fallback
    log.warning("All LLMs failed — using score heuristic fallback")
    decision = "CONFIRM" if score >= 70 else "HOLD" if score >= 50 else "FADE"
    return {
        "decision":   decision,
        "confidence": score,
        "reason":     f"LLM unavailable — score heuristic (score={score})",
        "risk":       "HIGH" if score < 60 else "MEDIUM",
        "source":     "heuristic_fallback",
    }


# ── Logging ───────────────────────────────────────────────────────────────────

def log_decision(signal: dict, decision: dict, latency_ms: int) -> None:
    record = {
        "ts":       datetime.now(tz=timezone.utc).isoformat(),
        "ticker":   signal.get("ticker"),
        "signal":   signal.get("signal"),
        "score":    signal.get("score"),
        "price":    signal.get("price"),
        "decision": decision.get("decision"),
        "confidence": decision.get("confidence"),
        "reason":   decision.get("reason"),
        "risk":     decision.get("risk"),
        "source":   decision.get("source"),
        "latency_ms": latency_ms,
    }
    with LOG_PATH.open("a") as f:
        f.write(json.dumps(record) + "\n")
    log.info(
        f"[{record['ticker']}] {record['signal']} score={record['score']} "
        f"→ {record['decision']} ({record['source']}) {latency_ms}ms"
    )


async def push_to_dashboard(signal: dict, decision: dict) -> None:
    """Optional: push result to M4D dashboard websocket / REST."""
    if not DASHBOARD_URL:
        return
    payload = {**signal, "arbitration": decision}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(DASHBOARD_URL, json=payload)
    except Exception as e:
        log.debug(f"Dashboard push failed (non-critical): {e}")


# ── Webhook endpoint ──────────────────────────────────────────────────────────

@app.post("/webhook")
async def webhook(request: Request) -> JSONResponse:
    """
    TradingView alert → arbitration → response.
    Expects JSON body matching SIGNAL-MASTER alert format.
    """
    body = await request.body()

    # Parse — TV sends alert message as raw string or JSON
    try:
        signal: dict[str, Any] = json.loads(body)
    except json.JSONDecodeError:
        # TV sometimes wraps in quotes — try unwrap
        try:
            signal = json.loads(body.decode().strip('"').replace('\\"', '"'))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

    if "ticker" not in signal or "signal" not in signal:
        raise HTTPException(status_code=422, detail="Missing required fields: ticker, signal")

    t0 = time.monotonic()
    decision = await arbitrate(signal)
    latency_ms = int((time.monotonic() - t0) * 1000)

    log_decision(signal, decision, latency_ms)
    asyncio.create_task(push_to_dashboard(signal, decision))

    return JSONResponse({
        "status":     "ok",
        "ticker":     signal.get("ticker"),
        "side":       signal.get("signal"),
        "score":      signal.get("score"),
        "decision":   decision.get("decision"),
        "confidence": decision.get("confidence"),
        "reason":     decision.get("reason"),
        "risk":       decision.get("risk"),
        "source":     decision.get("source"),
        "latency_ms": latency_ms,
    })


@app.get("/health")
async def health() -> JSONResponse:
    """Check which LLMs are reachable."""
    claude_ok = bool(os.getenv("ANTHROPIC_API_KEY"))
    ollama_ok = False
    models_up: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{OLLAMA_HOST}/api/tags")
            if r.status_code == 200:
                ollama_ok = True
                names = [m["name"] for m in r.json().get("models", [])]
                models_up = [n for n in names if any(k in n for k in ["gemma", "qwen"])]
    except Exception:
        pass
    return JSONResponse({
        "status":    "ok",
        "claude":    claude_ok,
        "ollama":    ollama_ok,
        "models":    models_up,
        "priority":  ["claude", OLLAMA_PRIMARY, OLLAMA_BACKUP, "heuristic_fallback"],
    })


@app.get("/log/recent")
async def recent_log(n: int = 20) -> JSONResponse:
    """Last N arbitration decisions."""
    if not LOG_PATH.exists():
        return JSONResponse({"decisions": []})
    lines = LOG_PATH.read_text().strip().splitlines()
    recent = [json.loads(l) for l in lines[-n:]]
    return JSONResponse({"decisions": list(reversed(recent))})


# ── Entry ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run("arbitration_bridge:app", host="0.0.0.0", port=PORT, reload=False)
