use crate::provider::{
    ChatMessage, LlmProvider, ModelResponse, TokenStream, ToolCall, ToolDefinition,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::StreamExt;
use openduo_core::{auth::AuthHeaders, config::Config};
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tracing::{debug, instrument};

pub struct GitLabAiProvider {
    client: Client,
    gateway_url: String,
    pat: String,
    model: String,
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
            model: "claude-sonnet-4-5".to_string(),
        })
    }

    fn build_request_body(&self, messages: &[ChatMessage], tools: &[ToolDefinition]) -> Value {
        let msgs: Vec<Value> = messages
            .iter()
            .map(|m| json!({ "role": m.role, "content": m.content }))
            .collect();

        let mut body = json!({
            "model": self.model,
            "messages": msgs,
            "stream": true,
        });

        if !tools.is_empty() {
            let tool_defs: Vec<Value> = tools
                .iter()
                .map(|t| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        }
                    })
                })
                .collect();
            body["tools"] = json!(tool_defs);
            body["tool_choice"] = json!("auto");
        }
        body
    }
}

/// Parse complete SSE events from a buffer, returning parsed ModelResponse items.
/// Accumulates tool call name/arguments across streaming deltas.
fn parse_sse_events(
    buffer: &mut String,
    tc_name: &mut String,
    tc_args: &mut String,
) -> Vec<Result<ModelResponse>> {
    let mut events = Vec::new();

    // Normalize \r\n to \n for cross-platform SSE compatibility
    if buffer.contains("\r\n") {
        *buffer = buffer.replace("\r\n", "\n");
    }

    while let Some(pos) = buffer.find("\n\n") {
        let event_block = buffer[..pos].to_string();
        *buffer = buffer[pos + 2..].to_string();

        for line in event_block.lines() {
            if let Some(json_str) = line.strip_prefix("data: ") {
                let trimmed = json_str.trim();
                if trimmed == "[DONE]" {
                    // Emit accumulated tool call before Done if present
                    if !tc_name.is_empty() {
                        let arguments = serde_json::from_str(tc_args).unwrap_or(json!({}));
                        events.push(Ok(ModelResponse::ToolCall(ToolCall {
                            name: std::mem::take(tc_name),
                            arguments,
                        })));
                        tc_args.clear();
                    }
                    events.push(Ok(ModelResponse::Done));
                    return events;
                }

                if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
                    let finish_reason = val["choices"][0]["finish_reason"].as_str();

                    // Accumulate tool call deltas
                    if let Some(tc) = val["choices"][0]["delta"]["tool_calls"][0].as_object() {
                        if let Some(name) = tc["function"]["name"].as_str() {
                            if !name.is_empty() {
                                *tc_name = name.to_string();
                            }
                        }
                        if let Some(args_fragment) = tc["function"]["arguments"].as_str() {
                            tc_args.push_str(args_fragment);
                        }
                    }

                    // Emit completed tool call when finish_reason indicates it
                    if finish_reason == Some("tool_calls") && !tc_name.is_empty() {
                        let arguments = serde_json::from_str(tc_args).unwrap_or(json!({}));
                        events.push(Ok(ModelResponse::ToolCall(ToolCall {
                            name: std::mem::take(tc_name),
                            arguments,
                        })));
                        tc_args.clear();
                        continue;
                    }

                    // Content token
                    if let Some(token) = val["choices"][0]["delta"]["content"].as_str() {
                        if !token.is_empty() {
                            events.push(Ok(ModelResponse::Token(token.to_string())));
                        }
                    }

                    // Normal stop
                    if finish_reason == Some("stop") {
                        events.push(Ok(ModelResponse::Done));
                    }
                }
            }
        }
    }

    events
}

#[async_trait]
impl LlmProvider for GitLabAiProvider {
    #[instrument(skip(self, messages, tools))]
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
    ) -> Result<TokenStream> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        let body = self.build_request_body(&messages, &tools);
        debug!("Sending to GitLab AI Gateway: {}", self.gateway_url);

        let resp = self
            .client
            .post(&self.gateway_url)
            .headers(headers)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        // Shared mutable state for buffering and tool call accumulation
        let buffer = Arc::new(Mutex::new(String::new()));
        let tc_name = Arc::new(Mutex::new(String::new()));
        let tc_args = Arc::new(Mutex::new(String::new()));

        let stream = resp.bytes_stream().flat_map(move |chunk| {
            let events: Vec<Result<ModelResponse>> = match chunk {
                Ok(bytes) => {
                    let text = String::from_utf8_lossy(&bytes).to_string();
                    let mut buf = buffer.lock().unwrap();
                    buf.push_str(&text);
                    let mut name = tc_name.lock().unwrap();
                    let mut args = tc_args.lock().unwrap();
                    parse_sse_events(&mut buf, &mut name, &mut args)
                }
                Err(e) => vec![Err(anyhow!(e))],
            };
            futures::stream::iter(events)
        });

        Ok(Box::pin(stream))
    }
}
