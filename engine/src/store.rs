use rusqlite::{Connection, Result, params};

/// Open (or create) the SQLite database and ensure all required tables exist.
pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;

    conn.execute_batch("
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS algo_scores (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol      TEXT NOT NULL,
            bar_time    INTEGER NOT NULL,
            open_price  REAL NOT NULL,
            close_price REAL NOT NULL,
            jedi_score  REAL NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            UNIQUE(symbol, bar_time)
        );

        CREATE TABLE IF NOT EXISTS algo_votes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol      TEXT NOT NULL,
            bar_index   INTEGER NOT NULL,
            bar_time    INTEGER NOT NULL,
            algo_id     TEXT NOT NULL,
            vote        INTEGER NOT NULL,
            strength    REAL NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_algo_scores_sym_time
            ON algo_scores (symbol, bar_time);

        CREATE INDEX IF NOT EXISTS idx_algo_votes_algo_id
            ON algo_votes (algo_id, bar_time);
    ")?;

    Ok(conn)
}

/// Upsert the JEDI composite score for a single bar.
pub fn upsert_algo_score(
    conn: &Connection,
    symbol: &str,
    bar_time: i64,
    open_price: f64,
    close_price: f64,
    jedi_score: f64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO algo_scores (symbol, bar_time, open_price, close_price, jedi_score)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(symbol, bar_time) DO UPDATE SET
             open_price  = excluded.open_price,
             close_price = excluded.close_price,
             jedi_score  = excluded.jedi_score,
             created_at  = strftime('%s', 'now')",
        params![symbol, bar_time, open_price, close_price, jedi_score],
    )?;
    Ok(())
}

/// Insert per-algo vote records for a bar (overwrite on rerun).
pub fn insert_algo_votes(
    conn: &Connection,
    symbol: &str,
    bar_index: usize,
    bar_time: i64,
    votes: &[(&'static str, i8, f64)],
) -> Result<()> {
    // Remove stale records for this bar before inserting fresh ones.
    conn.execute(
        "DELETE FROM algo_votes WHERE symbol = ?1 AND bar_time = ?2",
        params![symbol, bar_time],
    )?;

    let mut stmt = conn.prepare_cached(
        "INSERT INTO algo_votes (symbol, bar_index, bar_time, algo_id, vote, strength)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;

    for (algo_id, vote, strength) in votes {
        stmt.execute(params![
            symbol,
            bar_index as i64,
            bar_time,
            algo_id,
            *vote as i64,
            strength
        ])?;
    }
    Ok(())
}
