#!/usr/bin/env bash
# go4w.sh — W4D WorldQuant Quant HedgeFund launcher
#
# Services:
#   Quant API  (FastAPI + uvicorn)  :4040
#   War Room   (Vite React)         :4400
#
# Usage:
#   ./go4w.sh           → all services
#   ./go4w.sh quant     → quant API only
#   ./go4w.sh site      → React site only
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
W4D="$ROOT/W4D"
CMD="${1:-all}"

QUANT_PORT=4040
SITE_PORT=4400

# ── Quant Python API ────────────────────────────────────────────────────────
run_quant() {
  local quant_dir="$W4D/quant"
  local venv="$quant_dir/.venv"

  if [[ ! -d "$venv" ]]; then
    echo "[go4w] Creating Python venv…"
    python3 -m venv "$venv"
  fi

  echo "[go4w] Installing quant dependencies…"
  bash -c "source '$venv/bin/activate' && pip install -q -r '$quant_dir/requirements.txt'"

  echo "[go4w] Quant API → http://127.0.0.1:${QUANT_PORT}/"
  cd "$quant_dir"
  set +eu
  # shellcheck disable=SC1091
  source "$venv/bin/activate"
  exec uvicorn server:app --host 127.0.0.1 --port "$QUANT_PORT" --reload
}

# ── React War Room site ─────────────────────────────────────────────────────
run_site() {
  local site_dir="$W4D/site"
  if [[ ! -d "$site_dir/node_modules" ]]; then
    echo "[go4w] npm install for W4D site…"
    (cd "$site_dir" && npm install)
  fi
  echo "[go4w] War Room → http://127.0.0.1:${SITE_PORT}/"
  cd "$site_dir"
  exec npm run dev
}

# ── All ─────────────────────────────────────────────────────────────────────
run_all() {
  PIDS=()
  kill_children() {
    local p
    for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  }
  trap kill_children EXIT INT TERM

  QDIR="$W4D/quant"
  QVENV="$QDIR/.venv"
  SDIR="$W4D/site"

  # Prepare venv once (synchronously, before backgrounding)
  if [[ ! -d "$QVENV" ]]; then
    echo "[go4w] Creating Python venv…"
    python3 -m venv "$QVENV"
  fi
  echo "[go4w] Installing quant deps…"
  bash -c "source '$QVENV/bin/activate' && pip install -q -r '$QDIR/requirements.txt'" || \
    echo "[go4w] pip install had warnings — continuing"

  # Prepare node_modules once
  if [[ ! -d "$SDIR/node_modules" ]]; then
    echo "[go4w] npm install…"
    (cd "$SDIR" && npm install)
  fi

  echo "[go4w] Starting Quant API :${QUANT_PORT}…"
  bash -c "
    set +eu
    source '$QVENV/bin/activate'
    cd '$QDIR'
    exec uvicorn server:app --host 127.0.0.1 --port $QUANT_PORT
  " &
  PIDS+=($!)

  echo "[go4w] Starting War Room :${SITE_PORT}…"
  bash -c "
    cd '$SDIR'
    exec npm run dev
  " &
  PIDS+=($!)

  sleep 4
  echo ""
  echo "── W4D WorldQuant War Room ────────────────────────────────────"
  echo "  War Room (React)   http://127.0.0.1:${SITE_PORT}/"
  echo "  Quant API          http://127.0.0.1:${QUANT_PORT}/"
  echo "  API docs           http://127.0.0.1:${QUANT_PORT}/docs"
  echo "  Health             http://127.0.0.1:${QUANT_PORT}/health"
  echo ""
  echo "  Pages:  / War Room  /signals  /backtest  /attribution  /live"
  echo "  First run triggers backtest (~10-30s). Live data: /live page."
  echo "───────────────────────────────────────────────────────────────"
  wait
}

case "$CMD" in
all)       run_all ;;
quant|api) run_quant ;;
site|react)run_site ;;
*)
  echo "Usage: ./go4w.sh [all|quant|site]" >&2
  exit 1
  ;;
esac
