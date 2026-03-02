import * as cp from 'child_process';
import * as path from 'path';
import type { WorkspaceFolder } from '../config';
import type { Tool, ToolContext } from './tool';

const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB
const EXEC_TIMEOUT_MS = 60_000; // 60 seconds

/**
 * Resolves a user-provided relative path against a workspace root,
 * returning the absolute path only if it stays within the root.
 * Returns null for directory traversal attempts.
 */
function safePath(root: string, relativePath: string): string | null {
  const resolved = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return null;
  }
  return resolved;
}

/**
 * Terminal tools allow the LLM to run shell commands in the user's
 * workspace. Every command requires explicit user confirmation before
 * execution via the ToolContext.requestConfirmation callback.
 */
export function terminalTools(
  folders: WorkspaceFolder[],
  getActiveFolder: () => WorkspaceFolder | undefined,
): Tool[] {
  if (folders.length === 0) return [];

  return [
    {
      name: 'run_command',
      description:
        'Run a shell command in the workspace and return its output. ' +
        'The user will be asked to approve the command before it executes. ' +
        'Use this for build, test, lint, git, and other development commands.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to run (e.g. "npm test", "git status")',
          },
          working_directory: {
            type: 'string',
            description: 'Working directory relative to workspace root (default: workspace root)',
            default: '',
          },
        },
        required: ['command'],
      }),
      async execute(args, context?: ToolContext) {
        if (!context?.requestConfirmation) {
          return 'Error: run_command requires user confirmation but confirmation context is not available.';
        }

        const folder = getActiveFolder();
        if (!folder) return 'Error: No workspace folder selected.';

        const command = args.command as string;
        if (!command || typeof command !== 'string') {
          return 'Error: command must be a non-empty string.';
        }

        const relDir = (args.working_directory as string) ?? '';
        const cwd = relDir ? safePath(folder.path, relDir) : folder.path;
        if (!cwd) return 'Error: working_directory is outside the workspace.';

        // Ask user for approval
        const approved = await context.requestConfirmation(command);
        if (!approved) {
          return 'Command denied by user.';
        }

        return new Promise<string>((resolve) => {
          cp.exec(command, {
            cwd,
            timeout: EXEC_TIMEOUT_MS,
            maxBuffer: MAX_OUTPUT_BYTES,
            env: { ...process.env, FORCE_COLOR: '0' },
          }, (error, stdout, stderr) => {
            const parts: string[] = [];

            if (stdout) {
              const out = stdout.length > MAX_OUTPUT_BYTES
                ? stdout.slice(0, MAX_OUTPUT_BYTES) + '\n... (output truncated)'
                : stdout;
              parts.push(`STDOUT:\n${out}`);
            }

            if (stderr) {
              const err = stderr.length > MAX_OUTPUT_BYTES
                ? stderr.slice(0, MAX_OUTPUT_BYTES) + '\n... (output truncated)'
                : stderr;
              parts.push(`STDERR:\n${err}`);
            }

            const exitCode = error?.code ?? 0;
            parts.push(`Exit code: ${exitCode}`);

            if (error && !error.code) {
              parts.push(`Error: ${error.message}`);
            }

            resolve(parts.join('\n\n'));
          });
        });
      },
    },
  ];
}
