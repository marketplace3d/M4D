Based on the analysis of the competition between 36 AI agents in the video, here are the extracted algorithms, recommendations for testing, and advice for building your own system using Claude.

### **1. Extracted Algorithms & Performance**
The experiment utilized 36 different AI-driven strategies. The top-performing bots focused on specific indicators and asset-specific microstructures.

| **Algorithm Name** | **Core Strategy** | **Key Performance Metric** |
| :--- | :--- | :--- |
| **WLD Pivot Point (Winner)** | Mean Reversion / Pivot Level Fading on WLD (Worldcoin). Fades breakouts and waits for reversion to midpoint. | **$4,600 Profit** (46.2% return) |
| **ETH CCI Momentum** | Uses Commodity Channel Index (CCI) to trade momentum shifts specifically on Ethereum. | Top 3 Finisher (>$1,000 profit) |
| **Sooie Body Wick** | Price action strategy focusing on candlestick wicks and body ratios (likely looking for exhaustion). | Top 3 Finisher (>$1,000 profit) |
| **WLD Pivot Point S-R** | Support & Resistance combined with Pivot levels. | High Win Rate (63%) |
| **Entropy Fade** | Fades high-volatility/high-entropy price movements. | High early performance |
| **Phantom Revert** | Mean reversion (failed early due to high volatility/poor timing). | **-$1,000 Loss** (Losing strategy) |

---

### **2. Recommended Top 10 Algos to Test**
Based on the video's results and general quant principles, here are 10 strategies to test across Crypto, Stocks, and Forex:

1.  **Pivot Point Fader (WLD Style):** Test on high-volatility "alt-coins" or "growth stocks" with thinner order books. [[14:28](http://www.youtube.com/watch?v=nit5Gg0-pag&t=868)]
2.  **CCI Momentum Scalper:** Works best on high-liquidity assets like **ETH** or **SPY** (S&P 500 ETF). [[07:42](http://www.youtube.com/watch?v=nit5Gg0-pag&t=462)]
3.  **Inverse "Loser" Strategy:** Take a losing algorithm (like Phantom Revert) and flip the Buy/Sell signals. [[10:30](http://www.youtube.com/watch?v=nit5Gg0-pag&t=630)]
4.  **Body-Wick Exhaustion:** Use for "scalping" 5-minute charts on volatile tech stocks or Crypto. [[07:42](http://www.youtube.com/watch?v=nit5Gg0-pag&t=462)]
5.  **Mean Reversion (Bollinger Bands + RSI):** A classic variation of the "Pivot Fader" for sideways markets.
6.  **Trend-Following SMA Crossover:** Simple but effective for long-term "Asset Classes" like Gold or Blue-chip stocks.
7.  **Volume-Weighted Average Price (VWAP) Fade:** Trading against moves that overextend from the VWAP.
8.  **Liquidity Gap Filler:** Identifying price gaps in thin order books and trading the "fill." [[14:28](http://www.youtube.com/watch?v=nit5Gg0-pag&t=868)]
9.  **Opening Range Breakout (ORB):** Specifically for Stocks during the first 30 minutes of the NY session.
10. **Session-Based Pivot Reversion:** Calculating pivots for the London vs. NY sessions separately. [[14:02](http://www.youtube.com/watch?v=nit5Gg0-pag&t=842)]


---

### **3. Advice for Claude/AI Trading Builders**
The video provides a specific "hybrid" architecture to make AI trading profitable and cost-effective:

* **The "Brain" vs. "Hands" Model:**
    * **The Brain (Claude/GPT):** Use high-reasoning models (Claude 3.5 Sonnet/Opus) to **research and backtest** the strategy. Do not have the LLM "think" for every trade; it's too slow and expensive. [[01:28](http://www.youtube.com/watch?v=nit5Gg0-pag&t=88)]
    * **The Hands (Python Script):** Once Claude picks a strategy, convert it into a **static Python execution script**. This "dumb" bot just looks for the specific math triggers (e.g., "if price < Pivot S1, then Buy"). [[03:24](http://www.youtube.com/watch?v=nit5Gg0-pag&t=204)]

* **Solve the "Drunk Agent" Problem:**
    * AI agents "wake up" without memory (the 50 First Dates problem). Instead of sending the whole history to the LLM every 3 minutes, use a **"Soul File"** or a structured Trading Doc that stores the agent's current state and style. [[02:12](http://www.youtube.com/watch?v=nit5Gg0-pag&t=132)]

* **Micro-Structure Focus:**
    * Instead of building one bot to trade everything, use Claude to build "Specialist Agents" for specific tokens. The winner succeeded because it exploited the **micro-structure** of Worldcoin specifically, rather than being a generalist. [[14:49](http://www.youtube.com/watch?v=nit5Gg0-pag&t=889)]

* **Risk Management:**
    * Aim for a **Risk/Reward ratio of at least 1.10**. Even with a win rate under 50% (the agents had 48.7%), a positive risk/reward makes the system profitable. [[04:25](http://www.youtube.com/watch?v=nit5Gg0-pag&t=265)]

* **Fee Optimization:**
    * The creator warns that high-frequency AI trades will get eaten by fees on many platforms. Use fee-free or low-fee exchanges (like **Lighter**) to preserve the 1-2% edge the AI finds. [[06:33](http://www.youtube.com/watch?v=nit5Gg0-pag&t=393)]

**Video Link:** [I forced 36 AI trading agents to compete](http://www.youtube.com/watch?v=nit5Gg0-pag)



http://googleusercontent.com/youtube_content/0