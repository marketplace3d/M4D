This specification outlines a high-frequency decision engine designed to front-run traditional Market Structure Shifts (MSS) by identifying **Liquidity Purges** and **Displacement Velocity** as the primary triggers.

---

## 1) Signal Architecture: The "Lead-Lag" Engine
The engine operates on a dual-layered logic:
1.  **The Sentinel (1m Polling):** Scans for Liquidity Sweeps and SMT Divergence.
2.  **The Executor (3m Decision Window):** Validates Displacement (FVG creation) and calculates the Weighted Edge Score.



### Feature Schema Names
* `liq_draw_prox`: Proximity to PDH/PDL or Session Liquidity.
* `purge_velocity`: Rate of change during the "Judas" swing.
* `disp_score`: Magnitude of the displacement candle relative to ATR.
* `smt_delta`: Percentage divergence between correlated assets (e.g., BTC/ETH or ES/NQ).

---

## 2) Parameter Table
| Parameter | Default Value | Tuning Range | Description |
| :--- | :--- | :--- | :--- |
| `ATR_Period` | 14 | 10 – 22 | Basis for displacement thresholds. |
| `Disp_Mult` | 1.5x | 1.2x – 2.5x | Min candle size (Body > ATR * Mult). |
| `Killzone_NY` | 08:30–11:00 EST | Fixed | High-probability volatility window. |
| `Decay_Mult` | 0.4 | 0.1 – 0.7 | Weight reduction for signals outside Killzones. |
| `Kelly_Fraction` | 0.25 | 0.1 – 0.3 | Quarter-Kelly cap for position sizing. |
| `SMT_Thresh` | 0.05% | 0.01% – 0.1% | Divergence threshold for SMT validation. |

---

## 3) Entry & Exit Logic

### Primary Trigger: The "Purge-and-Propel"
Entry is triggered when **Purge + Displacement** occurs, regardless of whether a BOS has formed.

**Pseudo-code for Entry:**
```python
if session_in_killzone and liq_sweep_detected:
    if smt_divergence == True:
        if current_candle.body > (ATR * Disp_Mult) and has_fvg:
            edge_score = calculate_weighted_score()
            if edge_score > entry_threshold:
                execute_limit_order(price=fvg_mean_threshold, type='Early')
```

### Exit Logic
* **TP1 (Partial):** First Draw on Liquidity (DOL) reached (e.g., opposing session high).
* **TP2 (Runner):** Trail via Mean Threshold of the most recent Displacement Array (OB/FVG).
* **Stop Loss:** Placed at the low/high of the "Judas" candle (The Purge tail).

---

## 4) Risk Model & Weighted Edge Score
The engine calculates a **Total Edge Score ($S_{edge}$)** to determine conviction.

$$S_{edge} = (W_s \cdot S_{struct}) + (W_l \cdot S_{liq}) + (W_v \cdot S_{vol}) + (W_{sent} \cdot S_{sent})$$

* **Structure (45%):** Proximity to HTF PD Arrays.
* **Liquidity (30%):** Quality of the sweep (was it a "clean" purge?).
* **Volatility (21%):** Displacement strength and FVG width.
* **Sentiment (4%):** Order flow delta alignment (Non-gating).

---

## 5) Early vs. Late Signal Sets

| Feature | Early Signal (The Engine) | Late Confirmation (Standard ICT) |
| :--- | :--- | :--- |
| **Trigger** | FVG Creation after Purge | BOS/CHoCH + Retest |
| **R:R Ratio** | High (1:4 to 1:6) | Moderate (1:2 to 1:3) |
| **Win Rate** | 45-52% | 60-65% |
| **Drawdown** | Higher (vulnerable to "runs on stops") | Lower (more price validation) |

---

## 6) Profile Presets

| Profile | Min Edge Score | Max Session Loss | Max Leverage |
| :--- | :--- | :--- | :--- |
| **Conservative** | 85% | 1% | 2x |
| **Balanced** | 70% | 2% | 5x |
| **Aggressive** | 55% | 4% | 10x |

---

## 7) Failure Modes & Invalidation (Kill Switches)
The engine must cease operations if these "Gate Drops" occur:
1.  **Divergence Expansion:** SMT divergence continues to widen for >3 candles (indicates a trending break, not a reversal).
2.  **Reclaim Failure:** Price closes back inside the FVG against the trade direction.
3.  **Macro News Injection:** High-impact folder (red) ± 10 minutes.
4.  **Structure Re-Purge:** If the "Judas" low is breached, the signal is invalidated immediately.

---

## 8) Walk-Forward Test Plan
* **Phase 1 (In-Sample):** Optimize `Disp_Mult` and `FVG_Score` on 12 months of NQ/ES data.
* **Phase 2 (Out-of-Sample):** Forward test on 3 months of 1m/3m tick data.
* **Phase 3 (Stress Test):** Monte Carlo simulation (1,000 runs) to check for "Risk of Ruin" using the Quarter-Kelly constraint.

> **Note on Polling:** Compute intensive tasks (weighted scoring) should run every 60s, but order execution should be locked to 3m candle closes to filter out sub-minute noise and "wick" traps.