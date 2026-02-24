use crate::registry::Tool;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::gitlab_client::GitLabClient;
use serde_json::{json, Value};

pub struct MilestoneTools;

impl MilestoneTools {
    pub fn all(client: GitLabClient) -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(ListMilestones { client: client.clone() }),
        ]
    }
}

struct ListMilestones { client: GitLabClient }
#[async_trait]
impl Tool for ListMilestones {
    fn name(&self) -> &str { "list_milestones" }
    fn description(&self) -> &str { "List milestones for a GitLab project." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" } }, "required": ["project_id"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let v: Vec<Value> = self.client.get(&format!("projects/{}/milestones", pid)).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}
