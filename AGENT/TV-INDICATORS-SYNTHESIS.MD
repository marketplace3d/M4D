Based on the video from **Michael Automates**, here are the detailed instructions, components, and AI build specifications for creating a multi-combined trading strategy using AI and his back-testing engine.

---

### **1. Core Strategy Components**
To build this strategy, you need several modular components that work together:

* **TradingView Source Code:** You must find "Open Source" indicators on TradingView. The AI needs the raw Pine Script code to understand the logic and combine it with others [[02:54](http://www.youtube.com/watch?v=ISZlL0wP76s&t=174)].
* **The Back-Testing Engine (v22.0 or higher):** A local software environment that contains:
    * **Indicators Folder:** Stores the Pine Script files for the AI to reference.
    * **Data Folder:** Contains historical price data (CSV/JSON) for various assets (e.g., BTC, ETH, SOL) [[02:30](http://www.youtube.com/watch?v=ISZlL0wP76s&t=150)].
    * **Strategies Folder:** Where the baseline and new AI-generated strategies are saved [[07:15](http://www.youtube.com/watch?v=ISZlL0wP76s&t=435)].
* **Claude AI (specifically Claude Code):** The "brain" that executes the code, runs back-tests, and iterates on combinations [[08:52](http://www.youtube.com/watch?v=ISZlL0wP76s&t=532)].
* **Baseline Strategy:** A "control" strategy (like the Gaussian Channel) that the AI must attempt to beat [[06:23](http://www.youtube.com/watch?v=ISZlL0wP76s&t=383)].

---

### **2. AI Build Specifications (The Prompt Logic)**
The AI isn't just "guessing"; it follows a specific optimization framework defined in the system prompt:

| Spec Category | Requirement / Logic |
| :--- | :--- |
| **Optimization Goal** | High profit with **low drawdown** across an entire asset class (not just one coin) [[05:33](http://www.youtube.com/watch?v=ISZlL0wP76s&t=333)]. |
| **Portfolio Approach** | The AI tests the strategy against a basket of assets (e.g., Top 10 Crypto) to prevent "overfitting" [[05:41](http://www.youtube.com/watch?v=ISZlL0wP76s&t=341)]. |
| **Timeframe Alignment** | The indicator code must match the chart data timeframe (e.g., 1-Day, 4-Hour, or 1-Week) [[03:54](http://www.youtube.com/watch?v=ISZlL0wP76s&t=234)]. |
| **Model Settings** | **Claude Opus 4.6** (or latest) with **Maximum Effort** level for deep reasoning [[09:30](http://www.youtube.com/watch?v=ISZlL0wP76s&t=570)]. |
| **Safety Filter** | Use a "Baseline Strategy" to ensure the AI doesn't settle for mediocre results; it must iterate until it outperforms the control [[06:57](http://www.youtube.com/watch?v=ISZlL0wP76s&t=417)]. |


---

### **3. Step-by-Step Instructions**

#### **Phase 1: Preparation**
1.  **Download Indicators:** Go to TradingView, filter by "Open Source," copy the Pine Script of an indicator you like, and save it in your local `indicators` folder [[03:16](http://www.youtube.com/watch?v=ISZlL0wP76s&t=196)].
2.  **Naming Convention:** Save files as `indicator-[Name]-[Timeframe].pine` (e.g., `indicator-KernelRegression-1day.pine`) [[03:22](http://www.youtube.com/watch?v=ISZlL0wP76s&t=202)].
3.  **Load Data:** Ensure your `data` folder has the corresponding historical data for that timeframe. You can ask the AI to fetch this data from Binance or export it manually from TradingView [[18:30](http://www.youtube.com/watch?v=ISZlL0wP76s&t=1110)].

#### **Phase 2: Execution in Claude**
1.  **Open Claude Desktop:** Navigate to the **Claude Code** section [[08:52](http://www.youtube.com/watch?v=ISZlL0wP76s&t=532)].
2.  **Select Directory:** Point Claude to your local project folder containing the back-testing engine [[09:03](http://www.youtube.com/watch?v=ISZlL0wP76s&t=543)].
3.  **Input the Prompt:** Paste the specialized prompt (provided by Michael) that includes:
    * The engine folder name.
    * The baseline strategy file name.
    * The start date (e.g., 2018-01-01 to avoid "mania" data) [[08:16](http://www.youtube.com/watch?v=ISZlL0wP76s&t=496)].
4.  **Wait & Monitor:** The process takes **20 minutes to 1 hour**. Claude will run multiple variations, combining indicators like building blocks [[09:51](http://www.youtube.com/watch?v=ISZlL0wP76s&t=591)].

#### **Phase 3: Validation & Deployment**
1.  **Analyze Results:** Look for the "Winner" (the version with the best risk-adjusted profit). Pay attention to the **Median Profit** rather than Average to avoid being skewed by outliers like Solana [[12:24](http://www.youtube.com/watch?v=ISZlL0wP76s&t=744)].
2.  **Risk-Adjusted Simulation:** Ask the AI to simulate a portfolio (e.g., $10k) with specific allocations (e.g., 25% BTC, 20% ETH) to see how the strategy performs in a real-world scenario [[13:02](http://www.youtube.com/watch?v=ISZlL0wP76s&t=782)].
3.  **Export to TradingView:** Copy the final AI-generated code from your `strategies` folder and paste it into the TradingView Pine Editor to visualize the signals [[14:20](http://www.youtube.com/watch?v=ISZlL0wP76s&t=860)].

**URL:** [https://youtu.be/ISZlL0wP76s](https://youtu.be/ISZlL0wP76s)

http://googleusercontent.com/youtube_content/0

///////////

In the video, Michael explains that the AI doesn't just "invent" strategies from scratch; it uses **existing high-performing indicators** as building blocks. 

The strategy that eventually "won" in his test was a combination of these specific components:

### **1. The Winning Component Strategy**
* **Kernel Regression Breakout:** This was the primary indicator the AI selected as the foundation for the winning strategy [[10:52](http://www.youtube.com/watch?v=ISZlL0wP76s&t=652)].
* **Gaussian Channel (Baseline):** Michael used the **Gaussian Channel Long/Short** as the "competitor" or baseline strategy. The AI’s job was to analyze the source code of this and other indicators to create a logic that outperformed it [[07:15](http://www.youtube.com/watch?v=ISZlL0wP76s&t=435)].

### **2. Potential Indicator "Ingredients"**
Michael mentions that he pre-loads his back-testing engine with popular, open-source TradingView indicators for the AI to pick and choose from. Common examples he uses include:
* **Trend Following:** Indicators like the Gaussian Channel or Moving Averages.
* **Momentum/Oscillators:** Standard tools like **MACD** or **RSI** [[23:22](http://www.youtube.com/watch?v=ISZlL0wP76s&t=1402)].
* **Volatility/Risk:** Tools like **ATR (Average True Range)** are often combined by the AI to set stop losses or take profits [[23:22](http://www.youtube.com/watch?v=ISZlL0wP76s&t=1402)].

### **3. Why the AI chose these specific components**
* **Overfitting Protection:** The AI was instructed to find a strategy that worked across the **entire portfolio** (BTC, ETH, SOL, etc.) rather than just optimizing for one coin [[13:50](http://www.youtube.com/watch?v=ISZlL0wP76s&t=830)].
* **Drawdown Management:** A component like Kernel Regression was chosen because it offered a **lower drawdown** compared to other high-profit variations that were too risky [[11:12](http://www.youtube.com/watch?v=ISZlL0wP76s&t=672)].
* **Outlier Handling:** The strategy had to be robust enough to handle "hard to automate" coins like **XRP** and high-volatility assets like **Solana** [[15:56](http://www.youtube.com/watch?v=ISZlL0wP76s&t=956)], [[16:35](http://www.youtube.com/watch?v=ISZlL0wP76s&t=995)].

**Key Strategy Outcome:** The final combined strategy (Kernel Regression Breakout variation) outperformed the Gaussian Channel baseline by **3.6x** on a risk-adjusted $10k portfolio simulation [[13:26](http://www.youtube.com/watch?v=ISZlL0wP76s&t=806)].

**URL:** [https://youtu.be/ISZlL0wP76s](https://youtu.be/ISZlL0wP76s)

http://googleusercontent.com/youtube_content/1