#!/usr/bin/env bash
# Periodic IBKR algo cycle via HTTP (DS must be up). TWS stays independent.
# Run in tmux/screen so closing the terminal does not stop the loop.
#
#   IBKR_LOOP_SEC=300 IBKR_ASSET=FUTURES ./ibkr_loop.sh
#   IBKR_URL=http://127.0.0.1:8000 IBKR_MODE=PADAWAN IBKR_ASSET=FOREX IBKR_DRY=1 ./ibkr_loop.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
URL="${IBKR_URL:-http://127.0.0.1:8000}"
MODE="${IBKR_MODE:-PADAWAN}"
ASSET="${IBKR_ASSET:-FUTURES}"
DRY="${IBKR_DRY:-0}"
SEC="${IBKR_LOOP_SEC:-300}"
echo "[ibkr_loop] every ${SEC}s → POST ${URL}/v1/ibkr/run/?mode=${MODE}&asset=${ASSET}&dry=${DRY}"
while true; do
  curl -sS -X POST "${URL}/v1/ibkr/run/?mode=${MODE}&asset=${ASSET}&dry=${DRY}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ts','?'), 'entries',len(d.get('entries',[])), 'skips',len(d.get('skips',[])), 'errors',d.get('errors',[]))" 2>/dev/null || echo "[ibkr_loop] curl failed — is DS running?"
  sleep "$SEC"
done
