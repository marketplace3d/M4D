use axum::{extract::State, Json};
use std::sync::Arc;

use crate::models::AlgoDaySnapshot;
use crate::state::AppState;

pub async fn handler(State(state): State<Arc<AppState>>) -> Json<AlgoDaySnapshot> {
    let snap = state.algo_day.read().await.clone();
    Json(snap)
}
