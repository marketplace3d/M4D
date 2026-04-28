# TRADE LAB Implementation Plan

## User Instruction (Verbatim Priority)
- "DUPLICATE copy of `#obi` OBI page to page TRADE-LAB ... don't change other pages."
- "change name to TRADE LAB and put link in left menu for new page."
- "copy the page with all the features and work from there."

## Mandatory Build Rule
1. First create a full copy of the OBI page with all existing OBI features unchanged.
2. Only after parity is confirmed, layer Trade Lab simulator features on top.
3. Do not modify unrelated pages.

## Objective
Deliver a dedicated `TRADE LAB` page in the `:5556` app with:
- OBI-derived duplicate chart environment
- Top-half live chart and bottom-half simulation chart
- Linear speed control from 1x to 1000x (default 10x)
- Popout control panel including simulation-height slider
- Critical stats and performance charts below the chart stack
- Trade-mode orchestration (COUNCIL / ICT / BOTH / JEDI)
- Paper/live-sim trade visualization (triangles and in-trade lines)

## Scope Lock
- Target app: `M5D` only.
- Primary implementation file: `M5D/src/pages/TradeLabPage.tsx`.
- Existing routing/nav already wired to `#trade-lab`.
- No changes to unrelated pages.

## Architecture
1. **Market data source**
   - Use `fetchBarsForSymbol()` for consistent bar sourcing.
   - Reuse chart symbol/timeframe persistence helpers.

2. **Dual-chart stage**
   - Live chart (top): full bar stream.
   - Sim chart (bottom): progressively revealed subset (`bars.slice(0, simIndex+1)`).

3. **Simulation engine**
   - Time progression controlled by `simProgress`.
   - Linear speed model:
     - `speed` in `[1,1000]`.
     - Timer increments progress by `speed/10` every 100ms.
     - Effective bars/sec approximately linear to slider value.
   - Auto-stop when reaching final bar.

4. **Control panel popout**
   - Toggle open/close.
   - Controls:
     - Play/Pause
     - Step +1 bar
     - Reset to initial simulation window
     - Speed slider (1-1000x, default 10x)
     - Sim chart height slider (30%-75%, default 50%)
   - Persist panel/speed/height to `localStorage`.

5. **Performance layer**
   - Run strategy simulation over visible sim bars:
     - EMA(9/21) directional flip model.
   - Compute and display:
     - Trades
     - Win rate
     - Profit factor
     - Net return
     - Max drawdown
     - Sharpe-like score
     - Buy-and-hold return
     - Strategy edge vs buy-and-hold
   - Render performance visuals:
     - Equity sparkline
     - Drawdown sparkline
     - Snapshot panel

## Delivery Checklist
- [x] Trade Lab page scaffold created.
- [x] Live/sim split chart stage implemented.
- [x] Replay speed control implemented (default baseline forced to 10x).
- [x] Popout control panel implemented.
- [x] Chart stack + split controls implemented in popout.
- [x] Critical stats cards implemented below charts.
- [x] Performance charts implemented below charts.
- [x] Trade mode selector added (COUNCIL / ICT / BOTH / JEDI).
- [x] Live Trade standardized arm button added (red).
- [x] Killzone-only gate added for firing focus.
- [x] Top chart set as scan/record surface.
- [x] Top chart trade triangles (historical markers) wired.
- [x] Bottom chart set for live in-trade lines only.
- [x] Final pass: fire cadence logic switched to transition-based firing.
- [x] Final pass: marker surface split finalized (top triangles, bottom in-trade lines).
- [ ] QA pass in running browser session (manual user sign-off pending).
- [x] M5D production build for Trade Lab app: `cd M5D && npm run build` (tsc + vite) — passing.

## Current Build Status (Execution Log)
- Top chart is the historical scan/record chart and displays trade triangles.
- Bottom chart is the live replay chart and displays live trade lines only when in-trade.
- Replay runs in paper mode only (non-real execution), using loaded candle data.
- Firing gates currently include mode, alignment checks, optional killzone-only gate, and trend signal checks.
- Remaining work is calibration/tuning, not scaffolding.

## QA Protocol
1. Open `http://127.0.0.1:5556/#trade-lab`.
2. Confirm top live chart and bottom sim chart both render.
3. Confirm default load state:
   - 50/50 chart split.
   - replay running at baseline 10x.
4. Move speed slider:
   - Verify sim progression slows at low values.
   - Verify sim progression accelerates at high values.
5. Toggle panel and adjust chart stack/split:
   - Verify chart split updates immediately.
6. Use Play/Pause, Step, Reset:
   - Confirm deterministic behavior.
7. Validate top chart triangles:
   - Appear on trade transitions, not every candle.
8. Validate bottom chart live trade lines:
   - Visible only while in-trade, absent when flat.
9. Validate mode behavior:
   - COUNCIL / ICT / BOTH / JEDI change fire cadence and direction.
10. Validate killzone gate:
   - ON: events outside killzone are suppressed.
   - OFF: events can fire outside killzone.

## Notes
- Current simulation model is intentionally lightweight and deterministic for responsiveness.
- A future upgrade can swap to your full OBI signal execution model without UI contract changes.

## Exit Policy Directive (User Priority)
- STOP CIS-style early flip exits in Trade Lab replay (current gate-flip exits are producing premature closures).
- Preferred exits:
  1) liquidity target levels (ICT/LQ levels, T1/T2 hierarchy),
  2) safety fallback at 13 EMA breach/reclaim logic,
  3) optimized trailing ATR or anchored VWAP trail variants.
- Action item: quant-owned exit model comparison and optimization (per-symbol ES/NQ/BTC), with side-by-side Sharpe/PF/DD attribution before adopting as default.

## Optimization Roadmap (Level-Up IOPT)
- Scope: optimize **separately per mode** (COUNCIL / ICT / BOTH / JEDI / MASTER / BOOM) and **per symbol** (ES / NQ / BTC); avoid one shared setting.
- Add explicit `ALL MODES` benchmark leaderboard from independent books (already visible in SIM CONTEXT), then pick per-symbol winner.
- Run exit-family bakeoff:
  1) LQ targets only,
  2) LQ + EMA13 safety,
  3) LQ + trailing ATR,
  4) LQ + anchored VWAP trail.
- Rank by Sharpe, PF, drawdown, and premature-exit ratio (great-entry/early-exit defect metric).
- Adopt symbol-aware defaults (ES preset, NQ preset, BTC preset) only after holdout/walk-forward sanity check.

## Current Quant Sweep Snapshot (Reality Check)
- ES (1d, 2020-01-01 → 2026-04-27): best Sharpe/trade ≈ 1.145 (loose retest, hold 6, stop 1.5 ATR, TP 2.0 ATR, killzone off).
- NQ (1d, same window): best Sharpe/trade ≈ 1.558 (loose retest, hold 6, stop 1.0 ATR, TP 1.5 ATR, killzone off, T1 on).
- BTC (same framework): earlier run showed higher Sharpe than ES and strong sensitivity to strict-vs-loose retest + exit profile.
