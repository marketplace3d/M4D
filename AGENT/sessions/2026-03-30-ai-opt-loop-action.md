# AI-OPT-LOOP Action Plan (2026-03-30)

Source note reviewed: `spec-kit/AI in/AI-OPT-LOOP`.

## Cleaned summary

- WebSocket-first live path is the key bottleneck unlock; polling is temporary.
- Best initial feed options remain:
  - Stocks paper/live: Alpaca
  - Crypto stream: Binance
  - Extended data stack: Polygon/Massive
- TradingView webhooks can bridge Pine alerts into the existing runtime quickly.

## Immediate implementation status

- Added duplicate live chart route for integration:
  - `#chartslive` (alias `#clive`)
  - `M4D/src/pages/TvLwChartsLivePage.tsx`
- Added WebSocket hook scaffold:
  - `M4D/src/hooks/useAlgoWS.ts`
  - Connects to `VITE_M4D_WS_URL` when set.
  - Sends subscribe payload `{ op: "subscribe", stream: "bars", symbol, timeframe }`.
  - Parses `type: "bar"` and appends/replaces latest bar in live chart.
  - Falls back to existing REST bars when WS URL is absent.

## Recommended next coding steps

1. Add a small backend WS fan-in service:
   - Holds vendor keys and normalizes message shape to `{ type: "bar", bar }`.
2. Add reconnect policy:
   - exponential backoff + heartbeat timeout.
3. Add TradingView webhook endpoint:
   - map alert payload -> temporary event stream / state update.
4. Add risk layer channel:
   - one WS stream for market bars, one for risk/sentinel state.

## Follow-up quality tasks

- Extract thresholds/constants in control room viz files.
- Add `useMemo` around repeated bank tallies.
- Upgrade error UX from status dot to actionable banner + retry.
