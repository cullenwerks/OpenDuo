import * as cp from 'child_process';
import type { WorkspaceFolder } from '../config';
import type { Tool } from './tool';

const MAX_DIFF_BYTES = 8 * 1024; // 8 KB
const TRUNCATED_SUFFIX = '\n[truncated]';

function exec(cmd: string, cwd: string): string {
  return cp.execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

export function gitContextTools(
  folders: WorkspaceFolder[],
  getActiveFolder: () => WorkspaceFolder | undefined,
): Tool[] {
  if (folders.length === 0) return [];

  return [
    {
      name: 'get_git_context',
      description:
        'Get the current git context for the workspace: active branch, default branch, ' +
        'recent commits, staged diff, and unstaged file summary. ' +
        'Use this at the start of MR creation to understand what changed. ' +
        'No user confirmation required — read-only.',
      parametersSchema: () => ({
        type: 'object',
        properties: {},
      }),
      async execute(_args) {
        const folder = getActiveFolder();
        if (!folder) return JSON.stringify({ error: 'Error: No workspace folder selected.' });

        const cwd = folder.path;

        try {
          const currentBranch = exec('git branch --show-current', cwd).trim();

          let defaultBranch = 'main';
          try {
            const symref = exec('git symbolic-ref refs/remotes/origin/HEAD', cwd).trim();
            defaultBranch = symref.replace('refs/remotes/origin/', '');
          } catch {
            // fall back to 'main' if no remote HEAD is set
          }

          const logRaw = exec('git log --oneline -10', cwd).trim();
          const recentCommits = logRaw ? logRaw.split('\n') : [];

          let stagedDiff = '';
          try {
            const raw = exec('git diff --cached', cwd);
            if (raw.length > MAX_DIFF_BYTES) {
              stagedDiff = raw.slice(0, MAX_DIFF_BYTES - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX;
            } else {
              stagedDiff = raw;
            }
          } catch {
            stagedDiff = '';
          }

          let unstagedSummary = '';
          try {
            unstagedSummary = exec('git diff --stat', cwd).trim();
          } catch {
            unstagedSummary = '';
          }

          return JSON.stringify({
            currentBranch,
            defaultBranch,
            recentCommits,
            stagedDiff,
            unstagedSummary,
            hasStaged: stagedDiff.length > 0,
          }, null, 2);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: msg });
        }
      },
    },
  ];
}
