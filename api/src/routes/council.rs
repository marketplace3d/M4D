use axum::{extract::State, Json};
use std::sync::Arc;

use crate::models::CouncilSnapshot;
use crate::state::AppState;

pub async fn handler(State(state): State<Arc<AppState>>) -> Json<CouncilSnapshot> {
    let snap = state.council.read().await.clone();
    Json(snap)
}
