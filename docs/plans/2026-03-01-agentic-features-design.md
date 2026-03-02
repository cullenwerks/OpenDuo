# Agentic VSCode Features Design

**Date**: 2026-03-01
**Status**: Approved

## Problem

OpenDuo has 68 GitLab API tools and 6 workspace tools (read, list, search, info, write, delete) but lacks core agentic IDE features: terminal execution, diagnostics awareness, editor context, and line-level editing. The extension host and server process have no bidirectional communication channel.

## Architecture: IPC Bridge

The server runs as a child process (`child_process.spawn`). Currently `stdio: ['ignore', 'pipe', 'pipe']` — no IPC.

**Change**: `stdio: ['ignore', 'pipe', 'pipe', 'ipc']` to enable `process.send()` / `process.on('message')`.

### Protocol

Request/response over Node.js IPC:

```
Server → ExtHost:  { type: "request", id: "uuid", method: "getDiagnostics", params: {...} }
ExtHost → Server:  { type: "response", id: "uuid", data: [...] }
```

**Server side** (`server/ipcBridge.ts`):
- `sendIpcRequest(method, params): Promise<any>` — sends request, returns Promise
- `Map<string, {resolve, reject}>` of pending requests
- 5-second timeout per request

**Extension host side** (`src/server.ts`):
- `this.process.on('message', handler)` dispatches to VSCode API handlers
- Two methods: `getDiagnostics`, `getEditorContext`

## Feature 1: Terminal Execution (`run_command`)

**Tool**: `run_command`
**Parameters**: `command` (string, required), `working_directory` (string, optional)
**Returns**: `{ exitCode, stdout, stderr }` as formatted string

### Safety
- User confirmation required before execution
- 60-second timeout per command
- Working directory sandboxed via `safePath()`
- Output truncated at 50 KB
- Runs via `child_process.exec()` (not VSCode terminal)

### Confirmation Flow

1. Agent calls `run_command` with `{"command": "npm test"}`
2. Tool emits SSE event: `data: [CONFIRM:abc123] npm test\n\n`
3. Webview renders inline: `The agent wants to run: npm test [Approve] [Deny]`
4. User clicks Approve → webview POSTs to `POST /command/confirm`
5. Server resolves pending Promise → command executes
6. Output returned to agent as tool result

### Implementation
- Server holds `Map<string, {resolve}>` of pending confirmations
- New endpoint `POST /command/confirm` with `{ id, approved }`
- 2-minute timeout on user response
- Tool interface extended: `execute(args, context?)` where `context.requestConfirmation(prompt): Promise<boolean>`
- `onToken` callback threaded from ReactLoop through ToolRegistry to tools

### No IPC needed — pure server-side `child_process.exec()`.

## Feature 2: Diagnostics (`get_diagnostics`)

**Tool**: `get_diagnostics`
**Parameters**: `file_path` (string, optional), `severity` (enum, optional: error/warning/info/hint)
**Returns**: JSON array of `{ file, line, column, severity, message, source }`

### Implementation
- Tool calls `sendIpcRequest('getDiagnostics', { filePath, severity })`
- Extension host calls `vscode.languages.getDiagnostics()`
- Filters by file path and severity
- Max 100 diagnostics returned

### Requires IPC bridge.

## Feature 3: Editor Context (`get_editor_context`)

**Tool**: `get_editor_context`
**Parameters**: none
**Returns**: JSON object:
- `filePath` — relative to workspace root
- `languageId` — e.g. "typescript"
- `selection` — selected text (max 10 KB)
- `selectionRange` — `{ startLine, startCol, endLine, endCol }`
- `visibleRange` — `{ startLine, endLine }`
- `isDirty` — unsaved changes flag
- `lineCount` — total lines

### Requires IPC bridge.

## Feature 4: Line-Level Edit (`edit_workspace_file`)

**Tool**: `edit_workspace_file`
**Parameters**: `file_path` (string, required), `edits` (array of `{ start_line, end_line, new_text }`)
**Returns**: Success message with lines changed count

### Behavior
- Lines are 1-indexed, inclusive
- Multiple edits applied bottom-up to avoid line number shifts
- To insert: set `new_text` to include new content + existing line content
- To delete: set `new_text` to `""`
- File must exist (use `write_workspace_file` for new files)

### Safety
- Path sandboxed via `safePath()`
- Binary files rejected
- Max file size 100 KB
- No IPC needed — pure server-side fs operations

## Files Changed

| File | Change |
|------|--------|
| `server/ipcBridge.ts` | New — IPC request/response client |
| `server/tools/terminal.ts` | New — `run_command` tool |
| `server/tools/diagnostics.ts` | New — `get_diagnostics` tool |
| `server/tools/editorContext.ts` | New — `get_editor_context` tool |
| `server/tools/workspace.ts` | Add `edit_workspace_file` tool |
| `server/tools/tool.ts` | Extend Tool interface with optional context |
| `server/tools/registry.ts` | Register new tools, pass context |
| `server/index.ts` | Add `POST /command/confirm` endpoint, wire confirmation state |
| `server/reactLoop.ts` | Thread confirmation context through to tools |
| `server/prompt.ts` | Update system prompt with new tool descriptions |
| `src/server.ts` | Add IPC to stdio, handle IPC requests |
| `webview/hooks/useChat.ts` | Parse `[CONFIRM:id]` SSE events |
| `webview/components/MessageBubble.tsx` or new `ConfirmPrompt.tsx` | Render confirmation UI |

## GitLab Duo Compatibility

All tools follow the existing `Tool` interface (`name`, `description`, `parametersSchema()`, `execute()`). They are provider-agnostic and work with both REST and GraphQL GitLab Duo backends automatically. Tool definitions are inlined in the system prompt via `<tool_call>` syntax — no provider-specific function calling required.
