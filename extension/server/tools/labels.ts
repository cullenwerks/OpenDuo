import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function labelTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'list_labels',
      description: 'List labels for a GitLab project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(await client.get(`projects/${pid}/labels`), null, 2);
      },
    },
    {
      name: 'create_label',
      description: 'Create a new label in a GitLab project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          name: { type: 'string' },
          color: { type: 'string', description: 'Hex color code e.g. #FF0000' },
        },
        required: ['project_id', 'name', 'color'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const body: Record<string, unknown> = {};
        if (args.name) body.name = args.name;
        if (args.color) body.color = args.color;
        return JSON.stringify(await client.post(`projects/${pid}/labels`, body), null, 2);
      },
    },
  ];
}
