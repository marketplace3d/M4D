# DATA SOURCES — M3D / M2D Alpha Platform
## What we need · cheapest path · current wiring

---

## 1. WHAT EACH SYSTEM NEEDS

### A. Crypto Algo Engine (M3D — already working)
| Data | Granularity | Source | Cost |
|------|------------|--------|------|
| OHLCV 500 assets | 5m bars | Binance public REST | FREE |
| Order book depth | L2 snapshot | Binance public WS | FREE |
| Funding rates | 8h | Binance + Bybit REST | FREE |
| Open interest | 1h | Binance futures | FREE |

**Status: LIVE** — engine polls every 5 min

---

### B. Trade-Ideas Style Scanner (M2D — building now)
| Data | Granularity | Need |
|------|------------|------|
| Volume surge | Real-time 1m | rel_vol > 2.5 |
| Price breakout | 1m | close > 20-bar high + vol |
| Gappers | Pre-market | open/prev_close - 1 |
| Momentum | 1m + 5m | trend score + rate of change |
| Halt/resume | Real-time | halt flag |
| News catalyst | Real-time | news spike on ticker |

**Crypto**: Binance WebSocket 1m klines → FREE  
**Stocks**: Need provider below

---

### C. Live Trading (Risk Gate → Execution)
| Data | Need |
|------|------|
| Real-time quotes | bid/ask + last |
| Level 2 | order book depth |
| Time & Sales | tape reading |
| Options chain | IV, delta, gamma for VOLATILITY expert |
| Short interest | for contrarian signals |

---

## 2. ASSET CLASS DATA SOURCES

### ★ MASSIVE (formerly Polygon.io) — massive.com
**Currencies Starter — $49/mo** ← RECOMMENDED for this platform

| Feature | Included |
|---------|----------|
| All Forex pairs (EURUSD, GBPUSD, USDJPY, XAU/USD...) | ✓ |
| All Crypto tickers (BTC, ETH, 500+) | ✓ |
| Real-time data | ✓ |
| WebSocket streaming | ✓ |
| Minute aggregates | ✓ |
| Snapshot (current quote) | ✓ |
| 10+ years historical | ✓ |
| Technical indicators | ✓ |
| Unlimited API calls | ✓ |

**This single $49 plan replaces**: Binance REST polling + OANDA + Alpha Vantage + crypto data feeds

**Existing key**: `fumKYFuu7PvC3CxcE19VYxLe29QiJ2eE` — test if still valid after rebrand, else get new key on sign-up.

**What it unlocks for us**:
- Real-time WebSocket crypto scanner (replaces 5min Binance polling → true tick data)
- EURUSD, GBPUSD, USDJPY, AUDUSD live
- XAU/USD, XAG/USD (gold, silver) live
- 10yr history for backtesting all FX + crypto strategies
- Minute bars → Trade-Ideas scanner on FX pairs

---

### STOCKS (US Equities)
| Provider | Free Tier | Paid | Real-time | Pre-market | Notes |
|----------|-----------|------|-----------|------------|-------|
| **Massive Stocks** | — | $49/mo (Starter) | ✓ WebSocket | ✓ | Separate stock plan |
| **Alpaca** | IEX free (live acct) | $9/mo | ✓ WebSocket | ✓ | Paper key = no data |
| **Tiingo** | 500 req/hr | $10/mo | ✓ WebSocket | ✓ | Good value |
| **Interactive Brokers** | With account | — | ✓ L2 | ✓ | Best for live trading |

**Recommendation**: Alpaca live account (fund $1 → free IEX data). IBKR when going live.

---

### FUTURES (ES1, NQ1, RTY1, CL, GC)

**Massive Futures Starter — $29/mo** ← COMING SOON

| Feature | Included |
|---------|----------|
| All Futures tickers (ES, NQ, RTY, CL, GC, SI...) | ✓ |
| CME, CBOT, NYMEX, COMEX | ✓ |
| 10-minute delayed data | ✓ (live = upgrade) |
| Minute aggregates | ✓ |
| WebSockets | ✓ |
| 2 years historical | ✓ |
| Unlimited API calls | ✓ |

**Wait for launch** — coming soon at $29/mo. This covers ES1, NQ1, CL, GC with WebSocket streaming.

**Available NOW via Databento pay-per-use (key: prod-001)**:
| Symbol | 30d 1m bars cost | Dataset |
|--------|-----------------|---------|
| ES.c.0 (S&P 500) | $0.10 | GLBX.MDP3 |
| NQ.c.0 (Nasdaq) | $0.10 | GLBX.MDP3 |
| GC.c.0 (Gold) | $0.004 | GLBX.MDP3 |
| CL.c.0 (Crude) | $0.09 | GLBX.MDP3 |
| RTY.c.0 (Russell) | $0.09 | GLBX.MDP3 |

**Total 2yr history all 5 symbols ≈ $2-5** — use for backtesting. No live stream without subscription.

---

### GOLD / METALS (XAU, XAG)
**Covered by Massive Currencies Starter** — XAU/USD, XAG/USD included as FX pairs.

---

### NEWS & SENTIMENT
| Provider | Cost | Notes |
|----------|------|-------|
| **NewsAPI.org** | FREE 100 req/day | We have key: 33a0e204... |
| **GNews** | FREE | We have key: c27dc29e... |
| **Finnhub** | FREE 60 req/min | We have key: d0vp1vpr... — has earnings, IPOs |
| **Benzinga** | $49/mo | Real-time news with tickers |
| **Unusual Whales** | $50/mo | Options flow + dark pool |

---

## 3. MINIMUM VIABLE DATA STACK (cheapest to go live)

### Phase 1 — Crypto only (NOW, $0/mo)
```
Binance public API    → 500 crypto, 5m bars, funding, OI
Binance WebSocket     → 1m real-time klines for scanner
Grok/xAI API          → PULSE sentiment (already wired)
```

### Phase 2 — Massive Currencies ($49/mo) ← DO THIS FIRST
```
massive.com Currencies Starter →
  All crypto real-time WebSocket (replaces Binance polling)
  EURUSD, GBPUSD, USDJPY, AUDUSD, USDCHF live
  XAU/USD, XAG/USD (gold, silver) live
  10yr history for all FX + crypto backtest
```

### Phase 3 — Add Stocks ($0/mo bridge)
```
Alpaca live account   → Fund $1, get IEX free real-time WebSocket
Finnhub free          → earnings calendar, news (key already in .env)
```

### Phase 4 — Add Futures ($29/mo when live)
```
Massive Futures Starter (coming soon) →
  ES1, NQ1, RTY1, CL, GC — CME/CBOT/NYMEX
  10-min delayed → upgrade for live
```

### Phase 4 — Institutional ($200+/mo)
```
Polygon Pro / Massive → Full US tape, options flow, dark pool prints
Unusual Whales        → Options order flow (alpha signal)
Bloomberg Terminal    → [[[NOT YET]]]
```

---

## 4. KEYS CURRENTLY IN .env.local

| Key | Provider | Status |
|-----|----------|--------|
| `API_XAI_YODA_KEY` | xAI / Grok | ✓ Active |
| `POLYGON_IO_KEY` | Polygon / Massive [[[confirm]]] | ✓ Have key |
| `FINNHUB_KEY` | Finnhub | ✓ Have key |
| `NEWSAPI_ORG_API_KEY` | NewsAPI | ✓ Have key |
| `GNEWS_API_KEY` | GNews | ✓ Have key |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage | ✓ Have key |
| `ANTHROPIC_API_KEY` | Anthropic Claude | ✗ Missing |
| `GOOGLE_GEMINI_KEY` | Google Gemini | ✗ Missing |
| `OANDA_API_KEY` | OANDA | ✗ Need account |
| `ALPACA_API_KEY` | Alpaca | ✗ Need account |
| `ALPACA_SECRET_KEY` | Alpaca | ✗ Need account |

---

## 5. .env.local TEMPLATE (all keys needed)

```bash
# AI / LLM
API_XAI_YODA_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GEMINI_KEY=

# Market Data — Stocks
POLYGON_IO_KEY=           # polygon.io or Massive (rebranded?)
VITE_POLYGON_IO_KEY=      # same, for Vite frontend
FINNHUB_KEY=
ALPHA_VANTAGE_API_KEY=
ALPACA_API_KEY=
ALPACA_SECRET_KEY=

# Market Data — FX / Metals
OANDA_API_KEY=
OANDA_ACCOUNT_ID=

# News
NEWSAPI_ORG_API_KEY=
VITE_NEWSAPI_ORG_API_KEY=
GNEWS_API_KEY=
VITE_GNEWS_API_KEY=

# Futures (when ready)
DATABENTO_API_KEY=
BARCHART_API_KEY=
```

---

## 6. NEXT: CRYPTO SCANNER (this session)

Building Binance WebSocket 1m kline scanner → Trade-Ideas style alerts:
- **SURGE**: rel_vol > 2.5 in last bar
- **BREAKOUT**: close > 20-bar high + volume confirm
- **GAPPER**: open gap > 1% vs prior close
- **MOMENTUM**: 3-bar consecutive closes in same direction + vol
- **REVERSAL**: RSI < 25 or > 75 + vol spike

Output → `/v1/scanner/` → M2D TradeI page live feed.
