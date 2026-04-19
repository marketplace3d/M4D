use axum::{extract::State, Json};
use std::sync::Arc;

use crate::state::AppState;
use crate::scanner::ScannerState;

/// GET /v1/scanner — returns latest scan results
pub async fn handler(
    State(state): State<Arc<AppState>>,
) -> Json<ScannerState> {
    let snap = state.scanner.read().await;
    Json(snap.clone())
}
