use anyhow::Result;
use async_trait::async_trait;
use futures::Stream;
use serde::{Deserialize, Serialize};
use std::pin::Pin;

// Re-export from openduo-core so consumers keep using openduo_agent::provider::ToolDefinition
pub use openduo_core::types::ToolDefinition;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub enum ModelResponse {
    Token(String),
    ToolCall(ToolCall),
    Done,
}

pub type TokenStream = Pin<Box<dyn Stream<Item = Result<ModelResponse>> + Send>>;

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
    ) -> Result<TokenStream>;
}
