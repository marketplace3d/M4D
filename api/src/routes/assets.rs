use axum::{extract::State, Json};
use std::sync::Arc;

use crate::models::AssetSummary;
use crate::state::AppState;

pub async fn handler(State(state): State<Arc<AppState>>) -> Json<Vec<AssetSummary>> {
    let snap = state.algo_day.read().await;
    let summaries: Vec<AssetSummary> = snap
        .assets
        .iter()
        .map(|a| AssetSummary {
            symbol: a.symbol.clone(),
            price: a.price,
            change_pct: a.change_pct,
            // volume is not tracked in AssetAlgoDay; API serves 0 until engine populates it.
            volume: 0.0,
            jedi_score: a.jedi_score,
        })
        .collect();
    Json(summaries)
}
