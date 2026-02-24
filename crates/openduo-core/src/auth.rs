use anyhow::Result;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

pub struct AuthHeaders {
    pat: String,
}

impl AuthHeaders {
    pub fn new(pat: impl Into<String>) -> Self {
        Self { pat: pat.into() }
    }

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
}
