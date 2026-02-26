use crate::registry::Tool;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::gitlab_client::GitLabClient;
use serde_json::{json, Value};

pub struct ProjectTools;

impl ProjectTools {
    pub fn all(client: GitLabClient) -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(GetProject {
                client: client.clone(),
            }),
            Box::new(ListProjects {
                client: client.clone(),
            }),
            Box::new(SearchProjects {
                client: client.clone(),
            }),
        ]
    }
}

struct GetProject {
    client: GitLabClient,
}
#[async_trait]
impl Tool for GetProject {
    fn name(&self) -> &str {
        "get_project"
    }
    fn description(&self) -> &str {
        "Get details of a GitLab project."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" }
            },
            "required": ["project_id"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let v: Value = self.client.get(&format!("projects/{}", pid)).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct ListProjects {
    client: GitLabClient,
}
#[async_trait]
impl Tool for ListProjects {
    fn name(&self) -> &str {
        "list_projects"
    }
    fn description(&self) -> &str {
        "List projects the current user is a member of."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "per_page": { "type": "integer", "default": 20 }
            },
            "required": []
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let per_page = args["per_page"].as_u64().unwrap_or(20);
        let v: Vec<Value> = self
            .client
            .get(&format!("projects?membership=true&per_page={}", per_page))
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct SearchProjects {
    client: GitLabClient,
}
#[async_trait]
impl Tool for SearchProjects {
    fn name(&self) -> &str {
        "search_projects"
    }
    fn description(&self) -> &str {
        "Search for GitLab projects by name."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": { "type": "string" }
            },
            "required": ["query"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let query = urlencoding::encode(
            args["query"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("query required"))?,
        );
        let v: Vec<Value> = self
            .client
            .get(&format!("projects?search={}", query))
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}
