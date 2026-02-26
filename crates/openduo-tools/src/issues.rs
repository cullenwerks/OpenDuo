use crate::registry::Tool;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::gitlab_client::GitLabClient;
use serde_json::{json, Value};

pub struct IssuesTools;

impl IssuesTools {
    pub fn all(client: GitLabClient) -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(ListIssues {
                client: client.clone(),
            }),
            Box::new(GetIssue {
                client: client.clone(),
            }),
            Box::new(CreateIssue {
                client: client.clone(),
            }),
            Box::new(UpdateIssue {
                client: client.clone(),
            }),
            Box::new(CloseIssue {
                client: client.clone(),
            }),
            Box::new(AddIssueComment {
                client: client.clone(),
            }),
            Box::new(SearchIssues {
                client: client.clone(),
            }),
        ]
    }
}

struct ListIssues {
    client: GitLabClient,
}
#[async_trait]
impl Tool for ListIssues {
    fn name(&self) -> &str {
        "list_issues"
    }
    fn description(&self) -> &str {
        "List issues for a GitLab project. Supports filtering by state, assignee, labels."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID or URL-encoded path" },
                "state": { "type": "string", "enum": ["opened", "closed", "all"], "default": "opened" },
                "assignee_username": { "type": "string" },
                "labels": { "type": "string" },
                "per_page": { "type": "integer", "default": 20, "maximum": 100 }
            },
            "required": ["project_id"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let project_id = args["project_id"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("project_id required"))?;
        let encoded = urlencoding::encode(project_id);
        let state = args["state"].as_str().unwrap_or("opened");
        let per_page = args["per_page"].as_u64().unwrap_or(20);
        let mut path = format!(
            "projects/{}/issues?state={}&per_page={}",
            encoded, state, per_page
        );
        if let Some(a) = args["assignee_username"].as_str() {
            path.push_str(&format!("&assignee_username={}", urlencoding::encode(a)));
        }
        if let Some(l) = args["labels"].as_str() {
            path.push_str(&format!("&labels={}", urlencoding::encode(l)));
        }
        let issues: Vec<Value> = self.client.get(&path).await?;
        Ok(serde_json::to_string_pretty(&issues)?)
    }
}

struct GetIssue {
    client: GitLabClient,
}
#[async_trait]
impl Tool for GetIssue {
    fn name(&self) -> &str {
        "get_issue"
    }
    fn description(&self) -> &str {
        "Get a specific issue by IID."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "issue_iid": { "type": "integer" }
            },
            "required": ["project_id", "issue_iid"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let iid = args["issue_iid"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        let v: Value = self
            .client
            .get(&format!("projects/{}/issues/{}", pid, iid))
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct CreateIssue {
    client: GitLabClient,
}
#[async_trait]
impl Tool for CreateIssue {
    fn name(&self) -> &str {
        "create_issue"
    }
    fn description(&self) -> &str {
        "Create a new issue in a GitLab project."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "labels": { "type": "string" }
            },
            "required": ["project_id", "title"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        // Build body with only API-relevant fields (exclude project_id)
        let mut body = json!({});
        if let Some(title) = args["title"].as_str() {
            body["title"] = json!(title);
        }
        if let Some(desc) = args["description"].as_str() {
            body["description"] = json!(desc);
        }
        if let Some(labels) = args["labels"].as_str() {
            body["labels"] = json!(labels);
        }
        let v: Value = self
            .client
            .post(&format!("projects/{}/issues", pid), body)
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct UpdateIssue {
    client: GitLabClient,
}
#[async_trait]
impl Tool for UpdateIssue {
    fn name(&self) -> &str {
        "update_issue"
    }
    fn description(&self) -> &str {
        "Update an existing issue's title, description, labels, or assignees."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "issue_iid": { "type": "integer" },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "labels": { "type": "string" },
                "state_event": { "type": "string", "enum": ["close", "reopen"] }
            },
            "required": ["project_id", "issue_iid"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let iid = args["issue_iid"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        // Build body with only API-relevant fields
        let mut body = json!({});
        if let Some(v) = args["title"].as_str() {
            body["title"] = json!(v);
        }
        if let Some(v) = args["description"].as_str() {
            body["description"] = json!(v);
        }
        if let Some(v) = args["labels"].as_str() {
            body["labels"] = json!(v);
        }
        if let Some(v) = args["state_event"].as_str() {
            body["state_event"] = json!(v);
        }
        let v: Value = self
            .client
            .put(&format!("projects/{}/issues/{}", pid, iid), body)
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct CloseIssue {
    client: GitLabClient,
}
#[async_trait]
impl Tool for CloseIssue {
    fn name(&self) -> &str {
        "close_issue"
    }
    fn description(&self) -> &str {
        "Close an open issue."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "issue_iid": { "type": "integer" }
            },
            "required": ["project_id", "issue_iid"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let iid = args["issue_iid"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        let v: Value = self
            .client
            .put(
                &format!("projects/{}/issues/{}", pid, iid),
                json!({ "state_event": "close" }),
            )
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct AddIssueComment {
    client: GitLabClient,
}
#[async_trait]
impl Tool for AddIssueComment {
    fn name(&self) -> &str {
        "add_issue_comment"
    }
    fn description(&self) -> &str {
        "Add a note/comment to a GitLab issue."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "issue_iid": { "type": "integer" },
                "body": { "type": "string" }
            },
            "required": ["project_id", "issue_iid", "body"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let iid = args["issue_iid"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        let v: Value = self
            .client
            .post(
                &format!("projects/{}/issues/{}/notes", pid, iid),
                json!({ "body": args["body"] }),
            )
            .await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct SearchIssues {
    client: GitLabClient,
}
#[async_trait]
impl Tool for SearchIssues {
    fn name(&self) -> &str {
        "search_issues"
    }
    fn description(&self) -> &str {
        "Search issues in a project by keyword."
    }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID or URL-encoded path" },
                "query": { "type": "string", "description": "Search query" },
                "state": { "type": "string", "enum": ["opened", "closed", "all"], "default": "all" },
                "per_page": { "type": "integer", "default": 20 }
            },
            "required": ["project_id", "query"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(
            args["project_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("project_id required"))?,
        );
        let query = urlencoding::encode(
            args["query"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("query required"))?,
        );
        let state = args["state"].as_str().unwrap_or("all");
        let per_page = args["per_page"].as_u64().unwrap_or(20);
        let issues: Vec<Value> = self
            .client
            .get(&format!(
                "projects/{}/issues?search={}&state={}&per_page={}",
                pid, query, state, per_page
            ))
            .await?;
        Ok(serde_json::to_string_pretty(&issues)?)
    }
}
