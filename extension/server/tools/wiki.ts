import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function wikiTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'list_wiki_pages',
      description: 'List wiki pages for a GitLab project.',
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
          await client.get(`projects/${pid}/wikis`),
          null, 2,
        );
      },
    },
    {
      name: 'get_wiki_page',
      description: 'Get the content of a specific wiki page.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          slug: { type: 'string', description: 'URL slug of the wiki page' },
        },
        required: ['project_id', 'slug'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const slug = enc(args.slug as string);
        return JSON.stringify(
          await client.get(`projects/${pid}/wikis/${slug}`),
          null, 2,
        );
      },
    },
    {
      name: 'create_wiki_page',
      description: 'Create a new wiki page in a project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string', description: 'Markdown content of the page' },
        },
        required: ['project_id', 'title', 'content'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.post(`projects/${pid}/wikis`, {
            title: args.title,
            content: args.content,
          }),
          null, 2,
        );
      },
    },
    {
      name: 'update_wiki_page',
      description: 'Update an existing wiki page.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          slug: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['project_id', 'slug'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const slug = enc(args.slug as string);
        const body: Record<string, unknown> = {};
        if (args.title) body.title = args.title;
        if (args.content) body.content = args.content;
        return JSON.stringify(
          await client.put(`projects/${pid}/wikis/${slug}`, body),
          null, 2,
        );
      },
    },
  ];
}
