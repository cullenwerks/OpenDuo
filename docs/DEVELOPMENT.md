# Development Guide

> Everything you need to set up, build, test, and debug OpenDuo locally.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
- [Build System](#build-system)
- [Running Locally](#running-locally)
- [Testing](#testing)
- [Debugging](#debugging)
- [Code Organization](#code-organization)
- [Adding a New Tool](#adding-a-new-tool)
- [Adding a New Provider](#adding-a-new-provider)
- [Packaging](#packaging)
- [CI/CD](#cicd)

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| **Node.js** | 20+ | Runtime and build |
| **npm** | 10+ | Package management |
| **VS Code** | 1.85+ | Extension host |
| **Git** | 2.30+ | Version control |

Optional for packaging:
| Tool | Version | Purpose |
|---|---|---|
| **vsce** | (installed via npm) | `.vsix` packaging |

---

## Repository Structure

```
OpenDuo/
├── extension/                 # All extension source code
│   ├── package.json           # Extension manifest + dependencies
│   ├── esbuild.config.js     # Build configuration (3 bundles)
│   ├── tsconfig.json          # TypeScript config (extension host)
│   ├── tsconfig.webview.json  # TypeScript config (webview/browser)
│   ├── tsconfig.server.json   # TypeScript config (server/Node.js)
│   ├── vitest.config.ts       # Test configuration
│   ├── src/                   # Extension host code
│   │   ├── extension.ts       # Entry point (activate/deactivate)
│   │   ├── server.ts          # ServerManager (child process)
│   │   ├── chatPanel.ts       # Webview panel management
│   │   ├── patManager.ts      # PAT storage (SecretStorage)
│   │   └── logger.ts          # Output channel logging
│   ├── webview/               # React chat UI (browser context)
│   │   ├── index.tsx           # React entry point
│   │   ├── vscode.ts           # acquireVsCodeApi wrapper
│   │   ├── components/         # React components
│   │   │   ├── ChatApp.tsx
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── InputBar.tsx
│   │   │   └── StatusBar.tsx
│   │   └── hooks/
│   │       └── useChat.ts      # SSE consumer + chat state
│   ├── server/                # Node.js backend server
│   │   ├── index.ts           # HTTP server + routes
│   │   ├── reactLoop.ts       # ReAct agent loop
│   │   ├── toolCallParser.ts  # <tool_call> XML parser
│   │   ├── prompt.ts          # System prompt builder
│   │   ├── config.ts          # Environment config
│   │   ├── types.ts           # Shared types
│   │   ├── auth.ts            # PAT header helpers
│   │   ├── gitlabClient.ts    # GitLab HTTP client
│   │   ├── provider.ts        # LlmProvider interface
│   │   ├── gitlabProvider.ts  # REST provider
│   │   ├── graphqlProvider.ts # GraphQL + ActionCable provider
│   │   ├── confirmations.ts   # User confirmation manager
│   │   └── tools/             # Tool implementations
│   │       ├── tool.ts        # Tool interface
│   │       ├── registry.ts    # Tool registry + dispatch
│   │       ├── workspace.ts   # Local file tools
│   │       ├── terminal.ts    # Shell command tool
│   │       ├── editorContext.ts
│   │       ├── diagnostics.ts
│   │       ├── issues.ts
│   │       ├── mergeRequests.ts
│   │       ├── pipelines.ts
│   │       ├── repositories.ts
│   │       ├── projects.ts
│   │       ├── users.ts
│   │       ├── cicd.ts
│   │       ├── milestones.ts
│   │       ├── labels.ts
│   │       ├── snippets.ts
│   │       ├── groups.ts
│   │       ├── environments.ts
│   │       ├── wiki.ts
│   │       └── graphqlQueries.ts
│   ├── test/                  # Test files
│   ├── media/                 # Extension icon + assets
│   └── dist/                  # Build output (gitignored)
├── docs/                      # Documentation
│   ├── plans/                 # Design and implementation plans
│   ├── ARCHITECTURE.md
│   ├── DEVELOPMENT.md         # (this file)
│   ├── TOOLS.md
│   ├── API.md
│   ├── SECURITY.md
│   └── CONTRIBUTING.md
├── .github/workflows/ci.yml  # GitHub Actions CI
├── .gitlab-ci.yml             # GitLab CI
├── .gitignore
├── LICENSE
└── README.md
```

---

## Getting Started

```bash
# Clone the repository
git clone https://github.com/your-org/OpenDuo.git
cd OpenDuo/extension

# Install dependencies
npm install

# Build all bundles
npm run build

# Run tests
npm test
```

---

## Build System

OpenDuo uses **esbuild** for fast bundling. The config (`esbuild.config.js`) produces three independent bundles:

### Extension Host Bundle

```
Entry:    src/extension.ts
Output:   dist/extension.js
Format:   CommonJS
Target:   Node 20
External: vscode
```

This runs in VS Code's extension host process. The `vscode` module is external because VS Code provides it at runtime.

### Webview Bundle

```
Entry:    webview/index.tsx
Output:   dist/webview.js
Format:   IIFE (immediately-invoked function expression)
Target:   Browser ES2020
```

This runs inside the webview's browser context. It includes React, marked.js, and all component code.

### Server Bundle

```
Entry:    server/index.ts
Output:   dist/server.js
Format:   CommonJS
Target:   Node 20
```

This is spawned as a child process by the extension host. It includes the HTTP server, agent loop, providers, and all tools.

### Build Commands

```bash
npm run build     # Build all three bundles (production)
npm run watch     # Watch mode — rebuilds on file changes
```

### TypeScript Checking

Type checking is separate from bundling (esbuild does not type-check):

```bash
npx tsc --noEmit                        # Extension host
npx tsc --noEmit -p tsconfig.webview.json  # Webview
npx tsc --noEmit -p tsconfig.server.json   # Server
```

---

## Running Locally

### Option 1: VS Code Extension Development Host

1. Open the `extension/` folder in VS Code.
2. Press **F5** to launch the Extension Development Host.
3. In the new VS Code window, configure your GitLab URL and PAT.
4. Run `OpenDuo: Open Chat`.

### Option 2: Watch Mode

In a terminal:

```bash
cd extension
npm run watch
```

Then press **F5** in VS Code. Changes will be rebuilt automatically — just reload the Extension Development Host window (**Ctrl+Shift+P** → `Developer: Reload Window`).

---

## Testing

Tests use **Vitest** and live in `extension/test/`.

```bash
cd extension

npm test              # Run all tests once
npx vitest            # Run in watch mode
npx vitest --ui       # Open the Vitest UI
npx vitest --coverage # Run with coverage report
```

### Test Structure

Tests are unit tests that mock external dependencies (VS Code API, HTTP calls, file system). Key test files:

- `toolCallParser.test.ts` — Tests for `<tool_call>` parsing and streaming safety
- `config.test.ts` — Environment variable validation
- `prompt.test.ts` — System prompt construction
- `reactLoop.test.ts` — Agent loop behavior
- Tool-specific tests

### Writing Tests

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('myFunction', () => {
  it('should do the thing', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });
});
```

---

## Debugging

### Extension Host Debugging

The extension host runs in a Node.js process. Use VS Code's built-in debugger:

1. Set breakpoints in `src/*.ts` files.
2. Press **F5** to start debugging.
3. The debugger attaches to the extension host process.

### Server Debugging

The server runs as a child process. To debug it:

1. Add `console.log` or `console.error` statements — output appears in the VS Code Output Channel ("OpenDuo").
2. For breakpoint debugging, modify `server.ts` to spawn with `--inspect` flag and attach a separate debugger.

### Webview Debugging

1. Open the chat panel.
2. **Ctrl+Shift+P** → `Developer: Open Webview Developer Tools`.
3. Full Chrome DevTools available (console, network, elements).

### Logging

All tool invocations and errors are logged to the VS Code Output Channel:
- **View** → **Output** → select **"OpenDuo"** from the dropdown.

---

## Code Organization

### Three TypeScript Projects

The codebase has three separate TypeScript configurations because the code runs in three different environments:

| Project | Config | Environment | Key Libs |
|---|---|---|---|
| Extension Host | `tsconfig.json` | Node.js (VS Code) | `vscode` API |
| Webview | `tsconfig.webview.json` | Browser (DOM) | React, marked |
| Server | `tsconfig.server.json` | Node.js (child process) | `http`, `ws` |

### Shared Types

`server/types.ts` defines types shared across the server codebase: `ChatMessage`, `ToolDefinition`, `ToolCall`, `ModelResponse`.

### Naming Conventions

- Files: `camelCase.ts` (e.g., `reactLoop.ts`, `gitlabClient.ts`)
- Components: `PascalCase.tsx` (e.g., `ChatWindow.tsx`)
- Interfaces/Types: `PascalCase` (e.g., `LlmProvider`, `ToolContext`)
- Functions: `camelCase` (e.g., `getStreamableText`, `buildSystemPrompt`)

---

## Adding a New Tool

1. **Create the tool file** in `extension/server/tools/`:

```typescript
// extension/server/tools/myFeature.ts
import { GitLabClient } from '../gitlabClient';
import { Tool } from './tool';

export function createMyFeatureTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'my_tool_name',
      description: 'What this tool does — be specific for the LLM.',
      parametersSchema() {
        return {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project ID or URL-encoded path'
            }
          },
          required: ['project_id']
        };
      },
      async execute(args) {
        const projectId = encodeURIComponent(String(args.project_id));
        const result = await client.get(`projects/${projectId}/my_endpoint`);
        return JSON.stringify(result);
      }
    }
  ];
}
```

2. **Register in the registry** (`extension/server/tools/registry.ts`):

```typescript
import { createMyFeatureTools } from './myFeature';

// In the constructor:
const myFeatureTools = createMyFeatureTools(client);
this.tools.push(...myFeatureTools);
```

3. **Write tests** for the new tool.

4. **Document** the tool in `docs/TOOLS.md`.

### Tool Design Guidelines

- Tool names use `snake_case` (e.g., `list_issues`, `get_pipeline`).
- Descriptions should tell the LLM **when** to use the tool, not just what it does.
- Parameter schemas use JSON Schema format.
- `execute()` must return a string (JSON-serialized results).
- URL-encode project IDs: `encodeURIComponent(String(args.project_id))`.
- Handle errors gracefully — return error messages as strings, don't throw.

---

## Adding a New Provider

1. **Implement the `LlmProvider` interface** in a new file under `extension/server/`:

```typescript
// extension/server/myProvider.ts
import { LlmProvider } from './provider';
import { ChatMessage, ToolDefinition, ModelResponse } from './types';

export class MyProvider implements LlmProvider {
  async *chatStream(
    messages: ChatMessage[],
    tools: ToolDefinition[]
  ): AsyncIterable<ModelResponse> {
    // Yield tokens as they arrive:
    yield { type: 'token', content: 'Hello' };
    yield { type: 'done' };
  }
}
```

2. **Wire it into `index.ts`** by adding a case for your provider name in the provider selection logic.

3. **Add the config option** to `package.json` under `contributes.configuration.properties.openduo.chatProvider.enum`.

---

## Packaging

```bash
cd extension
npm run package    # Builds + creates .vsix file
```

This runs `esbuild` followed by `vsce package`, producing a `.vsix` file in the `extension/` directory.

### Manual VSIX Install

```bash
code --install-extension openduo-1.0.0-alpha.vsix
```

---

## CI/CD

### GitHub Actions (`.github/workflows/ci.yml`)

Runs on every push and PR:

| Job | What it does |
|---|---|
| `ts-test` | `npm test` (vitest) |
| `ts-lint` | `tsc --noEmit` on all three tsconfigs |
| `ts-audit` | `npm audit --audit-level=high` |
| `ts-build` | `npm run build` + uploads `dist/` artifact |
| `vsix-package` | `vsce package` + uploads `.vsix` artifact |
| `github-release` | Creates GitHub release (tag pushes only) |

### GitLab CI (`.gitlab-ci.yml`)

Same pipeline structure for GitLab-hosted mirrors:

```
stages: test → build → package → release
```

### Creating a Release

1. Update `version` in `extension/package.json`.
2. Commit and push.
3. Tag with the version: `git tag v1.0.0 && git push --tags`.
4. CI creates the release automatically with the `.vsix` attached.
