use crate::provider::{
    ChatMessage, ChatRole, LlmProvider, ModelResponse, TokenStream, ToolDefinition,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::StreamExt;
use openduo_core::{auth::AuthHeaders, config::Config};
use reqwest::Client;
use serde_json::{json, Value};
use tracing::{debug, error, instrument};

pub struct GitLabAiProvider {
    client: Client,
    gateway_url: String,
    pat: String,
}

impl GitLabAiProvider {
    pub fn new(config: &Config) -> Result<Self> {
        let client = Client::builder()
            .use_native_tls()
            .build()
            .map_err(|e| anyhow!("Failed to build reqwest client: {}", e))?;
        let gateway_url = format!(
            "{}/api/v4/chat/completions",
            config.gitlab_url.trim_end_matches('/')
        );
        Ok(Self {
            client,
            gateway_url,
            pat: config.pat.clone(),
        })
    }
}

#[async_trait]
impl LlmProvider for GitLabAiProvider {
    #[instrument(skip(self, messages, _tools))]
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        _tools: Vec<ToolDefinition>,
    ) -> Result<TokenStream> {
        // GitLab Duo Chat API uses Bearer auth, not PRIVATE-TOKEN
        let headers = AuthHeaders::new(&self.pat).to_bearer_header_map()?;

        // Extract the last user message as the content to send
        let content = messages
            .iter()
            .rev()
            .find(|m| matches!(m.role, ChatRole::User))
            .map(|m| m.content.clone())
            .unwrap_or_default();

        // GitLab Duo Chat API request format
        let body = json!({ "content": content });
        debug!(
            "Sending to GitLab Duo Chat: {} (content length: {})",
            self.gateway_url,
            content.len()
        );

        let raw_resp = self
            .client
            .post(&self.gateway_url)
            .headers(headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                error!(
                    "Failed to connect to GitLab Duo Chat at {}: {}",
                    self.gateway_url, e
                );
                anyhow!("Failed to connect to GitLab Duo Chat: {}", e)
            })?;

        let status = raw_resp.status();
        if !status.is_success() {
            let body_text = raw_resp.text().await.unwrap_or_default();
            error!("GitLab Duo Chat returned HTTP {}: {}", status, body_text);
            return Err(anyhow!(
                "GitLab Duo Chat returned HTTP {} — {}",
                status,
                body_text
            ));
        }

        let content_type = raw_resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        debug!("Response content-type: {}", content_type);

        if content_type.contains("text/event-stream") {
            // SSE streaming response — parse data: lines
            let stream = raw_resp.bytes_stream().flat_map(move |chunk| {
                let events: Vec<Result<ModelResponse>> = match chunk {
                    Ok(bytes) => {
                        let text = String::from_utf8_lossy(&bytes).to_string();
                        parse_sse_chunk(&text)
                    }
                    Err(e) => vec![Err(anyhow!(e))],
                };
                futures::stream::iter(events)
            });
            Ok(Box::pin(stream))
        } else {
            // Non-streaming response — read entire body as text
            let body_text = raw_resp.text().await?;
            debug!("Duo Chat response length: {}", body_text.len());

            // Response may be a JSON string or plain text
            let response_text = if body_text.starts_with('"') {
                serde_json::from_str::<String>(&body_text).unwrap_or(body_text)
            } else {
                body_text
            };

            let events: Vec<Result<ModelResponse>> = vec![
                Ok(ModelResponse::Token(response_text)),
                Ok(ModelResponse::Done),
            ];
            Ok(Box::pin(futures::stream::iter(events)))
        }
    }
}

/// Parse SSE data: lines from a chunk, extracting text tokens.
fn parse_sse_chunk(text: &str) -> Vec<Result<ModelResponse>> {
    let mut events = Vec::new();
    let normalized = text.replace("\r\n", "\n");

    for line in normalized.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            let trimmed = data.trim();
            if trimmed == "[DONE]" || trimmed.is_empty() {
                events.push(Ok(ModelResponse::Done));
                continue;
            }
            // Try parsing as JSON first (OpenAI-compatible format)
            if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
                // OpenAI format: choices[0].delta.content
                if let Some(token) = val["choices"][0]["delta"]["content"].as_str() {
                    if !token.is_empty() {
                        events.push(Ok(ModelResponse::Token(token.to_string())));
                    }
                }
                // GitLab format: may have "content" or "response" at top level
                else if let Some(token) = val["content"].as_str() {
                    if !token.is_empty() {
                        events.push(Ok(ModelResponse::Token(token.to_string())));
                    }
                } else if let Some(token) = val["response"].as_str() {
                    if !token.is_empty() {
                        events.push(Ok(ModelResponse::Token(token.to_string())));
                    }
                }
                if val["choices"][0]["finish_reason"].as_str() == Some("stop") {
                    events.push(Ok(ModelResponse::Done));
                }
            } else {
                // Plain text data line — treat as a token
                events.push(Ok(ModelResponse::Token(trimmed.to_string())));
            }
        }
    }
    events
}
