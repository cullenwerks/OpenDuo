use crate::prompt::PromptBuilder;
use crate::provider::{ChatMessage, LlmProvider, ModelResponse};
use anyhow::Result;
use futures::StreamExt;
use openduo_tools::registry::ToolRegistry;
use std::sync::Arc;
use tracing::{info, warn};

pub struct ReactLoop {
    max_iterations: usize,
}

impl ReactLoop {
    pub fn new(max_iterations: usize) -> Self {
        Self { max_iterations }
    }

    pub async fn run(
        &self,
        user_message: &str,
        history: &mut Vec<ChatMessage>,
        provider: &Arc<dyn LlmProvider>,
        tools: &ToolRegistry,
        on_token: impl Fn(String) + Send + Sync,
    ) -> Result<String> {
        PromptBuilder::append_user(history, user_message);
        let tool_defs = tools.definitions();
        let mut final_response = String::new();

        for iteration in 0..self.max_iterations {
            info!("ReAct iteration {}", iteration + 1);
            let mut stream = provider
                .chat_stream(history.clone(), tool_defs.clone())
                .await?;
            let mut current_response = String::new();
            let mut tool_calls: Vec<crate::provider::ToolCall> = Vec::new();

            while let Some(event) = stream.next().await {
                match event? {
                    ModelResponse::Token(token) => {
                        on_token(token.clone());
                        current_response.push_str(&token);
                    }
                    ModelResponse::ToolCall(tc) => {
                        tool_calls.push(tc);
                    }
                    ModelResponse::Done => break,
                }
            }

            if !tool_calls.is_empty() {
                for tc in tool_calls {
                    info!("Executing tool: {}", tc.name);
                    let result = tools
                        .execute(&tc.name, tc.arguments)
                        .await
                        .unwrap_or_else(|e| format!("Tool error: {}", e));
                    PromptBuilder::append_assistant(history, &format!("[Using tool: {}]", tc.name));
                    PromptBuilder::append_tool_result(history, &tc.name, &result);
                }
            } else {
                final_response = current_response.clone();
                PromptBuilder::append_assistant(history, &current_response);
                break;
            }

            if iteration + 1 == self.max_iterations {
                warn!("Max ReAct iterations ({}) reached", self.max_iterations);
                final_response = "I've reached the maximum number of reasoning steps. \
                    Please try rephrasing your question."
                    .to_string();
                on_token(final_response.clone());
                PromptBuilder::append_assistant(history, &final_response);
            }
        }

        Ok(final_response)
    }
}
