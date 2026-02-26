use crate::registry::Tool;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::gitlab_client::GitLabClient;
use serde_json::{json, Value};

pub struct PipelineTools;

impl PipelineTools {
    pub fn all(client: GitLabClient) -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(ListPipelines {
                client: client.clone(),
            }),
            Box::new(GetPipeline {
                client: client.clone(),
            }),
            Box::new(TriggerPipeline {
                client: client.clone(),
            }),
            Box::new(RetryPipeline {
                client: client.clone(),
            }),
            Box::new(CancelPipeline {
                client: client.clone(),
            }),
            Box::new(GetPipelineJobs {
                client: client.clone(),
            }),
            Box::new(GetJobLog {
                client: client.clone(),
            }),
        ]
    }
}

struct ListPipelines {
    client: GitLabClient,
}
#[async_trait]
impl Tool for ListPipelines {
    fn name(&self) -> &str {
        "list_pipelines"
    }
    fn description(&self) -> &str {
        "List pipelines for a project."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "per_page": { "type": "integer", "default": 20 }
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
        let per_page = args["per_page"].as_u64().unwrap_or(20);
        let v: Vec<Value> = self
            .client
            .get(&format!("projects/{}/pipelines?per_page={}", pid, per_page))
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct GetPipeline {
    client: GitLabClient,
}
#[async_trait]
impl Tool for GetPipeline {
    fn name(&self) -> &str {
        "get_pipeline"
    }
    fn description(&self) -> &str {
        "Get details of a specific pipeline."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "pipeline_id": { "type": "integer" }
            },
            "required": ["project_id", "pipeline_id"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let pipeline_id = args["pipeline_id"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("pipeline_id required"))?;
        let v: Value = self
            .client
            .get(&format!("projects/{}/pipelines/{}", pid, pipeline_id))
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct TriggerPipeline {
    client: GitLabClient,
}
#[async_trait]
impl Tool for TriggerPipeline {
    fn name(&self) -> &str {
        "trigger_pipeline"
    }
    fn description(&self) -> &str {
        "Trigger a new pipeline for a ref."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "ref": { "type": "string", "description": "Branch or tag name" }
            },
            "required": ["project_id", "ref"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let v: Value = self
            .client
            .post(
                &format!("projects/{}/pipeline", pid),
                json!({ "ref": args["ref"] }),
            )
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct RetryPipeline {
    client: GitLabClient,
}
#[async_trait]
impl Tool for RetryPipeline {
    fn name(&self) -> &str {
        "retry_pipeline"
    }
    fn description(&self) -> &str {
        "Retry a failed pipeline."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "pipeline_id": { "type": "integer" }
            },
            "required": ["project_id", "pipeline_id"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let pipeline_id = args["pipeline_id"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("pipeline_id required"))?;
        let v: Value = self
            .client
            .post(
                &format!("projects/{}/pipelines/{}/retry", pid, pipeline_id),
                json!({}),
            )
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct CancelPipeline {
    client: GitLabClient,
}
#[async_trait]
impl Tool for CancelPipeline {
    fn name(&self) -> &str {
        "cancel_pipeline"
    }
    fn description(&self) -> &str {
        "Cancel a running pipeline."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "pipeline_id": { "type": "integer" }
            },
            "required": ["project_id", "pipeline_id"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let pipeline_id = args["pipeline_id"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("pipeline_id required"))?;
        let v: Value = self
            .client
            .post(
                &format!("projects/{}/pipelines/{}/cancel", pid, pipeline_id),
                json!({}),
            )
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct GetPipelineJobs {
    client: GitLabClient,
}
#[async_trait]
impl Tool for GetPipelineJobs {
    fn name(&self) -> &str {
        "get_pipeline_jobs"
    }
    fn description(&self) -> &str {
        "List all jobs for a specific pipeline."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "pipeline_id": { "type": "integer" },
                "per_page": { "type": "integer", "default": 100 }
            },
            "required": ["project_id", "pipeline_id"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let pipeline_id = args["pipeline_id"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("pipeline_id required"))?;
        let per_page = args["per_page"].as_u64().unwrap_or(100);
        let v: Vec<Value> = self
            .client
            .get(&format!(
                "projects/{}/pipelines/{}/jobs?per_page={}",
                pid, pipeline_id, per_page
            ))
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct GetJobLog {
    client: GitLabClient,
}
#[async_trait]
impl Tool for GetJobLog {
    fn name(&self) -> &str {
        "get_job_log"
    }
    fn description(&self) -> &str {
        "Get the log/trace of a CI job."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "job_id": { "type": "integer" }
            },
            "required": ["project_id", "job_id"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let job_id = args["job_id"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("job_id required"))?;
        let resp = self
            .client
            .get_raw(
                &self
                    .client
                    .api_url(&format!("projects/{}/jobs/{}/trace", pid, job_id)),
            )
            .await?;
        Ok(resp.text().await?)
    }
}
