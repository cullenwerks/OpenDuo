use openduo_agent::prompt::PromptBuilder;
use openduo_agent::provider::ChatRole;

#[test]
fn test_prompt_contains_system_message() {
    let msgs = PromptBuilder::build_initial("https://gitlab.example.com", "test user");
    assert!(matches!(msgs[0].role, ChatRole::System));
    assert!(msgs[0].content.contains("GitLab"));
}

#[test]
fn test_append_user_message() {
    let mut history = PromptBuilder::build_initial("https://gitlab.example.com", "testuser");
    PromptBuilder::append_user(&mut history, "List my open issues");
    let last = history.last().unwrap();
    assert!(matches!(last.role, ChatRole::User));
    assert_eq!(last.content, "List my open issues");
}
