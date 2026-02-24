mod routes;
mod sse;
mod validation;

use anyhow::Result;
use openduo_agent::gitlab_provider::GitLabAiProvider;
use openduo_core::config::Config;
use openduo_tools::registry::ToolRegistry;
use routes::{build_router, AppState};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let port = config.server_port;
    let gitlab_url = config.gitlab_url.clone();

    let provider = Arc::new(GitLabAiProvider::new(config.clone()));
    let tools = Arc::new(ToolRegistry::new(config));
    let history = Arc::new(Mutex::new(Vec::new()));

    let state = AppState { provider, tools, gitlab_url, history };
    let app = build_router(state);

    let addr = format!("127.0.0.1:{}", port);
    info!("openduo-server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
