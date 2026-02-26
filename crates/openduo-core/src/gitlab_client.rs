use crate::auth::AuthHeaders;
use crate::config::Config;
use anyhow::Result;
use reqwest::Client;
use serde::de::DeserializeOwned;
use tracing::instrument;

#[derive(Clone)]
pub struct GitLabClient {
    client: Client,
    base_url: String,
    pat: String,
}

impl GitLabClient {
    pub fn new(config: Config) -> Self {
        let client = Client::builder()
            .use_native_tls()
            .build()
            .expect("Failed to build reqwest client");
        Self {
            client,
            base_url: config.gitlab_url.trim_end_matches('/').to_string(),
            pat: config.pat,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn api_url(&self, path: &str) -> String {
        format!("{}/api/v4/{}", self.base_url, path.trim_start_matches('/'))
    }

    #[instrument(skip(self))]
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        let resp = self
            .client
            .get(self.api_url(path))
            .headers(headers)
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json::<T>().await?)
    }

    #[instrument(skip(self, body))]
    pub async fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> Result<T> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        let resp = self
            .client
            .post(self.api_url(path))
            .headers(headers)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json::<T>().await?)
    }

    #[instrument(skip(self, body))]
    pub async fn put<T: DeserializeOwned>(&self, path: &str, body: serde_json::Value) -> Result<T> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        let resp = self
            .client
            .put(self.api_url(path))
            .headers(headers)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json::<T>().await?)
    }

    pub async fn get_raw(&self, url: &str) -> Result<reqwest::Response> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        Ok(self
            .client
            .get(url)
            .headers(headers)
            .send()
            .await?
            .error_for_status()?)
    }

    pub async fn post_stream(
        &self,
        url: &str,
        body: serde_json::Value,
    ) -> Result<reqwest::Response> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        Ok(self
            .client
            .post(url)
            .headers(headers)
            .json(&body)
            .send()
            .await?
            .error_for_status()?)
    }
}
