use axum::{
    extract::State,
    response::{Json, Sse},
    routing::{get, post},
    Router,
};
use futures::StreamExt;
use openduo_agent::{provider::LlmProvider, react_loop::ReactLoop};
use openduo_tools::registry::ToolRegistry;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct AppState {
    pub provider: Arc<dyn LlmProvider>,
    pub tools: Arc<ToolRegistry>,
    pub gitlab_url: String,
    pub history: Arc<Mutex<Vec<openduo_agent::provider::ChatMessage>>>,
}

#[derive(Deserialize)]
pub struct ChatRequest {
    pub message: String,
    pub username: Option<String>,
}

pub async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "openduo-server" }))
}

pub async fn tools_list(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "tools": state.tools.definitions() }))
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/tools", get(tools_list))
        .route("/chat", post(chat_handler))
        .with_state(state)
}

pub async fn chat_handler(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>>
{
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let provider = state.provider.clone();
    let tools = state.tools.clone();
    let gitlab_url = state.gitlab_url.clone();
    let history = state.history.clone();
    let username = req.username.unwrap_or_else(|| "user".to_string());
    let message = req.message;

    tokio::spawn(async move {
        let react_loop = ReactLoop::new(10);
        let mut hist = history.lock().await;
        let _ = react_loop
            .run(
                &message,
                &mut hist,
                &provider,
                &tools,
                &gitlab_url,
                &username,
                |token| {
                    let _ = tx.send(token);
                },
            )
            .await;
        let _ = tx.send("[DONE]".to_string());
    });

    let stream = tokio_stream::wrappers::UnboundedReceiverStream::new(rx).map(|data| {
        Ok::<_, std::convert::Infallible>(axum::response::sse::Event::default().data(data))
    });
    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_health_returns_ok() {
        // Build a minimal router with just health (no AppState needed)
        let app = Router::new().route("/health", get(health));
        let req = Request::builder().uri("/health").body(Body::empty()).unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}
