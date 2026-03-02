import type { Config, WorkspaceFolder } from '../config';
import { GitLabClient } from '../gitlabClient';
import type { ToolDefinition } from '../types';
import type { Tool, ToolContext } from './tool';
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
import { graphqlQueryTools } from './graphqlQueries';
import { snippetTools } from './snippets';
import { groupTools } from './groups';
import { environmentTools } from './environments';
import { wikiTools } from './wiki';
import { workspaceTools } from './workspace';
import { editorContextTools } from './editorContext';
import { diagnosticsTools } from './diagnostics';

export class ToolRegistry {
  private tools: Map<string, Tool>;
  private _activeFolder: WorkspaceFolder | undefined;
  readonly workspaceFolders: WorkspaceFolder[];

  constructor(config: Config) {
    const client = new GitLabClient(config);
    this.tools = new Map();
    this.workspaceFolders = config.workspaceFolders;

    // Default to the first workspace folder if available
    this._activeFolder = config.workspaceFolders[0];

    const allTools = [
      // REST API tools
      ...issueTools(client),
      ...mergeRequestTools(client),
      ...pipelineTools(client),
      ...repositoryTools(client),
      ...projectTools(client),
      ...userTools(client),
      ...cicdTools(client),
      ...milestoneTools(client),
      ...labelTools(client),
      ...snippetTools(client),
      ...groupTools(client),
      ...environmentTools(client),
      ...wikiTools(client),
      // GraphQL API tools (richer queries)
      ...graphqlQueryTools(client),
      // Local workspace tools (read, list, search local files)
      ...workspaceTools(
        config.workspaceFolders,
        () => this._activeFolder,
      ),
      // Editor context tools (IPC to extension host)
      ...editorContextTools(),
      // Diagnostics tools (IPC to extension host)
      ...diagnosticsTools(),
    ];

    for (const tool of allTools) {
      this.tools.set(tool.name, tool);
    }
  }

  get activeFolder(): WorkspaceFolder | undefined {
    return this._activeFolder;
  }

  setActiveFolder(name: string): boolean {
    const folder = this.workspaceFolders.find(f => f.name === name);
    if (folder) {
      this._activeFolder = folder;
      return true;
    }
    return false;
  }

  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(toolDefinition);
  }

  async execute(name: string, args: Record<string, unknown>, context?: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    console.log(`[tool] Invoking ${name} with args: ${JSON.stringify(args)}`);
    const result = await tool.execute(args, context);
    console.log(`[tool] ${name} returned ${result.length} chars`);
    return result;
  }
}
