mod models;
mod routes;
mod scanner;
mod state;
mod ws;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use state::AppState;

/// Path to the algo_day.json written by the engine, relative to the workspace root.
/// The API binary lives at `api/`, so `../engine/data/algo_day.json` resolves correctly
/// when run from the workspace root via `cargo run -p api`.
const ALGO_DAY_JSON: &str = "../engine/data/algo_day.json";
const DB_PATH: &str = "../engine/data/algo_state.db";
const CRYPTOBOT_DB_PATH: &str = "../engine/data/cryptobot.db";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "api=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let json_path = PathBuf::from(ALGO_DAY_JSON);

    // Ensure engine/data/ and a starter algo_day.json exist so the frontend
    // has something to display before the engine first runs.
    ensure_engine_data(&json_path).await;

    let state = Arc::new(AppState::new(DB_PATH, CRYPTOBOT_DB_PATH));

    // Initial load from disk.
    state::reload_from_disk(&state, &json_path).await;

    // Background poller: reload algo_day.json every 30 seconds.
    {
        let state2 = state.clone();
        let path2 = json_path.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                state::reload_from_disk(&state2, &path2).await;
            }
        });
    }

    // Background scanner: poll Binance 1m klines every 60s.
    {
        let scanner_state = state.scanner.clone();
        let scanner_tx    = state.scanner_tx.clone();
        tokio::spawn(async move {
            scanner::run_scanner(scanner_state, scanner_tx).await;
        });
    }

    // Static files: serve site/dist/ at / if it exists.
    let static_dir = PathBuf::from("../site/dist");
    let index_html = static_dir.join("index.html");

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api_router = Router::new()
        .route("/health", get(routes::health::handler))
        .route("/v1/council", get(routes::council::handler))
        .route("/v1/algo-day", get(routes::algo_day::handler))
        .route("/v1/assets", get(routes::assets::handler))
        .route("/v1/backtest", get(routes::backtest::handler))
        .route("/v1/votes", get(votes_handler))
        .route("/v1/reload", post(reload_handler))
        .route("/v1/scanner", get(routes::scanner::handler))
        .route(
            "/v1/cryptobot",
            get(routes::cryptobot::get_handler).put(routes::cryptobot::put_handler),
        )
        .route("/ws/algo", get(ws::algo::handler))
        .route("/ws/scanner", get(ws::scanner::handler))
        .with_state(state.clone());

    let app = if static_dir.is_dir() {
        tracing::info!("Serving static files from {}", static_dir.display());
        let serve = ServeDir::new(&static_dir)
            .not_found_service(ServeFile::new(&index_html));
        Router::new()
            .nest_service("/", serve)
            .merge(api_router)
    } else {
        tracing::info!(
            "Static dir {} not found — API-only mode",
            static_dir.display()
        );
        api_router
    };

    let app = app.layer(cors).layer(TraceLayer::new_for_http());

    let addr = "0.0.0.0:3300";
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("m3d-api listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

/// GET /v1/votes?algo_id=TREND
/// Returns vote records from SQLite for the requested algo.
async fn votes_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::Query(q): axum::extract::Query<models::VotesQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let records = match load_votes_from_db(&state.db_path, &q.algo_id) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("votes DB query failed: {e}");
            Vec::new()
        }
    };
    Ok(Json(json!({
        "algo_id": q.algo_id,
        "count": records.len(),
        "votes": records,
    })))
}

fn load_votes_from_db(
    db_path: &str,
    algo_id: &str,
) -> Result<Vec<models::VoteRecord>, rusqlite::Error> {
    let conn = rusqlite::Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT bar_index, bar_time, algo_id, vote, strength \
         FROM algo_votes \
         WHERE algo_id = ?1 \
         ORDER BY bar_index ASC \
         LIMIT 10000",
    )?;
    let rows: Vec<models::VoteRecord> = stmt
        .query_map(rusqlite::params![algo_id], |r| {
            Ok(models::VoteRecord {
                bar_index: r.get::<_, i64>(0)? as usize,
                time: r.get(1)?,
                algo_id: r.get(2)?,
                vote: r.get(3)?,
                strength: r.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// POST /v1/reload — trigger an immediate disk reload.
async fn reload_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> axum::http::StatusCode {
    let json_path = PathBuf::from(ALGO_DAY_JSON);
    state::reload_from_disk(&state, &json_path).await;
    axum::http::StatusCode::NO_CONTENT
}

/// Create engine/data/ directory and write a starter algo_day.json with
/// realistic mock data for 5 assets so the frontend has data before the engine runs.
async fn ensure_engine_data(json_path: &PathBuf) {
    if let Some(parent) = json_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            tracing::warn!("Could not create engine data dir: {e}");
        }
    }

    if json_path.exists() {
        return;
    }

    let mock = json!({
        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "assets": [
            {
                "symbol": "BTCUSDT",
                "price": 67420.50,
                "change_pct": 2.34,
                "jedi_score": 45.0,
                "votes": { "TREND": 1, "MOM": 1, "VOL": 0, "ATR": 1, "COMP": 1 }
            },
            {
                "symbol": "ETHUSDT",
                "price": 3521.80,
                "change_pct": 1.87,
                "jedi_score": 32.0,
                "votes": { "TREND": 1, "MOM": 1, "VOL": 1, "ATR": 0, "COMP": 1 }
            },
            {
                "symbol": "BNBUSDT",
                "price": 598.40,
                "change_pct": -0.62,
                "jedi_score": -8.0,
                "votes": { "TREND": 0, "MOM": -1, "VOL": 0, "ATR": 0, "COMP": 0 }
            },
            {
                "symbol": "SOLUSDT",
                "price": 182.15,
                "change_pct": 3.91,
                "jedi_score": 60.0,
                "votes": { "TREND": 1, "MOM": 1, "VOL": 1, "ATR": 1, "COMP": 1 }
            },
            {
                "symbol": "ADAUSDT",
                "price": 0.5843,
                "change_pct": -1.23,
                "jedi_score": -22.0,
                "votes": { "TREND": -1, "MOM": -1, "VOL": 0, "ATR": 0, "COMP": -1 }
            }
        ]
    });

    let text = serde_json::to_string_pretty(&mock).unwrap_or_default();
    match tokio::fs::write(json_path, text).await {
        Ok(_) => tracing::info!("Wrote starter algo_day.json to {}", json_path.display()),
        Err(e) => tracing::warn!("Could not write starter algo_day.json: {e}"),
    }
}
