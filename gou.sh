#!/usr/bin/env bash
# Rust Axum `m4d-api` + /opt bench (CDN React, same widget shape as Django).
#   http://127.0.0.1:3030/opt   ·  /mission/ (MISSION — npm run build:embed once)
# Env: M4D_DATA_DIR (default m4d-engine/out), M4D_API_HOST, M4D_API_PORT
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export M4D_DATA_DIR="${M4D_DATA_DIR:-m4d-engine/out}"
export M4D_API_HOST="${M4D_API_HOST:-127.0.0.1}"
export M4D_API_PORT="${M4D_API_PORT:-3330}"
if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"${M4D_API_PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
    OLD_PIDS="$(lsof -iTCP:"${M4D_API_PORT}" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')"
    echo "[gou] Port ${M4D_API_PORT} is already in use (${OLD_PIDS})."
    echo "    If http://127.0.0.1:${M4D_API_PORT}/ returns 404, that is an OLD m4d-api — stop it, then rerun:"
    echo "    kill ${OLD_PIDS%% *}"
    echo "    Or run on another port: M4D_API_PORT=3032 $0"
    exit 1
  fi
fi
echo "m4d-api → http://${M4D_API_HOST}:${M4D_API_PORT}/ (hub) · /opt · /mission/  (data-dir: ${M4D_DATA_DIR})"
cd "$ROOT/m4d-api"
exec cargo run -- --host "${M4D_API_HOST}" --port "${M4D_API_PORT}" --data-dir "${M4D_DATA_DIR}"
