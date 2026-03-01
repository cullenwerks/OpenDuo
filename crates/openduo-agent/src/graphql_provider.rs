use crate::provider::{ChatMessage, ChatRole, LlmProvider, ModelResponse, TokenStream, ToolDefinition};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::{SinkExt, StreamExt};
use openduo_core::config::Config;
use reqwest::Client;
use serde_json::Value;
use tokio::sync::OnceCell;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, instrument};

type WsStream = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

enum CableEvent {
    Token(String),
    Done,
    Error(String),
}

pub struct GraphQLProvider {
    http_client: Client,
    base_url: String,
    pat: String,
    user_gid: OnceCell<String>,
}

impl GraphQLProvider {
    pub fn new(config: &Config) -> Result<Self> {
        let http_client = Client::builder()
            .use_native_tls()
            .build()
            .map_err(|e| anyhow!("Failed to build HTTP client: {}", e))?;
        Ok(Self {
            http_client,
            base_url: config.gitlab_url.trim_end_matches('/').to_string(),
            pat: config.pat.clone(),
            user_gid: OnceCell::new(),
        })
    }

    async fn resolve_user_gid(&self) -> Result<&str> {
        self.user_gid
            .get_or_try_init(|| async {
                #[derive(serde::Deserialize)]
                struct UserResp {
                    id: u64,
                }

                let url = format!("{}/api/v4/user", self.base_url);
                debug!("Fetching GitLab user ID from {}", url);
                let resp: UserResp = self
                    .http_client
                    .get(&url)
                    .header("PRIVATE-TOKEN", &self.pat)
                    .send()
                    .await
                    .map_err(|e| anyhow!("Failed to fetch user: {}", e))?
                    .error_for_status()
                    .map_err(|e| anyhow!("GitLab user endpoint error: {}", e))?
                    .json()
                    .await
                    .map_err(|e| anyhow!("Failed to parse user response: {}", e))?;

                let gid = format!("gid://gitlab/User/{}", resp.id);
                debug!("Resolved user GID: {}", gid);
                Ok(gid)
            })
            .await
            .map(String::as_str)
    }
}

#[async_trait]
impl LlmProvider for GraphQLProvider {
    #[instrument(skip(self, messages, _tools))]
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        _tools: Vec<ToolDefinition>,
    ) -> Result<TokenStream> {
        let user_gid = self.resolve_user_gid().await?.to_string();

        let content = messages
            .iter()
            .rev()
            .find(|m| matches!(m.role, ChatRole::User))
            .map(|m| m.content.clone())
            .unwrap_or_default();

        let client_sub_id = uuid::Uuid::new_v4().to_string();

        let ws_url = build_ws_url(&self.base_url)?;
        debug!("Connecting to ActionCable at {}", ws_url);
        let ws = connect_ws(&ws_url, &self.pat).await?;

        let http_client = self.http_client.clone();
        let graphql_url = format!("{}/api/graphql", self.base_url);
        let pat = self.pat.clone();

        let stream = graphql_stream(ws, content, user_gid, client_sub_id, http_client, graphql_url, pat);
        Ok(Box::pin(stream))
    }
}

fn build_ws_url(base_url: &str) -> Result<String> {
    let ws_base = if base_url.starts_with("https://") {
        base_url.replacen("https://", "wss://", 1)
    } else if base_url.starts_with("http://") {
        base_url.replacen("http://", "ws://", 1)
    } else {
        return Err(anyhow!("Unsupported URL scheme: {}", base_url));
    };
    Ok(format!("{}/-/cable", ws_base))
}

async fn connect_ws(ws_url: &str, pat: &str) -> Result<WsStream> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::http::HeaderValue;

    let mut request = ws_url
        .into_client_request()
        .map_err(|e| anyhow!("Invalid WebSocket URL: {}", e))?;

    let headers = request.headers_mut();
    headers.insert(
        "PRIVATE-TOKEN",
        HeaderValue::from_str(pat).map_err(|e| anyhow!("Invalid PAT header value: {}", e))?,
    );
    // Origin is required by GitLab's ActionCable
    let origin = ws_url
        .replacen("wss://", "https://", 1)
        .replacen("ws://", "http://", 1);
    // Strip the path for the origin header
    let origin_base = origin
        .split("/-/")
        .next()
        .unwrap_or(&origin)
        .to_string();
    headers.insert(
        "Origin",
        HeaderValue::from_str(&origin_base)
            .map_err(|e| anyhow!("Invalid Origin header value: {}", e))?,
    );

    let (ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| anyhow!("WebSocket connection failed to {}: {}", ws_url, e))?;

    Ok(ws)
}

fn graphql_stream(
    ws: WsStream,
    content: String,
    user_gid: String,
    client_sub_id: String,
    http_client: Client,
    graphql_url: String,
    pat: String,
) -> impl futures::Stream<Item = Result<ModelResponse>> {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Result<ModelResponse>>();
    let tx_err = tx.clone();

    tokio::spawn(async move {
        if let Err(e) = drive_ws(
            ws,
            &content,
            &user_gid,
            &client_sub_id,
            &http_client,
            &graphql_url,
            &pat,
            &tx,
        )
        .await
        {
            error!("GraphQL provider error: {}", e);
            let _ = tx_err.send(Err(e));
        }
        let _ = tx_err.send(Ok(ModelResponse::Done));
    });

    tokio_stream::wrappers::UnboundedReceiverStream::new(rx)
}

async fn drive_ws(
    ws: WsStream,
    content: &str,
    user_gid: &str,
    client_sub_id: &str,
    http_client: &Client,
    graphql_url: &str,
    pat: &str,
    tx: &tokio::sync::mpsc::UnboundedSender<Result<ModelResponse>>,
) -> Result<()> {
    let (mut sink, mut stream) = ws.split();
    let identifier = r#"{"channel":"GraphqlChannel"}"#;

    // Step 1: wait for ActionCable "welcome"
    wait_for_type(&mut stream, "welcome").await?;
    debug!("ActionCable: received welcome");

    // Step 2: subscribe to GraphqlChannel
    let subscribe_msg = serde_json::json!({
        "command": "subscribe",
        "identifier": identifier,
    })
    .to_string();
    sink.send(Message::Text(subscribe_msg)).await
        .map_err(|e| anyhow!("Failed to send subscribe command: {}", e))?;

    // Step 3: wait for confirm_subscription
    wait_for_type(&mut stream, "confirm_subscription").await?;
    debug!("ActionCable: subscription confirmed");

    // Step 4: send the aiCompletionResponse subscription query via ActionCable
    let sub_query = format!(
        "subscription OpenDuoCompletion($userId: UserID!, $clientSubscriptionId: String!) {{ \
            aiCompletionResponse(userId: $userId, clientSubscriptionId: $clientSubscriptionId) {{ \
                content \
                requestId \
                errors \
            }} \
        }}"
    );
    let sub_variables = serde_json::json!({
        "userId": user_gid,
        "clientSubscriptionId": client_sub_id,
    });
    // ActionCable "data" field must be a JSON-encoded string
    let sub_data = serde_json::json!({
        "query": sub_query,
        "variables": sub_variables,
    })
    .to_string();
    let sub_msg = serde_json::json!({
        "command": "message",
        "identifier": identifier,
        "data": sub_data,
    })
    .to_string();
    sink.send(Message::Text(sub_msg)).await
        .map_err(|e| anyhow!("Failed to send subscription query: {}", e))?;
    debug!("ActionCable: subscription query sent, clientSubscriptionId={}", client_sub_id);

    // Step 5: fire the aiAction mutation via HTTP (after subscription is registered)
    fire_ai_action(http_client, graphql_url, pat, content, client_sub_id).await?;
    debug!("aiAction mutation sent for content len={}", content.len());

    // Step 6: read events from the subscription
    let timeout_dur = std::time::Duration::from_secs(120);
    let start = std::time::Instant::now();
    let mut seen_tokens = false;

    while let Some(msg) = stream.next().await {
        if start.elapsed() > timeout_dur {
            return Err(anyhow!("GraphQL subscription timed out after 120s"));
        }

        let msg = msg.map_err(|e| anyhow!("WebSocket read error: {}", e))?;
        match msg {
            Message::Text(text) => {
                match parse_cable_data(&text, client_sub_id, seen_tokens)? {
                    Some(CableEvent::Token(t)) => {
                        seen_tokens = true;
                        let _ = tx.send(Ok(ModelResponse::Token(t)));
                    }
                    Some(CableEvent::Done) => {
                        sink.send(Message::Close(None)).await.ok();
                        return Ok(());
                    }
                    Some(CableEvent::Error(e)) => {
                        return Err(anyhow!("aiCompletionResponse error: {}", e));
                    }
                    None => {} // control frame or irrelevant message
                }
            }
            Message::Ping(data) => {
                sink.send(Message::Pong(data)).await.ok();
            }
            Message::Close(_) => {
                if seen_tokens {
                    // Server closed after completion — treat as done
                    return Ok(());
                }
                return Err(anyhow!("WebSocket closed by server before any response"));
            }
            _ => {}
        }
    }

    Err(anyhow!("WebSocket stream ended without a terminal event"))
}

async fn fire_ai_action(
    client: &Client,
    graphql_url: &str,
    pat: &str,
    content: &str,
    client_sub_id: &str,
) -> Result<()> {
    let mutation = "mutation OpenDuoAiAction($input: AiActionInput!) { \
        aiAction(input: $input) { \
            requestId \
            errors \
        } \
    }";

    let variables = serde_json::json!({
        "input": {
            "chat": {
                "content": content,
                "resourceId": null,
            },
            "clientSubscriptionId": client_sub_id,
        }
    });

    let body = serde_json::json!({
        "query": mutation,
        "variables": variables,
    });

    let resp: Value = client
        .post(graphql_url)
        .header("PRIVATE-TOKEN", pat)
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("aiAction HTTP request failed: {}", e))?
        .error_for_status()
        .map_err(|e| anyhow!("aiAction HTTP error: {}", e))?
        .json()
        .await
        .map_err(|e| anyhow!("Failed to parse aiAction response: {}", e))?;

    // GraphQL always returns HTTP 200 — check for errors in the payload
    if let Some(errors) = resp["errors"].as_array() {
        if !errors.is_empty() {
            let msg = errors
                .iter()
                .filter_map(|e| e["message"].as_str())
                .collect::<Vec<_>>()
                .join("; ");
            return Err(anyhow!("aiAction mutation errors: {}", msg));
        }
    }
    if let Some(field_errors) = resp["data"]["aiAction"]["errors"].as_array() {
        if !field_errors.is_empty() {
            let msg = field_errors
                .iter()
                .filter_map(|e| e.as_str())
                .collect::<Vec<_>>()
                .join("; ");
            return Err(anyhow!("aiAction field errors: {}", msg));
        }
    }

    Ok(())
}

fn parse_cable_data(text: &str, _client_sub_id: &str, seen_tokens: bool) -> Result<Option<CableEvent>> {
    let val: Value = serde_json::from_str(text)
        .map_err(|e| anyhow!("Invalid JSON from WebSocket: {}", e))?;

    // ActionCable control frames have a "type" field — skip them
    if val["type"].is_string() {
        return Ok(None);
    }

    // Data messages have a "message" key
    let message = &val["message"];
    if message.is_null() {
        return Ok(None);
    }

    let response = &message["result"]["data"]["aiCompletionResponse"];
    if response.is_null() {
        return Ok(None);
    }

    // Check for errors
    if let Some(errors) = response["errors"].as_array() {
        if !errors.is_empty() {
            let msg = errors
                .iter()
                .filter_map(|e| e.as_str().or_else(|| e["message"].as_str()))
                .collect::<Vec<_>>()
                .join("; ");
            return Ok(Some(CableEvent::Error(msg)));
        }
    }

    let content = response["content"].as_str().unwrap_or("").to_string();

    // Null/empty content after we've seen tokens = terminal event
    if content.is_empty() {
        if seen_tokens {
            return Ok(Some(CableEvent::Done));
        }
        // Empty content before any tokens = not yet started, ignore
        return Ok(None);
    }

    Ok(Some(CableEvent::Token(content)))
}

async fn wait_for_type(
    stream: &mut (impl futures::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
              + Unpin),
    expected_type: &str,
) -> Result<()> {
    let deadline = std::time::Duration::from_secs(10);
    let start = std::time::Instant::now();

    while let Some(msg) = stream.next().await {
        if start.elapsed() > deadline {
            return Err(anyhow!(
                "Timeout waiting for ActionCable '{}' message",
                expected_type
            ));
        }
        if let Ok(Message::Text(text)) = msg {
            if let Ok(val) = serde_json::from_str::<Value>(&text) {
                if val["type"].as_str() == Some(expected_type) {
                    return Ok(());
                }
            }
        }
    }

    Err(anyhow!(
        "WebSocket closed before receiving '{}' message",
        expected_type
    ))
}
