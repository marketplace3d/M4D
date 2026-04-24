# M4D UI Style + Controls Plan

Date: 2026-04-23
Owner intent: Build style controls for M4D without destabilizing layout or chart surfaces.

## Scope Guardrails (Hard Rules)

- Work on M4D only.
- Do not change top nav tabs or primary top-nav button layout.
- Add controls elsewhere (secondary zone/side panel/settings area), not in top nav.
- No chart logic or rendering changes.
- Keep current subtle navy + black base as safe default.
- Keep implementation simple and durable (avoid layered complexity that breaks later).

## What Was Requested

- A controlled visual system with three style directions:
  - Dark high contrast
  - Subtle navy/blue base
  - Warm marketing style
- Preserve consistent vibrant action colors (vibrant lock idea).
- Energy glow available when needed (live trading/algo feedback), but optional and controlled.
- Soundscape master toggle with speaker icon (on/off).
- Size controls with stored state:
  - S/M/L/X sizing
  - MB/1080/4K profile behavior
- Locks are important:
  - Lock UI settings to prevent accidental changes.
- Keep controls efficient, compact, and expert-friendly.
- Font strategy to be reviewed later; compact fonts are desirable for some pages.

## Style Model (Agreed Direction)

- Base palette foundation:
  - Black
  - Navy
  - Vibrant accents
- Visual ratio target:
  - Most UI in black/navy neutral structure
  - Vibrant used only for active/live/signal emphasis
- Energy glow:
  - Controlled intensity (off/low/med/high)
  - Applied to active/live states only
  - Should not flood entire page backgrounds

## Control Set (Target)

- Theme mode: HC / NAVY / WARM
- Vibrant lock: on/off
- Glow level: off/low/med/high
- Text/scale size: S/M/L/X
- Screen profile: MB / 1080 / 4K
- Audio: speaker on/off
- UI lock: lock/unlock state

## Persistence and Safety

- Persist all control state in localStorage.
- Prefer token-based CSS variables at root/container level.
- Avoid global transform scaling; use font/spacing tokens.
- Do not refactor chart internals for this phase.
- Introduce in minimal steps to reduce break risk.

## Routing and App Context Notes

- Main M4D runtime target currently uses:
  - `http://127.0.0.1:5555/`
- Existing M1D legacy app remains separate:
  - `http://127.0.0.1:5550/`
- This plan is for M4D only.

## Implement Next (When Resuming)

1. Place control panel outside top nav (side utility panel or compact settings block).
2. Add style tokens and state persistence.
3. Wire speaker toggle state (UI-level first, audio hooks later).
4. Add lock behavior.
5. Validate responsive behavior on MB/1080/4K.
6. Iterate visual tuning after controls are stable.

## Explicit Non-Goals for First Pass

- No top-nav restructuring.
- No chart engine/indicator behavior changes.
- No large CSS architecture rewrite.
- No font family overhaul yet.

