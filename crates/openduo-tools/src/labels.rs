use crate::registry::Tool;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::gitlab_client::GitLabClient;
use serde_json::{json, Value};

pub struct LabelTools;

impl LabelTools {
    pub fn all(client: GitLabClient) -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(ListLabels { client: client.clone() }),
            Box::new(CreateLabel { client: client.clone() }),
        ]
    }
}

struct ListLabels { client: GitLabClient }
#[async_trait]
impl Tool for ListLabels {
    fn name(&self) -> &str { "list_labels" }
    fn description(&self) -> &str { "List labels for a GitLab project." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" } }, "required": ["project_id"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let v: Vec<Value> = self.client.get(&format!("projects/{}/labels", pid)).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct CreateLabel { client: GitLabClient }
#[async_trait]
impl Tool for CreateLabel {
    fn name(&self) -> &str { "create_label" }
    fn description(&self) -> &str { "Create a new label in a GitLab project." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "name": { "type": "string" }, "color": { "type": "string", "description": "Hex color code e.g. #FF0000" } }, "required": ["project_id", "name", "color"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let v: Value = self.client.post(&format!("projects/{}/labels", pid), args).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}
