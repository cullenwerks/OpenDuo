import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import type { WorkspaceFolder } from '../config';
import type { Tool } from './tool';

const MAX_FILE_SIZE = 100 * 1024; // 100 KB
const MAX_SEARCH_RESULTS = 50;
const MAX_LIST_ENTRIES = 200;

/** Known binary extensions to skip when reading/searching. */
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.gz', '.tar', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.ogg', '.webm',
  '.pyc', '.class', '.o', '.obj', '.wasm',
  '.vsix', '.lock',
]);

/** Directories to always skip when listing/searching. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '__pycache__', '.next', '.nuxt', 'vendor', '.venv', 'venv',
  'coverage', '.nyc_output', '.cache',
]);

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

function isBinary(filePath: string): boolean {
  return BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

/**
 * Workspace tools provide the LLM with access to the user's local
 * VS Code workspace — reading files, listing directories, and searching.
 *
 * An `activeFolder` function is provided so the active workspace can be
 * switched at runtime (via the folder selector in the UI) without
 * re-creating the tool instances.
 */
export function workspaceTools(
  folders: WorkspaceFolder[],
  getActiveFolder: () => WorkspaceFolder | undefined,
): Tool[] {
  if (folders.length === 0) return [];

  function activeRoot(): string {
    const folder = getActiveFolder();
    if (!folder) throw new Error('No workspace folder selected');
    return folder.path;
  }

  return [
    {
      name: 'read_workspace_file',
      description:
        "Read a file from the user's local workspace. " +
        'Use this to inspect files the user has open in VS Code.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path relative to the workspace root (e.g. "src/index.ts")',
          },
        },
        required: ['file_path'],
      }),
      async execute(args) {
        const root = activeRoot();
        const filePath = args.file_path as string;
        const abs = safePath(root, filePath);
        if (!abs) return 'Error: Path is outside the workspace.';

        if (isBinary(abs)) return 'Error: File appears to be binary.';

        try {
          const stat = fs.statSync(abs);
          if (stat.isDirectory()) return 'Error: Path is a directory, not a file. Use list_workspace_files instead.';
          if (stat.size > MAX_FILE_SIZE) {
            return `Error: File is too large (${(stat.size / 1024).toFixed(0)} KB). Maximum is ${MAX_FILE_SIZE / 1024} KB.`;
          }
          return fs.readFileSync(abs, 'utf-8');
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    },

    {
      name: 'list_workspace_files',
      description:
        "List files and directories in the user's local workspace. " +
        'Returns names with type indicators (file/dir).',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to workspace root (default: root)',
            default: '',
          },
        },
      }),
      async execute(args) {
        const root = activeRoot();
        const relPath = (args.path as string) ?? '';
        const abs = safePath(root, relPath);
        if (!abs) return 'Error: Path is outside the workspace.';

        try {
          const entries = fs.readdirSync(abs, { withFileTypes: true });
          const results: string[] = [];
          for (const entry of entries) {
            if (results.length >= MAX_LIST_ENTRIES) {
              results.push(`... (truncated, ${entries.length} total entries)`);
              break;
            }
            if (entry.isDirectory()) {
              if (SKIP_DIRS.has(entry.name)) continue;
              results.push(`${entry.name}/`);
            } else {
              results.push(entry.name);
            }
          }
          if (results.length === 0) return '(empty directory)';
          return results.join('\n');
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    },

    {
      name: 'search_workspace',
      description:
        "Search for a text pattern across files in the user's local workspace. " +
        'Returns matching lines with file paths and line numbers.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Text or regex pattern to search for',
          },
          path: {
            type: 'string',
            description: 'Subdirectory to search in (default: entire workspace)',
            default: '',
          },
          file_glob: {
            type: 'string',
            description: 'File extension filter (e.g. "*.ts", "*.py")',
          },
        },
        required: ['pattern'],
      }),
      async execute(args) {
        const root = activeRoot();
        const pattern = args.pattern as string;
        const relPath = (args.path as string) ?? '';
        const fileGlob = args.file_glob as string | undefined;
        const searchRoot = safePath(root, relPath);
        if (!searchRoot) return 'Error: Path is outside the workspace.';

        // Validate the pattern before compiling to avoid throwing inside the
        // recursive search and to give the LLM a clear error message.
        if (!pattern || typeof pattern !== 'string') {
          return 'Error: pattern must be a non-empty string.';
        }
        if (pattern.length > 500) {
          return 'Error: pattern is too long (max 500 characters).';
        }
        let compiledRe: RegExp;
        try {
          compiledRe = new RegExp(pattern, 'gi');
        } catch (e) {
          return `Error: Invalid regex pattern — ${(e as Error).message}`;
        }

        const results: string[] = [];
        const globExt = fileGlob?.startsWith('*.') ? fileGlob.slice(1) : null;

        function searchDir(dir: string, depth: number): void {
          if (depth > 10 || results.length >= MAX_SEARCH_RESULTS) return;
          let entries: fs.Dirent[];
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }

          for (const entry of entries) {
            if (results.length >= MAX_SEARCH_RESULTS) break;
            const full = path.join(dir, entry.name);

            if (entry.isDirectory()) {
              if (SKIP_DIRS.has(entry.name)) continue;
              searchDir(full, depth + 1);
            } else if (entry.isFile()) {
              if (isBinary(full)) continue;
              if (globExt && !entry.name.endsWith(globExt)) continue;

              try {
                const stat = fs.statSync(full);
                if (stat.size > MAX_FILE_SIZE) continue;

                const content = fs.readFileSync(full, 'utf-8');
                const lines = content.split('\n');
                // Re-use the compiled regex but reset lastIndex before each file
                compiledRe.lastIndex = 0;

                for (let i = 0; i < lines.length; i++) {
                  if (results.length >= MAX_SEARCH_RESULTS) break;
                  if (compiledRe.test(lines[i])) {
                    const rel = path.relative(root, full).replace(/\\/g, '/');
                    results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
                  }
                  compiledRe.lastIndex = 0;
                }
              } catch {
                // Skip files we can't read
              }
            }
          }
        }

        searchDir(searchRoot, 0);

        if (results.length === 0) return `No matches found for "${pattern}".`;
        let output = results.join('\n');
        if (results.length >= MAX_SEARCH_RESULTS) {
          output += `\n\n(Results capped at ${MAX_SEARCH_RESULTS}. Narrow your search.)`;
        }
        return output;
      },
    },

    {
      name: 'write_workspace_file',
      description:
        "Write or create a file in the user's local workspace. " +
        'Use this to create new files or overwrite existing ones. ' +
        'Parent directories are created automatically if needed.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path relative to the workspace root (e.g. "src/utils.ts")',
          },
          content: {
            type: 'string',
            description: 'The full content to write to the file',
          },
        },
        required: ['file_path', 'content'],
      }),
      async execute(args) {
        const root = activeRoot();
        const filePath = args.file_path as string;
        const content = args.content as string;
        const abs = safePath(root, filePath);
        if (!abs) return 'Error: Path is outside the workspace.';

        if (isBinary(abs)) return 'Error: Cannot write binary files.';

        try {
          // Create parent directories if they don't exist
          const dir = path.dirname(abs);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(abs, content, 'utf-8');
          return `Successfully wrote ${content.length} bytes to ${filePath}`;
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    },

    {
      name: 'delete_workspace_file',
      description:
        "Delete a file from the user's local workspace. " +
        'This permanently removes the file from disk.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path relative to the workspace root (e.g. "old-file.md")',
          },
        },
        required: ['file_path'],
      }),
      async execute(args) {
        const root = activeRoot();
        const filePath = args.file_path as string;
        const abs = safePath(root, filePath);
        if (!abs) return 'Error: Path is outside the workspace.';

        try {
          const stat = fs.statSync(abs);
          if (stat.isDirectory()) {
            return 'Error: Path is a directory. Only files can be deleted.';
          }
          fs.unlinkSync(abs);
          return `Successfully deleted ${filePath}`;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            return `Error: File not found: ${filePath}`;
          }
          return `Error: ${(e as Error).message}`;
        }
      },
    },

    {
      name: 'edit_workspace_file',
      description:
        "Edit specific lines in a file in the user's local workspace. " +
        'Use this instead of write_workspace_file when you only need to change part of a file. ' +
        'Provide one or more edits, each specifying a line range and replacement text. ' +
        'Lines are 1-indexed and inclusive. Use empty new_text to delete lines.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path relative to the workspace root',
          },
          edits: {
            type: 'array',
            description: 'Array of edits to apply',
            items: {
              type: 'object',
              properties: {
                start_line: { type: 'number', description: 'First line to replace (1-indexed)' },
                end_line: { type: 'number', description: 'Last line to replace (1-indexed, inclusive)' },
                new_text: { type: 'string', description: 'Replacement text (use empty string to delete lines)' },
              },
              required: ['start_line', 'end_line', 'new_text'],
            },
          },
        },
        required: ['file_path', 'edits'],
      }),
      async execute(args) {
        const root = activeRoot();
        const filePath = args.file_path as string;
        const abs = safePath(root, filePath);
        if (!abs) return 'Error: Path is outside the workspace.';
        if (isBinary(abs)) return 'Error: Cannot edit binary files.';

        let content: string;
        try {
          const stat = fs.statSync(abs);
          if (stat.isDirectory()) return 'Error: Path is a directory.';
          if (stat.size > MAX_FILE_SIZE) return `Error: File too large (${(stat.size / 1024).toFixed(0)} KB).`;
          content = fs.readFileSync(abs, 'utf-8');
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }

        const edits = args.edits as Array<{ start_line: number; end_line: number; new_text: string }>;
        if (!edits || edits.length === 0) return 'Error: No edits provided.';

        const lines = content.split('\n');
        // Track whether file ends with newline
        const trailingNewline = content.endsWith('\n');
        if (trailingNewline && lines[lines.length - 1] === '') {
          lines.pop();
        }

        // Sort edits by start_line descending so we apply bottom-up
        // without invalidating line numbers
        const sorted = [...edits].sort((a, b) => b.start_line - a.start_line);

        for (const edit of sorted) {
          const start = edit.start_line - 1; // Convert to 0-indexed
          const end = edit.end_line; // splice end is exclusive, so end_line (1-indexed) works

          if (start < 0 || end > lines.length || start >= end) {
            return `Error: Invalid line range ${edit.start_line}-${edit.end_line} (file has ${lines.length} lines).`;
          }

          const newLines = edit.new_text === '' ? [] : edit.new_text.split('\n');
          lines.splice(start, end - start, ...newLines);
        }

        const result = lines.join('\n') + (trailingNewline ? '\n' : '');
        fs.writeFileSync(abs, result, 'utf-8');
        return `Successfully edited ${filePath} (${edits.length} edit(s) applied, ${lines.length} lines total).`;
      },
    },

    {
      name: 'get_workspace_info',
      description:
        "Get information about the user's active workspace — name, root path, " +
        'git branch, and top-level file listing.',
      parametersSchema: () => ({
        type: 'object',
        properties: {},
      }),
      async execute() {
        const folder = getActiveFolder();
        if (!folder) return 'Error: No workspace folder selected.';
        const root = folder.path;

        const info: Record<string, unknown> = {
          name: folder.name,
          path: root,
        };

        // Try to get git branch
        try {
          const branch = cp.execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: root,
            encoding: 'utf-8',
            timeout: 5000,
          }).trim();
          info.gitBranch = branch;

          const remoteUrl = cp.execSync('git remote get-url origin', {
            cwd: root,
            encoding: 'utf-8',
            timeout: 5000,
          }).trim();
          info.gitRemote = remoteUrl;
        } catch {
          // Not a git repo or git not available
        }

        // Top-level listing
        try {
          const entries = fs.readdirSync(root, { withFileTypes: true });
          info.topLevelFiles = entries
            .filter(e => !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
            .slice(0, 50)
            .map(e => e.isDirectory() ? `${e.name}/` : e.name);
        } catch {
          info.topLevelFiles = [];
        }

        return JSON.stringify(info, null, 2);
      },
    },
  ];
}
