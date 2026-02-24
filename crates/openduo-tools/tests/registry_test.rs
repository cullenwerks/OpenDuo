use openduo_core::config::Config;
use openduo_tools::registry::ToolRegistry;

fn test_config() -> Config {
    std::env::set_var("GITLAB_URL", "https://gitlab.example.com");
    std::env::set_var("GITLAB_PAT", "glpat-test");
    Config::from_env().unwrap()
}

#[test]
fn test_registry_has_tools() {
    let registry = ToolRegistry::new(test_config());
    assert!(!registry.definitions().is_empty());
}

#[test]
fn test_registry_lists_expected_tools() {
    let registry = ToolRegistry::new(test_config());
    let names: Vec<String> = registry.definitions().iter().map(|t| t.name.clone()).collect();
    assert!(names.contains(&"list_issues".to_string()));
    assert!(names.contains(&"get_pipeline".to_string()));
    assert!(names.contains(&"get_file".to_string()));
}
