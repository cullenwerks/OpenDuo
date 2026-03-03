import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function mergeRequestTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'list_mrs',
      description: 'List merge requests for a GitLab project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          state: { type: 'string', enum: ['opened', 'closed', 'merged', 'all'], default: 'opened' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const state = (args.state as string) ?? 'opened';
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`projects/${pid}/merge_requests?state=${state}&per_page=${perPage}`),
          null, 2
        );
      },
    },
    {
      name: 'get_mr',
      description: 'Get a specific merge request by IID.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          mr_iid: { type: 'integer' },
        },
        required: ['project_id', 'mr_iid'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(await client.get(`projects/${pid}/merge_requests/${args.mr_iid}`), null, 2);
      },
    },
    {
      name: 'create_mr',
      description: 'Create a merge request.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          source_branch: { type: 'string' },
          target_branch: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          assignee_ids: {
            type: 'array',
            items: { type: 'integer' },
            description: 'List of user IDs to assign',
          },
          labels: {
            type: 'string',
            description: 'Comma-separated label names',
          },
          milestone_id: {
            type: 'integer',
            description: 'Milestone ID to attach',
          },
        },
        required: ['project_id', 'source_branch', 'target_branch', 'title'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const body: Record<string, unknown> = {};
        body.source_branch = args.source_branch;
        body.target_branch = args.target_branch;
        if (args.title) body.title = args.title;
        if (args.description) body.description = args.description;
        if (args.assignee_ids) body.assignee_ids = args.assignee_ids;
        if (args.labels) body.labels = args.labels;
        if (args.milestone_id != null) body.milestone_id = args.milestone_id;
        return JSON.stringify(await client.post(`projects/${pid}/merge_requests`, body), null, 2);
      },
    },
    {
      name: 'update_mr',
      description: 'Update a merge request.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          mr_iid: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string' },
          state_event: { type: 'string', enum: ['close', 'reopen'] },
          assignee_ids: {
            type: 'array',
            items: { type: 'integer' },
            description: 'List of user IDs to assign',
          },
          labels: {
            type: 'string',
            description: 'Comma-separated label names',
          },
          milestone_id: {
            type: 'integer',
            description: 'Milestone ID to attach',
          },
        },
        required: ['project_id', 'mr_iid'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const body: Record<string, unknown> = {};
        if (args.title) body.title = args.title;
        if (args.description) body.description = args.description;
        if (args.state_event) body.state_event = args.state_event;
        if (args.assignee_ids) body.assignee_ids = args.assignee_ids;
        if (args.labels) body.labels = args.labels;
        if (args.milestone_id != null) body.milestone_id = args.milestone_id;
        return JSON.stringify(
          await client.put(`projects/${pid}/merge_requests/${args.mr_iid}`, body),
          null, 2
        );
      },
    },
    {
      name: 'merge_mr',
      description: 'Merge a merge request.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          mr_iid: { type: 'integer' },
        },
        required: ['project_id', 'mr_iid'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.put(`projects/${pid}/merge_requests/${args.mr_iid}/merge`, {}),
          null, 2
        );
      },
    },
    {
      name: 'add_mr_comment',
      description: 'Add a comment to a merge request.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          mr_iid: { type: 'integer' },
          body: { type: 'string' },
        },
        required: ['project_id', 'mr_iid', 'body'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.post(`projects/${pid}/merge_requests/${args.mr_iid}/notes`, { body: args.body }),
          null, 2
        );
      },
    },
    {
      name: 'get_mr_changes',
      description: 'Get the file-by-file changes/diff of a merge request.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          mr_iid: { type: 'integer' },
        },
        required: ['project_id', 'mr_iid'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.get(`projects/${pid}/merge_requests/${args.mr_iid}/changes`),
          null, 2
        );
      },
    },
    {
      name: 'search_merge_requests',
      description: 'Search merge requests in a project by keyword.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project ID or URL-encoded path' },
          query: { type: 'string', description: 'Search query' },
          state: { type: 'string', enum: ['opened', 'closed', 'merged', 'all'], default: 'all' },
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
          await client.get(`projects/${pid}/merge_requests?search=${query}&state=${state}&per_page=${perPage}`),
          null, 2
        );
      },
    },
  ];
}
