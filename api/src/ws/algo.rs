use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;

use crate::state::AppState;

/// Upgrade handler for `GET /ws/algo`.
pub async fn handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();

    // Send the current council snapshot immediately on connect.
    {
        let council = state.council.read().await;
        if let Ok(json) = serde_json::to_string(&*council) {
            let _ = sender.send(Message::Text(json.into())).await;
        }
    }

    // Subscribe to future updates.
    let mut rx = state.tx.subscribe();

    loop {
        tokio::select! {
            biased;

            // Broadcast from engine reload → push to this client.
            update = rx.recv() => {
                match update {
                    Ok(text) => {
                        if sender.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("[ws/algo] subscriber lagged, dropped {n} messages");
                    }
                    Err(_) => break,
                }
            }

            // Handle incoming messages (ping/close).
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Ping(p))) => {
                        let _ = sender.send(Message::Pong(p)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
}
