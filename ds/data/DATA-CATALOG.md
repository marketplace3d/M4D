# DATA CATALOG — ds/data/
*Last updated: 2026-04-19*

---

## futures.db — CME Futures (Databento GLBX.MDP3)

**Source:** Databento pay-per-use · Key: `DATABENTO_API_KEY` in `.env.local`
**Cost:** ~$10 for 5 symbols × 2yr · ~$12 extra per symbol for 10yr
**Script:** `ds_app/databento_fetch.py`
**Refresh:** `python -m ds_app.databento_fetch --sym ES --years 2`

| Symbol | Contract | Name | Bars (1m) | History |
|--------|----------|------|-----------|---------|
| ES | ES.c.0 | S&P 500 E-mini | ~3.5M | 2016–2026 (10yr) |
| NQ | NQ.c.0 | Nasdaq 100 E-mini | ~3.5M | 2016–2026 (10yr) |
| GC | GC.c.0 | Gold E-mini | ~25k | 2024–2026 (2yr) |
| CL | CL.c.0 | Crude Oil WTI | ~650k | 2024–2026 (2yr) |
| RTY | RTY.c.0 | Russell 2000 E-mini | ~665k | 2024–2026 (2yr) |

| GC | GC.c.0 | Gold | ~25k | 2024–2026 (2yr) |
| SI | SI.c.0 | Silver | ~14k | 2024–2026 (2yr) |
| ZN | ZN.c.0 | 10yr T-Note (Bonds) | ~518k | 2024–2026 (2yr) |
| ZB | ZB.c.0 | 30yr T-Bond | ~462k | 2024–2026 (2yr) |

**Schema:** `bars_1m(symbol, ts, open, high, low, close, volume)` — ts = unix seconds UTC

**Trading:** IBKR micro-contracts (MES/MNQ/M2K/MGC/MCL) via `ibkr_paper.py` with `IBKR_ASSET=FUTURES`

---

## equities.db — US Stocks + ETFs + Forex (yfinance)

**Source:** yfinance (free, Yahoo Finance) · No API key needed
**Script:** `ds_app/equity_bars.py` (to build)
**Limit:** 5m bars = last 60 days only · 1d bars = up to 10yr
**Refresh:** re-run script weekly for fresh 5m

### bars_5m — Intraday (60-day window, for live signals)

| Category | Symbols |
|----------|---------|
| Mega-cap | AAPL MSFT NVDA AMZN GOOGL META TSLA JPM V |
| High-beta movers | AMD SMCI ARM PLTR MSTR COIN SOFI RBLX |
| ETFs | SPY QQQ IWM GLD TLT XLK XLE ARKK |
| Forex | EURUSD GBP |

~4,680 bars per US equity (60 days × 78 bars/day)
~17,000 bars for EURUSD/GBP (24hr forex)

### bars_1d — Daily (5yr history, for backtesting + signal validation)

Same universe · ~1,256 bars per symbol (5yr × 252 trading days)

**Schema:** `bars_5m(symbol, ts, open, high, low, close, volume)` — ts = unix seconds UTC
Same schema for `bars_1d`

**Trading:** Alpaca paper (stocks) via `alpaca_paper.py` with `PAPER_SYMBOLS=TSLA,NVDA,...`

---

## futures.db — Crypto (Binance via existing fetcher)

**Source:** Binance public API (free)
**Symbols (20):** ADA ARB ATOM AVAX BNB BTC DOGE DOT ETH FIL INJ LINK LTC MATIC OP SOL SUI TIA UNI XRP
**Tables:** `bars_1m`, `bars_5m`

---

## CREDIT STATUS — Databento

- **Balance:** $0.00 due
- **Remaining credits:** ~$104.07 (as of 2026-04-19)
- **Spent this session:** ~$34 (ES 10yr + NQ 10yr + GC/CL/RTY/SI/ZN/ZB 2yr)
- **Recommendation:** Pull NQ/CL/RTY 10yr when needed for deeper backtests (~$30 total)

---

## WHAT TO PULL NEXT

Priority order by trading value:
1. **NQ 10yr** — Nasdaq 1m bars 2016–2024 · ~$10 · `python -m ds_app.databento_fetch --sym NQ --years 10`
2. **ZN 2yr** — 10yr T-Note (bonds regime signal) · $1.89 · `--sym ZN`
3. **CL/RTY 10yr** — extend crude + Russell · ~$10 each
4. **Stocks intraday** — yfinance 5m auto-refreshes daily (free, always current)

---

*"The machine hunts. The data makes it possible." — DATA-CATALOG*
