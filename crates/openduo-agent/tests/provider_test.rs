use openduo_agent::provider::{ChatMessage, ChatRole};

#[test]
fn test_chat_message_serializes() {
    let msg = ChatMessage {
        role: ChatRole::User,
        content: "hello".to_string(),
    };
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"user\""));
    assert!(json.contains("\"hello\""));
}
