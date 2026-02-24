use crate::cicd::CicdTools;
use crate::issues::IssuesTools;
use crate::labels::LabelTools;
use crate::merge_requests::MergeRequestTools;
use crate::milestones::MilestoneTools;
use crate::pipelines::PipelineTools;
use crate::projects::ProjectTools;
use crate::repositories::RepositoryTools;
use crate::users::UserTools;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::{config::Config, gitlab_client::GitLabClient, types::ToolDefinition};
use std::collections::HashMap;

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> serde_json::Value;
    async fn execute(&self, args: serde_json::Value) -> Result<String>;

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters_schema(),
        }
    }
}

pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new(config: Config) -> Self {
        let client = GitLabClient::new(config);
        let mut tools: HashMap<String, Box<dyn Tool>> = HashMap::new();

        for tool in IssuesTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in MergeRequestTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in PipelineTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in RepositoryTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in ProjectTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in UserTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in CicdTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in MilestoneTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in LabelTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }

        Self { tools }
    }

    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.tools.values().map(|t| t.definition()).collect()
    }

    pub async fn execute(&self, name: &str, args: serde_json::Value) -> Result<String> {
        let span = tracing::info_span!("tool_execute", tool_name = %name);
        let _enter = span.enter();
        tracing::info!(tool = %name, args = %args, "Tool invocation");
        match self.tools.get(name) {
            Some(tool) => {
                let result = tool.execute(args).await;
                match &result {
                    Ok(r) => tracing::info!(tool = %name, result_len = r.len(), "Tool success"),
                    Err(e) => tracing::error!(tool = %name, error = %e, "Tool failed"),
                }
                result
            }
            None => anyhow::bail!("Unknown tool: {}", name),
        }
    }
}
