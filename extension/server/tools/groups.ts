import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

function enc(s: string): string {
  return encodeURIComponent(s);
}

export type WorkloadEntry = {
  username: string;
  name: string;
  open_issues: number;
};

/**
 * Returns the file paths from an MR's changes array that match `pattern`.
 * Checks both old_path and new_path. Returns [] when pattern is non-empty
 * and nothing matches. When pattern is empty, returns the new_path of each
 * change (deduplicated). Results are deduplicated across all entries.
 */
export function matchesPaths(
  changes: { old_path: string; new_path: string }[],
  pattern: string,
): string[] {
  if (!pattern) {
    const seen = new Set<string>();
    for (const c of changes) {
      seen.add(c.new_path);
    }
    return Array.from(seen);
  }
  const seen = new Set<string>();
  for (const c of changes) {
    for (const p of [c.old_path, c.new_path]) {
      if (p.includes(pattern)) seen.add(p);
    }
  }
  return Array.from(seen);
}

/**
 * Aggregates open issues by assignee. Members with zero issues are included.
 * Issues with no assignee go into an 'unassigned' bucket.
 * Result is sorted descending by open_issues.
 */
export function aggregateWorkload(
  issues: unknown[],
  members: unknown[],
): WorkloadEntry[] {
  const counts = new Map<string, WorkloadEntry>();

  // Seed from members list
  for (const m of members as { username: string; name: string }[]) {
    counts.set(m.username, { username: m.username, name: m.name, open_issues: 0 });
  }

  // Count issues
  for (const issue of issues as { assignee?: { username: string } | null }[]) {
    const username = issue.assignee?.username ?? 'unassigned';
    const entry = counts.get(username);
    if (entry) {
      entry.open_issues++;
    } else {
      counts.set(username, { username, name: username, open_issues: 1 });
    }
  }

  return Array.from(counts.values()).sort((a, b) => b.open_issues - a.open_issues);
}

export function groupTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'list_groups',
      description: 'List groups the current user is a member of.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          per_page: { type: 'integer', default: 20 },
        },
        required: [],
      }),
      async execute(args) {
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`groups?per_page=${perPage}`),
          null, 2,
        );
      },
    },
    {
      name: 'get_group',
      description: 'Get details of a GitLab group by ID or path.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Group ID or URL-encoded path' },
        },
        required: ['group_id'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        return JSON.stringify(await client.get(`groups/${gid}`), null, 2);
      },
    },
    {
      name: 'list_group_projects',
      description: 'List projects belonging to a group.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['group_id'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`groups/${gid}/projects?per_page=${perPage}`),
          null, 2,
        );
      },
    },
    {
      name: 'list_group_issues',
      description: 'List issues across all projects in a group.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string' },
          state: { type: 'string', enum: ['opened', 'closed', 'all'], default: 'opened' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['group_id'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        const state = (args.state as string) ?? 'opened';
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`groups/${gid}/issues?state=${state}&per_page=${perPage}`),
          null, 2,
        );
      },
    },
    {
      name: 'list_group_merge_requests',
      description: 'List merge requests across all projects in a group.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string' },
          state: { type: 'string', enum: ['opened', 'closed', 'merged', 'all'], default: 'opened' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['group_id'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        const state = (args.state as string) ?? 'opened';
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`groups/${gid}/merge_requests?state=${state}&per_page=${perPage}`),
          null, 2,
        );
      },
    },
    {
      name: 'list_group_members',
      description: 'List members of a GitLab group.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string' },
        },
        required: ['group_id'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        return JSON.stringify(await client.get(`groups/${gid}/members`), null, 2);
      },
    },
    {
      name: 'search_code_group',
      description: 'Search code (file contents) across all projects in a group. Use this to find which repos use a specific library, function, or pattern before bulk-creating issues.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Group ID or URL-encoded path' },
          search: { type: 'string', description: 'Search query (substring or keyword)' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['group_id', 'search'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        const q = encodeURIComponent(args.search as string);
        const perPage = (args.per_page as number) ?? 20;
        return JSON.stringify(
          await client.get(`groups/${gid}/search?scope=blobs&search=${q}&per_page=${perPage}`),
          null, 2,
        );
      },
    },
    {
      name: 'list_group_mr_changes',
      description: 'List merge requests across a group, optionally filtered to only those touching files that match a path substring (e.g. "auth/", ".env"). Returns matched file paths per MR. Use this to find which MRs are relevant to a specific area of the codebase.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          group_id: { type: 'string' },
          path_pattern: { type: 'string', description: 'Optional substring to filter changed file paths (e.g. "auth/")' },
          state: { type: 'string', enum: ['opened', 'closed', 'merged', 'all'], default: 'opened' },
          per_page: { type: 'integer', default: 20 },
        },
        required: ['group_id'],
      }),
      async execute(args) {
        const gid = enc(args.group_id as string);
        const state = (args.state as string) ?? 'opened';
        const perPage = (args.per_page as number) ?? 20;
        const pathPattern = (args.path_pattern as string) ?? '';

        const mrs = await client.get(
          `groups/${gid}/merge_requests?state=${state}&per_page=${perPage}`,
        ) as { id: number; iid: number; project_id: number; title: string; web_url: string; author: { username: string } }[];

        let skipped = 0;
        const results = await Promise.all(
          mrs.map(async (mr) => {
            try {
              const data = await client.get(
                `projects/${mr.project_id}/merge_requests/${mr.iid}/changes`,
              ) as { changes?: { old_path: string; new_path: string }[] };
              const changes = data.changes ?? [];
              const matched = matchesPaths(changes, pathPattern);
              if (pathPattern && matched.length === 0) return null;
              return {
                project_id: mr.project_id,
                mr_iid: mr.iid,
                title: mr.title,
                author: mr.author?.username,
                web_url: mr.web_url,
                matched_files: matched,
              };
            } catch {
              skipped++;
              return null;
            }
          }),
        );

        const filtered = results.filter(Boolean);
        return JSON.stringify({ skipped, results: filtered }, null, 2);
      },
    },
  ];
}
