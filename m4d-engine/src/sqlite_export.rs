//! Import `votes.jsonl` into `algo_votes`. Uses `session_id` = `{run_session}:b{bar_index}` so each bar fits `UNIQUE(session_id, algo_id)`.
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use rusqlite::{params, Connection};

use crate::bank::bank_for_algo;
use crate::error::EngineError;

/// Returns number of rows written.
pub fn import_votes_jsonl(db_path: &Path, votes_path: &Path) -> Result<usize, EngineError> {
    let conn = Connection::open(db_path)?;
    conn.execute("PRAGMA foreign_keys = ON", [])?;

    let file = File::open(votes_path)?;
    let reader = BufReader::new(file);
    let mut wrote = 0usize;

    let mut stmt = conn
        .prepare(
            "INSERT OR REPLACE INTO algo_votes (session_id, algo_id, bank, vote, strength, regime_state, payload_json, ts_utc, is_valid)
             VALUES (?1, ?2, ?3, ?4, ?5, 'LOW_VOL', ?6, datetime(?7, 'unixepoch'), 1)",
        )
        .map_err(|e| EngineError::Msg(format!("sqlite prepare: {e}")))?;

    for line in reader.lines() {
        let line = line.map_err(|e| EngineError::Msg(e.to_string()))?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value =
            serde_json::from_str(line).map_err(|e| EngineError::Msg(format!("jsonl: {e}")))?;

        let session = v["session_id"]
            .as_str()
            .ok_or_else(|| EngineError::Msg("missing session_id".into()))?;
        let bar = v["bar_index"]
            .as_u64()
            .ok_or_else(|| EngineError::Msg("missing bar_index".into()))?;
        let algo_id = v["algo_id"]
            .as_str()
            .ok_or_else(|| EngineError::Msg("missing algo_id".into()))?;
        let vote = v["vote"]
            .as_i64()
            .ok_or_else(|| EngineError::Msg("missing vote".into()))? as i32;
        let strength = v["strength"]
            .as_f64()
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        let time = v["time"]
            .as_i64()
            .ok_or_else(|| EngineError::Msg("missing time".into()))?;
        let payload = v
            .get("payload")
            .cloned()
            .unwrap_or(serde_json::Value::Null);

        let sid = format!("{session}:b{bar}");
        let bank = bank_for_algo(algo_id);
        let payload_json =
            serde_json::to_string(&payload).map_err(|e| EngineError::Msg(e.to_string()))?;

        match stmt.execute(params![sid, algo_id, bank, vote, strength, payload_json, time]) {
            Ok(_) => wrote += 1,
            Err(e) => {
                return Err(EngineError::Msg(format!(
                    "insert {algo_id} bar {bar}: {e} — ensure algo_metadata exists in DB"
                )));
            }
        }
    }

    Ok(wrote)
}
