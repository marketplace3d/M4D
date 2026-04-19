# m4d-api

Read-only HTTP API over **`m4d-engine`** outputs: `algo_day.json` + `votes.jsonl` in a single directory.

## Run

From repo root (after `m4d-processor historic …` wrote files into `m4d-engine/out/`):

```bash
cargo run -p m4d-api -- --data-dir m4d-engine/out --host 127.0.0.1 --port 3330
```

- `GET /` → small HTML index (links to `/mission/`, `/opt`, `/health`, `/v1/…`)
- `GET /health` → `ok`
- `GET /opt` → HTML bench page (React 18 from CDN; compare with `m4d-ds` on :8050)
- `GET /opt/ping` → `{"ok":true,"stack":"axum"}`
- `GET /mission/` → MISSION React SPA (served from repo **`build/mission/`**). Build: `cd M4D && npm run build:embed` (`VITE_M4D_API_URL=/`, `base /mission/`).
- `GET /v1/algo-day` → JSON (same as `algo_day.json`)
- `GET /v1/votes?algo_id=8E` → `{ "algo_id", "count", "votes": [...] }` (optional `limit`, `offset`)
- `POST /v1/reload` → reread files from disk (204)
- `GET /v1/ws/algo` → **WebSocket** bridge for MISSION `useAlgoWS`: browser connects, server forwards **normalized `{type:"bar", bar:{...}}`** frames. Upstream: Alpaca **`v2/test`** feed + **`FAKEPACA`** when **`ALPACA_API_KEY`** + **`ALPACA_SECRET_KEY`** are set in the environment (same keys as paper dashboard; never exposed to the browser). Optional **`M4D_ALPACA_WS_URL`** (default `wss://stream.data.alpaca.markets/v2/test`). Reconnects every 5s on failure.

CORS is open for local MISSION (`5550`).

## MISSION

Set **`VITE_M4D_API_URL=http://127.0.0.1:3330`** or use Vite proxy **`VITE_M4D_API_URL=/m4d-api`** with `vite.config.ts` proxy to this port.

**Live chart hook:** set **`VITE_M4D_WS_URL=ws://127.0.0.1:3330/v1/ws/algo`** when hitting `m4d-api` directly, or **`ws://127.0.0.1:5550/m4d-api/v1/ws/algo`** with Vite dev (proxy must enable **`ws: true`** — already set in `M4D/vite.config.ts`).
