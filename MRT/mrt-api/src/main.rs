//! MRT API — read-only research façade over processor snapshots + DS SQLite inventory.

mod replay;

use std::collections::BTreeSet;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::Query;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::Connection;
use serde::Serialize;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
struct AppState {
    snapshot_path: PathBuf,
    /// Tried in order until `mrt_discovery.json` is found (handles missing env / odd cwd).
    discovery_paths: Vec<PathBuf>,
    futures_db: PathBuf,
    ds_db: PathBuf,
}

fn path_env(key: &str, default: &str) -> PathBuf {
    PathBuf::from(env::var(key).unwrap_or_else(|_| default.to_string()))
}

fn push_unique(paths: &mut Vec<PathBuf>, seen: &mut BTreeSet<String>, p: PathBuf) {
    let k = p.to_string_lossy().to_string();
    if seen.insert(k) {
        paths.push(p);
    }
}

/// Resolve candidate discovery JSON paths: env, snapshot sibling, MRT_DATA_DIR, cwd-relative, then
/// `MRT/data/` next to this crate (works when the binary is run without `MRT_*` set).
fn discovery_candidate_paths(snapshot_path: &PathBuf) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut seen = BTreeSet::new();

    if let Ok(p) = env::var("MRT_DISCOVERY_PATH") {
        push_unique(&mut paths, &mut seen, PathBuf::from(p));
    }
    if let Some(parent) = snapshot_path.parent() {
        push_unique(
            &mut paths,
            &mut seen,
            parent.join("mrt_discovery.json"),
        );
    }
    if let Ok(dir) = env::var("MRT_DATA_DIR") {
        push_unique(
            &mut paths,
            &mut seen,
            PathBuf::from(dir).join("mrt_discovery.json"),
        );
    }
    push_unique(
        &mut paths,
        &mut seen,
        PathBuf::from("data/mrt_discovery.json"),
    );

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(mrt_root) = manifest_dir.parent() {
        push_unique(
            &mut paths,
            &mut seen,
            mrt_root.join("data/mrt_discovery.json"),
        );
    }

    paths
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "mrt_api=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let snapshot_path =
        path_env("MRT_SNAPSHOT_PATH", "data/mrt_snapshot.json");
    let discovery_paths = discovery_candidate_paths(&snapshot_path);
    let futures_db = path_env("MRT_FUTURES_DB", "../ds/data/futures.db");
    let ds_db = path_env("MRT_DS_DB", "../ds/data/ds.db");

    let state = Arc::new(AppState {
        snapshot_path: snapshot_path.clone(),
        discovery_paths: discovery_paths.clone(),
        futures_db,
        ds_db,
    });

    tracing::info!(
        snapshot_path = %snapshot_path.display(),
        discovery_paths = ?discovery_paths.iter().map(|p| p.display().to_string()).collect::<Vec<_>>(),
        "MRT API data paths"
    );

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/mrt/snapshot", get(snapshot_handler))
        .route("/v1/mrt/discovery", get(discovery_handler))
        .route("/v1/mrt/replay", get(replay_handler))
        .route("/v1/mrt/futures/symbols", get(futures_symbols))
        .route("/v1/mrt/ds/meta", get(ds_meta))
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let port: u16 = env::var("MRT_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3340);
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("MRT API listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "mrt-api",
        "status": "ok",
    }))
}

async fn snapshot_handler(
    State(s): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let raw = tokio::fs::read_to_string(&s.snapshot_path).await.map_err(|e| {
        (
            axum::http::StatusCode::NOT_FOUND,
            format!("snapshot: {} — run mrt-processor first ({e})", s.snapshot_path.display()),
        )
    })?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("json: {e}"),
        )
    })?;
    Ok(Json(v))
}

async fn discovery_handler(
    State(s): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    use std::io::ErrorKind;

    let tried: Vec<String> = s
        .discovery_paths
        .iter()
        .map(|p| p.display().to_string())
        .collect();
    let primary = tried
        .first()
        .cloned()
        .unwrap_or_else(|| "data/mrt_discovery.json".into());

    for path in &s.discovery_paths {
        match tokio::fs::read_to_string(path).await {
            Ok(raw) => {
                let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
                    (
                        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        format!("json: {} ({})", e, path.display()),
                    )
                })?;
                return Ok(Json(v));
            }
            Err(e) if e.kind() == ErrorKind::NotFound => continue,
            Err(e) => {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("discovery read {}: {e}", path.display()),
                ));
            }
        }
    }

    Ok(Json(serde_json::json!({
        "version": 1,
        "file_missing": true,
        "discovery_path": primary,
        "tried_paths": tried,
        "generated_at_unix": serde_json::Value::Null,
        "table": serde_json::Value::Null,
        "is_frac": serde_json::Value::Null,
        "fdr_alpha": serde_json::Value::Null,
        "symbols": [],
    })))
}

async fn replay_handler(
    State(s): State<Arc<AppState>>,
    Query(q): Query<replay::ReplayQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if q.symbol.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "symbol required".into()));
    }
    let snap = s.snapshot_path.clone();
    let fut = s.futures_db.clone();
    let table = env::var("MRT_BARS_TABLE").unwrap_or_else(|_| "bars_5m".to_string());
    let sym = q.symbol.trim().to_string();
    let lim = q.limit.unwrap_or(2500).clamp(200, 8000);
    let res = tokio::task::spawn_blocking(move || replay::run(&snap, &fut, &table, &sym, lim)).await;
    match res {
        Ok(Ok(j)) => Ok(Json(j)),
        Ok(Err(e)) => Err((StatusCode::BAD_REQUEST, e)),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, format!("task: {e}"))),
    }
}

#[derive(Serialize)]
struct FuturesSymbolsOut {
    ok: bool,
    db: String,
    symbols: serde_json::Value,
    error: Option<String>,
}

async fn futures_symbols(
    State(s): State<Arc<AppState>>,
) -> Json<FuturesSymbolsOut> {
    if !s.futures_db.exists() {
        return Json(FuturesSymbolsOut {
            ok: false,
            db: s.futures_db.to_string_lossy().to_string(),
            symbols: serde_json::json!({}),
            error: Some("futures.db not found".into()),
        });
    }

    let path = s.futures_db.clone();
    let res = tokio::task::spawn_blocking(move || scan_futures(&path)).await;
    match res {
        Ok(Ok(v)) => Json(FuturesSymbolsOut {
            ok: true,
            db: s.futures_db.to_string_lossy().to_string(),
            symbols: v,
            error: None,
        }),
        Ok(Err(e)) => Json(FuturesSymbolsOut {
            ok: false,
            db: s.futures_db.to_string_lossy().to_string(),
            symbols: serde_json::json!({}),
            error: Some(e),
        }),
        Err(e) => Json(FuturesSymbolsOut {
            ok: false,
            db: s.futures_db.to_string_lossy().to_string(),
            symbols: serde_json::json!({}),
            error: Some(format!("join: {e}")),
        }),
    }
}

fn scan_futures(path: &PathBuf) -> Result<serde_json::Value, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    let mut out = serde_json::Map::new();
    for tf in ["1m", "5m"] {
        let table = format!("bars_{tf}");
        let q = format!("SELECT symbol, COUNT(*), MIN(ts), MAX(ts) FROM {table} GROUP BY symbol ORDER BY symbol");
        let mut stmt = conn.prepare(&q).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let list: Result<Vec<_>, _> = rows.collect();
        let list = list.map_err(|e| e.to_string())?;
        let j: Vec<serde_json::Value> = list
            .into_iter()
            .map(|(sym, cnt, t0, t1)| {
                serde_json::json!({
                    "symbol": sym,
                    "bars": cnt,
                    "from_ts": t0,
                    "to_ts": t1,
                })
            })
            .collect();
        out.insert(tf.to_string(), serde_json::Value::Array(j));
    }
    Ok(serde_json::Value::Object(out))
}

#[derive(Serialize)]
struct DsMetaOut {
    ok: bool,
    path: String,
    django_sqlite: bool,
    backtest_runs: Option<i64>,
    error: Option<String>,
}

async fn ds_meta(State(s): State<Arc<AppState>>) -> Json<DsMetaOut> {
    if !s.ds_db.exists() {
        return Json(DsMetaOut {
            ok: false,
            path: s.ds_db.to_string_lossy().to_string(),
            django_sqlite: false,
            backtest_runs: None,
            error: Some("ds.db not found".into()),
        });
    }
    let path = s.ds_db.clone();
    let res = tokio::task::spawn_blocking(move || ds_counts(&path)).await;
    match res {
        Ok(Ok(n)) => Json(DsMetaOut {
            ok: true,
            path: s.ds_db.to_string_lossy().to_string(),
            django_sqlite: true,
            backtest_runs: Some(n),
            error: None,
        }),
        Ok(Err(e)) => Json(DsMetaOut {
            ok: false,
            path: s.ds_db.to_string_lossy().to_string(),
            django_sqlite: true,
            backtest_runs: None,
            error: Some(e),
        }),
        Err(e) => Json(DsMetaOut {
            ok: false,
            path: s.ds_db.to_string_lossy().to_string(),
            django_sqlite: false,
            backtest_runs: None,
            error: Some(format!("join: {e}")),
        }),
    }
}

fn ds_counts(path: &PathBuf) -> Result<i64, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ds_app_backtestrun'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Ok(0);
    }
    conn.query_row("SELECT COUNT(*) FROM ds_app_backtestrun", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}
