#!/usr/bin/env bash
# M1D stack launcher (repo root).
#
# Single entry point: use ./go.sh only. gou.sh / god.sh exist for go.sh to exec — do not run them directly.
#
# Dev ports keep the same leading digit as the canonical port (never change the first digit):
#   Django 8000→8050 · MISSION 5174→5550 · m4d-api 3030→3330 · M3D site :5500 · PWA :5555 · algo-exec 9044→9050
#
#   ./go.sh | ./go.sh all     → full stack: m4d-api :3330 + Django :8050 + crypto_worker + PWA :5555 + MISSION :5550
#   ./go.sh mission           → React MISSION only (:5550, --open)
#   ./go.sh mission server    → MISSION dev only
#   ./go.sh pwa               → Svelte PWA only (:5555, --open)
#   ./go.sh pwa server        → PWA dev, no open
#   ./go.sh api               → Axum m4d-api only (:3330)
#   ./go.sh django            → m4d-ds only (:8050) — rarely needed; prefer ./go.sh all
#   ./go.sh crypto            → crypto_worker only — rarely needed; prefer ./go.sh all
#
# React UI source: M1D/src/   (Vite app; MaxCogViz bundles in src/viz/)
# Build / clean: ./gob.sh   (Rust + MISSION + PWA)  ·  ./gob.sh clean  ·  ./gob.sh embed
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
CMD="${1:-all}"

show_help() {
  awk 'NR==1{next} /^set -euo pipefail$/{exit} {sub(/^# ?/,""); print}' "$0"
}

if [[ "$CMD" == "help" || "$CMD" == "-h" || "$CMD" == "--help" ]]; then
  show_help
  exit 0
fi

run_mission_only() {
  cd "$ROOT/M1D"
  echo "  (Crypto Lab / BOOM need Django :8050 — run ./go.sh all for full stack)"
  if [[ "${1:-}" == "server" ]]; then
    exec npm run dev
  fi
  echo "MISSION (React) → http://127.0.0.1:5550/  ·  not :8880 — sources: M1D/src/"
  echo "  Routes use #hash — Crypto Lab: http://127.0.0.1:5550/#crypto"
  exec npm run dev:open
}

run_pwa_only() {
  cd "$ROOT/pwa"
  if [[ "${1:-}" == "server" ]]; then
    exec npm run dev
  fi
  echo "PWA (Svelte) → http://127.0.0.1:5555/"
  exec npm run dev -- --open
}

run_api_only() {
  exec "$ROOT/gou.sh"
}

run_django_only() {
  exec "$ROOT/god.sh"
}

run_crypto_only() {
  cd "$ROOT/m4d-ds"
  if [[ ! -d .venv ]]; then
    python3 -m venv .venv
  fi
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install -q websockets 2>/dev/null || true
  echo "crypto_worker → accumulates Binance 1m bars, runs council signals, sim trades"
  exec python crypto_worker.py
}

run_all() {
  # Do not use errexit here: pip/migrate/wait failures must not tear down the whole stack.
  set +e
  PIDS=()
  kill_children() {
    local p
    for p in "${PIDS[@]:-}"; do
      kill "$p" 2>/dev/null || true
    done
  }
  trap kill_children EXIT INT TERM

  SKIP_API=0
  if command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP:3330 -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "[go.sh all] Port 3330 already in use — skipping m4d-api spawn (using existing listener)."
      echo "  To replace it: kill \$(lsof -tiTCP:3330 -sTCP:LISTEN) then rerun ./go.sh"
      SKIP_API=1
    fi
  fi

  prepare_ds() {
    cd "$ROOT/m4d-ds" || {
      echo "[go.sh all] Cannot cd to m4d-ds — Django not started." >&2
      return 1
    }
    if [[ ! -d .venv ]]; then
      python3 -m venv .venv || {
        echo "[go.sh all] python3 -m venv failed — check Python." >&2
        return 1
      }
    fi
    # shellcheck disable=SC1091
    source .venv/bin/activate || {
      echo "[go.sh all] Could not activate .venv" >&2
      return 1
    }
    pip install -q -r requirements.txt || echo "[go.sh all] pip install had errors — continuing (Django may still run)." >&2
    pip install -q websockets 2>/dev/null || true
    python manage.py migrate --noinput || echo "[go.sh all] migrate had errors — continuing; fix DB if Django fails." >&2
    return 0
  }

  if [[ "$SKIP_API" -eq 0 ]]; then
    echo "Starting m4d-api :3330 … (Binance crypto WS — no auth needed)"
    (
      cd "$ROOT/m4d-api"
      export M4D_DATA_DIR="${M4D_DATA_DIR:-$ROOT/m4d-engine/out}"
      exec cargo run -- --host 127.0.0.1 --port 3330 --data-dir "${M4D_DATA_DIR}"
    ) &
    PIDS+=($!)
  fi

  echo "Starting m4d-ds :8050 …"
  prepare_ds || echo "[go.sh all] prepare_ds incomplete — check m4d-ds/.venv and requirements." >&2
  (
    cd "$ROOT/m4d-ds"
    # shellcheck disable=SC1091
    source .venv/bin/activate
    exec python manage.py runserver 127.0.0.1:8050
  ) &
  PIDS+=($!)

  echo "Starting crypto_worker … (council scanner + sim trader — data ready in ~60 bars)"
  (
    cd "$ROOT/m4d-ds"
    # shellcheck disable=SC1091
    source .venv/bin/activate
    # Give m4d-api 8s to connect to Binance before worker subscribes
    sleep 8
    exec python crypto_worker.py
  ) &
  PIDS+=($!)

  echo "Starting MISSION :5550 …"
  (cd "$ROOT/M1D" && exec npm run dev) &
  PIDS+=($!)

  sleep 2
  echo ""
  echo "── ./go.sh all ──────────────────────────────────────────────────"
  echo "  MISSION (React)       http://127.0.0.1:5550/  ← not :8880 / :5174"
  echo "  React (edit here)     http://127.0.0.1:5550/#crypto   ← CRYPTO LAB"
  echo "  m4d-api               http://127.0.0.1:3330/          ← Binance bars"
  echo "  Django m4d-ds         http://127.0.0.1:8050/"
  echo "  crypto/live API       http://127.0.0.1:8050/crypto/live/"
  echo "  crypto_worker         accumulating bars — signals live in ~60 min"
  echo "  MISSION embed         build/mission/ → /mission/ on :3330 and :8050"
  echo "─────────────────────────────────────────────────────────────────"
  # One crashed child must not exit the supervisor (bash wait can return non-zero).
  wait || true
  set -e
}

case "$CMD" in
all)
  run_all
  ;;
pwa)
  case "${1:-}" in pwa) shift ;; esac
  run_pwa_only "$@"
  ;;
mission|m|react)
  case "${1:-}" in mission|m|react) shift ;; esac
  run_mission_only "$@"
  ;;
api|axum|rust)
  run_api_only
  ;;
django|ds|god)
  run_django_only
  ;;
crypto)
  run_crypto_only
  ;;
*)
  echo "Unknown: $CMD" >&2
  show_help >&2
  exit 1
  ;;
esac
