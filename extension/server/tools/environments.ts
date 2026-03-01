import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function environmentTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'list_environments',
      description: 'List environments for a GitLab project (REST API).',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project ID or URL-encoded path' },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.get(`projects/${pid}/environments`),
          null, 2,
        );
      },
    },
    {
      name: 'get_environment',
      description: 'Get a specific environment by ID.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          environment_id: { type: 'integer' },
        },
        required: ['project_id', 'environment_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.get(`projects/${pid}/environments/${args.environment_id}`),
          null, 2,
        );
      },
    },
    {
      name: 'list_deployments',
      description: 'List deployments for a project, optionally filtered by environment.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          environment: { type: 'string', description: 'Environment name to filter by (optional)' },
          per_page: { type: 'integer', default: 20 },
          order_by: { type: 'string', enum: ['id', 'iid', 'created_at', 'updated_at', 'ref'], default: 'id' },
          sort: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const perPage = (args.per_page as number) ?? 20;
        const orderBy = (args.order_by as string) ?? 'id';
        const sort = (args.sort as string) ?? 'desc';
        let path = `projects/${pid}/deployments?per_page=${perPage}&order_by=${orderBy}&sort=${sort}`;
        if (args.environment) {
          path += `&environment=${enc(args.environment as string)}`;
        }
        return JSON.stringify(await client.get(path), null, 2);
      },
    },
    {
      name: 'get_deployment',
      description: 'Get a specific deployment by ID.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          deployment_id: { type: 'integer' },
        },
        required: ['project_id', 'deployment_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.get(`projects/${pid}/deployments/${args.deployment_id}`),
          null, 2,
        );
      },
    },
  ];
}
