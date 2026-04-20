This strategy, presented by **TG Capital (Tyler)**, is a high-conviction "Trend Wave" model that combines ICT concepts with specific momentum indicators. It is designed for extreme patience, occurring only 8–15 times per year per pair, but yielding massive risk-to-reward (RR) ratios (1:20 to 1:50+).

### **1. The Core Algorithm (The "Trident" Strategy)**

The strategy relies on a confluence of Time, Trend, and a specific 3-candle price action pattern.

#### **A. Context & Setup (The "Wave")**
* **Timeframe:** 30-Minute (Entry), Daily (Target/Bias).
* **Kill Zone:** London Session only (3:00 AM – 6:30 AM EST).
* **The Trend Wave:** Use four Exponential Moving Averages (EMAs): **5, 9, 13, and 21**.
    * **Validation:** EMAs must be "stacked" (e.g., for longs: 5 > 9 > 13 > 21) and not intertwining. This represents a "trend wave" [[10:28](http://www.youtube.com/watch?v=ADnslyKOwFE&t=628)].
* **200 EMA Filter:** Price must be above the 200 EMA for longs, below for shorts [[33:50](http://www.youtube.com/watch?v=ADnslyKOwFE&t=2030)].

#### **B. The Trident Pattern (The Entry)**
1.  **Fair Value Gap (FVG):** Look for a 3-candle FVG to print during or just before the Kill Zone (ideally at 2:30 AM or 3:00 AM) [[33:17](http://www.youtube.com/watch?v=ADnslyKOwFE&t=1997)].
2.  **The Dogee/Trident:** A "Doji" candle must wick into the FVG, specifically touching the **Consequent Encroachment (50% level)** [[07:20](http://www.youtube.com/watch?v=ADnslyKOwFE&t=440)].
3.  **The Confirmation Candle:** The candle *after* the Doji must **not** close above the Doji's high (for longs). If it closes above, the trade is invalidated [[43:02](http://www.youtube.com/watch?v=ADnslyKOwFE&t=2582)].
    * *Logic:* A Doji wicking the FVG shows sellers tried to push down but were met with overwhelming buying pressure [[10:01](http://www.youtube.com/watch?v=ADnslyKOwFE&t=601)].

---

### **2. Python & Rust Logic Templates**

To automate this, you need to handle EMA stacking, FVG detection, and the specific "Doji-mid-gap" validation.

#### **Python (Conceptual)**
```python
def is_trident_valid(candles):
    # 1. EMA Stacking (5 > 9 > 13 > 21)
    if not (ema5 > ema9 > ema13 > ema21): return False
    
    # 2. Identify FVG (Candle 0, 1, 2)
    fvg_top = candles[0].low
    fvg_bottom = candles[2].high
    fvg_mid = (fvg_top + fvg_bottom) / 2
    
    # 3. Validation: Doji wicks 50% of FVG
    doji = candles[3]
    if not (doji.low <= fvg_mid <= doji.high): return False
    
    # 4. Alignment: Next candle must close below Doji high
    confirmation = candles[4]
    if confirmation.close > doji.high: return False
    
    return True
```

#### **Rust (Structural)**
```rust
struct TridentStrategy {
    ema_stack: [f64; 4], // 5, 9, 13, 21
    kill_zone: bool,
}

impl TridentStrategy {
    fn check_entry(&self, fvg: FairValueGap, doji: Candle, confirm: Candle) -> bool {
        let is_stacked = self.ema_stack.windows(2).all(|w| w[0] > w[1]);
        let wicks_midpoint = doji.low <= fvg.midpoint() && doji.high >= fvg.midpoint();
        let valid_confirmation = confirm.close < doji.high;

        is_stacked && self.kill_zone && wicks_midpoint && valid_confirmation
    }
}
```

---

### **3. Extra Validation & Alignment**

* **Indicator Confluence:** Tyler uses a custom "Bull Trading" indicator on TradingView. It colors candles based on volume and strength: **Bright Green** (Strong Bullish), **Blue** (Weak Bullish), **Red** (Strong Bearish), **Black** (Weak Bearish) [[33:31](http://www.youtube.com/watch?v=ADnslyKOwFE&t=2011)]. 
    * *Validation:* Only take longs if candles are Green or Black (indicating no heavy selling pressure).
* **Gold-Specific Rule:** Do not use a "hard" stop loss on Gold due to liquidity wicks. Wait for a **candle close** below the setup candle's low to exit [[14:03](http://www.youtube.com/watch?v=ADnslyKOwFE&t=843)].
* **Daily Alignment:** Ensure the Daily candle is printing the same color/direction as your 30m entry [[20:32](http://www.youtube.com/watch?v=ADnslyKOwFE&t=1232)].

---

### **4. How to Deal with the Two-Week Wait**

Waiting two weeks for a single trade is the hardest part of this model. Tyler suggests several mental and structural shifts:

1.  **Focus on the Mathematics:** Realize that one 1:20 or 1:50 win "trumps every other person who's trading regularly" [[28:39](http://www.youtube.com/watch?v=ADnslyKOwFE&t=1719)]. You only need 8–10 of these a year to be financially free.
2.  **Balance-Based Prop Firms:** Crucial for long-duration trades. Use firms like Alpha Capital or FTMO that use **Balance-based Drawdown** instead of Equity-based. Equity-based firms will penalize you for the natural P&L swings of a multi-day winner [[30:37](http://www.youtube.com/watch?v=ADnslyKOwFE&t=1837)].
3.  **Step Away from the Screen:** Since the window is strictly 3:00 AM – 6:30 AM EST, if the setup isn't there by 6:30, your day is over. Do not "force" price action in the afternoon [[09:19](http://www.youtube.com/watch?v=ADnslyKOwFE&t=559)].
4.  **The "Delusional" Self-Belief:** Tyler attributes his success to a year of backtesting without trading. He collected enough data to know the system was "bulletproof," which provided the peace of mind to wait [[11:15](http://www.youtube.com/watch?v=ADnslyKOwFE&t=675)].



http://googleusercontent.com/youtube_content/0