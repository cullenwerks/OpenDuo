use crate::registry::Tool;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::gitlab_client::GitLabClient;
use serde_json::{json, Value};

pub struct UserTools;

impl UserTools {
    pub fn all(client: GitLabClient) -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(GetCurrentUser { client: client.clone() }),
            Box::new(ListProjectMembers { client: client.clone() }),
        ]
    }
}

struct GetCurrentUser { client: GitLabClient }
#[async_trait]
impl Tool for GetCurrentUser {
    fn name(&self) -> &str { "get_current_user" }
    fn description(&self) -> &str { "Get the currently authenticated GitLab user." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": {}, "required": [] }) }
    async fn execute(&self, _args: Value) -> Result<String> {
        let v: Value = self.client.get("user").await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct ListProjectMembers { client: GitLabClient }
#[async_trait]
impl Tool for ListProjectMembers {
    fn name(&self) -> &str { "list_project_members" }
    fn description(&self) -> &str { "List members of a GitLab project." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" } }, "required": ["project_id"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let v: Vec<Value> = self.client.get(&format!("projects/{}/members", pid)).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}
