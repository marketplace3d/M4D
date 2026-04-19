# M4D Engine — Rust algo processor

Historic OHLCV → walk-forward algo votes → JSON for charts / **ALGO day** summaries → optional toy backtest.

## Build

```bash
cd m4d-engine
cargo build --release
```

## CSV format

Header (any order with these names, case-insensitive):

`time,open,high,low,close,volume`

- `time`: Unix seconds **or** milliseconds (detected if value > 1e12).
- `volume` optional (defaults to 0).

Polygon export / Binance-style dumps can be massaged into this shape.

## Commands

From **repo root** (workspace):

```bash
cargo run -p m4d-engine --release -- historic --csv m4d-engine/fixtures/sample_bars.csv --out-dir m4d-engine/out --symbol BTC --session-id dev_run
```

From **`m4d-engine/`**:

```bash
cargo run --release -- historic --csv fixtures/sample_bars.csv --out-dir ./out --symbol BTC \
  --session-id 2026-03-27_BTC
```

- Default session id if omitted: `UTC-YYYY-MM-DD_<symbol>`.

### SQLite `algo_votes` import

Requires DB created with `M4D_AlgoSystem_migration.sql` (so `algo_metadata` exists for FK).

```bash
cargo run -p m4d-engine --release -- sqlite-export --db /path/M4D_AlgoSystem.db --votes m4d-engine/out/votes.jsonl
```

Each JSONL row is stored with `session_id = `{original_session}:b{bar_index}` to satisfy `UNIQUE(session_id, algo_id)` per bar.

```bash
# votes only (no sqlite)
cargo run -p m4d-engine --release -- historic --csv fixtures/sample_bars.csv --out-dir ./out --symbol BTC --no-votes
```

Outputs in `--out-dir`:

| File | Purpose |
|------|--------|
| `votes.jsonl` | One JSON object per line: `session_id`, `bar_index`, `time`, `algo_id`, `vote`, `strength`, `payload` |
| `algo_day.json` | `session_id`, per-algo tallies + last-bar snapshot for Mission / SQLite seeds |
| `backtest.json` | Simple ensemble rule: toy equity curve + win rate (research only) |
| `bars.json` | Echo of input series for chart clients (optional debug) |

## Implemented algos (v0)

| ID | Logic |
|----|--------|
| `8E` | Close vs EMA(8); strength scaled by ATR |
| `CC` | 8/21/34 EMA bull/bear stack (+1 / -1 / 0) |
| `BQ` | TTM-style squeeze: BB inside KC; vote on **first expansion** bar after squeeze |
| *others* | Stub `vote: 0`, `payload.stubs: true` until ported |

`J` (Jedi) is a **meta** pass: +1 if `8E` and `CC` agree and non-zero, else 0 (placeholder until MTF data).

## Roadmap

- Load `council-algos.v1.json` IDs as SSOT.
- Polygon/Binance ingest binary; WSS realtime (separate service).
- Port NS/WH/RV from `indicators/boom3d-tech.ts` numerics.
- SQLite `algo_votes` INSERT exporter.
