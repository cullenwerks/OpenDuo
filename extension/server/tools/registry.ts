import type { Config } from '../config';
import { GitLabClient } from '../gitlabClient';
import type { ToolDefinition } from '../types';
import type { Tool } from './tool';
import { toolDefinition } from './tool';
import { issueTools } from './issues';
import { mergeRequestTools } from './mergeRequests';
import { pipelineTools } from './pipelines';
import { repositoryTools } from './repositories';
import { projectTools } from './projects';
import { userTools } from './users';
import { cicdTools } from './cicd';
import { milestoneTools } from './milestones';
import { labelTools } from './labels';

export class ToolRegistry {
  private tools: Map<string, Tool>;

  constructor(config: Config) {
    const client = new GitLabClient(config);
    this.tools = new Map();

    const allTools = [
      ...issueTools(client),
      ...mergeRequestTools(client),
      ...pipelineTools(client),
      ...repositoryTools(client),
      ...projectTools(client),
      ...userTools(client),
      ...cicdTools(client),
      ...milestoneTools(client),
      ...labelTools(client),
    ];

    for (const tool of allTools) {
      this.tools.set(tool.name, tool);
    }
  }

  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(toolDefinition);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    console.log(`[tool] Invoking ${name} with args: ${JSON.stringify(args)}`);
    const result = await tool.execute(args);
    console.log(`[tool] ${name} returned ${result.length} chars`);
    return result;
  }
}
