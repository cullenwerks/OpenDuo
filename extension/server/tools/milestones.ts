import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function milestoneTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'list_milestones',
      description: 'List milestones for a GitLab project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(await client.get(`projects/${pid}/milestones`), null, 2);
      },
    },
  ];
}
