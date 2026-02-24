use openduo_core::config::Config;
use openduo_core::gitlab_client::GitLabClient;

#[tokio::test]
async fn test_client_builds_without_panicking() {
    std::env::set_var("GITLAB_URL", "https://gitlab.example.com");
    std::env::set_var("GITLAB_PAT", "glpat-test");
    let config = Config::from_env().unwrap();
    let client = GitLabClient::new(config);
    assert!(client.base_url().starts_with("https://"));
}
