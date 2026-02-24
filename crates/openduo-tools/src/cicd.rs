use crate::registry::Tool;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::gitlab_client::GitLabClient;
use serde_json::{json, Value};

pub struct CicdTools;

impl CicdTools {
    pub fn all(client: GitLabClient) -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(GetPipelineYaml { client: client.clone() }),
            Box::new(ValidatePipelineYaml { client: client.clone() }),
            Box::new(ListRunners { client: client.clone() }),
        ]
    }
}

struct GetPipelineYaml { client: GitLabClient }
#[async_trait]
impl Tool for GetPipelineYaml {
    fn name(&self) -> &str { "get_pipeline_yaml" }
    fn description(&self) -> &str { "Get the .gitlab-ci.yml pipeline configuration for a project." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "ref": { "type": "string", "default": "main" } }, "required": ["project_id"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let git_ref = args["ref"].as_str().unwrap_or("main");
        let file_path = urlencoding::encode(".gitlab-ci.yml");
        let v: Value = self.client.get(&format!("projects/{}/repository/files/{}?ref={}", pid, file_path, git_ref)).await?;
        let content = v["content"].as_str().unwrap_or("");
        use base64::{Engine, engine::general_purpose::STANDARD};
        let decoded = STANDARD.decode(content).unwrap_or_default();
        Ok(String::from_utf8_lossy(&decoded).to_string())
    }
}

struct ValidatePipelineYaml { client: GitLabClient }
#[async_trait]
impl Tool for ValidatePipelineYaml {
    fn name(&self) -> &str { "validate_pipeline_yaml" }
    fn description(&self) -> &str { "Validate a .gitlab-ci.yml configuration." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "content": { "type": "string", "description": "YAML content to validate" } }, "required": ["content"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let v: Value = self.client.post("ci/lint", json!({ "content": args["content"] })).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct ListRunners { client: GitLabClient }
#[async_trait]
impl Tool for ListRunners {
    fn name(&self) -> &str { "list_runners" }
    fn description(&self) -> &str { "List active GitLab runners." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": {}, "required": [] }) }
    async fn execute(&self, _args: Value) -> Result<String> {
        let v: Vec<Value> = self.client.get("runners?scope=active").await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}
