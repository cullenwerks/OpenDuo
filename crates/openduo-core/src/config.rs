use anyhow::{anyhow, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub gitlab_url: String,
    pub pat: String,
    pub server_port: u16,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let gitlab_url = std::env::var("GITLAB_URL")
            .map_err(|_| anyhow!("GITLAB_URL environment variable not set"))?;
        let pat = std::env::var("GITLAB_PAT")
            .map_err(|_| anyhow!("GITLAB_PAT environment variable not set"))?;
        let server_port = std::env::var("OPENDUO_PORT")
            .unwrap_or_else(|_| "8745".to_string())
            .parse::<u16>()
            .map_err(|_| anyhow!("OPENDUO_PORT must be a valid port number"))?;
        Ok(Self { gitlab_url, pat, server_port })
    }
}
