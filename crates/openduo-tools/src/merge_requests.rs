use crate::registry::Tool;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::gitlab_client::GitLabClient;
use serde_json::{json, Value};

pub struct MergeRequestTools;

impl MergeRequestTools {
    pub fn all(client: GitLabClient) -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(ListMrs {
                client: client.clone(),
            }),
            Box::new(GetMr {
                client: client.clone(),
            }),
            Box::new(CreateMr {
                client: client.clone(),
            }),
            Box::new(UpdateMr {
                client: client.clone(),
            }),
            Box::new(MergeMr {
                client: client.clone(),
            }),
            Box::new(AddMrComment {
                client: client.clone(),
            }),
            Box::new(GetMrDiff {
                client: client.clone(),
            }),
        ]
    }
}

struct ListMrs {
    client: GitLabClient,
}
#[async_trait]
impl Tool for ListMrs {
    fn name(&self) -> &str {
        "list_mrs"
    }
    fn description(&self) -> &str {
        "List merge requests for a GitLab project."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "state": { "type": "string", "enum": ["opened", "closed", "merged", "all"], "default": "opened" },
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
        let state = args["state"].as_str().unwrap_or("opened");
        let per_page = args["per_page"].as_u64().unwrap_or(20);
        let mrs: Vec<Value> = self
            .client
            .get(&format!(
                "projects/{}/merge_requests?state={}&per_page={}",
                pid, state, per_page
            ))
            .await?;
        Ok(serde_json::to_string_pretty(&mrs)?)
    }
}

struct GetMr {
    client: GitLabClient,
}
#[async_trait]
impl Tool for GetMr {
    fn name(&self) -> &str {
        "get_mr"
    }
    fn description(&self) -> &str {
        "Get a specific merge request by IID."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "mr_iid": { "type": "integer" }
            },
            "required": ["project_id", "mr_iid"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let iid = args["mr_iid"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("mr_iid required"))?;
        let v: Value = self
            .client
            .get(&format!("projects/{}/merge_requests/{}", pid, iid))
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct CreateMr {
    client: GitLabClient,
}
#[async_trait]
impl Tool for CreateMr {
    fn name(&self) -> &str {
        "create_mr"
    }
    fn description(&self) -> &str {
        "Create a merge request."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "source_branch": { "type": "string" },
                "target_branch": { "type": "string" },
                "title": { "type": "string" },
                "description": { "type": "string" }
            },
            "required": ["project_id", "source_branch", "target_branch", "title"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        // Build body with only API-relevant fields
        let mut body = json!({});
        if let Some(v) = args["source_branch"].as_str() {
            body["source_branch"] = json!(v);
        }
        if let Some(v) = args["target_branch"].as_str() {
            body["target_branch"] = json!(v);
        }
        if let Some(v) = args["title"].as_str() {
            body["title"] = json!(v);
        }
        if let Some(v) = args["description"].as_str() {
            body["description"] = json!(v);
        }
        let v: Value = self
            .client
            .post(&format!("projects/{}/merge_requests", pid), body)
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct UpdateMr {
    client: GitLabClient,
}
#[async_trait]
impl Tool for UpdateMr {
    fn name(&self) -> &str {
        "update_mr"
    }
    fn description(&self) -> &str {
        "Update a merge request."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "mr_iid": { "type": "integer" },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "state_event": { "type": "string", "enum": ["close", "reopen"] }
            },
            "required": ["project_id", "mr_iid"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let iid = args["mr_iid"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("mr_iid required"))?;
        // Build body with only API-relevant fields
        let mut body = json!({});
        if let Some(v) = args["title"].as_str() {
            body["title"] = json!(v);
        }
        if let Some(v) = args["description"].as_str() {
            body["description"] = json!(v);
        }
        if let Some(v) = args["state_event"].as_str() {
            body["state_event"] = json!(v);
        }
        let v: Value = self
            .client
            .put(&format!("projects/{}/merge_requests/{}", pid, iid), body)
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct MergeMr {
    client: GitLabClient,
}
#[async_trait]
impl Tool for MergeMr {
    fn name(&self) -> &str {
        "merge_mr"
    }
    fn description(&self) -> &str {
        "Merge a merge request."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "mr_iid": { "type": "integer" }
            },
            "required": ["project_id", "mr_iid"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let iid = args["mr_iid"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("mr_iid required"))?;
        let v: Value = self
            .client
            .put(
                &format!("projects/{}/merge_requests/{}/merge", pid, iid),
                json!({}),
            )
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct AddMrComment {
    client: GitLabClient,
}
#[async_trait]
impl Tool for AddMrComment {
    fn name(&self) -> &str {
        "add_mr_comment"
    }
    fn description(&self) -> &str {
        "Add a comment to a merge request."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "mr_iid": { "type": "integer" },
                "body": { "type": "string" }
            },
            "required": ["project_id", "mr_iid", "body"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let iid = args["mr_iid"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("mr_iid required"))?;
        let v: Value = self
            .client
            .post(
                &format!("projects/{}/merge_requests/{}/notes", pid, iid),
                json!({ "body": args["body"] }),
            )
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct GetMrDiff {
    client: GitLabClient,
}
#[async_trait]
impl Tool for GetMrDiff {
    fn name(&self) -> &str {
        "get_mr_diff"
    }
    fn description(&self) -> &str {
        "Get the diff of a merge request."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "mr_iid": { "type": "integer" }
            },
            "required": ["project_id", "mr_iid"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let iid = args["mr_iid"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("mr_iid required"))?;
        let v: Vec<Value> = self
            .client
            .get(&format!("projects/{}/merge_requests/{}/diffs", pid, iid))
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}
