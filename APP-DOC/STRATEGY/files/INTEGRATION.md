# SURGE SMC Module — Integration Guide

## Files

```
surge-smc/
├── pinescript/
│   ├── SURGE_SMC_Core.pine        # BOS/CHoCH, OB, FVG, Liquidity, alert JSON
│   └── SURGE_MTF_Confluence.pine  # 5-TF bias engine, 0-100 alignment score
└── python/
    ├── arbitration_layer.py       # FastAPI webhook + Claude/Ollama ensemble
    └── requirements.txt
```

## TradingView Setup

### 1. Add indicators
- Open TradingView Pine Editor
- Paste `SURGE_SMC_Core.pine` → Add to chart
- Paste `SURGE_MTF_Confluence.pine` → Add to chart (separate pane)

### 2. Create alerts

**SMC Core alert:**
- Condition: `SURGE SMC Core v1.0: any alert() function call`
- Webhook URL: `https://your-server:8765/webhook/smc`
- Message: (leave default — script sends JSON)

**MTF Confluence alert:**
- Condition: `SURGE MTF Confluence v1.0: any alert() function call`
- Webhook URL: `https://your-server:8765/webhook/mtf`
- Message: (leave default)

## Python Server Setup

```bash
cd surge-smc/python
pip install -r requirements.txt

# Configure env
export ANTHROPIC_API_KEY="sk-ant-..."
export OLLAMA_BASE_URL="http://localhost:11434"   # or remote
export OLLAMA_MODEL="llama3.1:8b"
export SURGE_WEBHOOK_SECRET="your-secret"

# Run
python arbitration_layer.py
# → Listening on 0.0.0.0:8765
```

## Signal Flow

```
TradingView (SMC alert)  ──→  POST /webhook/smc  ──→  SignalBuffer
TradingView (MTF alert)  ──→  POST /webhook/mtf  ──→  SignalBuffer
                                                         │
                                                   FusionEngine (30s window)
                                                         │
                                                   GateCheck
                                                   (conf >= 40, MTF >= 55)
                                                         │
                                              ┌──────────┴──────────┐
                                          Claude API           Ollama local
                                          (70% weight)         (30% weight)
                                              └──────────┬──────────┘
                                                   EnsembleCombiner
                                                         │
                                                  ArbitratorDecision
                                                  {signal, conf, entry, sl, tp}
                                                         │
                                               /decisions endpoint
                                               (→ execution bridge next)
```

## Signal Priority (conflict resolution)

| Event         | Weight | Notes                              |
|---------------|--------|------------------------------------|
| CHoCH         | 5      | Potential reversal — highest prio  |
| OB Sweep+Fill | 4      | Institutional entry confirmed      |
| Liq Sweep     | 3      | Stop hunt — reversal candidate     |
| BOS           | 2      | Trend continuation                 |
| MTF Alignment | 3      | Bias confirmation weight           |
| FVG           | 1      | Supporting evidence only           |
| Momentum      | 1      | Gate only — not entry trigger      |

## API Endpoints

| Method | Path          | Description                        |
|--------|---------------|------------------------------------|
| POST   | /webhook/smc  | Receive SMC alert from TradingView |
| POST   | /webhook/mtf  | Receive MTF alert from TradingView |
| GET    | /decisions    | Recent arbitration decisions       |
| GET    | /status       | System status + config             |
| GET    | /health       | Liveness check                     |

## MTF Score → LLM Arbitrator Weight

| MTF Score | LLM Weight Multiplier | Effect                    |
|-----------|-----------------------|---------------------------|
| 80-100    | +20 confidence boost  | Strong alignment bonus    |
| 65-79     | No adjustment         | Normal processing         |
| 50-64     | -10 confidence        | Weak alignment penalty    |
| 35-49     | -20 confidence        | Poor alignment, warn      |
| 0-34      | HOLD gate             | Blocks trade execution    |

## HTF/LTF Conflict Rule

If Daily bias ≠ 15m bias:
- `execution_allowed = false` unless `confidence >= 75`
- CHoCH overrides this rule (reversal in progress)

## Next Phase

- Add PA key level module (SURGE_PA_Levels.pine)
- Add breakout + retest module (SURGE_BRK_Retest.pine)
- Add RSI/Stoch/EMA gate module (SURGE_MOM_Gates.pine)
- Build execution bridge (Binance API → paper trade → live)
- Add crypto OHLC backtest harness
