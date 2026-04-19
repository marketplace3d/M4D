#!/usr/bin/env bash
# M6D frontend launcher (standalone).
#
# Keeps goa.sh orchestration untouched.
#
# Usage:
#   ./go6d.sh            -> run M6D dev server on :5560 and open browser
#   ./go6d.sh dev        -> same as default
#   ./go6d.sh server     -> run dev server on :5560 (no auto-open)
#   ./go6d.sh build      -> production build only
#   ./go6d.sh preview    -> preview built app on :5560
#   ./go6d.sh install    -> install dependencies only
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
M6D_DIR="$ROOT/M6D"
PORT="${M6D_PORT:-5560}"
CMD="${1:-dev}"

if [[ ! -d "$M6D_DIR" ]]; then
  echo "[go6d] Missing $M6D_DIR" >&2
  exit 1
fi

ensure_node_modules() {
  if [[ ! -d "$M6D_DIR/node_modules" ]]; then
    echo "[go6d] Installing dependencies..."
    (cd "$M6D_DIR" && npm install)
  fi
}

case "$CMD" in
  install)
    (cd "$M6D_DIR" && npm install)
    ;;

  build)
    ensure_node_modules
    echo "[go6d] Building M6D..."
    (cd "$M6D_DIR" && npm run build)
    ;;

  preview)
    ensure_node_modules
    echo "[go6d] Preview M6D -> http://127.0.0.1:${PORT}/"
    exec bash -lc "cd \"$M6D_DIR\" && npm run preview -- --host 127.0.0.1 --port \"$PORT\""
    ;;

  server)
    ensure_node_modules
    echo "[go6d] M6D dev -> http://127.0.0.1:${PORT}/"
    exec bash -lc "cd \"$M6D_DIR\" && npm run dev -- --host 127.0.0.1 --port \"$PORT\""
    ;;

  dev|"")
    ensure_node_modules
    echo "[go6d] M6D dev -> http://127.0.0.1:${PORT}/"
    if command -v open >/dev/null 2>&1; then
      (sleep 2; open "http://127.0.0.1:${PORT}/" 2>/dev/null || true) &
    fi
    exec bash -lc "cd \"$M6D_DIR\" && npm run dev -- --host 127.0.0.1 --port \"$PORT\""
    ;;

  help|-h|--help)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    ;;

  *)
    echo "[go6d] Unknown command: $CMD" >&2
    echo "Use: dev | server | build | preview | install | help" >&2
    exit 1
    ;;
esac
