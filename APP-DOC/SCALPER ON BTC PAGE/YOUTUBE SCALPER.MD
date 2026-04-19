Based on the video featuring the trader Andrea, here is the extraction of his "edge," the visuals he monitors, and a detailed specification for building a similar algorithm using **TSX (React)** and **Lightweight Charts (tvlwcharts)**.

### **1. The Core Edge: Order Flow & Liquidity Dynamics**
Andrea's edge isn't based on lagging indicators (RSI, MACD) but on the **"Plumbing of the Market."**
* **Auction Market Theory:** He views the market as a continuous auction where price moves to find liquidity [[08:44](http://www.youtube.com/watch?v=TvoQr6ObjnU&t=524)].
* **Aggressive vs. Passive Orders:** He differentiates between "Passive" liquidity (Limit orders sitting in the book) and "Aggressive" market orders (Market Buy/Sell bubbles) [[13:43](http://www.youtube.com/watch?v=TvoQr6ObjnU&t=823)].
* **Anticipating Breakouts:** He doesn't wait for a breakout to occur. Instead, he identifies when "Sellers/Buyers are engaging" via order flow before the candle even closes [[01:03](http://www.youtube.com/watch?v=TvoQr6ObjnU&t=63)].
* **The "Thermal Vision":** He uses order flow to see "Stop-Loss hunting" in real-time, entering where others are being forced out [[00:32](http://www.youtube.com/watch?v=TvoQr6ObjnU&t=32)].

### **2. Visuals & Input Signals**
Andrea monitors a high-density data environment. To replicate this, your UI needs:
* **Bubble Charts (Aggressive Orders):** Large visual "bubbles" representing market orders hitting the bid/ask. Size indicates volume [[13:50](http://www.youtube.com/watch?v=TvoQr6ObjnU&t=830)].
* **Limit Order Book (Passive Liquidity):** A heatmap or depth-of-market (DOM) showing where large sell/buy limits are resting [[10:05](http://www.youtube.com/watch?v=TvoQr6ObjnU&t=605)].
* **VWAP (Volume Weighted Average Price):** Used as a baseline for "Fair Value" and optimal execution [[26:06](http://www.youtube.com/watch?v=TvoQr6ObjnU&t=1566)].
* **Footprint/Candlestick Hybrid:** Watching how a candle is "created behind the scenes" by looking at the volume delta within the candle [[00:21](http://www.youtube.com/watch?v=TvoQr6ObjnU&t=21)].

---

### **3. Technical Spec for Claude AI (TSX + TVLWCharts)**

**Prompt for Claude:**
> "Build a high-performance trading dashboard using React (TSX) and `lightweight-charts`. The goal is a Scalping Order Flow Algorithm.
>
> **Core Components:**
> 1. **Price Chart:** Use `createChart` from `lightweight-charts`. Implement a CandlestickSeries.
> 2. **VWAP Overlay:** Add a LineSeries for VWAP calculation: `sum(Typical Price * Volume) / sum(Volume)`.
> 3. **Order Flow Bubbles (Custom Plugin/Canvas):** Overlay a transparent canvas or use a custom series to render 'Bubbles'. 
>    - **Input:** WebSocket stream of 'Trades' (price, side, quantity).
>    - **Logic:** Draw a Green circle for Buy Market, Red for Sell Market. Radius = `sqrt(quantity) * multiplier`.
> 4. **Liquidity Heatmap:** Use a HistogramSeries or a custom background shader to represent 'Limit Order Book' depth at specific price levels.
>
> **Input Signal Logic:**
> - **Signal A (Absorption):** If Price is at a 'Heavy Limit' level and 'Aggressive Bubbles' are large but price isn't moving, flag as 'Absorption' (Potential Reversal).
> - **Signal B (Aggression):** If 'Aggressive Bubbles' exceed a threshold (e.g., 3x average) and Price breaks the previous candle high/low, flag as 'Momentum Entry'.
>
> **Architecture:**
> - Use `useRef` for the chart instance to prevent re-renders.
> - Implement a `useEffect` to handle real-time WebSocket data updates using `requestAnimationFrame` for smooth bubble scaling.
> - Use `series.update()` for the price feed."

---

### **4. Algorithmic Logic Summary**
To build the algo, focus on the **Delta**:
* **Delta = Aggressive Buys - Aggressive Sells.**
* **The Signal:** Look for **Divergence**. If price is making a new low, but the Delta is turning positive (aggressive buying), this is Andrea's "Perfect Sniper Entry" [[00:00](http://www.youtube.com/watch?v=TvoQr6ObjnU&t=0)].


**Source Video:** [Trading LIVE with One of the World's BEST Scalpers](http://www.youtube.com/watch?v=TvoQr6ObjnU)

http://googleusercontent.com/youtube_content/0


/////////


//////////////////////

To build a high-fidelity Order Flow / Liquidity visualization using **TradingView Lightweight Charts (tvlwcharts)** and **React (TSX)**, we need to handle real-time WebSockets from Binance.
Since the "Edge" requires seeing **Aggressive Orders (Bubbles)** and **Passive Liquidity (Order Book)**, we will use a **Price Line** approach for the current price and **Custom Series/Overlays** for the liquidity clusters.
### 🛠️ The Tech Stack
 * **Framework:** React + Vite (TSX)
 * **Charting:** lightweight-charts (3.8+)
 * **Data Source:** Binance Public WebSocket (btcusdt@aggTrade and btcusdt@depth20)
### 💻 TSX Implementation: The "Sniper" Dashboard
This code sets up the base chart and hooks into Binance's aggressive trade stream to visualize market "bubbles" (the high-signal input).
```tsx
import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, ISeriesApi } from 'lightweight-charts';

interface AggTrade {
  p: string; // Price
  q: string; // Quantity
  m: boolean; // Is the buyer the market maker? (Determines Side)
}

export const SniperChart: React.FC = () => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. Initialize Chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0e17' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#1e222d' },
        horzLines: { color: '#1e222d' },
      },
      rightPriceScale: { borderColor: '#2b2b43' },
      timeScale: { borderColor: '#2b2b43', timeVisible: true, secondsVisible: true },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    
    candlestickSeriesRef.current = candlestickSeries;

    // 2. Binance WebSocket - Aggressive Trades (The "Bubbles")
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');

    ws.onmessage = (event) => {
      const data: AggTrade = JSON.parse(event.data);
      const price = parseFloat(data.p);
      const quantity = parseFloat(data.q);
      const time = Math.floor(Date.now() / 1000);

      // Update Candle (Simplification: using trade price as OHLC)
      candlestickSeries.update({
        time: time as any,
        open: price, high: price, low: price, close: price
      });

      // SIGNAL: Large "Bubble" Detection (The Edge)
      if (quantity > 1.0) { // Filtering for "High Signal" whales
        const side = data.m ? 'SELL' : 'BUY';
        console.log(`🎯 Sniper Signal: ${side} of ${quantity} BTC at ${price}`);
        
        // Add Marker for aggressive orders
        candlestickSeries.setMarkers([
          {
            time: time as any,
            position: side === 'BUY' ? 'belowBar' : 'aboveBar',
            color: side === 'BUY' ? '#2196F3' : '#FF9800',
            shape: 'circle',
            text: `${quantity.toFixed(2)}`,
          },
        ]);
      }
    };

    const handleResize = () => {
      chart.applyOptions({ width: chartContainerRef.current?.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      ws.close();
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '500px' }}>
      <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute', top: '10px', left: '10px', 
        color: '#00ff00', fontFamily: 'monospace', zIndex: 10
      }}>
        📡 SIGNAL: LIVE_BTC_AUCTION
      </div>
    </div>
  );
};

```
### 🎯 Key Logic for your AI Developer (Specification)
To reach the "Palantir Level" of visualization seen in the video, instruct the coder to implement these three recursive optimizations:
#### 1. The Passive Liquidity Mapper (Heatmap)
Instead of just candles, use the btcusdt@depth20 stream.
 * **Action:** Map the bids and asks arrays to a **Custom SVG Layer** overlaid on the chart.
 * **Logic:** If a price level has >50 BTC in limit orders, draw a semi-transparent rectangle (Heatmap). This identifies "Stop-Loss Hunting" zones.
#### 2. The Bubble Size Scaling
In the onmessage handler, do not just log the quantity.
 * **Action:** Use a logarithmic scale to determine the marker size.
 * **Math:** Radius = \log(Quantity) \times BaseScale. This allows the UI to distinguish between retail noise and "World-Class Scalper" entries.
#### 3. Delta Exhaustion Signal
Calculate the difference between aggressive buyers and sellers over a 10-second rolling window.
 * **Input Signal:** If Aggressive_Sellers spike but Price refuses to drop, this is **Absorption** (The ultimate Sniper entry trigger).
### 📦 Installation requirements:
```bash
npm install lightweight-charts

```
This TSX component provides the "Thermal Vision" mentioned in the video—moving from standard price action to seeing the aggressive intent of market participants in real-time.
