"""
SURGE LLM Arbitration Layer v1.0
=================================
Receives SMC + MTF JSON signals from TradingView webhooks.
Runs Claude API (+ Ollama fallback) arbitration ensemble.
Outputs: final trade decision with entry/SL/TP and reasoning chain.

Architecture:
  TradingView Alert → Webhook (FastAPI) → Signal Buffer →
  Arbitrator (Claude + Ollama ensemble) → Decision JSON → Execution Bridge
"""

import asyncio
import json
import logging
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

import anthropic
import httpx
from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
import uvicorn

# ─── CONFIG ──────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("SURGE.Arbitrator")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OLLAMA_BASE_URL   = os.environ.get("OLLAMA_BASE_URL",   "http://localhost:11434")
OLLAMA_MODEL      = os.environ.get("OLLAMA_MODEL",      "llama3.1:8b")
WEBHOOK_SECRET    = os.environ.get("SURGE_WEBHOOK_SECRET", "surge-secret-change-me")

# Signal buffer: hold signals per ticker for fusion window
FUSION_WINDOW_SECS = 30   # Wait up to 30s for MTF signal after SMC signal
MIN_SMC_CONFIDENCE = 40   # Ignore SMC signals below this confidence
MIN_MTF_ALIGNMENT  = 55   # Ignore MTF scores below this

# Ensemble weights
WEIGHT_CLAUDE  = 0.70
WEIGHT_OLLAMA  = 0.30

# Priority hierarchy for conflict resolution (higher = wins)
SIGNAL_PRIORITY = {
    "choch":   5,   # Highest — potential reversal
    "ob_sf":   4,   # OB sweep-and-fill (confirmed institutional entry)
    "liq":     3,   # Liquidity sweep
    "bos":     2,   # Structure break (trend continuation)
    "fvg":     1,   # FVG (supporting, low weight)
    "mtf":     3,   # MTF alignment
    "momentum": 1,  # Gate only
}

# ─── DATA MODELS ─────────────────────────────────────────────────────────────

@dataclass
class SMCSignal:
    source: str
    ts: int
    ticker: str
    tf: str
    close: float
    signal: str          # LONG / SHORT / NEUTRAL
    confidence: float    # 0-100
    smc_score: float     # -100 to +100
    norm_score: float    # 0-100
    bos_bull: bool
    bos_bear: bool
    choch_bull: bool
    choch_bear: bool
    liq_sweep_bsl: bool
    liq_sweep_ssl: bool
    ob_sweep_fill_bull: bool
    ob_sweep_fill_bear: bool
    fvg_bull: bool
    fvg_bear: bool
    trend_bull: Optional[bool]

@dataclass
class MTFSignal:
    source: str
    ts: int
    ticker: str
    mtf_bias: str        # BULL / BEAR / NEUTRAL
    align_score: float   # 0-100
    adj_score: float     # 0-100 (conflict-adjusted)
    agreement: int       # 0-5 TFs aligned
    htf_ltf_aligned: bool
    conflict_penalty: int
    bias_d: str
    bias_4h: str
    bias_1h: str
    bias_15m: str
    bias_5m: str

@dataclass
class FusedSignal:
    ticker: str
    ts: datetime
    smc: Optional[SMCSignal]
    mtf: Optional[MTFSignal]
    raw_direction: str   # From SMC
    raw_confidence: float
    mtf_alignment: float
    composite_score: float  # 0-100 weighted
    key_events: list[str]

@dataclass
class ArbitratorDecision:
    ticker: str
    ts: str
    signal: str          # LONG / SHORT / HOLD
    confidence: float    # 0-100
    entry: Optional[float]
    sl: Optional[float]
    tp1: Optional[float]
    tp2: Optional[float]
    rr: Optional[float]
    reasoning: str
    smc_summary: str
    mtf_summary: str
    model_used: str
    ensemble_votes: dict
    raw_composite: float
    execution_allowed: bool  # False if HTF/LTF conflict

# ─── SIGNAL BUFFER ───────────────────────────────────────────────────────────

class SignalBuffer:
    """
    Buffers incoming signals per ticker and fuses them
    when both SMC and MTF arrive within the fusion window.
    """
    def __init__(self):
        self._smc: dict[str, SMCSignal] = {}
        self._mtf: dict[str, MTFSignal] = {}
        self._smc_ts: dict[str, float]  = {}
        self._history: deque = deque(maxlen=100)

    def add_smc(self, s: SMCSignal):
        self._smc[s.ticker]    = s
        self._smc_ts[s.ticker] = time.time()
        log.info(f"SMC buffered: {s.ticker} {s.signal} conf={s.confidence:.0f}")

    def add_mtf(self, s: MTFSignal):
        self._mtf[s.ticker] = s
        log.info(f"MTF buffered: {s.ticker} bias={s.mtf_bias} align={s.align_score:.0f}")

    def try_fuse(self, ticker: str) -> Optional[FusedSignal]:
        smc = self._smc.get(ticker)
        mtf = self._mtf.get(ticker)

        if smc is None:
            return None

        # Check if SMC signal is stale
        age = time.time() - self._smc_ts.get(ticker, 0)
        if age > FUSION_WINDOW_SECS:
            log.info(f"SMC signal for {ticker} stale ({age:.0f}s), dropping")
            self._smc.pop(ticker, None)
            return None

        # MTF optional but weighted in composite
        mtf_align = mtf.adj_score if mtf else 50.0  # Neutral if no MTF signal
        htf_ltf_ok = mtf.htf_ltf_aligned if mtf else True

        # Composite score: SMC 60% + MTF 40%
        composite = smc.norm_score * 0.60 + mtf_align * 0.40

        # Key events for arbitrator context
        events = []
        if smc.choch_bull:   events.append("CHoCH Bullish — potential trend reversal")
        if smc.choch_bear:   events.append("CHoCH Bearish — potential trend reversal")
        if smc.ob_sweep_fill_bull: events.append("OB Sweep-and-Fill Bullish — institutional entry confirmed")
        if smc.ob_sweep_fill_bear: events.append("OB Sweep-and-Fill Bearish — institutional entry confirmed")
        if smc.liq_sweep_ssl:events.append("SSL Swept — stop hunt below, reversal candidate")
        if smc.liq_sweep_bsl:events.append("BSL Swept — stop hunt above, reversal candidate")
        if smc.bos_bull:     events.append("BOS Bullish — trend continuation signal")
        if smc.bos_bear:     events.append("BOS Bearish — trend continuation signal")
        if smc.fvg_bull:     events.append("Bullish FVG detected — imbalance zone above")
        if smc.fvg_bear:     events.append("Bearish FVG detected — imbalance zone below")

        fused = FusedSignal(
            ticker         = ticker,
            ts             = datetime.now(timezone.utc),
            smc            = smc,
            mtf            = mtf,
            raw_direction  = smc.signal,
            raw_confidence = smc.confidence,
            mtf_alignment  = mtf_align,
            composite_score= composite,
            key_events     = events,
        )

        # Clear buffer after fusion
        self._smc.pop(ticker, None)
        self._mtf.pop(ticker, None)
        self._history.appendleft(fused)
        return fused

buffer = SignalBuffer()

# ─── ARBITRATOR PROMPT ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are SURGE, an institutional-grade Smart Money Concepts trading arbitrator.

Your role: receive fused SMC + MTF signals and output a precise, actionable trading decision.

DECISION FRAMEWORK (apply in strict priority order):
1. CHoCH (Change of Character) → highest weight, potential reversal. Confirm with MTF bias flip.
2. OB Sweep-and-Fill → institutional entry signal. High confidence if MTF aligned.
3. Liquidity Sweep (BSL/SSL) → stop hunt signal. Strong if followed by CHoCH or OB S&F.
4. BOS (Break of Structure) → trend continuation. Only trade WITH HTF bias.
5. FVG → supporting evidence only. Never standalone entry trigger.

RULES:
- NEVER signal LONG if HTF bias is BEAR unless CHoCH is present.
- NEVER signal SHORT if HTF bias is BULL unless CHoCH is present.
- If HTF/LTF conflict penalty > 0: downgrade confidence by 20pts.
- If MTF alignment < 40: output HOLD regardless of SMC score.
- If SMC confidence < 40: output HOLD.
- CHoCH + SSL Sweep + OB S&F = highest quality setup (Triple Confluence).
- BOS + MTF alignment > 70 = trend continuation trade.

OUTPUT FORMAT (JSON only, no prose outside JSON):
{
  "signal": "LONG|SHORT|HOLD",
  "confidence": 0-100,
  "entry": price_or_null,
  "sl": price_or_null,
  "tp1": price_or_null,
  "tp2": price_or_null,
  "rr": ratio_or_null,
  "reasoning": "2-3 sentence max: primary trigger, confluence factors, risk note",
  "smc_summary": "1 sentence: key SMC event",
  "mtf_summary": "1 sentence: MTF alignment state",
  "execution_allowed": true|false
}"""

def build_user_prompt(fused: FusedSignal) -> str:
    smc = fused.smc
    mtf = fused.mtf

    price = smc.close if smc else 0

    # Estimate SL/TP from ATR proxy (price × % move)
    # Real system should feed actual ATR — placeholder here
    atr_proxy = price * 0.005  # 0.5% ATR estimate
    sl_long  = round(price - atr_proxy * 2, 4)
    tp1_long = round(price + atr_proxy * 3, 4)
    tp2_long = round(price + atr_proxy * 6, 4)
    sl_short  = round(price + atr_proxy * 2, 4)
    tp1_short = round(price - atr_proxy * 3, 4)
    tp2_short = round(price - atr_proxy * 6, 4)

    mtf_str = ""
    if mtf:
        mtf_str = f"""
MTF CONFLUENCE:
  Bias: {mtf.mtf_bias} | Alignment: {mtf.align_score:.0f}/100 (Adjusted: {mtf.adj_score:.0f})
  Agreement: {mtf.agreement}/5 TFs
  HTF/LTF Aligned: {mtf.htf_ltf_aligned} | Conflict penalty: -{mtf.conflict_penalty}pts
  Timeframe biases: D={mtf.bias_d} | 4H={mtf.bias_4h} | 1H={mtf.bias_1h} | 15m={mtf.bias_15m} | 5m={mtf.bias_5m}"""
    else:
        mtf_str = "\nMTF CONFLUENCE: Not yet received — treat as neutral (50/100)"

    key_str = "\n  ".join(fused.key_events) if fused.key_events else "None"

    return f"""SURGE SIGNAL FUSION — {fused.ticker} @ {datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}

SMC MODULE:
  Signal: {smc.signal if smc else 'N/A'} | Confidence: {smc.confidence:.0f} | SMC Score: {smc.smc_score:.0f}
  Trend: {'BULL' if smc.trend_bull else 'BEAR' if smc.trend_bull is False else 'N/A'}
  Close: {price}
  Timeframe: {smc.tf if smc else 'N/A'}
{mtf_str}

COMPOSITE SCORE: {fused.composite_score:.1f}/100 (SMC 60% + MTF 40%)

KEY EVENTS FIRED:
  {key_str}

PRICE REFS (for entry/SL/TP estimation):
  Estimated long  SL={sl_long}, TP1={tp1_long}, TP2={tp2_long}
  Estimated short SL={sl_short}, TP1={tp1_short}, TP2={tp2_short}
  (Override with actual OB/FVG/swing levels in your response)

Output decision JSON only."""

# ─── CLAUDE ARBITRATOR ────────────────────────────────────────────────────────

client_claude = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

async def run_claude_arbitration(fused: FusedSignal) -> dict:
    try:
        msg = await client_claude.messages.create(
            model      = "claude-sonnet-4-20250514",
            max_tokens = 600,
            system     = SYSTEM_PROMPT,
            messages   = [{"role": "user", "content": build_user_prompt(fused)}]
        )
        raw = msg.content[0].text.strip()
        # Strip any markdown fences if present
        raw = raw.replace("```json", "").replace("```", "").strip()
        return json.loads(raw)
    except Exception as e:
        log.error(f"Claude arbitration failed: {e}")
        return None

# ─── OLLAMA ARBITRATOR (LOCAL FALLBACK) ──────────────────────────────────────

async def run_ollama_arbitration(fused: FusedSignal) -> dict:
    try:
        payload = {
            "model":  OLLAMA_MODEL,
            "prompt": SYSTEM_PROMPT + "\n\n" + build_user_prompt(fused),
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1, "num_predict": 500}
        }
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
            r.raise_for_status()
            data = r.json()
            raw  = data.get("response", "{}").strip()
            return json.loads(raw)
    except Exception as e:
        log.error(f"Ollama arbitration failed: {e}")
        return None

# ─── ENSEMBLE COMBINER ────────────────────────────────────────────────────────

def combine_ensemble(claude_r: dict, ollama_r: dict, fused: FusedSignal) -> ArbitratorDecision:
    """
    Weighted ensemble: Claude 70% + Ollama 30%.
    If one model fails, use the other at 100%.
    """
    if claude_r is None and ollama_r is None:
        # Total failure — fallback to rule-based decision
        signal = fused.raw_direction if fused.composite_score >= 60 else "HOLD"
        return ArbitratorDecision(
            ticker          = fused.ticker,
            ts              = datetime.now(timezone.utc).isoformat(),
            signal          = signal,
            confidence      = min(fused.composite_score, 40),  # Cap at 40 on fallback
            entry           = fused.smc.close if fused.smc else None,
            sl              = None, tp1=None, tp2=None, rr=None,
            reasoning       = "Ensemble unavailable — rule-based fallback",
            smc_summary     = ", ".join(fused.key_events[:2]) if fused.key_events else "No key events",
            mtf_summary     = f"MTF alignment {fused.mtf_alignment:.0f}/100",
            model_used      = "FALLBACK",
            ensemble_votes  = {},
            raw_composite   = fused.composite_score,
            execution_allowed = fused.composite_score >= 60
        )

    # Signal voting with weights
    signal_scores = defaultdict(float)
    confidence_total = 0.0
    votes = {}

    if claude_r:
        sig = claude_r.get("signal", "HOLD")
        conf = float(claude_r.get("confidence", 0))
        signal_scores[sig] += conf * WEIGHT_CLAUDE
        confidence_total   += conf * WEIGHT_CLAUDE
        votes["claude"]     = {"signal": sig, "confidence": conf}

    if ollama_r:
        sig = ollama_r.get("signal", "HOLD")
        conf = float(ollama_r.get("confidence", 0))
        weight = WEIGHT_OLLAMA if claude_r else 1.0
        signal_scores[sig] += conf * weight
        confidence_total   += conf * weight
        votes["ollama"]     = {"signal": sig, "confidence": conf}

    final_signal = max(signal_scores, key=signal_scores.get)
    final_conf   = min(100, confidence_total)

    # Prefer Claude for entry/SL/TP if available
    primary = claude_r if claude_r else ollama_r

    # HTF/LTF execution lock
    exec_allowed = True
    if fused.mtf and not fused.mtf.htf_ltf_aligned:
        exec_allowed = final_conf >= 75  # Only high-confidence trades override conflict

    model_used = "ENSEMBLE(Claude+Ollama)" if claude_r and ollama_r else \
                 "Claude" if claude_r else "Ollama"

    return ArbitratorDecision(
        ticker     = fused.ticker,
        ts         = datetime.now(timezone.utc).isoformat(),
        signal     = final_signal,
        confidence = round(final_conf, 1),
        entry      = primary.get("entry"),
        sl         = primary.get("sl"),
        tp1        = primary.get("tp1"),
        tp2        = primary.get("tp2"),
        rr         = primary.get("rr"),
        reasoning  = primary.get("reasoning", ""),
        smc_summary= primary.get("smc_summary", ""),
        mtf_summary= primary.get("mtf_summary", ""),
        model_used = model_used,
        ensemble_votes = votes,
        raw_composite  = fused.composite_score,
        execution_allowed = exec_allowed
    )

# ─── MAIN ARBITRATION PIPELINE ────────────────────────────────────────────────

async def arbitrate(fused: FusedSignal) -> ArbitratorDecision:
    log.info(f"Arbitrating: {fused.ticker} composite={fused.composite_score:.1f}")

    # Gate checks before LLM call (saves API cost)
    smc = fused.smc
    if smc and smc.confidence < MIN_SMC_CONFIDENCE:
        log.info(f"Skipping: SMC confidence {smc.confidence} < {MIN_SMC_CONFIDENCE}")
        return None

    if fused.mtf_alignment < MIN_MTF_ALIGNMENT and fused.composite_score < 55:
        log.info(f"Skipping: MTF alignment {fused.mtf_alignment:.0f} too low")
        return None

    # Run ensemble in parallel
    claude_task = asyncio.create_task(run_claude_arbitration(fused))
    ollama_task = asyncio.create_task(run_ollama_arbitration(fused))
    claude_r, ollama_r = await asyncio.gather(claude_task, ollama_task)

    decision = combine_ensemble(claude_r, ollama_r, fused)
    log.info(f"Decision: {decision.signal} conf={decision.confidence:.0f} model={decision.model_used}")
    return decision

# ─── WEBHOOK API ─────────────────────────────────────────────────────────────

app = FastAPI(title="SURGE Arbitration Layer", version="1.0")

# In-memory decision log (replace with DB in production)
decision_log: deque = deque(maxlen=500)

@app.post("/webhook/smc")
async def receive_smc(request: Request, background_tasks: BackgroundTasks):
    """Receive SMC alert from TradingView"""
    body = await request.body()
    try:
        data = json.loads(body)
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    # Auth check
    if data.get("secret") and data["secret"] != WEBHOOK_SECRET:
        raise HTTPException(403, "Invalid secret")

    try:
        sig = SMCSignal(**{k: v for k, v in data.items() if k != "secret"})
    except Exception as e:
        raise HTTPException(422, f"SMC parse error: {e}")

    buffer.add_smc(sig)
    background_tasks.add_task(process_fusion, sig.ticker)
    return {"status": "buffered", "ticker": sig.ticker}

@app.post("/webhook/mtf")
async def receive_mtf(request: Request, background_tasks: BackgroundTasks):
    """Receive MTF confluence alert from TradingView"""
    body = await request.body()
    try:
        data = json.loads(body)
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    try:
        sig = MTFSignal(**{k: v for k, v in data.items() if k != "secret"})
    except Exception as e:
        raise HTTPException(422, f"MTF parse error: {e}")

    buffer.add_mtf(sig)
    background_tasks.add_task(process_fusion, sig.ticker)
    return {"status": "buffered", "ticker": sig.ticker}

async def process_fusion(ticker: str):
    """Try to fuse signals and run arbitration"""
    fused = buffer.try_fuse(ticker)
    if fused is None:
        return

    decision = await arbitrate(fused)
    if decision:
        decision_log.appendleft(decision)
        log.info(f"DECISION LOGGED: {decision.ticker} {decision.signal} {decision.confidence:.0f}")

        # TODO: Forward to execution bridge
        # await execution_bridge.send(decision)

@app.get("/decisions")
async def get_decisions(ticker: Optional[str] = None, limit: int = 20):
    """Retrieve recent arbitration decisions"""
    decisions = list(decision_log)
    if ticker:
        decisions = [d for d in decisions if d.ticker == ticker]
    return [asdict(d) for d in decisions[:limit]]

@app.get("/status")
async def get_status():
    return {
        "status":       "online",
        "ts":           datetime.now(timezone.utc).isoformat(),
        "decisions_logged": len(decision_log),
        "claude_model": "claude-sonnet-4-20250514",
        "ollama_model": OLLAMA_MODEL,
        "ensemble_weights": {
            "claude": WEIGHT_CLAUDE,
            "ollama": WEIGHT_OLLAMA
        },
        "gates": {
            "min_smc_confidence": MIN_SMC_CONFIDENCE,
            "min_mtf_alignment":  MIN_MTF_ALIGNMENT,
            "fusion_window_secs": FUSION_WINDOW_SECS
        }
    }

@app.get("/health")
async def health():
    return {"ok": True}

# ─── ENTRYPOINT ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")
