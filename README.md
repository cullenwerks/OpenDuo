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
  <img src="https://img.shields.io/badge/version-0.1.0-orange" alt="Version 0.1.0"/>
</p>

---

## Why OpenDuo?

The official GitLab Duo VS Code extension requires OAuth for its chat features, which is **blocked in many Federal, DoD, and GovCloud environments**. OpenDuo provides the same agentic GitLab chat experience using only a Personal Access Token (PAT) — no OAuth handshake, no browser redirects, no external auth servers.

## Features

- **Agentic Chat** — Ask questions in natural language; an AI agent autonomously calls 30+ GitLab tools to answer
- **PAT-Only Auth** — Works in air-gapped and OAuth-restricted networks
- **30+ GitLab Tools** — Issues, merge requests, pipelines, repositories, wikis, CI/CD, environments, and more
- **Streaming Responses** — Real-time SSE streaming for fast, incremental answers
- **Secure by Default** — PAT stored in Windows Credential Manager (DPAPI), TLS 1.2+ via SChannel, zero telemetry
- **REST & GraphQL** — Supports self-managed GitLab EE (REST) and GitLab.com (GraphQL + ActionCable)

## Prerequisites

| Requirement | Details |
|---|---|
| **VS Code** | 1.85 or later |
| **OS** | Windows x64 |
| **GitLab** | Self-managed EE with `access_rest_chat` feature flag, or GitLab.com |
| **PAT Scopes** | `api`, `read_user`, `ai_features` |

## Installation

1. Download `openduo-windows-x64-{version}.vsix` from [Releases](../../releases)
2. In VS Code: **Ctrl+Shift+P** → `Extensions: Install from VSIX...`
3. Select the downloaded `.vsix` file
4. Reload VS Code when prompted

## Configuration

1. Open VS Code Settings (**Ctrl+,**)
2. Search for `openduo`
3. Set **`openduo.gitlabUrl`** to your GitLab instance URL (e.g. `https://gitlab.example.com`)
4. *(Optional)* Set **`openduo.chatProvider`** to `graphql` if using GitLab.com (default is `rest`)
5. Run **Ctrl+Shift+P** → `OpenDuo: Configure PAT`
6. Enter your GitLab PAT — it is stored securely in Windows Credential Manager

## Usage

Open the chat panel with **Ctrl+Shift+P** → `OpenDuo: Open Chat`, then ask anything:

```
List my open merge requests in group/myrepo
Show me the last 5 failed pipelines
Create an issue titled "Fix login bug" in group/frontend
Who are the members of the devops group?
Show the CI config for project myapp
```

The AI agent will plan a sequence of GitLab API calls, execute them, and return a synthesized answer — all inside VS Code.

## Available Tools

<details>
<summary><strong>Issues & Merge Requests</strong></summary>

`list_issues` · `get_issue` · `create_issue` · `update_issue` · `close_issue` · `list_merge_requests` · `get_merge_request` · `create_merge_request` · `update_merge_request` · `merge_merge_request`
</details>

<details>
<summary><strong>Pipelines & CI/CD</strong></summary>

`list_pipelines` · `get_pipeline` · `get_pipeline_jobs` · `list_environments` · `create_environment`
</details>

<details>
<summary><strong>Repositories & Code</strong></summary>

`list_repositories` · `get_repository` · `get_file` · `list_snippets` · `get_snippet` · `create_snippet`
</details>

<details>
<summary><strong>Projects, Groups & Users</strong></summary>

`list_projects` · `get_project` · `list_groups` · `get_group` · `list_users` · `get_user` · `list_labels` · `list_milestones`
</details>

<details>
<summary><strong>Wiki & GraphQL</strong></summary>

`list_wiki_pages` · `get_wiki_page` · GraphQL queries for rich data retrieval
</details>

## Architecture

```
VS Code Extension (TypeScript + React)
    │
    ├── Chat Webview (React)
    │     Components: ChatWindow, MessageBubble, InputBar, StatusBar
    │     Streaming via SSE (useChat hook)
    │
    └── Extension Host (TypeScript)
          ├── PAT Manager (Windows Credential Manager / DPAPI)
          ├── Node.js Server (spawns embedded binary)
          └── openduo-server.exe (Rust)
                ├── Auth Module (PAT validation)
                ├── ReAct Agent Loop (LLM orchestration)
                ├── Tool Registry (30+ GitLab tools)
                └── GitLab API Client (REST v4 + GraphQL)
```

## Security

| Control | Detail |
|---|---|
| **Credential Storage** | Windows Credential Manager via VS Code SecretStorage (DPAPI encrypted) |
| **Transport** | TLS 1.2+ using Windows SChannel (FIPS 140-2 validated) |
| **Input Validation** | Request body size limit (64 KiB), CORS restrictions |
| **Telemetry** | Zero — no data leaves your GitLab instance |
| **Logging** | All tool invocations logged to VS Code Output Channel → "OpenDuo" |

## Development

```bash
cd extension
npm install
npm run build     # Build with esbuild
npm run watch     # Watch mode for development
npm run test      # Run tests (vitest)
npm run package   # Build + package as .vsix
```

## Contributing

Contributions are welcome! Please open an issue or submit a merge request on [GitLab](https://gitlab.com/cullen.guimond/openduo).

## License

[MIT](LICENSE)
