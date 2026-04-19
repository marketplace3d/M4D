#!/usr/bin/env bash
# go6d.sh — M4D combined interface (M6D shell) on :5650
# Runs ONLY the Vite dev server — backends (api :3330, DS :8050, etc.)
# are started by goa.sh as usual.
#
# Usage:
#   ./go6d.sh          → start M6D dev server :5650, open browser when ready
#   ./go6d.sh server   → start only, no browser open
#   ./go6d.sh build    → production build → M6D/dist/
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
M6D="$ROOT/M6D"
CMD="${1:-}"

R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; C=$'\033[0;36m'; B=$'\033[0;34m'; NC=$'\033[0m'

if [[ "$CMD" == "build" ]]; then
  echo -e "${G}Building M6D → $M6D/dist/ ...${NC}"
  (cd "$M6D" && npm run build)
  echo -e "${G}Done.${NC}"
  exit 0
fi

[ ! -d "$M6D/node_modules" ] && { echo -e "${Y}Installing M6D deps...${NC}"; (cd "$M6D" && npm install --silent); }

echo ""
echo -e "  ${B}M4D Interface (M6D shell)${NC}  http://127.0.0.1:5650/"
echo -e "  Backends: run ${Y}./goa.sh${NC} in another terminal for full stack"
echo ""

if [[ "$CMD" != "server" ]]; then
  # Open browser when ready
  (
    for i in $(seq 1 60); do
      code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "http://127.0.0.1:5650/" 2>/dev/null || echo "000")
      [[ "$code" =~ ^[23] ]] && { open "http://127.0.0.1:5650/" 2>/dev/null || true; exit 0; }
      sleep 1
    done
  ) &
fi

(cd "$M6D" && npm run dev)
