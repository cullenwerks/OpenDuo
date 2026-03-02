<p align="center">
  <img src="extension/media/icon.png" alt="OpenDuo Logo" width="128" height="128"/>
</p>

<h1 align="center">OpenDuo</h1>

<p align="center">
  <strong>Open-source GitLab Duo Agentic Chat for Federal Enterprise</strong><br/>
  PAT-authenticated &middot; No OAuth required &middot; Windows x64
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"/></a>
  <img src="https://img.shields.io/badge/VS%20Code-1.85%2B-blue?logo=visual-studio-code" alt="VS Code 1.85+"/>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-0078D4?logo=windows" alt="Windows x64"/>
  <img src="https://img.shields.io/badge/version-1.0.0--alpha-orange" alt="Version 1.0.0-alpha"/>
</p>

---

## Why OpenDuo?

The official GitLab Duo VS Code extension requires OAuth for its chat features, which is **blocked in many Federal, DoD, and GovCloud environments**. OpenDuo provides the same agentic GitLab chat experience using only a Personal Access Token (PAT) — no OAuth handshake, no browser redirects, no external auth servers.

## Features

- **Agentic Chat** — Ask questions in natural language; a ReAct AI agent autonomously calls 30+ GitLab tools to answer
- **PAT-Only Auth** — Works in air-gapped and OAuth-restricted networks
- **30+ GitLab Tools** — Issues, merge requests, pipelines, repositories, wikis, CI/CD, environments, snippets, groups, and more
- **Workspace Tools** — Read, write, search, and edit local files directly from the chat agent
- **Terminal Execution** — Run shell commands with user confirmation before execution
- **Editor Context** — Agent can read your active editor state and diagnostics
- **Streaming Responses** — Real-time SSE streaming with safe tool-call filtering
- **Secure by Default** — PAT stored in Windows Credential Manager (DPAPI), TLS 1.2+ via SChannel, zero telemetry
- **Dual Provider** — Supports self-managed GitLab EE (REST) and GitLab.com (GraphQL + ActionCable)

## Prerequisites

| Requirement | Details |
|---|---|
| **VS Code** | 1.85 or later |
| **OS** | Windows x64 |
| **Node.js** | 20+ (bundled with VS Code) |
| **GitLab** | Self-managed EE with `access_rest_chat` feature flag, or GitLab.com |
| **PAT Scopes** | `api`, `read_user`, `ai_features` |

## Quick Start

1. Download `openduo-{version}.vsix` from [Releases](../../releases)
2. In VS Code: **Ctrl+Shift+P** → `Extensions: Install from VSIX...`
3. Select the downloaded `.vsix` file and reload VS Code
4. Open Settings (**Ctrl+,**) → search `openduo` → set **`openduo.gitlabUrl`** to your GitLab instance
5. **Ctrl+Shift+P** → `OpenDuo: Configure PAT` → enter your GitLab PAT
6. **Ctrl+Shift+P** → `OpenDuo: Open Chat` → start chatting

## Configuration

| Setting | Default | Description |
|---|---|---|
| `openduo.gitlabUrl` | *(empty)* | Your GitLab instance URL (e.g., `https://gitlab.example.com`) |
| `openduo.chatProvider` | `rest` | `rest` for self-managed GitLab EE, `graphql` for GitLab.com |

## Usage Examples

```
List my open merge requests in group/myrepo
Show me the last 5 failed pipelines
Create an issue titled "Fix login bug" in group/frontend
Who are the members of the devops group?
Read the file src/main.ts from my workspace
Search my workspace for TODO comments
Run "npm test" in my project
```

The AI agent plans a sequence of GitLab API calls, executes them, and returns a synthesized answer — all inside VS Code.

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | System design, component diagram, data flow |
| [Development](docs/DEVELOPMENT.md) | Developer setup, build, test, debug workflow |
| [Tools Reference](docs/TOOLS.md) | Complete reference for all 30+ agent tools |
| [API Reference](docs/API.md) | Server HTTP endpoints and SSE protocol |
| [Security](docs/SECURITY.md) | Security model, threat mitigations, compliance |
| [Contributing](docs/CONTRIBUTING.md) | How to contribute, code style, PR process |

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│             VS Code Extension Host               │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐ │
│  │ extension  │ │ patManager │ │  chatPanel   │ │
│  │ .ts        │ │ .ts        │ │  .ts         │ │
│  └─────┬──────┘ └────────────┘ └──────┬───────┘ │
│        │          IPC (stdio)         │ webview  │
│        ▼                              ▼          │
│  ┌───────────────────────────────────────────┐   │
│  │         Node.js Server (server.js)        │   │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────┐ │   │
│  │  │ ReactLoop│ │ Provider  │ │ Registry │ │   │
│  │  │ (ReAct)  │ │ REST/GQL  │ │ 30+ tools│ │   │
│  │  └────┬─────┘ └─────┬─────┘ └────┬─────┘ │   │
│  └───────┼──────────────┼────────────┼───────┘   │
└──────────┼──────────────┼────────────┼───────────┘
           │              │            │
           ▼              ▼            ▼
    ┌────────────┐  ┌──────────┐  ┌──────────────┐
    │ Local FS   │  │ GitLab   │  │ GitLab AI    │
    │ Workspace  │  │ REST/GQL │  │ Gateway      │
    └────────────┘  └──────────┘  └──────────────┘
```

## Development

```bash
cd extension
npm install
npm run build     # Build all three bundles (extension, webview, server)
npm run watch     # Watch mode for development
npm test          # Run tests (vitest)
npm run package   # Build + package as .vsix
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full developer guide.

## Contributing

Contributions are welcome! Please read the [Contributing Guide](docs/CONTRIBUTING.md) before submitting a pull request.

## License

[MIT](LICENSE) — Copyright (c) 2026 OpenDuo Contributors
