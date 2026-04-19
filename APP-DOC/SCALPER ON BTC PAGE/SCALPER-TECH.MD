# SCALPER TECH — BTC Order Flow Panel
**Location:** `M6D/src/components/ScalperPanel.tsx`  
**Mount point:** First child of `FxChartsPage` (`#fx`)  
**Data cost:** $0 — Binance public endpoints, no API key

---

## WHAT IS BUILT

### Chart — `lightweight-charts v5`
| Element | Detail |
|---------|--------|
| Candlestick series | 1m OHLCV, seeded from Binance REST (200 bars), updated live via aggTrade WS |
| VWAP line | Session VWAP (amber dashed). Cumulative `TP×Vol / Vol` from midnight UTC. Resets each day |
| Canvas overlay | `position: absolute; inset: 0; pointer-events: none` — RAF loop draws bubbles on top of chart |

### Order Flow Bubbles — canvas layer
- **Source:** `wss://stream.binance.com:9443/ws/btcusdt@aggTrade`
- **Filter:** `qty >= 0.3 BTC` (constant `BUBBLE_MIN_QTY`) — removes retail noise
- **Side:** `m === false` → aggressive BUY (green) · `m === true` → aggressive SELL (red)
- **Size:** `radius = log1p(qty) × 14` — log scale so whale prints dominate without overflowing
- **Fade:** Alpha decay over 18s (`BUBBLE_FADE_MS`). Oldest bubbles ghost out naturally
- **Position:** `series.priceToCoordinate(price)` × `chart.timeScale().timeToCoordinate(barTime)` — pixels locked to chart coords

### DOM Depth Heatmap — sidebar (128px)
- **Source:** `wss://stream.binance.com:9443/ws/btcusdt@depth20@100ms`
- Top-10 asks (red, reversed so best ask is nearest spread)
- Top-10 bids (green)
- Bar width = `qty / maxQty × 100%` — relative liquidity visualisation
- Spread shown at divider and in header

### Delta Bar — bottom strip
- **Window:** 10s rolling (`DELTA_WIN_MS`)
- **Formula:** `Σ aggressive_buy_qty − Σ aggressive_sell_qty`
- Gradient track: green fill right of centre (bull) or red fill left (bear)
- Capped at ±10 BTC for bar width scaling

### Signal Chips
| Signal | Trigger condition |
|--------|------------------|
| `ABSORPTION` | `sell_vol > buy_vol × 2` AND delta is flipping positive → sellers absorbed, reversal setup |
| `MOMENTUM` | `buy_vol > sell_vol × 2` AND single trade `qty > 2 BTC` → whale aggression breakout |

### UX
- Collapse toggle `▴ / ▾` in header — hides body, keeps header metrics visible
- Live price, spread, delta, signal all update in header at trade frequency
- Status dot: green=live · amber=connecting · dark=off

---

## DATA TO ADD

### Priority 1 — Core scalper completeness

| Feature | What | Source | Notes |
|---------|------|--------|-------|
| **Footprint candle** | Show buy vol vs sell vol split INSIDE each candle body | aggTrade WS — aggregate per bar | Replace plain candle with a split bar: left=sell delta, right=buy delta. Requires custom series or canvas layer |
| **Cumulative Delta line** | Running `Σ(buy − sell)` for the full session as a sub-chart | aggTrade WS | Draw as a separate pane below main chart. The divergence between price and cum-delta IS the sniper signal |
| **Volume profile (VP) bars** | Horizontal bars on price axis showing vol traded at each $X increment | aggTrade WS — bin by price | Most traded price = POC. Show VAH / VAL. Critical for limit order hunting context |
| **Large print tape** | Scrolling list of trades `qty > 1.0 BTC` with timestamp, price, side, qty | aggTrade WS | Already detecting these — just needs a feed panel render |
| **Bubble min qty slider** | UI control for `BUBBLE_MIN_QTY` threshold (currently hardcoded 0.3) | — | One range input in header |

### Priority 2 — Signal quality upgrades

| Feature | What | Source | Notes |
|---------|------|--------|-------|
| **Stacked imbalance detection** | 3+ consecutive bid or ask levels where one side is 4× the other | depth20 WS | Strong magnet / stop-hunt zone. Mark on chart with a horizontal ray |
| **Delta divergence signal** | Price makes new high/low but 10s delta does NOT confirm | aggTrade + price | The "Perfect Sniper Entry" from the spec. Currently ABSORPTION is a rough proxy — this is the precise version |
| **RVOL chip** | Current 1m volume vs 20-bar average | aggTrade WS (accumulate per bar) | Already have data; just need the ratio displayed in header |
| **ATR-normalised bubble size** | Scale bubble radius relative to current ATR so size is comparable across sessions | Need ATR from klines | Currently raw log(qty) — can look massive on low-vol sessions |

### Priority 3 — Multi-asset / FX extension

| Feature | What | Source | Notes |
|---------|------|--------|-------|
| **Symbol selector** | Switch scalper between BTC, ETH, SOL, XRP | Binance WS — reconnect on change | WS URLs are hardcoded to `btcusdt` |
| **FX pair scalper** | Same panel for EURUSD, XAUUSD using different data source | Requires paid tick data (FXCM, Interactive Brokers, or Dukascopy) | Binance only covers crypto. FX has no centralised order flow — synthetic from tick data only |
| **Multi-timeframe delta** | Show 1m + 5m + 15m delta in tabs | aggTrade WS — resample | Same WS stream, different accumulation windows |

### Priority 4 — Visual polish

| Feature | What |
|---------|------|
| **Bubble clustering** | When 3+ bubbles at same price level, merge into one large ring instead of stacking |
| **DOM animation** | Animate bid/ask qty bar widths with CSS transitions when levels update |
| **Heat gradient on DOM** | Color intensity on depth bars: bright = fresh large order, dim = stale |
| **Session open/close lines** | Vertical rays at NY open (14:30 UTC), London open (08:00 UTC) — key liquidity events |

---

## DATA PIPELINE SUMMARY

```
FREE (live today)
  Binance REST     → seed 200×1m OHLCV bars
  Binance aggTrade → price, qty, side per trade (~100ms latency)
  Binance depth20  → top-20 bid/ask snapshot every 100ms

NEEDS BUILDING
  Per-bar vol accumulation → footprint, VP, RVOL
  Cum-delta series         → divergence signal

REQUIRES PAID SOURCE (FX only)
  Tick data feed           → synthetic order flow for EURUSD/XAUUSD
```

---

## CONSTANTS TO TUNE

```ts
BUBBLE_MIN_QTY = 0.3   // BTC — raise to 1.0 on low-noise sessions
BUBBLE_FADE_MS = 18_000 // ms — lower to 8_000 for cleaner chart
DELTA_WIN_MS   = 10_000 // ms — widen to 30_000 for slower markets
```

**File:** `M6D/src/components/ScalperPanel.tsx`  
**Spec source:** `APP-DOC/SCALPER ON BTC PAGE/YOUTUBE SCALPER.MD`
