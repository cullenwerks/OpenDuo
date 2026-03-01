import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function projectTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'get_project',
      description: 'Get details of a GitLab project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(await client.get(`projects/${pid}`), null, 2);
      },
    },
    {
      name: 'list_projects',
      description: 'List projects the current user is a member of.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          per_page: { type: 'integer', default: 20 },
        },
        required: [],
      }),
      async execute(args) {
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(await client.get(`projects?membership=true&per_page=${perPage}`), null, 2);
      },
    },
    {
      name: 'search_projects',
      description: 'Search for GitLab projects by name.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      }),
      async execute(args) {
        const query = enc(args.query as string);
        return JSON.stringify(await client.get(`projects?search=${query}`), null, 2);
      },
    },
  ];
}
