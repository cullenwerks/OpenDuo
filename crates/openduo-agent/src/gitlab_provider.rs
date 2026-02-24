use crate::provider::{
    ChatMessage, LlmProvider, ModelResponse, TokenStream, ToolCall, ToolDefinition,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::StreamExt;
use openduo_core::{auth::AuthHeaders, config::Config};
use reqwest::Client;
use serde_json::{json, Value};
use tracing::{debug, instrument};

pub struct GitLabAiProvider {
    client: Client,
    gateway_url: String,
    pat: String,
    model: String,
}

impl GitLabAiProvider {
    pub fn new(config: Config) -> Self {
        let client = Client::builder()
            .use_native_tls()
            .build()
            .expect("Failed to build reqwest client");
        let gateway_url = format!(
            "{}/api/v4/chat/completions",
            config.gitlab_url.trim_end_matches('/')
        );
        Self {
            client,
            gateway_url,
            pat: config.pat,
            model: "claude-sonnet-4-5".to_string(),
        }
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
                .map(|t| json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    }
                }))
                .collect();
            body["tools"] = json!(tool_defs);
            body["tool_choice"] = json!("auto");
        }
        body
    }
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

        let stream = resp.bytes_stream().map(move |chunk| {
            let bytes = chunk.map_err(|e| anyhow!(e))?;
            let text = String::from_utf8_lossy(&bytes).to_string();

            // Parse SSE: "data: {...}\n\n"
            for line in text.lines() {
                if let Some(json_str) = line.strip_prefix("data: ") {
                    if json_str == "[DONE]" {
                        return Ok(ModelResponse::Done);
                    }
                    if let Ok(val) = serde_json::from_str::<Value>(json_str) {
                        // Tool call
                        if let Some(tc) = val["choices"][0]["delta"]["tool_calls"][0].as_object() {
                            let name = tc["function"]["name"]
                                .as_str()
                                .unwrap_or("")
                                .to_string();
                            let args_str =
                                tc["function"]["arguments"].as_str().unwrap_or("{}");
                            let arguments =
                                serde_json::from_str(args_str).unwrap_or(json!({}));
                            return Ok(ModelResponse::ToolCall(ToolCall { name, arguments }));
                        }
                        // Token
                        if let Some(token) =
                            val["choices"][0]["delta"]["content"].as_str()
                        {
                            return Ok(ModelResponse::Token(token.to_string()));
                        }
                    }
                }
            }
            Ok(ModelResponse::Done)
        });

        Ok(Box::pin(stream))
    }
}
