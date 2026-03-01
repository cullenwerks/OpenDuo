mod routes;
mod validation;

use anyhow::Result;
use openduo_agent::gitlab_provider::GitLabAiProvider;
use openduo_agent::graphql_provider::GraphQLProvider;
use openduo_agent::prompt::PromptBuilder;
use openduo_agent::provider::LlmProvider;
use openduo_core::config::Config;
use openduo_tools::registry::ToolRegistry;
use routes::{build_router, AppState};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;
use tracing_subscriber::EnvFilter;

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install Ctrl+C handler");
    info!("Received shutdown signal, draining connections...");
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let port = config.server_port;
    let gitlab_url = config.gitlab_url.clone();

    let provider: Arc<dyn LlmProvider> = match config.chat_provider.as_str() {
        "graphql" => {
            info!("Using GraphQL+ActionCable provider (gitlab.com mode)");
            Arc::new(GraphQLProvider::new(&config)?)
        }
        _ => {
            info!("Using REST provider (self-managed EE mode)");
            Arc::new(GitLabAiProvider::new(&config)?)
        }
    };
    let tools = Arc::new(ToolRegistry::new(config)?);
    // Initialize conversation history with system prompt
    let history = Arc::new(Mutex::new(PromptBuilder::build_initial(&gitlab_url)));

    let state = AppState {
        provider,
        tools,
        history,
        chat_lock: Arc::new(Mutex::new(())),
    };
    let app = build_router(state);

    let addr = format!("127.0.0.1:{}", port);
    info!("openduo-server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    info!("openduo-server shut down gracefully");
    Ok(())
}
