# IOPT Status Cursor

Updated: 2026-04-21
Scope: M4D IterOpt trading-surface buildout (live status + progress)

## Definition

- IOPT means IterOpt execution quality across every co-trading layer.
- This status tracks shipped items that improve operator safety, run reliability, and action visibility.

## Shipped Now

### P0 (Core Safety + Execution)

- Trader action bus implemented with unified actions:
  - `close_longs`
  - `close_shorts`
  - `flatten_lock`
  - `rescue`
- Every action now emits receipt metadata:
  - `ACK/ERR`
  - `eventId`
  - `scope` (`ALL`/`PAPER`/`IBKR`)
  - operator-facing message
- Account-aware execution is live in Trader:
  - account scope selector drives position universe
  - scope is carried on action receipts
- Rescue protocol hardened into staged flow:
  1. freeze entries (UI lock on)
  2. cancel pending approvals
  3. flatten positions
  4. enforce server lock
  5. emit action receipt event

### P1 (Surface Standardization)

- Shared panel primitives added for cross-page consistency:
  - `ContextPanel`
  - `ActionPanel`
  - `SafetyPanel`
  - `StatusPanel`
- Market + Pulse priority/status panels moved onto shared primitives.
- Trader MT5-style position matrix added:
  - sortable columns (`symbol`, `side`, `qty`, `avg`, `unrealized`, `account`, `kill-switch`)

- Trader right-side Trade Interface Dock (MT5-style operating panel):
  - live positions summary, long/short split
  - `CLOSE LONGS`, `CLOSE SHORTS`, `FLATTEN + LOCK`
  - multi-account scope toggle (`ALL`, `PAPER`, `IBKR`)
  - safety rescue protocol + alt comms quick surface
  - server-lockdown terminal command surface
- Dual lock model is server-enforced:
  - `ui_lock` (Trader UI toggle)
  - `terminal_lock` (controlled from `go.sh`)
  - effective `halt_lock = ui_lock OR terminal_lock`
- Backend lock enforcement added to run/approval endpoints:
  - blocks `paper_run`, `ibkr_run`, `paper_approve` when effective lock is on
- `go.sh` lock commands added:
  - `./go.sh lock-on`
  - `./go.sh lock-off`
  - `./go.sh lock-status`
- Trader hard run gating:
  - blocks run actions if halt lock on, session blocked, or risk gate not green
  - explicit run-block reason surfaced
- Trader dual-lock visibility:
  - `UI LOCK` and `SERVER LOCK` status pills surfaced in control strip
- Market + Pulse dual-lock visibility:
  - `UI`, `SERVER`, `HALT` lock truth surfaced in-page

## In Progress

### P1 Remaining

- Replace remaining ad-hoc dock card wrappers with panel primitives in Trader.
- Add rescue timeline strip (stage latencies + error handoff).

### P2 (4K + Responsive Profile)

- Layout profile selector added in Trader (`4K`, `DESKTOP`, `COMPACT`) and dock width behavior wired.
- Remaining:
  - profile-aware typography scaling
  - profile-aware card density/row limits
  - compact auto-collapse rules

## Gaps To Surface (Doc Only)

- Recon panel: MISSING
- Stale-data hard gate: PARTIAL
- Hard risk veto reasons: PARTIAL
- TCA/slippage: MISSING
- Mode promotion gates: MISSING

## Next IterOpt Steps

1. Add slippage delta metrics per action to execution log (expected vs actual move).
2. Add cloud heartbeat watchdog for server lock source to support always-on remote operator mode.
3. Add immutable action signature fields (who, source, run id) to all run-control responses.

## Operator Commands

- Check lock state: `./go.sh lock-status`
- Force server lock on: `./go.sh lock-on`
- Release server lock: `./go.sh lock-off`
- Start full system: `./go.sh`

## Notes

- This file is a live build status, not a design doc.
- UI changes must remain trading-first and avoid non-trading control clutter.
