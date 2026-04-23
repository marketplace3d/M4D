/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override algo_day JSON URL (default `/m4d-latest/algo_day.json`) when API is off. */
  readonly VITE_M4D_ALGO_DAY_URL?: string;
  /**
   * Rust `m4d-api` base: `http://127.0.0.1:3330`, `/m4d-api` (Vite proxy), or `/` (same-origin embed on Axum).
   */
  readonly VITE_M4D_API_URL?: string;
  /** Static `votes.jsonl` URL when API is off (default `/m4d-latest/votes.jsonl`). */
  readonly VITE_M4D_VOTES_JSONL_URL?: string;
  /** Polygon REST (optional if dev proxy injects key via `/api/polygon`). */
  readonly VITE_POLYGON_IO_KEY?: string;
  readonly VITE_POLYGON_API_KEY?: string;
  /** Mock council sentiment 0–1 for `mountBoomChart` (same as Svelte PWA). */
  readonly VITE_MOCK_SENTIMENT?: string;
  /** Django `m4d-ds` origin for `/health` probe (default `http://127.0.0.1:8050`). Set `off` to skip. */
  readonly VITE_M4D_DS_URL?: string;
  /** `tools/algo-execution` base URL (overrides dev proxy). */
  readonly VITE_ALGO_EXEC_URL?: string;
  /** Dev: set `1` / `on` / `true` to use Vite `/algo-exec` proxy → 127.0.0.1:9050 (avoids probe spam when service is off). */
  readonly VITE_ALGO_EXEC_DEV?: string;
  /** Optional fan-in WebSocket URL for live bars (probe only in ops dash). */
  readonly VITE_M4D_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
