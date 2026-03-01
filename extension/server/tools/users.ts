import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function userTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'get_current_user',
      description: 'Get the currently authenticated GitLab user.',
      parametersSchema: () => ({
        type: 'object',
        properties: {},
        required: [],
      }),
      async execute() {
        return JSON.stringify(await client.get('user'), null, 2);
      },
    },
    {
      name: 'get_user',
      description: 'Get a GitLab user by ID.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          user_id: { type: 'integer', description: 'User ID' },
        },
        required: ['user_id'],
      }),
      async execute(args) {
        return JSON.stringify(await client.get(`users/${args.user_id}`), null, 2);
      },
    },
    {
      name: 'list_project_members',
      description: 'List members of a GitLab project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(await client.get(`projects/${pid}/members`), null, 2);
      },
    },
  ];
}
