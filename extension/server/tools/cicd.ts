import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function cicdTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'get_pipeline_yaml',
      description: 'Get the .gitlab-ci.yml pipeline configuration for a project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          ref: { type: 'string', default: 'main' },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const ref = enc((args.ref as string) ?? 'main');
        const filePath = enc('.gitlab-ci.yml');
        const v = await client.get<{ content?: string }>(`projects/${pid}/repository/files/${filePath}?ref=${ref}`);
        const content = v.content ?? '';
        return Buffer.from(content, 'base64').toString('utf-8');
      },
    },
    {
      name: 'validate_pipeline_yaml',
      description: 'Validate a .gitlab-ci.yml configuration.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          content: { type: 'string', description: 'YAML content to validate' },
        },
        required: ['content'],
      }),
      async execute(args) {
        return JSON.stringify(await client.post('ci/lint', { content: args.content }), null, 2);
      },
    },
    {
      name: 'list_runners',
      description: 'List active GitLab runners.',
      parametersSchema: () => ({
        type: 'object',
        properties: {},
        required: [],
      }),
      async execute() {
        return JSON.stringify(await client.get('runners?scope=active'), null, 2);
      },
    },
  ];
}
