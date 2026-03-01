import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function issueTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'list_issues',
      description: 'List issues for a GitLab project. Supports filtering by state, assignee, labels.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project ID or URL-encoded path' },
          state: { type: 'string', enum: ['opened', 'closed', 'all'], default: 'opened' },
          assignee_username: { type: 'string' },
          labels: { type: 'string' },
          per_page: { type: 'integer', default: 20, maximum: 100 },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const state = (args.state as string) ?? 'opened';
        const perPage = (args.per_page as number) ?? 20;
        let path = `projects/${pid}/issues?state=${state}&per_page=${perPage}`;
        if (args.assignee_username) path += `&assignee_username=${enc(args.assignee_username as string)}`;
        if (args.labels) path += `&labels=${enc(args.labels as string)}`;
        return JSON.stringify(await client.get(path), null, 2);
      },
    },
    {
      name: 'get_issue',
      description: 'Get a specific issue by IID.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          issue_iid: { type: 'integer' },
        },
        required: ['project_id', 'issue_iid'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(await client.get(`projects/${pid}/issues/${args.issue_iid}`), null, 2);
      },
    },
    {
      name: 'create_issue',
      description: 'Create a new issue in a GitLab project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          labels: { type: 'string' },
        },
        required: ['project_id', 'title'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const body: Record<string, unknown> = {};
        if (args.title) body.title = args.title;
        if (args.description) body.description = args.description;
        if (args.labels) body.labels = args.labels;
        return JSON.stringify(await client.post(`projects/${pid}/issues`, body), null, 2);
      },
    },
    {
      name: 'update_issue',
      description: "Update an existing issue's title, description, labels, or assignees.",
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          issue_iid: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string' },
          labels: { type: 'string' },
          state_event: { type: 'string', enum: ['close', 'reopen'] },
        },
        required: ['project_id', 'issue_iid'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const body: Record<string, unknown> = {};
        if (args.title) body.title = args.title;
        if (args.description) body.description = args.description;
        if (args.labels) body.labels = args.labels;
        if (args.state_event) body.state_event = args.state_event;
        return JSON.stringify(await client.put(`projects/${pid}/issues/${args.issue_iid}`, body), null, 2);
      },
    },
    {
      name: 'close_issue',
      description: 'Close an open issue.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          issue_iid: { type: 'integer' },
        },
        required: ['project_id', 'issue_iid'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.put(`projects/${pid}/issues/${args.issue_iid}`, { state_event: 'close' }),
          null, 2
        );
      },
    },
    {
      name: 'add_issue_comment',
      description: 'Add a note/comment to a GitLab issue.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          issue_iid: { type: 'integer' },
          body: { type: 'string' },
        },
        required: ['project_id', 'issue_iid', 'body'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.post(`projects/${pid}/issues/${args.issue_iid}/notes`, { body: args.body }),
          null, 2
        );
      },
    },
    {
      name: 'search_issues',
      description: 'Search issues in a project by keyword.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project ID or URL-encoded path' },
          query: { type: 'string', description: 'Search query' },
          state: { type: 'string', enum: ['opened', 'closed', 'all'], default: 'all' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['project_id', 'query'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const query = enc(args.query as string);
        const state = (args.state as string) ?? 'all';
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`projects/${pid}/issues?search=${query}&state=${state}&per_page=${perPage}`),
          null, 2
        );
      },
    },
  ];
}
