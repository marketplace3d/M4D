use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct AlgoVoteRow {
    /// Matches `algo_votes.session_id` / `algo_day.session_id`.
    pub session_id: String,
    pub bar_index: usize,
    pub time: i64,
    pub algo_id: String,
    /// -1 short, 0 flat, +1 long (SQLite convention).
    pub vote: i8,
    pub strength: f64,
    pub payload: serde_json::Value,
}
