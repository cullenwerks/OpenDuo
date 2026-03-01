import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function snippetTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'list_project_snippets',
      description: 'List snippets for a GitLab project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project ID or URL-encoded path' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`projects/${pid}/snippets?per_page=${perPage}`),
          null, 2,
        );
      },
    },
    {
      name: 'get_snippet',
      description: 'Get a specific project snippet by ID.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          snippet_id: { type: 'integer' },
        },
        required: ['project_id', 'snippet_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.get(`projects/${pid}/snippets/${args.snippet_id}`),
          null, 2,
        );
      },
    },
    {
      name: 'create_snippet',
      description: 'Create a new snippet in a GitLab project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          title: { type: 'string' },
          file_name: { type: 'string' },
          content: { type: 'string' },
          visibility: { type: 'string', enum: ['private', 'internal', 'public'], default: 'private' },
        },
        required: ['project_id', 'title', 'file_name', 'content'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.post(`projects/${pid}/snippets`, {
            title: args.title,
            file_name: args.file_name,
            content: args.content,
            visibility: args.visibility ?? 'private',
          }),
          null, 2,
        );
      },
    },
  ];
}
