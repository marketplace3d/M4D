//! GET /v1/audit/order-intent — proxies to Django DS (order_intent SQLite audit).

use axum::{
    body::Body,
    extract::RawQuery,
    http::{header::CONTENT_TYPE, HeaderValue, StatusCode},
    response::Response,
};
use std::time::Duration;

/// Default DS base when `M3D_DS_BASE` is unset (see `go.sh ds` :8000).
fn ds_base() -> String {
    std::env::var("M3D_DS_BASE").unwrap_or_else(|_| "http://127.0.0.1:8000".into())
}

/// GET /v1/audit/order-intent?broker=all|alpaca|ibkr&limit=50&cycle_id=...
///
/// Forwards query string to DS; response body and status are passed through.
pub async fn handler(RawQuery(raw): RawQuery) -> Result<Response, (StatusCode, String)> {
    let mut url = format!("{}/v1/audit/order-intent/", ds_base().trim_end_matches('/'));
    if let Some(q) = raw.as_ref().filter(|s| !s.is_empty()) {
        url.push('?');
        url.push_str(q);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resp = client.get(&url).send().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("DS audit unreachable ({url}): {e}"),
        )
    })?;

    let status =
        StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json")
        .to_string();

    let body = resp
        .bytes()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let mut res = Response::builder().status(status);
    if let Ok(val) = HeaderValue::from_str(&ct) {
        res = res.header(CONTENT_TYPE, val);
    }
    res.body(Body::from(body))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
