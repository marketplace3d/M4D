//! Paper CryptoBot snapshot — persisted in SQLite (`engine/data/cryptobot.db`).
use std::path::Path;
use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CryptoBotTradeRow {
    pub id: String,
    pub time: i64,
    pub side: String,
    pub price: f64,
    pub qty: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CryptoBotSnapshot {
    pub version: u32,
    pub pair: String,
    pub iv: String,
    pub strat: String,
    pub cash: f64,
    pub pos: f64,
    pub entry: Option<f64>,
    pub trades: Vec<CryptoBotTradeRow>,
    pub rsi_lo: f64,
    pub rsi_hi: f64,
    pub sl_pct: f64,
    pub tp_pct: f64,
    pub trade_usd: f64,
    pub running: bool,
    pub live: bool,
}

fn default_snapshot() -> CryptoBotSnapshot {
    CryptoBotSnapshot {
        version: 1,
        pair: "BTCUSDT".into(),
        iv: "5m".into(),
        strat: "rsi".into(),
        cash: 10_000.0,
        pos: 0.0,
        entry: None,
        trades: vec![],
        rsi_lo: 32.0,
        rsi_hi: 68.0,
        sl_pct: 1.5,
        tp_pct: 2.5,
        trade_usd: 500.0,
        running: false,
        live: true,
    }
}

fn open_conn(path: &Path) -> Result<Connection, rusqlite::Error> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    Connection::open(path)
}

fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS cryptobot_account (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          pair TEXT NOT NULL DEFAULT 'BTCUSDT',
          iv TEXT NOT NULL DEFAULT '5m',
          strat TEXT NOT NULL DEFAULT 'rsi',
          cash REAL NOT NULL DEFAULT 10000,
          pos REAL NOT NULL DEFAULT 0,
          entry REAL,
          rsi_lo REAL NOT NULL DEFAULT 32,
          rsi_hi REAL NOT NULL DEFAULT 68,
          sl_pct REAL NOT NULL DEFAULT 1.5,
          tp_pct REAL NOT NULL DEFAULT 2.5,
          trade_usd REAL NOT NULL DEFAULT 500,
          running INTEGER NOT NULL DEFAULT 0,
          live INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS cryptobot_trades (
          id TEXT PRIMARY KEY NOT NULL,
          time_ms INTEGER NOT NULL,
          side TEXT NOT NULL,
          price REAL NOT NULL,
          qty REAL NOT NULL,
          note TEXT
        );
    "#,
    )?;
    Ok(())
}

pub async fn get_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<CryptoBotSnapshot>, (StatusCode, String)> {
    let path = Path::new(&state.cryptobot_db_path);
    let conn = open_conn(path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    migrate(&conn).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let row = conn.query_row(
        "SELECT pair, iv, strat, cash, pos, entry, rsi_lo, rsi_hi, sl_pct, tp_pct, trade_usd, running, live \
         FROM cryptobot_account WHERE id = 1",
        [],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, f64>(3)?,
                r.get::<_, f64>(4)?,
                r.get::<_, Option<f64>>(5)?,
                r.get::<_, f64>(6)?,
                r.get::<_, f64>(7)?,
                r.get::<_, f64>(8)?,
                r.get::<_, f64>(9)?,
                r.get::<_, f64>(10)?,
                r.get::<_, i64>(11)? != 0,
                r.get::<_, i64>(12)? != 0,
            ))
        },
    );

    let (pair, iv, strat, cash, pos, entry, rsi_lo, rsi_hi, sl_pct, tp_pct, trade_usd, running, live) =
        match row {
            Ok(x) => x,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(Json(default_snapshot())),
            Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        };

    let mut stmt = conn
        .prepare(
            "SELECT id, time_ms, side, price, qty, note FROM cryptobot_trades ORDER BY time_ms DESC LIMIT 500",
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let trades: Vec<CryptoBotTradeRow> = stmt
        .query_map([], |r| {
            Ok(CryptoBotTradeRow {
                id: r.get(0)?,
                time: r.get::<_, i64>(1)?,
                side: r.get(2)?,
                price: r.get(3)?,
                qty: r.get(4)?,
                note: r.get(5)?,
            })
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(CryptoBotSnapshot {
        version: 1,
        pair,
        iv,
        strat,
        cash,
        pos,
        entry,
        trades,
        rsi_lo,
        rsi_hi,
        sl_pct,
        tp_pct,
        trade_usd,
        running,
        live,
    }))
}

pub async fn put_handler(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CryptoBotSnapshot>,
) -> Result<StatusCode, (StatusCode, String)> {
    if body.version != 1 {
        return Err((StatusCode::BAD_REQUEST, "version must be 1".into()));
    }

    let path = Path::new(&state.cryptobot_db_path);
    let mut conn = open_conn(path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    migrate(&conn).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let trades_trunc: Vec<&CryptoBotTradeRow> = body.trades.iter().take(200).collect();

    let ts = chrono::Utc::now().timestamp_millis();
    let tx = conn
        .transaction()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tx.execute(
        "INSERT INTO cryptobot_account (id, pair, iv, strat, cash, pos, entry, rsi_lo, rsi_hi, sl_pct, tp_pct, trade_usd, running, live, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(id) DO UPDATE SET
           pair=excluded.pair, iv=excluded.iv, strat=excluded.strat, cash=excluded.cash, pos=excluded.pos,
           entry=excluded.entry, rsi_lo=excluded.rsi_lo, rsi_hi=excluded.rsi_hi, sl_pct=excluded.sl_pct,
           tp_pct=excluded.tp_pct, trade_usd=excluded.trade_usd, running=excluded.running, live=excluded.live, updated_at=excluded.updated_at",
        params![
            body.pair,
            body.iv,
            body.strat,
            body.cash,
            body.pos,
            body.entry,
            body.rsi_lo,
            body.rsi_hi,
            body.sl_pct,
            body.tp_pct,
            body.trade_usd,
            body.running as i64,
            body.live as i64,
            ts,
        ],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.execute("DELETE FROM cryptobot_trades", [])
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    for t in trades_trunc {
        tx.execute(
            "INSERT INTO cryptobot_trades (id, time_ms, side, price, qty, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![t.id, t.time, t.side, t.price, t.qty, t.note],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    tx.commit()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
