use openduo_agent::gitlab_provider::GitLabAiProvider;
use openduo_core::config::Config;
use serial_test::serial;

#[test]
#[serial]
fn test_provider_constructs() {
    unsafe {
        std::env::set_var("GITLAB_URL", "https://gitlab.example.com");
        std::env::set_var("GITLAB_PAT", "glpat-test");
    }
    let config = Config::from_env().unwrap();
    let _provider = GitLabAiProvider::new(&config).unwrap();
}
