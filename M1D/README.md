# MISSION

Vite + React (**TypeScript**) control-room UI for the M4D **3×3×3 council** (nine algos per bank A/B/C) plus **Jedi** strip. Roster and copy come from the same JSON as the rest of spec-kit.

**Dev server URL:** **`http://127.0.0.1:5550/`** (with `./go.sh` or `npm run dev`). If you see **connection refused on :8880** (or :5174), that port is obsolete — update bookmarks to **:5550**.

**Edit React / MaxCogViz ports here:** `M4D/src/` (pages, `viz/*.jsx`, components). Production bundle: repo `build/mission/` (not under `spec-kit/`).

## Run

```bash
cd M4D
npm install
npm run dev              # http://127.0.0.1:5550/  (not :5555 — that is Svelte PWA)
npm run dev:open         # same + open in browser
```

**Routing:** pages are selected with the URL **hash** (client-side only). Example: **Crypto Lab** → [`http://127.0.0.1:5550/#crypto`](http://127.0.0.1:5550/#crypto). From **HOME**, use the **CRYPTO** tile or the **CRYPTO** tab in the shell.

From repo root: **`./go.sh`** (default) → **full stack** (API :3330, Django :8050, `crypto_worker`, PWA :5555, MISSION :5550). **`./go.sh mission`** → React only (Crypto/BOOM proxies need the full stack).

- **HOME** (`/` or `#`) — menu; **sticky top bar**: **HOME · COUNCIL · ALGOS · BOOM · WARRIOR · MISSION · WARRIOR 27** + hash links (ALL CAPS in UI).
- **Responsive shell:** ≤720px — **bottom bar** uses short labels (e.g. **W** for `#warriors`) + **☰** drawer; 721px+ — **left rail** (synced); **≥2560px** — top row hides (rail with labels). **COUNCIL** embeds **WARRIORS** (`ControlRoomKnights.jsx`); votes/strengths/tick stay **synced** via `WarriorMobileSyncContext`.
- **COUNCIL** (`#council`) — JSON roster, EKG + Intel rail + embedded WARRIOR 27 (same simulation as full-page route).
- **ALGOS** (`#algos`) — TanStack Table: **`m4d-engine`** `algo_day.json` merged with council names. Dev sample: `public/m4d-latest/algo_day.json`. Regenerate: run `m4d-processor historic …` then copy, or set **`VITE_M4D_ALGO_DAY_URL`** to any URL.
- **BOOM** (`#boom`) — `M4D-boom-algo-dashboard.jsx` (mock).
- **WARRIOR** (`#warrior`; legacy `#xyflow` still works) — bundled copy of `M4D_ALGOSX3_MaxCogViz_XYFlow.jsx` (Jedi → 3 councils → 27 nodes). Source edits: update `spec-kit/` file then copy to `MISSION/src/viz/MaxCogVizXYFlow.jsx`.
- **MISSION** canvas (`#mission`; legacy `#vizdoc` still works) — bundled copy of `M4D_FullSystemVizDoc.jsx` (wide canvas, opt loop, spec boxes). Same sync: `MISSION/src/viz/FullSystemVizDoc.jsx`.
- **WARRIORS** (`#warriors`) — 27-panel grid in `MISSION/src/viz/ControlRoomKnights.jsx` (legacy bundle copy archived as `ControlRoom27.OLD.jsx`): 9-wide desktop, **3-col** under 900px, tap to pin, **shell-synced** votes with the COUNCIL embed.
- **CRYPTO LAB** (`#crypto`) — live scanner; polls Django **`/crypto/live/`** (use **`./go.sh all`** so :8050 + `crypto_worker` are up).

## Data

- **Runtime loaded:** `public/council-algos.v1.json` (fetched as `/council-algos.v1.json`).
- **Canonical copy:** `spec-kit/data/council-algos.v1.json` — when the roster changes, copy or sync into `public/` before dev or build.

```bash
cp ../data/council-algos.v1.json public/council-algos.v1.json
```

### Rust algo_day + votes (ALGOS tab)

```bash
cd ../../m4d-engine
cargo run --release -- historic --csv fixtures/sample_bars.csv --out-dir ./out --symbol BTC --session-id dev_BTC_smoke
cp out/algo_day.json ../M4D/public/m4d-latest/algo_day.json
cp out/votes.jsonl ../M4D/public/m4d-latest/votes.jsonl
```

**Optional — live API instead of static files:**

```bash
# repo root
cargo run -p m4d-api -- --data-dir m4d-engine/out --port 3330
```

In `M4D/.env.local`:  
`VITE_M4D_API_URL=/m4d-api` (uses `vite.config.ts` proxy to `127.0.0.1:3330`) or `VITE_M4D_API_URL=http://127.0.0.1:3330`.  
Optional: **`VITE_ALGO_EXEC_DEV=1`** enables the `/algo-exec` Vite proxy to **`tools/algo-execution`** on **:9050** (health + Council exec). If unset, dev skips probing that port so the terminal stays quiet when the service is off.

## PCA / data science

`CouncilMatrix` accepts optional **`emphasis: Record<algoId, 0–1>`** for highlighting (e.g. PCA loadings or live scores). The app does not compute PCA yet; wire your pipeline to the same **`algorithms[].id`** keys as in the JSON.

## Build

```bash
npm run build
npm run preview   # optional local check of production bundle
```

### One `build/mission/`, three hosts (`/mission/`)

Single command: **`npm run build:embed`** (`base /mission/`, `VITE_M4D_API_URL=/`). Output lives at repo **`build/mission/`** (not under `spec-kit/`). Use the same folder on:

| Where | URL | Notes |
|--------|-----|------|
| **Axum** `m4d-api` | `http://127.0.0.1:3330/mission/` | `/v1` native |
| **Django** `m4d-ds` | `http://127.0.0.1:8050/mission/` | Proxies `/v1/*` + `/health` → `m4d-api` (`M4D_API_UPSTREAM`, default :3330) |
| **Vite preview** | `http://127.0.0.1:4174/mission/` | `npm run preview:embed` (proxies `/v1`, `/api/polygon`, … to :3330) |

**LW charts** on embed still need `VITE_POLYGON_*` at build time or use dev server `:5550` (`/api/polygon`). **`npm run build`** writes the same `build/mission/` tree with default base `/` (for non-`/mission/` hosting).

This app is separate from the Svelte **`pwa/`** chart surface; keep it small and JSON-driven until live feeds land.
