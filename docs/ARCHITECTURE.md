# OpenDuo Architecture

> System design reference for contributors and maintainers.

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Component Diagram](#component-diagram)
- [Extension Host](#extension-host)
- [Node.js Server](#nodejs-server)
- [React Webview](#react-webview)
- [ReAct Agent Loop](#react-agent-loop)
- [Provider Abstraction](#provider-abstraction)
- [Tool System](#tool-system)
- [Streaming Protocol](#streaming-protocol)
- [IPC Bridge](#ipc-bridge)
- [Build Pipeline](#build-pipeline)

---

## High-Level Overview

OpenDuo is a VS Code extension with three runtime components:

1. **Extension Host** — TypeScript running in VS Code's Node.js process. Manages PAT storage, spawns the server, and hosts the webview.
2. **Node.js Server** — A standalone HTTP server (`server.js`) spawned as a child process. Runs the ReAct agent loop, calls GitLab APIs, and streams responses via SSE.
3. **React Webview** — A browser-context React app rendered in a VS Code webview panel. Connects to the server over HTTP/SSE.

```
User ↔ React Webview ↔ Node.js Server ↔ GitLab APIs
                            ↕
                     Extension Host (IPC)
```

---

## Component Diagram

```
┌──────────────────────────────────────────────────────────┐
│                   VS Code Process                        │
│                                                          │
│  ┌─────────────────────────────────────────────────┐     │
│  │              Extension Host                     │     │
│  │                                                 │     │
│  │  extension.ts    Main entry point. Registers    │     │
│  │                  commands, starts server,        │     │
│  │                  handles IPC requests.           │     │
│  │                                                 │     │
│  │  patManager.ts   PAT CRUD via SecretStorage     │     │
│  │                  (Windows DPAPI).                │     │
│  │                                                 │     │
│  │  server.ts       ServerManager — spawns         │     │
│  │                  server.js as child_process,     │     │
│  │                  manages lifecycle + IPC.        │     │
│  │                                                 │     │
│  │  chatPanel.ts    Creates WebviewPanel,           │     │
│  │                  injects server URL + CSP.       │     │
│  │                                                 │     │
│  │  logger.ts       Output channel logging.         │     │
│  └──────────┬──────────────────────────────────────┘     │
│             │ child_process (stdio + IPC)                 │
│             ▼                                            │
│  ┌─────────────────────────────────────────────────┐     │
│  │              Node.js Server                     │     │
│  │                                                 │     │
│  │  index.ts        HTTP server (http.createServer)│     │
│  │                  Routes: /health, /chat, /tools,│     │
│  │                  /chat/reset, /command/confirm,  │     │
│  │                  /workspaces                     │     │
│  │                                                 │     │
│  │  reactLoop.ts    ReAct agent loop. Iterates     │     │
│  │                  LLM → tool calls → observations│     │
│  │                  up to 15 times.                 │     │
│  │                                                 │     │
│  │  providers/      LLM provider abstraction:      │     │
│  │    gitlabProvider.ts   REST /chat/completions   │     │
│  │    graphqlProvider.ts  GraphQL + ActionCable     │     │
│  │                                                 │     │
│  │  tools/          30+ tool implementations       │     │
│  │    registry.ts   Central dispatch + definitions │     │
│  │    issues.ts, mergeRequests.ts, ...             │     │
│  │    workspace.ts  Local file operations          │     │
│  │    terminal.ts   Shell command execution         │     │
│  │                                                 │     │
│  │  toolCallParser.ts  Extracts <tool_call> blocks │     │
│  │  prompt.ts          System prompt builder       │     │
│  │  config.ts          Env var configuration       │     │
│  │  gitlabClient.ts    HTTP client for GitLab API  │     │
│  │  auth.ts            PAT header helpers          │     │
│  │  confirmations.ts   User confirmation manager   │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌─────────────────────────────────────────────────┐     │
│  │              React Webview                      │     │
│  │                                                 │     │
│  │  ChatApp.tsx     Root component, connection     │     │
│  │                  health polling, workspace mgmt │     │
│  │                                                 │     │
│  │  ChatWindow.tsx  Message list, auto-scroll,     │     │
│  │                  example prompts                 │     │
│  │                                                 │     │
│  │  MessageBubble   Markdown rendering (marked.js),│     │
│  │  .tsx            streaming cursor, XSS-safe     │     │
│  │                                                 │     │
│  │  InputBar.tsx    Auto-resize textarea, send/stop│     │
│  │                                                 │     │
│  │  StatusBar.tsx   Connection indicator, model     │     │
│  │                  label, workspace folder picker  │     │
│  │                                                 │     │
│  │  useChat.ts      SSE consumer, message state,   │     │
│  │                  confirmation handling           │     │
│  └─────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

---

## Extension Host

**Entry:** `extension/src/extension.ts`

The `activate()` function:

1. Creates a `PatManager` instance (wraps VS Code `SecretStorage`).
2. Registers two commands:
   - `openduo.configurePat` — Prompts user for PAT, validates format, stores securely.
   - `openduo.openChat` — Starts the server (if not running), opens the chat webview.
3. Creates a `ServerManager` that spawns `dist/server.js` as a child process.
4. Passes environment variables to the server: `GITLAB_URL`, `GITLAB_PAT`, `OPENDUO_CHAT_PROVIDER`, `OPENDUO_WORKSPACE_FOLDERS`.
5. Watches for settings changes and restarts the server when GitLab URL or provider changes.
6. Registers IPC handlers for `getDiagnostics` and `getEditorContext` (bridging server requests to VS Code APIs).

**Lifecycle:** Server starts when the user first opens chat and stops when VS Code deactivates the extension.

---

## Node.js Server

**Entry:** `extension/server/index.ts`

A plain `http.createServer` bound to `127.0.0.1:8745` (configurable via `OPENDUO_PORT`). No framework — just manual route matching.

### Request Flow (POST /chat)

1. Validate CORS origin (only `vscode-webview://` and localhost).
2. Parse JSON body: `{ message: string, workspaceFolder?: string }`.
3. Set SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`).
4. Create a `ReactLoop` with max 15 iterations.
5. Stream tokens to the client as `data: <token>\n\n` events.
6. On completion, send `data: [DONE]\n\n`.
7. On error, send `data: [ERROR] <message>\n\n`.

### History Management

Conversation history is maintained in-memory on the server. It is trimmed to the system prompt + last 50 messages to prevent unbounded growth. `POST /chat/reset` clears history.

---

## React Webview

**Entry:** `extension/webview/index.tsx`

The webview is an IIFE bundle loaded in an `<iframe>` inside a VS Code `WebviewPanel`. The server URL is injected at panel creation time by `chatPanel.ts`.

### `useChat` Hook

The core of the webview. Manages:

- Message array state (user + assistant messages).
- SSE connection per request (not persistent — one fetch per user message).
- Multi-line token reassembly (multiple `data:` fields within a single SSE event).
- Confirmation flow: detects `[CONFIRM:id] <prompt>` tokens and shows approve/deny UI.
- Abort controller for cancelling in-flight requests.

---

## ReAct Agent Loop

**File:** `extension/server/reactLoop.ts`

The ReAct (Reasoning + Acting) loop is the core agentic behavior:

```
User Message
  │
  ▼
┌──────────────────────────────┐
│  Iteration (max 15)          │
│                              │
│  1. Stream LLM response      │
│     - Tokens sent to client  │
│     - Tool calls captured    │
│                              │
│  2. Parse <tool_call> blocks │
│                              │
│  3. Execute each tool call   │
│     - Emit [Calling ...]     │
│     - Run tool.execute()     │
│     - Append observation     │
│                              │
│  4. If tool calls found:     │
│     → Continue loop          │
│     If no tool calls:        │
│     → Final answer, stop     │
└──────────────────────────────┘
```

### Tool Call Format

The LLM emits tool calls as XML blocks in its text output:

```xml
<tool_call>
{"name": "list_issues", "arguments": {"project_id": "mygroup/myproject"}}
</tool_call>
```

These are parsed by `toolCallParser.ts` using regex extraction. The `getStreamableText()` function strips complete `<tool_call>` blocks and maintains a lookahead buffer to prevent partial tags from leaking to the client.

---

## Provider Abstraction

**Interface:** `extension/server/provider.ts`

```typescript
interface LlmProvider {
  chatStream(
    messages: ChatMessage[],
    tools: ToolDefinition[]
  ): AsyncIterable<ModelResponse>;
}
```

### REST Provider (`gitlabProvider.ts`)

For self-managed GitLab EE with `access_rest_chat` feature flag:

- Flattens message history into a single content string.
- POSTs to `/api/v4/chat/completions`.
- Parses SSE stream (OpenAI-compatible format).

### GraphQL Provider (`graphqlProvider.ts`)

For GitLab.com:

- Resolves user GID via REST.
- Connects to ActionCable WebSocket (`/-/cable`).
- Subscribes to `aiCompletionResponse` subscription.
- Fires `aiAction` mutation via HTTP.
- Buffers and reorders out-of-order streaming chunks.
- 120s overall timeout, 10s idle timeout.

---

## Tool System

**Registry:** `extension/server/tools/registry.ts`

Tools implement a common interface:

```typescript
interface Tool {
  name: string;
  description: string;
  parametersSchema(): Record<string, unknown>;
  execute(args: Record<string, unknown>, context?: ToolContext): Promise<string>;
}
```

The `ToolRegistry` instantiates all tools at startup, provides definitions for the LLM prompt, and dispatches execution by tool name.

### Tool Categories

| Category | Source File | Tools |
|---|---|---|
| Issues | `issues.ts` | list, get, create, update, close |
| Merge Requests | `mergeRequests.ts` | list, get, create, update, approve, merge |
| Pipelines | `pipelines.ts` | list, get, jobs, cancel, retry |
| Repositories | `repositories.ts` | list files, get file, search code |
| Projects | `projects.ts` | list, get, create |
| Users | `users.ts` | get current user, list users |
| CI/CD | `cicd.ts` | list variables, get variable |
| Milestones | `milestones.ts` | list, get, create |
| Labels | `labels.ts` | list, get |
| Snippets | `snippets.ts` | list, get, create |
| Groups | `groups.ts` | list, get |
| Environments | `environments.ts` | list |
| Wiki | `wiki.ts` | list pages, get page |
| GraphQL | `graphqlQueries.ts` | custom query execution |
| Workspace | `workspace.ts` | read, list, search, write, delete, edit files; get info |
| Terminal | `terminal.ts` | run_command (with confirmation) |
| Editor | `editorContext.ts` | get editor context, get diagnostics |

See [docs/TOOLS.md](TOOLS.md) for the complete reference.

---

## Streaming Protocol

Communication between the webview and server uses **Server-Sent Events (SSE)**:

```
POST /chat { "message": "List my issues" }

← HTTP 200, Content-Type: text/event-stream

data: Here are
data: your open
data: issues:
data: \n- Issue #1
data: [DONE]
```

### Multi-line Tokens

Tokens containing newlines are split across multiple `data:` fields within a single event (separated by `\n\n`). The webview's `useChat` hook reassembles them.

### Special Markers

| Marker | Meaning |
|---|---|
| `[DONE]` | Stream complete, no more tokens |
| `[ERROR] <msg>` | Server-side error occurred |
| `[Calling <tool>...]` | Tool execution in progress |
| `[CONFIRM:<id>] <prompt>` | User confirmation required |

---

## IPC Bridge

The extension host and server communicate via **stdio IPC** (JSON messages on the child process channel):

```
Server → Extension Host:
{ "type": "request", "id": "abc123", "method": "getDiagnostics", "params": { "filePath": "..." } }

Extension Host → Server:
{ "type": "response", "id": "abc123", "data": [...] }
```

This bridge allows the server to access VS Code APIs (diagnostics, editor context) that are only available in the extension host process.

---

## Build Pipeline

The project uses **esbuild** to produce three separate bundles:

| Bundle | Entry | Format | Target | Output |
|---|---|---|---|---|
| `extension.js` | `src/extension.ts` | CommonJS | Node 20 | `dist/extension.js` |
| `webview.js` | `webview/index.tsx` | IIFE | Browser ES2020 | `dist/webview.js` |
| `server.js` | `server/index.ts` | CommonJS | Node 20 | `dist/server.js` |

All three bundles are tree-shaken and minified. The `vscode` module is marked as external for the extension bundle.

### CI/CD

- **GitLab CI** (`.gitlab-ci.yml`): test → build → package → release (tag-triggered)
- **GitHub Actions** (`.github/workflows/ci.yml`): test → lint → audit → build → package → release

See [docs/DEVELOPMENT.md](DEVELOPMENT.md) for build instructions.
