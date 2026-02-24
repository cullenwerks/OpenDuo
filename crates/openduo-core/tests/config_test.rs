use openduo_core::auth::AuthHeaders;
use openduo_core::config::Config;
use serial_test::serial;

#[test]
#[serial]
fn test_config_from_env() {
    std::env::set_var("GITLAB_URL", "https://gitlab.example.com");
    std::env::set_var("GITLAB_PAT", "glpat-test123");
    let cfg = Config::from_env().unwrap();
    assert_eq!(cfg.gitlab_url, "https://gitlab.example.com");
    assert_eq!(cfg.pat, "glpat-test123");
}

#[test]
#[serial]
fn test_config_missing_env_fails() {
    std::env::remove_var("GITLAB_URL");
    std::env::remove_var("GITLAB_PAT");
    let result = Config::from_env();
    assert!(result.is_err());
}

#[test]
fn test_auth_headers_contain_pat() {
    let headers = AuthHeaders::new("glpat-abc123");
    let map = headers.to_header_map().unwrap();
    assert_eq!(
        map.get("PRIVATE-TOKEN").unwrap(),
        "glpat-abc123"
    );
}

#[test]
fn test_auth_headers_contain_content_type() {
    let headers = AuthHeaders::new("glpat-abc123");
    let map = headers.to_header_map().unwrap();
    assert!(map.contains_key("Content-Type"));
}
