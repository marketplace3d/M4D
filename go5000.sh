#!/usr/bin/env bash
# go5000.sh — Russell 3000 / 5000 expansion engine [NOT YET BUILT]
# Future: stock tick data feed (Polygon paid), expanded asset_list, regime-conditional weights
#
# Prerequisites before enabling:
#   1. Polygon paid plan (real-time US equities)
#   2. engine/src/fetcher.rs — add fetch_stock_1m() via Polygon WebSocket
#   3. engine/src/algos/mod.rs — add equity-specific algos (ORB, SEPA, composites)
#   4. Regime-conditional weight matrix baked into council-algos.v1.json
#   5. TradeI live table page in M4D ready to consume 3000+ asset feed
set -euo pipefail
Y=$'\033[0;33m'; NC=$'\033[0m'
echo -e "${Y}[go5000] NOT YET BUILT — see prerequisites in this script.${NC}"
echo ""
echo "  Current: go500.sh  → 500 crypto assets · Binance public · 1m loop · live"
echo "  Future:  go5000.sh → Russell 3000 · Polygon paid · regime-conditional weights"
echo ""
echo "  Run ./go500.sh for the live engine."
exit 1
