Based on the video featuring the trader Andrea, here is the extraction of his "edge," the visuals he monitors, and a detailed specification for building a similar algorithm using TSX (React) and Lightweight Charts (tvlwcharts).
1. The Core Edge: Order Flow & Liquidity Dynamics
Andrea's edge isn't based on lagging indicators (RSI, MACD) but on the "Plumbing of the Market."
Auction Market Theory: He views the market as a continuous auction where price moves to find liquidity [08:44].
Aggressive vs. Passive Orders: He differentiates between "Passive" liquidity (Limit orders sitting in the book) and "Aggressive" market orders (Market Buy/Sell bubbles) [13:43].
Anticipating Breakouts: He doesn't wait for a breakout to occur. Instead, he identifies when "Sellers/Buyers are engaging" via order flow before the candle even closes [01:03].
The "Thermal Vision": He uses order flow to see "Stop-Loss hunting" in real-time, entering where others are being forced out [00:32].
2. Visuals & Input Signals
Andrea monitors a high-density data environment. To replicate this, your UI needs:
Bubble Charts (Aggressive Orders): Large visual "bubbles" representing market orders hitting the bid/ask. Size indicates volume [13:50].
Limit Order Book (Passive Liquidity): A heatmap or depth-of-market (DOM) showing where large sell/buy limits are resting [10:05].
VWAP (Volume Weighted Average Price): Used as a baseline for "Fair Value" and optimal execution [26:06].
Footprint/Candlestick Hybrid: Watching how a candle is "created behind the scenes" by looking at the volume delta within the candle [00:21].
3. Technical Spec for Claude AI (TSX + TVLWCharts)
Prompt for Claude:
"Build a high-performance trading dashboard using React (TSX) and lightweight-charts. The goal is a Scalping Order Flow Algorithm.
Core Components:
Price Chart: Use createChart from lightweight-charts. Implement a CandlestickSeries.
VWAP Overlay: Add a LineSeries for VWAP calculation: sum(Typical Price * Volume) / sum(Volume).
Order Flow Bubbles (Custom Plugin/Canvas): Overlay a transparent canvas or use a custom series to render 'Bubbles'.
Input: WebSocket stream of 'Trades' (price, side, quantity).
Logic: Draw a Green circle for Buy Market, Red for Sell Market. Radius = sqrt(quantity) * multiplier.
Liquidity Heatmap: Use a HistogramSeries or a custom background shader to represent 'Limit Order Book' depth at specific price levels.
Input Signal Logic:
Signal A (Absorption): If Price is at a 'Heavy Limit' level and 'Aggressive Bubbles' are large but price isn't moving, flag as 'Absorption' (Potential Reversal).
Signal B (Aggression): If 'Aggressive Bubbles' exceed a threshold (e.g., 3x average) and Price breaks the previous candle high/low, flag as 'Momentum Entry'.
Architecture:
Use useRef for the chart instance to prevent re-renders.
Implement a useEffect to handle real-time WebSocket data updates using requestAnimationFrame for smooth bubble scaling.
Use series.update() for the price feed."
4. Algorithmic Logic Summary
To build the algo, focus on the Delta:
Delta = Aggressive Buys - Aggressive Sells.
The Signal: Look for Divergence. If price is making a new low, but the Delta is turning positive (aggressive buying), this is Andrea's "Perfect Sniper Entry" [00:00].
Source Video: Trading LIVE with One of the World's BEST Scalpers


2
To integrate an algorithmic trader (like the one based on Lance Breitstein’s "Market Wizard" framework) into a collaborative "Council" or "Expert" environment, you need a system that translates raw market data into scored, human-readable signals.
If you are instructing a code builder (like Claude or a specialized AI coder) to build this, you should structure the request as a **System Architecture and API Integration** task.
## 1. Defining the "Mental Rubric" in Code
Instruct the code builder to create a **Scoring Engine**. Instead of simple "Buy/Sell" indicators, the algo must output a **Confidence Score (0-100)** based on the factors we identified from the video.
### The Scoring Logic (Pseudo-code for the builder):
```python
# Factors to quantify:
score = 0
score += quantify_rate_of_change(timeframe="2m", acceleration=True) * 0.30
score += quantify_distance_from_ma(ma_period=20, type="Bollinger") * 0.20
score += quantify_volume_climax(relative_to_atv=True) * 0.25
score += quantify_boringness(sector_stability=True, market_cap="Large") * 0.25

if score > 85: 
    emit_signal("POCKET ACES / LEGEND TIER")
elif score > 70:
    emit_signal("GRADE A SETUP")

```
## 2. Integration with "YouTube Trader Councils"
To "contribute" or be "elected," an algo must demonstrate **Transparency** and **Verifiable Edge**. Instruct the developer to build a **Proof-of-Work (PoW) Dashboard**.
 * **Signal Output:** Every stock tip should include a "Rational Memo." (e.g., *"BTC Long: Score 88. Reason: 3rd leg down, 5% waterfall in 4 mins, volume 10x normal"*).
 * **Webhooks:** Use **Discord or Telegram Webhooks** to push these signals into the council’s private channels in real-time.
 * **Leaderboard API:** Integrate with platforms like **TradeZella** (mentioned in the video) or a custom SQL database to track the "Win Rate vs. Expected Value" of the algo’s tips.
## 3. Creating Signals on a "Processed Universe"
The "Processed Universe" refers to filtering the thousands of available stocks down to the few that meet Breitstein’s criteria.
### Builder Instructions for Scanning:
 1. **Filter 1 (The Base):** Large Cap ($>10B) or Highly Liquid assets only (Boringness factor).
 2. **Filter 2 (The Deviation):** Stocks currently trading at >3 Standard Deviations from their 20-day Moving Average.
 3. **Filter 3 (The Momentum):** Stocks with >4 consecutive bars in one direction on the Daily timeframe.
 4. **Signal Trigger:** The **"Right Side of the V"** entry—The code should only trigger a signal once the price reclaims the high/low of the previous candle.
## 4. Instructing the Code Builder (Copy-Paste Prompt)
If you are talking to a code-generating AI, use this specific prompt to get the best results:
> *"Build a Python-based stock screening engine that implements the 'Breitstein Mean Reversion Rubric.' The system must process a universe of S&P 500 stocks.

> **Requirements:**
>  1. Calculate a dynamic 'Setup Quality Score' using RSI divergence, distance from 20-period MA, and Volume Price Trend.
>  2. Implement an 'Entry Logic' module that waits for the 'Right Side of the V' (price breaking the previous 2-minute candle high after a waterfall drop).
>  3. Create an API export function that formats these signals into a 'Trade Tip Memo' containing Entry, Stop (at move low), and Target (at 20 MA).
>  4. Ensure the output is compatible with a Discord Webhook for contribution to a trading council leaderboard."*
> 
## Summary of the "Legend" Path
To be "elected" as a top-tier contributor, your algo shouldn't just provide "Stock Tips"—it should provide **Data-Backed Conviction**.
By providing the **"Why"** (the score) alongside the **"What"** (the ticker), the algo moves from being a "black box" to an "expert consultant" that human traders on a council will trust and follow.
**Would you like a specific Python template for the "Waterfall Acceleration" calculation?**

3
To integrate an algo trader into an elite council (like a YouTube Expert Council or "Legend" tier), your code builder needs to move beyond simple technical indicators. Lance Breitstein’s system, as taught in his *Magnum Opus*, is a **Mental Rubric** that scores the "Expected Value" (EV) of a setup based on specific, non-linear factors.
Here is the breakdown of the remaining factors and how to instruct a code builder to combine them.
## 1. The Missing Factors (Beyond Price/Volume)
To contribute as a "Legend," the algo must quantify these advanced criteria from Lance’s framework:
| Factor | Description for Code Builder |
|---|---|
| **Footprint Delta Divergence** | The algo must track **Order Flow**. If price makes a new low but the *aggressive selling* (Delta) is shrinking, this is a high-conviction reversal signal. |
| **Trapped Liquidity** | Track "resting liquidity" (limit orders) being absorbed. Code a "Stop Run" detector where price pokes below a key level and instantly snaps back. |
| **Sector Convergence** | The algo shouldn't just look at one stock. It must check the **Relative Strength** against its sector. (e.g., Is NVDA falling faster than the SMH? If so, it’s a "Lead Sinker" setup). |
| **The "20% Heuristic"** | A safety buffer. Instruct the code to subtract **20%** from its own calculated win-rate to account for "optimism bias" before sizing. |
| **Bobblehead Concept** | This is Lance's term for **Mean Reversion**. The "head" (price) is too far from the "shoulders" (Moving Averages). Quantify this using Bollinger Band %B or Standard Deviation distance. |
## 2. The "Right Side of the V" Method (Entry Logic)
Instruct the code builder **not** to buy the "waterfall." A "Legend" trader waits for the turn.
 * **Trigger:** The code identifies a 5-standard-deviation "waterfall" drop.
 * **Wait:** It ignores the bottom.
 * **Execution:** It buys only when the price breaks the **high of the previous 1-minute or 2-minute candle**.
 * **Stop Loss:** Placed strictly at the low of the "waterfall" (the tip of the V).
## 3. How to Combine: The "Scoring Tally"
In Lance's system, a trade isn't "Buy" or "Sell"—it's a **Grade (A+, A, B, C)**. Instruct your builder to use a **weighted summation model** to create these signals.
### Prompt for Claude/Code Builder:
> "Create a Python class called CouncilExpertScorer. It should combine the following factors into a final **EV Score (0-100)**:
>  1. **Waterfall Score (30%):** Calculate the Rate of Change (ROC) over the last 5 minutes.
>  2. **Context Score (25%):** Is it trading at the edge of the Daily Value Area or a High Volume Node (HVN)?
>  3. **Footprint Score (20%):** Check for Delta Divergence (Price down, Delta up).
>  4. **Relative Strength (15%):** Is the stock weaker/stronger than the SPY/QQQ on this move?
>  5. **Sentiment Score (10%):** Use a 'Boringness' filter—Large cap stocks are preferred for mean reversion.
> **Signal Output:** If Score > 80, output 'LEGEND TIER SETUP: HIGH SIZE.' Format this as a JSON object for a Discord Webhook."
> 
## 4. Path to Election (The "Daily Report Card")
To be elected to a council, your algo must provide a **Post-Trade Analysis**. Instruct the builder to log:
 * **Trade EV:** What was the expected value vs. the actual outcome?
 * **Sizing Efficiency:** Did the algo size up for A+ setups and size down for C- setups?
 * **MGI (Market Generated Information):** The algo should update its "tip" in real-time. If the stock isn't bouncing as expected, the code should trigger a "Time Stop" (exit because the trade is "stale"), which is a hallmark of an expert trader.
By automating this **"Mental Tally,"** your algorithmic trader stops being a "bot" and starts acting like a high-level discretionary trader, making it a valuable contributor to any expert council.

4
Since I am an AI, I cannot directly generate a Google Doc file for you, but I have compiled the complete "Market Wizard" framework below. You can copy and paste this into a document to create a professional trading manual or use it as a master specification for a code builder.
# **The Lance Breitstein "Legend" Trading Framework**
This document outlines the systematic mean-reversion strategy used by Lance Breitstein to generate over **$100 million** in profits. It covers the core factors, the "Mental Rubric," and the integration logic for an algorithmic signal generator.
## **1. Core Concept: Expected Value (EV)**
The foundation of the system is the equation:


The goal is to only trade when EV is significantly positive by stacking variables that increase the win rate and the potential reward simultaneously.
## **2. The Factor Rubric (The "Tally")**
An expert trader weighs these variables dynamically. An algo should assign a score (0-10) to each:
### **Category A: Price & Momentum (30% Weight)**
 * **Rate of Change (Waterfall):** Look for "asymptotic" moves (price dropping vertically).
 * **Magnitude:** The move must be multiple standard deviations away from the 20-period Moving Average.
 * **Leg Count:** Reversals are more likely on the 3rd or 4th "leg" (push) of a move.
### **Category B: Market Structure (25% Weight)**
 * **Volume Capitulation:** A massive volume spike at the bottom/top signals exhaustion.
 * **Forced Liquidations:** Identify "Stop Runs" where price pokes below key levels to trap sellers before reversing.
 * **Boringness Factor:** Higher scores are given to large-cap, stable stocks (S&P 500) because they have a "quantifiable floor" compared to micro-caps.
### **Category C: Context & Sentiment (25% Weight)**
 * **Sector Convergence:** Is the stock weaker than its peers? (e.g., if the sector is flat but the stock is cratering on no news, the EV is higher).
 * **News Filter:** Reversals are strongest when there is **no fundamental change** (panic for the sake of panic).
 * **Time of Day:** Reversals often happen at the "Open" or "Close" when liquidity is highest.
### **Category D: Order Flow (20% Weight)**
 * **Delta Divergence:** Price makes a new low, but the "Aggressive Selling" (Delta) is decreasing.
 * **Trapped Liquidity:** Identifying where large limit orders are getting "filled" and the price refuses to go further.
## **3. Execution: The "Right Side of the V"**
The most critical rule: **Never catch a falling knife.** You must wait for the "turn."
 * **The Wait:** Let the waterfall happen. Ignore the bottom.
 * **The Signal:** Enter only when price breaks the **high of the previous candle** (1-minute or 2-minute timeframe).
 * **The Stop:** Strictly placed at the low of the move.
 * **The Target:** The 20-period Moving Average (the "Equilibrium").
## **4. Developer Instructions: The "Legend Council" Algo**
To build this into an algorithmic "expert" that provides stock tips, instruct your developer as follows:
### **Module 1: The Scanner**
Filter a universe (e.g., S&P 500) for assets where:
 1. Price < (20_SMA - 3_Standard_Deviations)
 2. RSI(14) < 25
 3. Current_Volume > 2.0 * Average_Volume
### **Module 2: The Scorer**
The algo must output a **"Council Grade"**:
 * **A+ (Score 90+):** All factors align (Large cap, 3rd leg, volume spike, no news).
 * **B (Score 70-89):** Decent setup, but missing volume or sector support.
 * **C (Score < 70):** Marginal setup. "Paper cut" territory. **No Signal.**
### **Module 3: Signal Transmission**
The algo should push a JSON payload to a Discord Webhook/Council Leaderboard:
```json
{
  "Ticker": "TSLA",
  "Grade": "A+",
  "Setup": "3rd Leg Waterfall / No News",
  "Entry": "Break of 2m High ($185.50)",
  "Stop": "Low of Move ($182.00)",
  "Target": "20 SMA ($191.00)",
  "Confidence_Score": "92/100"
}

```
## **5. Becoming an Elected Trader**
To be respected by a council of experts, the algo must demonstrate "Professional Humility":
 1. **Transparency:** Log every trade’s EV vs. result.
 2. **Time Stops:** If the trade doesn't bounce within a set time, the algo should exit at breakeven. Expert traders don't hope; they react.
 3. **Risk Management:** Automatically reduce size if the "Boringness" factor is low (high-volatility small caps).
**Next Step:** Copy this text into a Google Doc, title it "Breitstein Wizard Spec," and share it with your development team.
