use anyhow::Result;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

pub struct AuthHeaders {
    pat: String,
}

impl AuthHeaders {
    pub fn new(pat: impl Into<String>) -> Self {
        Self { pat: pat.into() }
    }

    /// Headers for GitLab REST API calls (PRIVATE-TOKEN).
    pub fn to_header_map(&self) -> Result<HeaderMap> {
        let mut map = HeaderMap::new();
        map.insert(
            HeaderName::from_static("private-token"),
            HeaderValue::from_str(&self.pat)?,
        );
        map.insert(
            reqwest::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        Ok(map)
    }

    /// Headers for GitLab Duo Chat API (Authorization: Bearer).
    pub fn to_bearer_header_map(&self) -> Result<HeaderMap> {
        let mut map = HeaderMap::new();
        map.insert(
            reqwest::header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", self.pat))?,
        );
        map.insert(
            reqwest::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        Ok(map)
    }
}
