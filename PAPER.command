#!/usr/bin/env bash
# ── PAPER TRADING LAUNCHER ─────────────────────────────────────────────────────
# Double-click this file in Finder → opens Terminal → starts DS + tests TWS
# ──────────────────────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "$0")" && pwd)"
DS="$ROOT/ds"

G=$'\033[0;32m'; R=$'\033[0;31m'; Y=$'\033[0;33m'; C=$'\033[0;36m'; NC=$'\033[0m'

clear
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${Y}M4D PAPER TRADING${NC}  — PADAWAN · MES · MNQ"
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Kill any existing DS on :8000
existing=$(lsof -tiTCP:8000 -sTCP:LISTEN 2>/dev/null || true)
[ -n "$existing" ] && { echo -e "  ${Y}Freeing :8000...${NC}"; kill $existing 2>/dev/null; sleep 0.5; }

# Start DS
echo -e "  ${C}Starting DS server on :8000...${NC}"
cd "$DS"
.venv/bin/python manage.py migrate --noinput -v 0 2>/dev/null || true
.venv/bin/python manage.py runserver 127.0.0.1:8000 &>/tmp/m4d_ds.log &
DS_PID=$!

# Wait for health
echo -n "  Waiting for DS"
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "http://127.0.0.1:8000/health/" 2>/dev/null || echo "000")
  [[ "$code" =~ ^[23] ]] && break
  echo -n "."
  sleep 1
done
echo ""

# Test TWS
echo ""
echo -e "  ${C}Testing TWS connection...${NC}"
result=$(curl -s http://localhost:8000/v1/ibkr/test/ 2>/dev/null)
if echo "$result" | grep -q '"connected": true'; then
  acct=$(echo "$result" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["accounts"][0])' 2>/dev/null)
  eq=$(echo "$result" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"{d[\"equity\"]:,.0f} {d[\"currency\"]}")' 2>/dev/null)
  echo -e "  ${G}✓ TWS CONNECTED${NC}  account=$acct  equity=$eq"
else
  echo -e "  ${R}✗ TWS NOT CONNECTED${NC}"
  echo -e "  → Open TWS → Paper Trading → API → port 7497 → trusted 127.0.0.1"
fi

echo ""
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${Y}COMMANDS${NC}"
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${C}DRY RUN${NC}  (no orders):"
echo -e "  curl -X POST 'http://localhost:8000/v1/ibkr/run/?mode=PADAWAN&asset=FUTURES&dry=1'"
echo ""
echo -e "  ${G}LIVE RUN${NC}  (places orders):"
echo -e "  curl -X POST 'http://localhost:8000/v1/ibkr/run/?mode=PADAWAN&asset=FUTURES'"
echo ""
echo -e "  ${C}STATUS:${NC}  curl http://localhost:8000/v1/ibkr/status/"
echo -e "  ${C}HUNT:${NC}    cd $ROOT && ./daily_hunt.sh --quick"
echo ""
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  DS log: /tmp/m4d_ds.log   PID: $DS_PID"
echo -e "  Press Ctrl+C to stop server"
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

wait $DS_PID
