import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function repositoryTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'get_file',
      description: "Get a file's content from a GitLab repository.",
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          file_path: { type: 'string' },
          ref: { type: 'string', default: 'main' },
        },
        required: ['project_id', 'file_path'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const filePath = enc(args.file_path as string);
        const ref = enc((args.ref as string) ?? 'main');
        const v = await client.get<{ content?: string }>(`projects/${pid}/repository/files/${filePath}?ref=${ref}`);
        const content = v.content ?? '';
        return Buffer.from(content, 'base64').toString('utf-8');
      },
    },
    {
      name: 'list_files',
      description: 'List files in a repository directory.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          path: { type: 'string', default: '' },
          ref: { type: 'string', default: 'main' },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const p = enc((args.path as string) ?? '');
        const ref = enc((args.ref as string) ?? 'main');
        return JSON.stringify(await client.get(`projects/${pid}/repository/tree?path=${p}&ref=${ref}`), null, 2);
      },
    },
    {
      name: 'search_code',
      description: 'Search for code in a GitLab project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          query: { type: 'string' },
        },
        required: ['project_id', 'query'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const query = enc(args.query as string);
        return JSON.stringify(await client.get(`projects/${pid}/search?scope=blobs&search=${query}`), null, 2);
      },
    },
    {
      name: 'get_commit',
      description: 'Get details of a specific commit.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          sha: { type: 'string' },
        },
        required: ['project_id', 'sha'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const sha = enc(args.sha as string);
        return JSON.stringify(await client.get(`projects/${pid}/repository/commits/${sha}`), null, 2);
      },
    },
    {
      name: 'list_commits',
      description: 'List commits for a branch.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          ref_name: { type: 'string', default: 'main' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const refName = enc((args.ref_name as string) ?? 'main');
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`projects/${pid}/repository/commits?ref_name=${refName}&per_page=${perPage}`),
          null, 2
        );
      },
    },
    {
      name: 'compare_refs',
      description: 'Compare two refs (branches, tags, commits).',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['project_id', 'from', 'to'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const from = enc(args.from as string);
        const to = enc(args.to as string);
        return JSON.stringify(
          await client.get(`projects/${pid}/repository/compare?from=${from}&to=${to}`),
          null, 2
        );
      },
    },
  ];
}
