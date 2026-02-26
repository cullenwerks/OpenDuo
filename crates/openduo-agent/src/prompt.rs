use crate::provider::{ChatMessage, ChatRole};

pub struct PromptBuilder;

impl PromptBuilder {
    pub fn build_initial(gitlab_url: &str) -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: ChatRole::System,
            content: format!(
                "You are OpenDuo, an AI assistant integrated with GitLab at {}. \
                You help the user interact with their GitLab instance by using available tools. \
                Always think step-by-step. Use tools to fetch real data before answering. \
                Never fabricate issue numbers, pipeline IDs, or commit hashes. \
                When you have enough information, provide a clear, concise answer.",
                gitlab_url
            ),
        }]
    }

    pub fn append_user(history: &mut Vec<ChatMessage>, content: &str) {
        history.push(ChatMessage {
            role: ChatRole::User,
            content: content.to_string(),
        });
    }

    pub fn append_assistant(history: &mut Vec<ChatMessage>, content: &str) {
        history.push(ChatMessage {
            role: ChatRole::Assistant,
            content: content.to_string(),
        });
    }

    pub fn append_tool_result(history: &mut Vec<ChatMessage>, tool_name: &str, result: &str) {
        history.push(ChatMessage {
            role: ChatRole::Tool,
            content: format!("Tool `{}` returned:\n{}", tool_name, result),
        });
    }
}
