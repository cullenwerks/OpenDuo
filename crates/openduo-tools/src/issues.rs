use crate::registry::Tool;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::gitlab_client::GitLabClient;
use serde_json::{json, Value};

pub struct IssuesTools;

impl IssuesTools {
    pub fn all(client: GitLabClient) -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(ListIssues { client: client.clone() }),
            Box::new(GetIssue { client: client.clone() }),
            Box::new(CreateIssue { client: client.clone() }),
            Box::new(UpdateIssue { client: client.clone() }),
            Box::new(CloseIssue { client: client.clone() }),
            Box::new(AddIssueComment { client: client.clone() }),
        ]
    }
}

struct ListIssues { client: GitLabClient }
#[async_trait]
impl Tool for ListIssues {
    fn name(&self) -> &str { "list_issues" }
    fn description(&self) -> &str { "List issues for a GitLab project. Supports filtering by state, assignee, labels." }
    fn parameters_schema(&self) -> Value {
        json!({ "type": "object", "properties": { "project_id": { "type": "string", "description": "Project ID or URL-encoded path" }, "state": { "type": "string", "enum": ["opened", "closed", "all"], "default": "opened" }, "assignee_username": { "type": "string" }, "labels": { "type": "string" }, "per_page": { "type": "integer", "default": 20, "maximum": 100 } }, "required": ["project_id"] })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let project_id = args["project_id"].as_str().ok_or_else(|| anyhow::anyhow!("project_id required"))?;
        let encoded = urlencoding::encode(project_id);
        let state = args["state"].as_str().unwrap_or("opened");
        let per_page = args["per_page"].as_u64().unwrap_or(20);
        let mut path = format!("projects/{}/issues?state={}&per_page={}", encoded, state, per_page);
        if let Some(a) = args["assignee_username"].as_str() { path.push_str(&format!("&assignee_username={}", a)); }
        if let Some(l) = args["labels"].as_str() { path.push_str(&format!("&labels={}", l)); }
        let issues: Vec<Value> = self.client.get(&path).await?;
        Ok(serde_json::to_string_pretty(&issues)?)
    }
}

struct GetIssue { client: GitLabClient }
#[async_trait]
impl Tool for GetIssue {
    fn name(&self) -> &str { "get_issue" }
    fn description(&self) -> &str { "Get a specific issue by IID." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "issue_iid": { "type": "integer" } }, "required": ["project_id", "issue_iid"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let iid = args["issue_iid"].as_u64().ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        let v: Value = self.client.get(&format!("projects/{}/issues/{}", pid, iid)).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct CreateIssue { client: GitLabClient }
#[async_trait]
impl Tool for CreateIssue {
    fn name(&self) -> &str { "create_issue" }
    fn description(&self) -> &str { "Create a new issue in a GitLab project." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "title": { "type": "string" }, "description": { "type": "string" }, "labels": { "type": "string" } }, "required": ["project_id", "title"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let v: Value = self.client.post(&format!("projects/{}/issues", pid), args).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct UpdateIssue { client: GitLabClient }
#[async_trait]
impl Tool for UpdateIssue {
    fn name(&self) -> &str { "update_issue" }
    fn description(&self) -> &str { "Update an existing issue's title, description, labels, or assignees." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "issue_iid": { "type": "integer" }, "title": { "type": "string" }, "description": { "type": "string" }, "labels": { "type": "string" }, "state_event": { "type": "string", "enum": ["close", "reopen"] } }, "required": ["project_id", "issue_iid"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let iid = args["issue_iid"].as_u64().ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        let v: Value = self.client.put(&format!("projects/{}/issues/{}", pid, iid), args).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct CloseIssue { client: GitLabClient }
#[async_trait]
impl Tool for CloseIssue {
    fn name(&self) -> &str { "close_issue" }
    fn description(&self) -> &str { "Close an open issue." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "issue_iid": { "type": "integer" } }, "required": ["project_id", "issue_iid"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let iid = args["issue_iid"].as_u64().ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        let v: Value = self.client.put(&format!("projects/{}/issues/{}", pid, iid), json!({ "state_event": "close" })).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct AddIssueComment { client: GitLabClient }
#[async_trait]
impl Tool for AddIssueComment {
    fn name(&self) -> &str { "add_issue_comment" }
    fn description(&self) -> &str { "Add a note/comment to a GitLab issue." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "issue_iid": { "type": "integer" }, "body": { "type": "string" } }, "required": ["project_id", "issue_iid", "body"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let iid = args["issue_iid"].as_u64().ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        let v: Value = self.client.post(&format!("projects/{}/issues/{}/notes", pid, iid), json!({ "body": args["body"] })).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}
