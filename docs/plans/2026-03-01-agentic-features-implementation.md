# Agentic VSCode Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add terminal execution (with user confirmation), diagnostics awareness, editor context, and line-level editing to OpenDuo's agentic tool set.

**Architecture:** Node.js IPC bridge between server child process and extension host for VSCode API access. Pure server-side tools for terminal and file edits. SSE-based confirmation flow for terminal commands. All tools implement the existing `Tool` interface and work with both REST and GraphQL GitLab Duo providers.

**Tech Stack:** TypeScript, Node.js IPC (`child_process`), VSCode Extension API, React (webview), vitest (tests)

**Design doc:** `docs/plans/2026-03-01-agentic-features-design.md`

---

### Task 1: IPC Bridge — Server Side

**Files:**
- Create: `extension/server/ipcBridge.ts`
- Test: `extension/server/ipcBridge.test.ts`

**Step 1: Write the failing test**

```typescript
// extension/server/ipcBridge.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendIpcRequest, _resetForTest } from './ipcBridge';

describe('sendIpcRequest', () => {
  const originalSend = process.send;

  beforeEach(() => {
    _resetForTest();
    process.send = vi.fn();
  });

  afterEach(() => {
    process.send = originalSend;
  });

  it('sends a message with type, id, method, and params', () => {
    sendIpcRequest('getDiagnostics', { filePath: 'src/index.ts' });
    expect(process.send).toHaveBeenCalledOnce();
    const msg = (process.send as any).mock.calls[0][0];
    expect(msg.type).toBe('request');
    expect(msg.method).toBe('getDiagnostics');
    expect(msg.params).toEqual({ filePath: 'src/index.ts' });
    expect(typeof msg.id).toBe('string');
  });

  it('returns a promise that resolves when response arrives', async () => {
    const promise = sendIpcRequest('getEditorContext', {});
    const msg = (process.send as any).mock.calls[0][0];

    // Simulate the extension host responding
    process.emit('message' as any, {
      type: 'response',
      id: msg.id,
      data: { filePath: 'test.ts' },
    });

    const result = await promise;
    expect(result).toEqual({ filePath: 'test.ts' });
  });

  it('rejects with error when IPC is not available', async () => {
    process.send = undefined as any;
    await expect(sendIpcRequest('test', {})).rejects.toThrow('IPC not available');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run server/ipcBridge.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// extension/server/ipcBridge.ts
import * as crypto from 'crypto';

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();
const IPC_TIMEOUT_MS = 5000;

let listenerAttached = false;

function ensureListener(): void {
  if (listenerAttached) return;
  listenerAttached = true;
  process.on('message', (msg: any) => {
    if (msg?.type === 'response' && typeof msg.id === 'string') {
      const req = pending.get(msg.id);
      if (req) {
        pending.delete(msg.id);
        clearTimeout(req.timer);
        if (msg.error) {
          req.reject(new Error(msg.error));
        } else {
          req.resolve(msg.data);
        }
      }
    }
  });
}

export function sendIpcRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (typeof process.send !== 'function') {
    return Promise.reject(new Error('IPC not available — server not spawned with IPC channel'));
  }

  ensureListener();
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`IPC request '${method}' timed out after ${IPC_TIMEOUT_MS}ms`));
    }, IPC_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    process.send!({ type: 'request', id, method, params });
  });
}

/** Reset internal state for tests. */
export function _resetForTest(): void {
  for (const req of pending.values()) clearTimeout(req.timer);
  pending.clear();
}
```

**Step 4: Run test to verify it passes**

Run: `cd extension && npx vitest run server/ipcBridge.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add extension/server/ipcBridge.ts extension/server/ipcBridge.test.ts
git commit -m "feat: add IPC bridge for server-to-extension-host communication"
```

---

### Task 2: IPC Bridge — Extension Host Side

**Files:**
- Modify: `extension/src/server.ts:30-38` (add IPC to stdio, add message handler)

**Step 1: Write the failing test**

```typescript
// Add to extension/src/server.test.ts
it('spawns with IPC channel in stdio', () => {
  const sm = new ServerManager('/fake/dist/server.js', {
    GITLAB_URL: 'https://gitlab.example.com',
    GITLAB_PAT: 'glpat-test',
  });
  // ServerManager stores ipcEnabled flag for testing
  expect(sm.hasIpc()).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run src/server.test.ts`
Expected: FAIL — `sm.hasIpc is not a function`

**Step 3: Implement IPC support in ServerManager**

Modify `extension/src/server.ts`:

1. Change `stdio` from `['ignore', 'pipe', 'pipe']` to `['ignore', 'pipe', 'pipe', 'ipc']`
2. Add `hasIpc()` method returning `true`
3. Add `private ipcHandler` that registers on spawn
4. Add `setIpcHandler(fn)` method for the extension to register its handler
5. In `start()`, after spawning, add:
```typescript
this.process.on('message', (msg: any) => {
  if (msg?.type === 'request' && this.ipcRequestHandler) {
    this.handleIpcRequest(msg);
  }
});
```
6. Add `private async handleIpcRequest(msg)` that dispatches to the registered handler and sends response back via `this.process.send()`

**Step 4: Run test to verify it passes**

Run: `cd extension && npx vitest run src/server.test.ts`
Expected: PASS

**Step 5: Register IPC handlers in extension.ts**

Modify `extension/src/extension.ts` — after creating `serverManager`, register the IPC handler that dispatches `getDiagnostics` and `getEditorContext` methods to VSCode API calls. (Actual VSCode API calls will be implemented in Tasks 4-5.)

```typescript
// After serverManager.start():
serverManager.setIpcHandler(async (method: string, params: Record<string, unknown>) => {
  switch (method) {
    case 'getDiagnostics':
      return handleGetDiagnostics(params);
    case 'getEditorContext':
      return handleGetEditorContext();
    default:
      throw new Error(`Unknown IPC method: ${method}`);
  }
});
```

**Step 6: Commit**

```bash
git add extension/src/server.ts extension/src/server.test.ts extension/src/extension.ts
git commit -m "feat: add IPC channel between extension host and server"
```

---

### Task 3: Tool Interface — Add Optional Context

**Files:**
- Modify: `extension/server/tools/tool.ts` (add ToolContext)
- Modify: `extension/server/tools/registry.ts:81-88` (pass context through execute)

**Step 1: Extend the Tool interface**

```typescript
// extension/server/tools/tool.ts — add to existing file:

export interface ToolContext {
  /** Emit text to the SSE stream (same as onToken in ReactLoop). */
  emitToken: (text: string) => void;
  /**
   * Request user confirmation. Returns true if approved, false if denied.
   * Emits a [CONFIRM:id] SSE event and waits for the user's response.
   */
  requestConfirmation: (prompt: string) => Promise<boolean>;
}
```

Update `Tool.execute` signature:
```typescript
execute(args: Record<string, unknown>, context?: ToolContext): Promise<string>;
```

**Step 2: Update ToolRegistry.execute to accept and pass context**

```typescript
// extension/server/tools/registry.ts — modify execute():
async execute(
  name: string,
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<string> {
  const tool = this.tools.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  console.log(`[tool] Invoking ${name} with args: ${JSON.stringify(args)}`);
  const result = await tool.execute(args, context);
  console.log(`[tool] ${name} returned ${result.length} chars`);
  return result;
}
```

**Step 3: Update ReactLoop to create and pass ToolContext**

Modify `extension/server/reactLoop.ts:97-107` — create a `ToolContext` and pass it:

```typescript
// Inside the tool execution loop, before calling tools.execute():
const toolContext: ToolContext = {
  emitToken: onToken,
  requestConfirmation: async (prompt: string) => {
    // Will be wired up in Task 7 (confirmation infrastructure)
    throw new Error('Confirmation not yet implemented');
  },
};

// Change: tools.execute(tc.name, tc.arguments)
// To:     tools.execute(tc.name, tc.arguments, toolContext)
```

**Step 4: Run all tests to verify nothing breaks**

Run: `cd extension && npx vitest run`
Expected: All existing tests PASS (no existing tool uses context)

**Step 5: Commit**

```bash
git add extension/server/tools/tool.ts extension/server/tools/registry.ts extension/server/reactLoop.ts
git commit -m "feat: add ToolContext with emitToken and requestConfirmation"
```

---

### Task 4: Editor Context Tool (`get_editor_context`)

**Files:**
- Create: `extension/server/tools/editorContext.ts`
- Create: `extension/server/tools/editorContext.test.ts`
- Modify: `extension/src/extension.ts` (implement `handleGetEditorContext`)

**Step 1: Write the failing test**

```typescript
// extension/server/tools/editorContext.test.ts
import { describe, it, expect, vi } from 'vitest';
import { editorContextTools } from './editorContext';

// Mock ipcBridge
vi.mock('./ipcBridge' as any, () => ({
  sendIpcRequest: vi.fn(),
}));

import { sendIpcRequest } from '../ipcBridge';
const mockSend = sendIpcRequest as any;

describe('get_editor_context tool', () => {
  const tools = editorContextTools();
  const tool = tools.find(t => t.name === 'get_editor_context')!;

  it('exists and has correct name', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('get_editor_context');
  });

  it('returns editor context from IPC', async () => {
    mockSend.mockResolvedValueOnce({
      filePath: 'src/index.ts',
      languageId: 'typescript',
      selection: 'const x = 1;',
      selectionRange: { startLine: 5, startCol: 0, endLine: 5, endCol: 12 },
      visibleRange: { startLine: 1, endLine: 40 },
      isDirty: false,
      lineCount: 100,
    });

    const result = await tool.execute({});
    expect(mockSend).toHaveBeenCalledWith('getEditorContext', {});
    const parsed = JSON.parse(result);
    expect(parsed.filePath).toBe('src/index.ts');
    expect(parsed.languageId).toBe('typescript');
  });

  it('returns message when no editor is open', async () => {
    mockSend.mockResolvedValueOnce(null);
    const result = await tool.execute({});
    expect(result).toContain('No editor');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run server/tools/editorContext.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// extension/server/tools/editorContext.ts
import type { Tool } from './tool';
import { sendIpcRequest } from '../ipcBridge';

export function editorContextTools(): Tool[] {
  return [
    {
      name: 'get_editor_context',
      description:
        "Get the user's current editor context — which file is open, " +
        'what text is selected, cursor position, and visible range. ' +
        'Use this to understand what the user is looking at.',
      parametersSchema: () => ({
        type: 'object',
        properties: {},
      }),
      async execute() {
        try {
          const ctx = await sendIpcRequest('getEditorContext', {});
          if (!ctx) return 'No editor is currently open.';
          return JSON.stringify(ctx, null, 2);
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    },
  ];
}
```

**Step 4: Implement extension host handler**

In `extension/src/extension.ts`, implement `handleGetEditorContext()`:

```typescript
function handleGetEditorContext(): Record<string, unknown> | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const absPath = editor.document.uri.fsPath;
  const filePath = workspaceRoot
    ? path.relative(workspaceRoot, absPath).replace(/\\/g, '/')
    : absPath;

  const sel = editor.selection;
  const selectedText = editor.document.getText(sel);

  return {
    filePath,
    languageId: editor.document.languageId,
    selection: selectedText.slice(0, 10240), // 10 KB max
    selectionRange: {
      startLine: sel.start.line + 1,
      startCol: sel.start.character,
      endLine: sel.end.line + 1,
      endCol: sel.end.character,
    },
    visibleRange: {
      startLine: editor.visibleRanges[0]?.start.line + 1 ?? 1,
      endLine: editor.visibleRanges[0]?.end.line + 1 ?? 1,
    },
    isDirty: editor.document.isDirty,
    lineCount: editor.document.lineCount,
  };
}
```

**Step 5: Run tests**

Run: `cd extension && npx vitest run server/tools/editorContext.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add extension/server/tools/editorContext.ts extension/server/tools/editorContext.test.ts extension/src/extension.ts
git commit -m "feat: add get_editor_context tool with IPC bridge"
```

---

### Task 5: Diagnostics Tool (`get_diagnostics`)

**Files:**
- Create: `extension/server/tools/diagnostics.ts`
- Create: `extension/server/tools/diagnostics.test.ts`
- Modify: `extension/src/extension.ts` (implement `handleGetDiagnostics`)

**Step 1: Write the failing test**

```typescript
// extension/server/tools/diagnostics.test.ts
import { describe, it, expect, vi } from 'vitest';
import { diagnosticsTools } from './diagnostics';

vi.mock('./diagnostics', async (importOriginal) => {
  // We mock sendIpcRequest at the module level
  return importOriginal();
});

vi.mock('../ipcBridge', () => ({
  sendIpcRequest: vi.fn(),
}));

import { sendIpcRequest } from '../ipcBridge';
const mockSend = sendIpcRequest as any;

describe('get_diagnostics tool', () => {
  const tools = diagnosticsTools();
  const tool = tools.find(t => t.name === 'get_diagnostics')!;

  it('exists and has correct name', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('get_diagnostics');
  });

  it('returns diagnostics from IPC', async () => {
    mockSend.mockResolvedValueOnce([
      {
        file: 'src/index.ts',
        line: 10,
        column: 5,
        severity: 'error',
        message: "Property 'foo' does not exist",
        source: 'typescript',
      },
    ]);

    const result = await tool.execute({});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].severity).toBe('error');
  });

  it('passes file_path and severity filters', async () => {
    mockSend.mockResolvedValueOnce([]);
    await tool.execute({ file_path: 'src/app.ts', severity: 'warning' });
    expect(mockSend).toHaveBeenCalledWith('getDiagnostics', {
      filePath: 'src/app.ts',
      severity: 'warning',
    });
  });

  it('returns message when no diagnostics found', async () => {
    mockSend.mockResolvedValueOnce([]);
    const result = await tool.execute({});
    expect(result).toContain('No diagnostics');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run server/tools/diagnostics.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// extension/server/tools/diagnostics.ts
import type { Tool } from './tool';
import { sendIpcRequest } from '../ipcBridge';

export function diagnosticsTools(): Tool[] {
  return [
    {
      name: 'get_diagnostics',
      description:
        "Get diagnostics (errors, warnings) from the user's VS Code editor. " +
        'These come from TypeScript, ESLint, and other language tools. ' +
        'Use this to find and fix problems in the code.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Filter to a specific file (relative to workspace root). Omit for all files.',
          },
          severity: {
            type: 'string',
            enum: ['error', 'warning', 'info', 'hint'],
            description: 'Filter by severity level. Omit for all severities.',
          },
        },
      }),
      async execute(args) {
        const filePath = args.file_path as string | undefined;
        const severity = args.severity as string | undefined;

        try {
          const diagnostics = await sendIpcRequest('getDiagnostics', {
            filePath,
            severity,
          });

          const items = diagnostics as Array<Record<string, unknown>>;
          if (!items || items.length === 0) {
            return 'No diagnostics found' +
              (filePath ? ` for ${filePath}` : '') +
              (severity ? ` with severity "${severity}"` : '') +
              '.';
          }

          return JSON.stringify(items, null, 2);
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    },
  ];
}
```

**Step 4: Implement extension host handler**

In `extension/src/extension.ts`, implement `handleGetDiagnostics(params)`:

```typescript
function handleGetDiagnostics(params: Record<string, unknown>): Array<Record<string, unknown>> {
  const filterPath = params.filePath as string | undefined;
  const filterSeverity = params.severity as string | undefined;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const allDiagnostics = vscode.languages.getDiagnostics();
  const results: Array<Record<string, unknown>> = [];
  const MAX_RESULTS = 100;

  const severityMap: Record<number, string> = {
    0: 'error',
    1: 'warning',
    2: 'info',
    3: 'hint',
  };

  for (const [uri, diagnostics] of allDiagnostics) {
    if (results.length >= MAX_RESULTS) break;

    const absPath = uri.fsPath;
    const relPath = workspaceRoot
      ? path.relative(workspaceRoot, absPath).replace(/\\/g, '/')
      : absPath;

    if (filterPath && relPath !== filterPath) continue;

    for (const d of diagnostics) {
      if (results.length >= MAX_RESULTS) break;

      const sev = severityMap[d.severity] ?? 'info';
      if (filterSeverity && sev !== filterSeverity) continue;

      results.push({
        file: relPath,
        line: d.range.start.line + 1,
        column: d.range.start.character,
        severity: sev,
        message: d.message,
        source: d.source ?? '',
      });
    }
  }

  return results;
}
```

**Step 5: Run tests**

Run: `cd extension && npx vitest run server/tools/diagnostics.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add extension/server/tools/diagnostics.ts extension/server/tools/diagnostics.test.ts extension/src/extension.ts
git commit -m "feat: add get_diagnostics tool with IPC bridge"
```

---

### Task 6: Line-Level Edit Tool (`edit_workspace_file`)

**Files:**
- Modify: `extension/server/tools/workspace.ts` (add tool to the array at line 68)
- Create: `extension/server/tools/workspace.edit.test.ts`

**Step 1: Write the failing test**

```typescript
// extension/server/tools/workspace.edit.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { workspaceTools } from './workspace';

describe('edit_workspace_file tool', () => {
  let tmpDir: string;
  let tools: ReturnType<typeof workspaceTools>;
  let editTool: (typeof tools)[number];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openduo-test-'));
    tools = workspaceTools(
      [{ name: 'test', path: tmpDir }],
      () => ({ name: 'test', path: tmpDir }),
    );
    editTool = tools.find(t => t.name === 'edit_workspace_file')!;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exists in the workspace tools', () => {
    expect(editTool).toBeDefined();
    expect(editTool.name).toBe('edit_workspace_file');
  });

  it('replaces a single line', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'line1\nline2\nline3\n');
    const result = await editTool.execute({
      file_path: 'test.ts',
      edits: [{ start_line: 2, end_line: 2, new_text: 'replaced' }],
    });
    expect(result).toContain('Success');
    const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toBe('line1\nreplaced\nline3\n');
  });

  it('deletes lines when new_text is empty', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'a\nb\nc\nd\n');
    const result = await editTool.execute({
      file_path: 'test.ts',
      edits: [{ start_line: 2, end_line: 3, new_text: '' }],
    });
    expect(result).toContain('Success');
    const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toBe('a\nd\n');
  });

  it('inserts lines (single-line range with added content)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'a\nb\nc\n');
    const result = await editTool.execute({
      file_path: 'test.ts',
      edits: [{ start_line: 2, end_line: 2, new_text: 'x\nb' }],
    });
    expect(result).toContain('Success');
    const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toBe('a\nx\nb\nc\n');
  });

  it('applies multiple edits bottom-up', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), '1\n2\n3\n4\n5\n');
    const result = await editTool.execute({
      file_path: 'test.ts',
      edits: [
        { start_line: 2, end_line: 2, new_text: 'TWO' },
        { start_line: 4, end_line: 4, new_text: 'FOUR' },
      ],
    });
    expect(result).toContain('Success');
    const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toBe('1\nTWO\n3\nFOUR\n5\n');
  });

  it('rejects paths outside workspace', async () => {
    const result = await editTool.execute({
      file_path: '../../../etc/passwd',
      edits: [{ start_line: 1, end_line: 1, new_text: 'hacked' }],
    });
    expect(result).toContain('outside the workspace');
  });

  it('rejects non-existent files', async () => {
    const result = await editTool.execute({
      file_path: 'nonexistent.ts',
      edits: [{ start_line: 1, end_line: 1, new_text: 'x' }],
    });
    expect(result).toContain('Error');
  });

  it('rejects binary files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'image.png'), 'fake');
    const result = await editTool.execute({
      file_path: 'image.png',
      edits: [{ start_line: 1, end_line: 1, new_text: 'x' }],
    });
    expect(result).toContain('binary');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run server/tools/workspace.edit.test.ts`
Expected: FAIL — `editTool` is undefined (tool doesn't exist yet)

**Step 3: Add `edit_workspace_file` tool to workspace.ts**

Add to the tools array in `workspaceTools()` function (after the existing `delete_workspace_file` tool, before `get_workspace_info`):

```typescript
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
    // Remove trailing empty element from split (if file ends with \n)
    const trailingNewline = content.endsWith('\n');
    if (trailingNewline && lines[lines.length - 1] === '') {
      lines.pop();
    }

    // Sort edits by start_line descending so we can apply bottom-up
    // without invalidating line numbers.
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
```

**Step 4: Run tests**

Run: `cd extension && npx vitest run server/tools/workspace.edit.test.ts`
Expected: PASS

**Step 5: Run all workspace tests to verify nothing broke**

Run: `cd extension && npx vitest run`
Expected: All PASS

**Step 6: Commit**

```bash
git add extension/server/tools/workspace.ts extension/server/tools/workspace.edit.test.ts
git commit -m "feat: add edit_workspace_file tool for line-level edits"
```

---

### Task 7: Confirmation Infrastructure (for Terminal)

**Files:**
- Create: `extension/server/confirmations.ts`
- Create: `extension/server/confirmations.test.ts`
- Modify: `extension/server/index.ts` (add `POST /command/confirm` endpoint)
- Modify: `extension/server/reactLoop.ts` (wire confirmation into ToolContext)

**Step 1: Write the failing test**

```typescript
// extension/server/confirmations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfirmationManager } from './confirmations';

describe('ConfirmationManager', () => {
  let manager: ConfirmationManager;

  beforeEach(() => {
    manager = new ConfirmationManager();
  });

  it('creates a pending confirmation and resolves on approve', async () => {
    const emitted: string[] = [];
    const emitToken = (t: string) => emitted.push(t);

    const promise = manager.requestConfirmation('npm test', emitToken);
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toMatch(/\[CONFIRM:[\w-]+\] npm test/);

    // Extract ID from emitted token
    const match = emitted[0].match(/\[CONFIRM:([\w-]+)\]/);
    const id = match![1];

    manager.resolve(id, true);
    const result = await promise;
    expect(result).toBe(true);
  });

  it('resolves false on deny', async () => {
    const emitToken = vi.fn();
    const promise = manager.requestConfirmation('rm -rf /', emitToken);

    const match = emitToken.mock.calls[0][0].match(/\[CONFIRM:([\w-]+)\]/);
    manager.resolve(match![1], false);

    const result = await promise;
    expect(result).toBe(false);
  });

  it('returns false for unknown confirmation IDs', () => {
    const result = manager.resolve('nonexistent', true);
    expect(result).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run server/confirmations.test.ts`
Expected: FAIL — module not found

**Step 3: Implement ConfirmationManager**

```typescript
// extension/server/confirmations.ts
import * as crypto from 'crypto';

interface PendingConfirmation {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CONFIRM_TIMEOUT_MS = 120_000; // 2 minutes

export class ConfirmationManager {
  private pending = new Map<string, PendingConfirmation>();

  /**
   * Request user confirmation. Emits a [CONFIRM:id] event via emitToken
   * and returns a Promise that resolves when the user responds.
   */
  requestConfirmation(prompt: string, emitToken: (text: string) => void): Promise<boolean> {
    const id = crypto.randomUUID();

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(false); // Timeout = deny
      }, CONFIRM_TIMEOUT_MS);

      this.pending.set(id, { resolve, timer });
      emitToken(`\n[CONFIRM:${id}] ${prompt}\n`);
    });
  }

  /**
   * Resolve a pending confirmation. Returns false if the ID is unknown.
   */
  resolve(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(approved);
    return true;
  }
}
```

**Step 4: Run test**

Run: `cd extension && npx vitest run server/confirmations.test.ts`
Expected: PASS

**Step 5: Add `POST /command/confirm` endpoint to server/index.ts**

Add after the `/chat/reset` handler (around line 248):

```typescript
// POST /command/confirm — resolve a pending tool confirmation
if (req.method === 'POST' && url === '/command/confirm') {
  const body = await readBody(req);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const id = parsed.id as string;
  const approved = parsed.approved === true;
  if (!id || typeof id !== 'string') {
    res.writeHead(400, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing confirmation id' }));
    return;
  }

  const found = confirmations.resolve(id, approved);
  res.writeHead(200, { ...cors, 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: found ? 'resolved' : 'not_found' }));
  return;
}
```

Also add at the top of `index.ts`:
```typescript
import { ConfirmationManager } from './confirmations';
const confirmations = new ConfirmationManager();
```

**Step 6: Wire confirmation into ReactLoop**

Modify `extension/server/reactLoop.ts` — update the `run()` method to accept a `ConfirmationManager` parameter, and update the `ToolContext`:

```typescript
// In ReactLoop.run() signature, add: confirmations?: ConfirmationManager
// In the toolContext creation:
const toolContext: ToolContext = {
  emitToken: onToken,
  requestConfirmation: confirmations
    ? (prompt) => confirmations.requestConfirmation(prompt, onToken)
    : async () => { throw new Error('Confirmation not available'); },
};
```

Update `server/index.ts` to pass `confirmations` to `reactLoop.run()`.

**Step 7: Run all tests**

Run: `cd extension && npx vitest run`
Expected: All PASS

**Step 8: Commit**

```bash
git add extension/server/confirmations.ts extension/server/confirmations.test.ts extension/server/index.ts extension/server/reactLoop.ts
git commit -m "feat: add confirmation infrastructure for user-approved tool actions"
```

---

### Task 8: Terminal Execution Tool (`run_command`)

**Files:**
- Create: `extension/server/tools/terminal.ts`
- Create: `extension/server/tools/terminal.test.ts`

**Step 1: Write the failing test**

```typescript
// extension/server/tools/terminal.test.ts
import { describe, it, expect, vi } from 'vitest';
import { terminalTools } from './terminal';
import type { ToolContext } from './tool';

describe('run_command tool', () => {
  const tools = terminalTools(
    [{ name: 'test', path: '/tmp/test-workspace' }],
    () => ({ name: 'test', path: '/tmp/test-workspace' }),
  );
  const tool = tools.find(t => t.name === 'run_command')!;

  it('exists and has correct name', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('run_command');
  });

  it('runs a simple command after confirmation', async () => {
    const ctx: ToolContext = {
      emitToken: vi.fn(),
      requestConfirmation: vi.fn().mockResolvedValue(true),
    };

    const result = await tool.execute({ command: 'echo hello' }, ctx);
    expect(ctx.requestConfirmation).toHaveBeenCalledWith('echo hello');
    expect(result).toContain('hello');
    expect(result).toContain('Exit code: 0');
  });

  it('returns denial message when user denies', async () => {
    const ctx: ToolContext = {
      emitToken: vi.fn(),
      requestConfirmation: vi.fn().mockResolvedValue(false),
    };

    const result = await tool.execute({ command: 'rm -rf /' }, ctx);
    expect(result).toContain('denied');
  });

  it('requires context with requestConfirmation', async () => {
    const result = await tool.execute({ command: 'echo hi' });
    expect(result).toContain('Error');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run server/tools/terminal.test.ts`
Expected: FAIL — module not found

**Step 3: Implement terminal tool**

```typescript
// extension/server/tools/terminal.ts
import * as cp from 'child_process';
import * as path from 'path';
import type { WorkspaceFolder } from '../config';
import type { Tool, ToolContext } from './tool';

const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB
const EXEC_TIMEOUT_MS = 60_000; // 60 seconds

function safePath(root: string, relativePath: string): string | null {
  const resolved = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return null;
  }
  return resolved;
}

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
```

**Step 4: Run tests**

Run: `cd extension && npx vitest run server/tools/terminal.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add extension/server/tools/terminal.ts extension/server/tools/terminal.test.ts
git commit -m "feat: add run_command tool with user confirmation"
```

---

### Task 9: Register New Tools + Update System Prompt

**Files:**
- Modify: `extension/server/tools/registry.ts` (import and register new tool modules)
- Modify: `extension/server/prompt.ts` (update workspace context section)

**Step 1: Update registry.ts**

Add imports for new tool modules:
```typescript
import { editorContextTools } from './editorContext';
import { diagnosticsTools } from './diagnostics';
import { terminalTools } from './terminal';
```

In the `allTools` array in the constructor, add after the workspace tools block:

```typescript
// IDE integration tools (editor context, diagnostics, terminal)
...editorContextTools(),
...diagnosticsTools(),
...terminalTools(
  config.workspaceFolders,
  () => this._activeFolder,
),
```

**Step 2: Update prompt.ts — workspace context section**

In `buildSystemPrompt()`, update the workspace context block (lines 36-43) to mention the new tools:

```typescript
if (activeFolder) {
  parts.push('');
  parts.push('WORKSPACE CONTEXT:');
  parts.push(`The user has workspace folder "${activeFolder.name}" open at: ${activeFolder.path}`);
  parts.push('Use workspace tools (read_workspace_file, list_workspace_files, search_workspace, get_workspace_info, write_workspace_file, delete_workspace_file, edit_workspace_file) to work with local files.');
  parts.push('Use get_editor_context to see what file the user has open and what text they have selected.');
  parts.push('Use get_diagnostics to see errors and warnings from TypeScript, ESLint, and other tools.');
  parts.push('Use run_command to execute shell commands (build, test, lint, git). The user must approve each command.');
  parts.push('Use repository tools (get_file, list_files, search_code) for remote GitLab repository files.');
  parts.push('When the user asks about their code or files, prefer workspace tools first.');
}
```

**Step 3: Run all tests**

Run: `cd extension && npx vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
git add extension/server/tools/registry.ts extension/server/prompt.ts
git commit -m "feat: register new agentic tools and update system prompt"
```

---

### Task 10: Webview — Confirmation UI

**Files:**
- Modify: `extension/webview/hooks/useChat.ts` (parse `[CONFIRM:id]` events, add confirm callback)
- Modify: `extension/webview/components/MessageBubble.tsx` (render confirmation buttons)

**Step 1: Update useChat.ts to detect and handle confirmations**

Add a `pendingConfirmation` state:

```typescript
export interface PendingConfirmation {
  id: string;
  command: string;
}

// In useChat hook, add:
const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
```

In the SSE event processing loop, add detection for `[CONFIRM:id]` before the normal token append:

```typescript
// Check for confirmation request
const confirmMatch = data.match(/^\n?\[CONFIRM:([\w-]+)\] (.+)\n?$/);
if (confirmMatch) {
  setPendingConfirmation({ id: confirmMatch[1], command: confirmMatch[2] });
  // Don't append this to the message text
  continue; // or use appropriate control flow
}
```

Add a `confirmCommand` callback:

```typescript
const confirmCommand = useCallback(async (id: string, approved: boolean) => {
  setPendingConfirmation(null);
  try {
    await fetch(`${serverUrl}/command/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, approved }),
    });
  } catch (e) {
    console.error('Failed to send confirmation:', e);
  }
}, [serverUrl]);
```

Return `pendingConfirmation` and `confirmCommand` from the hook.

**Step 2: Update MessageBubble.tsx or ChatWindow.tsx for confirmation UI**

In `ChatWindow.tsx`, render the confirmation prompt when `pendingConfirmation` is set:

```tsx
{pendingConfirmation && (
  <div style={{
    padding: '0.75rem 1rem',
    margin: '0 1rem 0.75rem',
    borderRadius: '8px',
    background: 'var(--vscode-editorWidget-background)',
    border: '1px solid var(--vscode-panel-border)',
  }}>
    <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
      The agent wants to run:
    </div>
    <code style={{
      display: 'block',
      padding: '0.4rem 0.6rem',
      borderRadius: '4px',
      background: 'var(--vscode-editor-background)',
      marginBottom: '0.75rem',
      fontSize: '0.85rem',
    }}>
      {pendingConfirmation.command}
    </code>
    <div style={{ display: 'flex', gap: '0.5rem' }}>
      <button
        onClick={() => confirmCommand(pendingConfirmation.id, true)}
        style={{
          background: 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
          border: 'none',
          borderRadius: '4px',
          padding: '0.3rem 0.75rem',
          cursor: 'pointer',
          fontSize: '0.8rem',
        }}
      >
        Approve
      </button>
      <button
        onClick={() => confirmCommand(pendingConfirmation.id, false)}
        style={{
          background: 'var(--vscode-button-secondaryBackground)',
          color: 'var(--vscode-button-secondaryForeground)',
          border: 'none',
          borderRadius: '4px',
          padding: '0.3rem 0.75rem',
          cursor: 'pointer',
          fontSize: '0.8rem',
        }}
      >
        Deny
      </button>
    </div>
  </div>
)}
```

**Step 3: Run all tests**

Run: `cd extension && npx vitest run`
Expected: All PASS

**Step 4: Build and verify**

Run: `cd extension && npm run build`
Expected: Build succeeds with no errors

**Step 5: Commit**

```bash
git add extension/webview/hooks/useChat.ts extension/webview/components/ChatWindow.tsx
git commit -m "feat: add command confirmation UI in chat webview"
```

---

### Task 11: Integration Test — Build & Smoke Test

**Step 1: Run full test suite**

Run: `cd extension && npx vitest run`
Expected: All tests PASS

**Step 2: Build all bundles**

Run: `cd extension && npm run build`
Expected: Build produces `dist/extension.js`, `dist/server.js`, `dist/webview.js` without errors

**Step 3: Verify tool count in built server**

Run: `cd extension && node -e "const r = require('./dist/server.js'); console.log('built ok');"` (or use the `/tools` endpoint after starting the extension)

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: integration fixes for agentic features"
```

---

## Summary

| Task | Feature | Tests | Files |
|------|---------|-------|-------|
| 1 | IPC bridge (server side) | 3 | `ipcBridge.ts`, test |
| 2 | IPC bridge (extension host side) | 1 | `server.ts`, `extension.ts` |
| 3 | Tool interface (ToolContext) | 0 (verified by existing) | `tool.ts`, `registry.ts`, `reactLoop.ts` |
| 4 | `get_editor_context` | 3 | `editorContext.ts`, test |
| 5 | `get_diagnostics` | 4 | `diagnostics.ts`, test |
| 6 | `edit_workspace_file` | 7 | `workspace.ts`, test |
| 7 | Confirmation infrastructure | 3 | `confirmations.ts`, `index.ts`, `reactLoop.ts` |
| 8 | `run_command` | 4 | `terminal.ts`, test |
| 9 | Registry + prompt updates | 0 (verified by all-pass) | `registry.ts`, `prompt.ts` |
| 10 | Confirmation UI (webview) | 0 (manual) | `useChat.ts`, `ChatWindow.tsx` |
| 11 | Build & smoke test | - | - |

**Total new tests:** ~25
**Total new tool count:** 4 (`run_command`, `get_diagnostics`, `get_editor_context`, `edit_workspace_file`)
**Estimated tool total after:** 72
