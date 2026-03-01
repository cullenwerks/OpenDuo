import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function groupTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'list_groups',
      description: 'List groups the current user is a member of.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          per_page: { type: 'integer', default: 20 },
        },
        required: [],
      }),
      async execute(args) {
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`groups?per_page=${perPage}`),
          null, 2,
        );
      },
    },
    {
      name: 'get_group',
      description: 'Get details of a GitLab group by ID or path.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Group ID or URL-encoded path' },
        },
        required: ['group_id'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        return JSON.stringify(await client.get(`groups/${gid}`), null, 2);
      },
    },
    {
      name: 'list_group_projects',
      description: 'List projects belonging to a group.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['group_id'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`groups/${gid}/projects?per_page=${perPage}`),
          null, 2,
        );
      },
    },
    {
      name: 'list_group_issues',
      description: 'List issues across all projects in a group.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string' },
          state: { type: 'string', enum: ['opened', 'closed', 'all'], default: 'opened' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['group_id'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        const state = (args.state as string) ?? 'opened';
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`groups/${gid}/issues?state=${state}&per_page=${perPage}`),
          null, 2,
        );
      },
    },
    {
      name: 'list_group_merge_requests',
      description: 'List merge requests across all projects in a group.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string' },
          state: { type: 'string', enum: ['opened', 'closed', 'merged', 'all'], default: 'opened' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['group_id'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        const state = (args.state as string) ?? 'opened';
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`groups/${gid}/merge_requests?state=${state}&per_page=${perPage}`),
          null, 2,
        );
      },
    },
    {
      name: 'list_group_members',
      description: 'List members of a GitLab group.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string' },
        },
        required: ['group_id'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        return JSON.stringify(await client.get(`groups/${gid}/members`), null, 2);
      },
    },
  ];
}
