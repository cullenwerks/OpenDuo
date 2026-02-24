use openduo_agent::gitlab_provider::GitLabAiProvider;
use openduo_core::config::Config;

#[test]
fn test_provider_constructs() {
    std::env::set_var("GITLAB_URL", "https://gitlab.example.com");
    std::env::set_var("GITLAB_PAT", "glpat-test");
    let config = Config::from_env().unwrap();
    let _provider = GitLabAiProvider::new(config);
}
