import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

const ANSI_RE = /\x1b\[[0-9;]*[mGKHF]/g;
const ERROR_RE = /ERROR|FAILED|[Ee]rror:|fatal:|FATAL|AssertionError|Traceback|npm ERR!|exit code [1-9]/;

export function extractLogErrors(rawLog: string, maxLines: number, contextLines: number): string {
  const clean = rawLog.replace(ANSI_RE, "");
  const lines = clean.split("\n");
  const total = lines.length;

  // Find all lines matching error patterns
  const errorIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ERROR_RE.test(lines[i])) errorIndexes.push(i);
  }

  let selectedLines: string[];

  if (errorIndexes.length === 0) {
    // Fallback: last max_lines lines
    selectedLines = lines.slice(Math.max(0, total - maxLines));
  } else {
    // Build merged context windows
    const included = new Set<number>();
    for (const idx of errorIndexes) {
      const start = Math.max(0, idx - contextLines);
      const end = Math.min(total - 1, idx + contextLines);
      for (let i = start; i <= end; i++) included.add(i);
    }
    const sortedIndexes = Array.from(included).sort((a, b) => a - b);
    selectedLines = sortedIndexes.map(i => lines[i]);
  }

  // Keep the trailing window — the end of a failed log is most diagnostic
  if (selectedLines.length > maxLines) {
    selectedLines = selectedLines.slice(selectedLines.length - maxLines);
  }

  const header = `[Extracted ${errorIndexes.length} error lines from ${total} total.]`;
  return [header, ...selectedLines].join("\n");
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
    {
      name: 'get_job_log_errors',
      description:
        'Get the relevant error/failure section of a CI job log. Strips ANSI codes, ' +
        'finds lines matching error patterns, returns them with context. Much smaller ' +
        'than get_job_log — use this for pipeline debugging.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          job_id: { type: 'integer' },
          max_lines: { type: 'integer', default: 150, description: 'Max lines to return' },
          context_lines: { type: 'integer', default: 5, description: 'Lines of context around each error' },
        },
        required: ['project_id', 'job_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const maxLines = (args.max_lines as number) ?? 150;
        const contextLines = (args.context_lines as number) ?? 5;
        const raw = await client.getRaw(client.apiUrl(`projects/${pid}/jobs/${args.job_id}/trace`));
        return extractLogErrors(raw, maxLines, contextLines);
      },
    },
  ];
}
