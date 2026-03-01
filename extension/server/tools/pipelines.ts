import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function pipelineTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'list_pipelines',
      description: 'List pipelines for a project.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['project_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(await client.get(`projects/${pid}/pipelines?per_page=${perPage}`), null, 2);
      },
    },
    {
      name: 'get_pipeline',
      description: 'Get details of a specific pipeline.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          pipeline_id: { type: 'integer' },
        },
        required: ['project_id', 'pipeline_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(await client.get(`projects/${pid}/pipelines/${args.pipeline_id}`), null, 2);
      },
    },
    {
      name: 'trigger_pipeline',
      description: 'Trigger a new pipeline for a ref.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          ref: { type: 'string', description: 'Branch or tag name' },
        },
        required: ['project_id', 'ref'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(await client.post(`projects/${pid}/pipeline`, { ref: args.ref }), null, 2);
      },
    },
    {
      name: 'retry_pipeline',
      description: 'Retry a failed pipeline.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          pipeline_id: { type: 'integer' },
        },
        required: ['project_id', 'pipeline_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.post(`projects/${pid}/pipelines/${args.pipeline_id}/retry`, {}),
          null, 2
        );
      },
    },
    {
      name: 'cancel_pipeline',
      description: 'Cancel a running pipeline.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          pipeline_id: { type: 'integer' },
        },
        required: ['project_id', 'pipeline_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return JSON.stringify(
          await client.post(`projects/${pid}/pipelines/${args.pipeline_id}/cancel`, {}),
          null, 2
        );
      },
    },
    {
      name: 'get_pipeline_jobs',
      description: 'List all jobs for a specific pipeline.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          pipeline_id: { type: 'integer' },
          per_page: { type: 'integer', default: 100 },
        },
        required: ['project_id', 'pipeline_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const perPage = (args.per_page as number) ?? 100;
        return JSON.stringify(
          await client.get(`projects/${pid}/pipelines/${args.pipeline_id}/jobs?per_page=${perPage}`),
          null, 2
        );
      },
    },
    {
      name: 'get_job_log',
      description: 'Get the log/trace of a CI job.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          job_id: { type: 'integer' },
        },
        required: ['project_id', 'job_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        return client.getRaw(client.apiUrl(`projects/${pid}/jobs/${args.job_id}/trace`));
      },
    },
  ];
}
