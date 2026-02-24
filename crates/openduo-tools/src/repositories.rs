use crate::registry::Tool;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::gitlab_client::GitLabClient;
use serde_json::{json, Value};

pub struct RepositoryTools;

impl RepositoryTools {
    pub fn all(client: GitLabClient) -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(GetFile { client: client.clone() }),
            Box::new(ListFiles { client: client.clone() }),
            Box::new(SearchCode { client: client.clone() }),
            Box::new(GetCommit { client: client.clone() }),
            Box::new(ListCommits { client: client.clone() }),
            Box::new(CompareRefs { client: client.clone() }),
        ]
    }
}

struct GetFile { client: GitLabClient }
#[async_trait]
impl Tool for GetFile {
    fn name(&self) -> &str { "get_file" }
    fn description(&self) -> &str { "Get a file's content from a GitLab repository." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "file_path": { "type": "string" }, "ref": { "type": "string", "default": "main" } }, "required": ["project_id", "file_path"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let file_path = urlencoding::encode(args["file_path"].as_str().unwrap_or_default());
        let git_ref = args["ref"].as_str().unwrap_or("main");
        let v: Value = self.client.get(&format!("projects/{}/repository/files/{}?ref={}", pid, file_path, git_ref)).await?;
        let content = v["content"].as_str().unwrap_or("");
        use base64::{Engine, engine::general_purpose::STANDARD};
        let decoded = STANDARD.decode(content).unwrap_or_default();
        Ok(String::from_utf8_lossy(&decoded).to_string())
    }
}

struct ListFiles { client: GitLabClient }
#[async_trait]
impl Tool for ListFiles {
    fn name(&self) -> &str { "list_files" }
    fn description(&self) -> &str { "List files in a repository directory." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "path": { "type": "string", "default": "" }, "ref": { "type": "string", "default": "main" } }, "required": ["project_id"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let path = args["path"].as_str().unwrap_or("");
        let git_ref = args["ref"].as_str().unwrap_or("main");
        let v: Vec<Value> = self.client.get(&format!("projects/{}/repository/tree?path={}&ref={}", pid, path, git_ref)).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct SearchCode { client: GitLabClient }
#[async_trait]
impl Tool for SearchCode {
    fn name(&self) -> &str { "search_code" }
    fn description(&self) -> &str { "Search for code in a GitLab project." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "query": { "type": "string" } }, "required": ["project_id", "query"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let query = urlencoding::encode(args["query"].as_str().unwrap_or_default());
        let v: Vec<Value> = self.client.get(&format!("projects/{}/search?scope=blobs&search={}", pid, query)).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct GetCommit { client: GitLabClient }
#[async_trait]
impl Tool for GetCommit {
    fn name(&self) -> &str { "get_commit" }
    fn description(&self) -> &str { "Get details of a specific commit." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "sha": { "type": "string" } }, "required": ["project_id", "sha"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let sha = args["sha"].as_str().unwrap_or_default();
        let v: Value = self.client.get(&format!("projects/{}/repository/commits/{}", pid, sha)).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct ListCommits { client: GitLabClient }
#[async_trait]
impl Tool for ListCommits {
    fn name(&self) -> &str { "list_commits" }
    fn description(&self) -> &str { "List commits for a branch." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "ref_name": { "type": "string", "default": "main" }, "per_page": { "type": "integer", "default": 20 } }, "required": ["project_id"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let ref_name = args["ref_name"].as_str().unwrap_or("main");
        let per_page = args["per_page"].as_u64().unwrap_or(20);
        let v: Vec<Value> = self.client.get(&format!("projects/{}/repository/commits?ref_name={}&per_page={}", pid, ref_name, per_page)).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}

struct CompareRefs { client: GitLabClient }
#[async_trait]
impl Tool for CompareRefs {
    fn name(&self) -> &str { "compare_refs" }
    fn description(&self) -> &str { "Compare two refs (branches, tags, commits)." }
    fn parameters_schema(&self) -> Value { json!({ "type": "object", "properties": { "project_id": { "type": "string" }, "from": { "type": "string" }, "to": { "type": "string" } }, "required": ["project_id", "from", "to"] }) }
    async fn execute(&self, args: Value) -> Result<String> {
        let pid = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let from = args["from"].as_str().unwrap_or_default();
        let to = args["to"].as_str().unwrap_or_default();
        let v: Value = self.client.get(&format!("projects/{}/repository/compare?from={}&to={}", pid, from, to)).await?;
        Ok(serde_json::to_string_pretty(&v)?)
    }
}
