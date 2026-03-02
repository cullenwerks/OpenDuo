# Contributing to OpenDuo

Thank you for your interest in contributing to OpenDuo! This guide covers everything you need to know to contribute effectively.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Architecture Overview](#architecture-overview)
- [Common Tasks](#common-tasks)
- [Testing](#testing)
- [Documentation](#documentation)
- [Issue Guidelines](#issue-guidelines)

---

## Getting Started

1. **Fork** the repository.
2. **Clone** your fork: `git clone https://github.com/your-username/OpenDuo.git`
3. **Create a branch**: `git checkout -b feature/my-feature`
4. **Install dependencies**: `cd extension && npm install`
5. **Build**: `npm run build`
6. **Test**: `npm test`

---

## Development Setup

See [docs/DEVELOPMENT.md](DEVELOPMENT.md) for the complete development guide, including:

- Prerequisites (Node.js 20+, VS Code 1.85+)
- Build system (esbuild, three bundles)
- Running locally (F5 in VS Code)
- Debugging (extension host, server, webview)

---

## Code Style

### TypeScript

- **Strict mode** is enabled across all tsconfigs.
- Use `const` by default, `let` when reassignment is needed. Never `var`.
- Prefer `async/await` over raw Promises.
- Use explicit types for function parameters and return values.
- Use interfaces for object shapes, type aliases for unions and primitives.

### Naming

| Element | Convention | Example |
|---|---|---|
| Files | camelCase | `reactLoop.ts` |
| React components | PascalCase | `ChatWindow.tsx` |
| Interfaces/Types | PascalCase | `LlmProvider` |
| Functions | camelCase | `getStreamableText` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_PORT` |
| Tool names | snake_case | `list_issues` |

### Project Structure

- Extension host code → `extension/src/`
- React webview code → `extension/webview/`
- Server code → `extension/server/`
- Tool implementations → `extension/server/tools/`
- Tests → `extension/test/`

### Error Handling

- Tool `execute()` functions should return error messages as strings, not throw exceptions.
- HTTP errors should return appropriate status codes.
- Streaming errors should be sent as `[ERROR]` events.
- Never expose stack traces or internal paths to the user.

---

## Making Changes

### Before You Start

1. Check existing issues and PRs to avoid duplicate work.
2. For large changes, open an issue first to discuss the approach.
3. Keep PRs focused — one feature or fix per PR.

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add pipeline retry tool
fix: handle empty project_id in list_issues
docs: update tools reference with new workspace tools
test: add tests for graphqlProvider timeout handling
refactor: extract SSE parsing into shared utility
```

Prefixes: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`

### Branch Naming

```
feature/add-pipeline-retry
fix/empty-project-id-crash
docs/update-api-reference
```

---

## Pull Request Process

1. **Ensure tests pass**: `npm test`
2. **Ensure types check**: `npx tsc --noEmit` (all three tsconfigs)
3. **Update documentation** if you added/changed tools, endpoints, or configuration.
4. **Write a clear PR description** explaining what changed and why.
5. **Link related issues** in the PR description.

### PR Template

```markdown
## Summary

Brief description of the changes.

## Changes

- Added X
- Fixed Y
- Updated Z

## Testing

- [ ] New tests added
- [ ] Existing tests pass
- [ ] Manual testing done (describe what you tested)

## Documentation

- [ ] docs/TOOLS.md updated (if new tools)
- [ ] docs/API.md updated (if new endpoints)
- [ ] README.md updated (if user-facing changes)
```

---

## Architecture Overview

OpenDuo has three runtime components. Understanding which component your change touches is important:

| Component | Location | Environment | When to Modify |
|---|---|---|---|
| **Extension Host** | `src/` | VS Code Node.js | Commands, PAT management, server lifecycle |
| **Node.js Server** | `server/` | Child process | Agent loop, tools, providers, API routes |
| **React Webview** | `webview/` | Browser | Chat UI, message rendering, user interaction |

See [docs/ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture guide.

---

## Common Tasks

### Adding a New GitLab Tool

See [docs/DEVELOPMENT.md § Adding a New Tool](DEVELOPMENT.md#adding-a-new-tool).

1. Create a tool file in `server/tools/`.
2. Register it in `server/tools/registry.ts`.
3. Add tests.
4. Document in `docs/TOOLS.md`.

### Adding a New Chat Provider

See [docs/DEVELOPMENT.md § Adding a New Provider](DEVELOPMENT.md#adding-a-new-provider).

1. Implement the `LlmProvider` interface.
2. Wire into `server/index.ts`.
3. Add config option to `package.json`.

### Modifying the Chat UI

1. Edit components in `webview/components/`.
2. Test in the Extension Development Host (F5).
3. Use **Ctrl+Shift+P** → `Developer: Open Webview Developer Tools` for debugging.

### Adding a New Extension Command

1. Add the command in `package.json` under `contributes.commands`.
2. Register the handler in `src/extension.ts`.
3. Add any needed VS Code API calls.

---

## Testing

### Running Tests

```bash
cd extension
npm test              # Run all tests
npx vitest --watch    # Watch mode
```

### Test Guidelines

- Write unit tests for all new tools and utility functions.
- Mock external dependencies (HTTP calls, VS Code API, file system).
- Test edge cases: empty inputs, malformed data, error responses.
- Tool tests should verify:
  - Correct API path construction.
  - Proper URL-encoding of project IDs.
  - Error message formatting.

### Test File Location

Tests live in `extension/test/` and follow the naming convention `<module>.test.ts`.

---

## Documentation

### When to Update Docs

- **New tool added** → Update `docs/TOOLS.md`
- **New endpoint added** → Update `docs/API.md`
- **New config option** → Update `docs/DEVELOPMENT.md` and `README.md`
- **Security-relevant change** → Update `docs/SECURITY.md`
- **Architecture change** → Update `docs/ARCHITECTURE.md`

### Documentation Style

- Use present tense ("Returns" not "Will return").
- Include code examples where helpful.
- Keep tables for structured reference data.
- Link between docs where relevant.

---

## Issue Guidelines

### Bug Reports

Include:
- VS Code version
- OpenDuo version
- GitLab instance type (self-managed EE / GitLab.com)
- Chat provider (REST / GraphQL)
- Steps to reproduce
- Expected vs actual behavior
- Relevant error messages from the Output Channel

### Feature Requests

Include:
- Use case description
- Proposed behavior
- Which component it affects (extension host, server, webview)

---

## Code of Conduct

Be respectful, constructive, and collaborative. We're building this for Federal Enterprise environments where reliability and security matter. Every contribution should uphold those standards.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
