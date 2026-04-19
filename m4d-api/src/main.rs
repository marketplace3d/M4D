//! Serve `algo_day.json` + filter `votes.jsonl` from a data directory (e.g. `m4d-engine/out`).
mod ws_bridge;
mod binance_ingest;

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use tower_http::services::{ServeDir, ServeFile};
use clap::Parser;
use serde::Serialize;
use serde_json::Value;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Parser, Debug)]
#[command(name = "m4d-api", about = "M4D read-only API for MISSION")]
struct Args {
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
    #[arg(long, default_value_t = 3330)]
    port: u16,
    /// Directory containing `algo_day.json` and `votes.jsonl` (e.g. `m4d-engine/out`).
    #[arg(long, default_value = ".")]
    data_dir: PathBuf,
    /// SQLite-derived algo roster JSON (default: `spec-kit/data/algo_metadata.json` next to workspace).
    #[arg(long)]
    algo_metadata: Option<PathBuf>,
}

#[derive(Clone)]
struct AppState {
    inner: Arc<AppStateInner>,
    ws_hub: Arc<ws_bridge::WsBridgeHub>,
}

struct AppStateInner {
    data_dir: PathBuf,
    metadata_path: PathBuf,
    votes: RwLock<Vec<VoteLine>>,
    algo_day_raw: RwLock<Option<Value>>,
    algo_metadata_raw: RwLock<Value>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct VoteLine {
    session_id: String,
    bar_index: usize,
    time: i64,
    algo_id: String,
    vote: i8,
    strength: f64,
    payload: Value,
}

#[derive(Debug, Serialize)]
struct VotesResponse {
    algo_id: String,
    count: usize,
    votes: Vec<VoteLine>,
}

#[derive(Debug, serde::Deserialize)]
struct VotesQuery {
    algo_id: String,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
}

fn read_json(path: &Path) -> std::io::Result<Value> {
    let s = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&s)?)
}

fn load_votes_jsonl(path: &Path) -> std::io::Result<Vec<VoteLine>> {
    let s = std::fs::read_to_string(path)?;
    let mut out = Vec::new();
    for line in s.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: VoteLine = serde_json::from_str(line).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, format!("jsonl: {e}"))
        })?;
        out.push(v);
    }
    Ok(out)
}

fn default_metadata_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../spec-kit/data/algo_metadata.json")
}

fn load_algo_metadata(path: &Path) -> Result<Value, String> {
    let s = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

fn refresh_state(state: &AppStateInner) -> Result<(), String> {
    let day_path = state.data_dir.join("algo_day.json");
    let votes_path = state.data_dir.join("votes.jsonl");

    if day_path.is_file() {
        let v = read_json(&day_path).map_err(|e| e.to_string())?;
        *state.algo_day_raw.write().unwrap() = Some(v);
    }

    if votes_path.is_file() {
        let list = load_votes_jsonl(&votes_path).map_err(|e| e.to_string())?;
        *state.votes.write().unwrap() = list;
    }

    if state.metadata_path.is_file() {
        let m = load_algo_metadata(&state.metadata_path)?;
        *state.algo_metadata_raw.write().unwrap() = m;
    }

    Ok(())
}

async fn health() -> &'static str {
    "ok"
}

async fn root_index() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("index_page.html"))
}

/// Bench page: minimal React from CDN (parity with `m4d-ds` Django home).
async fn opt_page() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("opt_page.html"))
}

async fn opt_ping() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "stack": "axum" }))
}

async fn get_algo_day(State(state): State<AppState>) -> Result<Json<Value>, (StatusCode, String)> {
    let lock = state.inner.algo_day_raw.read().unwrap();
    match &*lock {
        Some(j) => Ok(Json(j.clone())),
        None => Err((
            StatusCode::NOT_FOUND,
            "algo_day.json missing — point --data-dir at m4d-processor out/".into(),
        )),
    }
}

async fn get_votes(
    State(state): State<AppState>,
    Query(q): Query<VotesQuery>,
) -> Result<Json<VotesResponse>, (StatusCode, String)> {
    let all = state.inner.votes.read().unwrap();
    let mut filtered: Vec<VoteLine> = all
        .iter()
        .filter(|v| v.algo_id == q.algo_id)
        .cloned()
        .collect();
    filtered.sort_by_key(|v| v.bar_index);
    let offset = q.offset.unwrap_or(0).min(filtered.len());
    let lim = q.limit.unwrap_or(10_000).min(50_000);
    let slice: Vec<VoteLine> = filtered.into_iter().skip(offset).take(lim).collect();
    let count = slice.len();
    Ok(Json(VotesResponse {
        algo_id: q.algo_id,
        count,
        votes: slice,
    }))
}

async fn reload(State(state): State<AppState>) -> Result<StatusCode, (StatusCode, String)> {
    refresh_state(&state.inner).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_algo_metadata(State(state): State<AppState>) -> Json<Value> {
    Json(state.inner.algo_metadata_raw.read().unwrap().clone())
}

async fn ws_algo(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let hub = state.ws_hub.clone();
    ws.on_upgrade(move |socket| ws_bridge::handle_browser_ws(socket, hub))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "m4d_api=info,tower_http=info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let args = Args::parse();
    let metadata_path = args
        .algo_metadata
        .clone()
        .or_else(|| std::env::var("M4D_ALGO_METADATA_PATH").ok().map(PathBuf::from))
        .unwrap_or_else(|| {
            let in_data = args.data_dir.join("algo_metadata.json");
            if in_data.is_file() {
                in_data
            } else {
                default_metadata_path()
            }
        });
    let meta_initial = load_algo_metadata(&metadata_path).unwrap_or_else(|e| {
        tracing::warn!("algo_metadata load failed ({}): {} — empty object", metadata_path.display(), e);
        serde_json::json!({ "version": 0, "algorithms": {}, "conflicts": [], "evaluation_strips": [] })
    });
    let meta_path_log = metadata_path.display().to_string();
    let inner = Arc::new(AppStateInner {
        data_dir: args.data_dir.clone(),
        metadata_path,
        votes: RwLock::new(Vec::new()),
        algo_day_raw: RwLock::new(None),
        algo_metadata_raw: RwLock::new(meta_initial),
    });
    refresh_state(&inner).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let ws_hub = Arc::new(ws_bridge::WsBridgeHub::new());
    ws_bridge::spawn_ingest(ws_hub.as_ref());
    let state = AppState {
        inner,
        ws_hub,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // CARGO_MANIFEST_DIR is `…/m4d-api`; workspace root is one level up (not two).
    let mission_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../build/mission");
    let index = mission_dir.join("index.html");
    let mission_svc = ServeDir::new(mission_dir.clone()).not_found_service(ServeFile::new(index));

    if mission_dir.is_dir() {
        tracing::info!(
            "MISSION static → http://{}:{}/mission/  (npm run build:embed)",
            args.host,
            args.port
        );
    } else {
        tracing::warn!(
            "MISSION build missing at {} — run: cd M4D && npm run build:embed",
            mission_dir.display()
        );
    }

    let api = Router::new()
        .route("/", get(root_index))
        .route("/health", get(health))
        .route("/opt", get(opt_page))
        .route("/opt/ping", get(opt_ping))
        .route("/v1/ws/algo", get(ws_algo))
        .route("/v1/algo-day", get(get_algo_day))
        .route("/v1/algo-metadata", get(get_algo_metadata))
        .route("/v1/votes", get(get_votes))
        .route("/v1/reload", axum::routing::post(reload))
        .with_state(state);

    let app = Router::new()
        .merge(api)
        .nest_service("/mission", mission_svc)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr = format!("{}:{}", args.host, args.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("m4d-api listening on http://{}", addr);
    tracing::info!("hub (HTML links) → http://{}/", addr);
    tracing::info!("data_dir={}", args.data_dir.display());
    tracing::info!("algo_metadata={}", meta_path_log);
    axum::serve(listener, app).await?;
    Ok(())
}
