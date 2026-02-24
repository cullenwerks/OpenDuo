# OpenDuo — Full System Design

**Date:** 2026-02-24
**Status:** Approved
**Author:** Cullen Guimond

---

## 1. Project Summary

OpenDuo is a VS Code extension that delivers PAT-authenticated GitLab Duo Agentic Chat for Federal Enterprise environments (DOJ / DoD security standards) where OAuth is blocked. It consists of a TypeScript/React VS Code extension that spawns a local Rust backend server, which drives a ReAct agent loop against the GitLab AI Gateway (GovCloud, Claude Sonnet 4.5 backend).

---

## 2. Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Auth method | PAT only (`PRIVATE-TOKEN` header) | No OAuth in Federal/GovCloud environments |
| LLM provider | GitLab AI Gateway (`/api/v4/chat/completions`) | Enterprise GovCloud with `access_rest_chat` feature flag enabled |
| LLM model | Claude Sonnet 4.5 (via GitLab AI Gateway) | Enterprise standard |
| TLS implementation | `native-tls` (Windows SChannel) | FIPS 140-2 validated crypto on Windows |
| Binary distribution | Single Windows x64 `.vsix` with embedded `openduo-server.exe` | DOJ environment is Windows x64 only; cleanest user experience |
| Release mechanism | GitLab Release artifact on tag push | Hosted on internal GitLab EE instance |
| Extension scope | Phase 1–6 full implementation | All features from SUPERPROMPT.md |

---

## 3. Architecture

```
┌─────────────────────────────────────────────┐
│           VS Code Extension (TypeScript)     │
│  ┌──────────────┐   ┌──────────────────────┐│
│  │ React Webview│◄──│  Extension Host       ││
│  │ (Chat UI)    │   │  (PAT mgmt, spawning) ││
│  └──────┬───────┘   └──────────┬────────────┘│
└─────────┼────────────────────▲─┼─────────────┘
          │ HTTP (localhost)   │ │ child_process
          ▼                   │ ▼
┌─────────────────────────────────────────────┐
│        Rust Backend (openduo-server)         │
│  Axum HTTP server · SSE streaming           │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐│
│  │openduo-core│  │openduo-  │  │openduo-  ││
│  │PAT auth    │  │agent     │  │tools     ││
│  │GitLab REST │  │ReAct loop│  │30+ tools ││
│  └─────┬──────┘  └────┬─────┘  └────┬─────┘│
└────────┼──────────────┼─────────────┼───────┘
         ▼              ▼             ▼
    GitLab EE API  GitLab AI Gateway (GovCloud)
    (REST + GraphQL)  POST /api/v4/chat/completions
                      PRIVATE-TOKEN: <PAT>
```

---

## 4. Security Model (DoD/DOJ Compliance)

### Credential Handling
- PAT stored in VS Code `SecretStorage` API → Windows DPAPI / Credential Manager
- Never written to disk, never logged
- Passed to Rust server via environment variable (not CLI args)

### Network Security
- TLS 1.2+ only via `native-tls` (Windows SChannel — FIPS 140-2 validated)
- System trust store (`native-tls`) — respects enterprise CA chain automatically
- Zero external network calls — only to configured GitLab EE instance
- Localhost server binds to `127.0.0.1` only (not `0.0.0.0`)

### Extension Permissions
- Webview CSP locks `script-src` and `connect-src` to `localhost` only
- No wildcard host permissions in manifest
- Minimal VS Code API surface

### No Telemetry
- Zero analytics, crash reporting, or usage tracking
- Nothing leaves the machine except calls to the configured GitLab host

### Audit Logging
- All agent tool invocations logged to VS Code Output Channel (visible, local, not transmitted)

### Memory Safety
- Rust backend eliminates buffer overflows, use-after-free, and memory corruption

### Supply Chain
- `cargo audit` and `npm audit` on every CI pipeline run
- Lockfiles committed (`Cargo.lock`, `package-lock.json`)
- Pinned dependency versions

---

## 5. Rust Workspace Structure

```
openduo/
├── Cargo.toml                      # workspace root
├── Cargo.lock
├── crates/
│   ├── openduo-core/               # auth, config, GitLab REST client
│   │   ├── src/
│   │   │   ├── auth.rs             # PAT validation, header injection
│   │   │   ├── config.rs           # GitLab host URL, PAT, TLS settings
│   │   │   ├── gitlab_client.rs    # reqwest client, retry, rate-limit
│   │   │   └── lib.rs
│   │   └── Cargo.toml
│   │
│   ├── openduo-agent/              # ReAct loop, prompt builder, LLM provider
│   │   ├── src/
│   │   │   ├── react_loop.rs       # Thought→Action→Observation cycle
│   │   │   ├── prompt.rs           # system prompt assembly
│   │   │   ├── provider.rs         # LlmProvider trait + GitLab AI Gateway impl
│   │   │   └── lib.rs
│   │   └── Cargo.toml
│   │
│   ├── openduo-tools/              # 30+ GitLab tool implementations
│   │   ├── src/
│   │   │   ├── registry.rs         # ToolRegistry, dynamic dispatch
│   │   │   ├── issues.rs
│   │   │   ├── merge_requests.rs
│   │   │   ├── pipelines.rs
│   │   │   ├── repositories.rs
│   │   │   ├── projects.rs
│   │   │   ├── users.rs
│   │   │   ├── cicd.rs
│   │   │   ├── milestones.rs
│   │   │   └── labels.rs
│   │   └── Cargo.toml
│   │
│   └── openduo-server/             # Axum HTTP server, SSE, binary entry point
│       ├── src/
│       │   ├── main.rs
│       │   ├── routes.rs           # /chat, /health, /tools
│       │   └── sse.rs              # SSE stream adapter
│       └── Cargo.toml
│
├── extension/                      # VS Code extension
├── docs/plans/                     # design + implementation plans
└── .gitlab-ci.yml
```

**Crate dependency order:** `openduo-server` → `openduo-agent` → `openduo-core` + `openduo-tools`

**Key Rust dependencies:**
- `axum` — HTTP server
- `tokio` — async runtime
- `reqwest` (with `native-tls`) — HTTP client (FIPS TLS)
- `serde` / `serde_json` — serialization
- `schemars` — JSON Schema for tool definitions
- `tracing` / `tracing-subscriber` — structured audit logging

---

## 6. VS Code Extension Structure

```
extension/
├── package.json                    # manifest, commands, config schema
├── tsconfig.json
├── esbuild.config.js               # separate bundles: host + webview
├── src/
│   ├── extension.ts                # activate(), registers commands
│   ├── server.ts                   # openduo-server.exe lifecycle
│   ├── patManager.ts               # SecretStorage read/write
│   ├── chatPanel.ts                # WebviewPanel + message routing
│   └── logger.ts                   # Output channel audit log
│
├── webview/
│   ├── index.tsx
│   ├── components/
│   │   ├── ChatWindow.tsx          # message list, streaming
│   │   ├── MessageBubble.tsx       # user/assistant/tool-call rendering
│   │   ├── InputBar.tsx            # textarea + send
│   │   └── StatusBar.tsx           # connection status, model indicator
│   ├── hooks/
│   │   └── useChat.ts              # SSE consumer, message state
│   └── vscode.ts                   # acquireVsCodeApi() wrapper
│
└── bin/
    └── openduo-server.exe          # bundled at vsce package time
```

**Activation flow:**
1. `extension.ts` activates on VS Code startup
2. Reads PAT from `SecretStorage` (prompts user if not set)
3. Spawns `openduo-server.exe` with PAT + GitLab host as env vars
4. Creates `WebviewPanel` loading the React chat UI
5. Routes messages: Webview → Extension Host → Rust server → AI Gateway → SSE back

---

## 7. Tool Inventory

| Domain | Tools |
|---|---|
| **Issues** | `create_issue`, `get_issue`, `list_issues`, `update_issue`, `close_issue`, `add_issue_comment` |
| **Merge Requests** | `create_mr`, `get_mr`, `list_mrs`, `update_mr`, `merge_mr`, `add_mr_comment`, `get_mr_diff` |
| **Pipelines** | `get_pipeline`, `list_pipelines`, `trigger_pipeline`, `retry_pipeline`, `cancel_pipeline`, `get_job_log` |
| **Repositories** | `get_file`, `list_files`, `search_code`, `get_commit`, `list_commits`, `compare_refs` |
| **Projects** | `get_project`, `list_projects`, `search_projects` |
| **Users** | `get_current_user`, `list_project_members` |
| **CI/CD** | `get_pipeline_yaml`, `validate_pipeline_yaml`, `list_runners` |
| **Milestones/Labels** | `list_milestones`, `list_labels`, `create_label` |

**ReAct loop:**
```
User message
  → Prompt builder: system prompt + tool schemas + conversation history
  → POST /api/v4/chat/completions (SSE)
  → Model: Thought + tool_call JSON
  → ToolRegistry.execute(name, args) → GitLab REST API
  → Observation appended to context
  → Repeat until Answer (no tool_call) — max 10 iterations
  → Stream final answer tokens to webview
```

---

## 8. CI/CD Pipeline

```yaml
stages: [test, build, package, release]

# TEST
rust:test     # cargo test --workspace
rust:fmt      # cargo fmt --check
rust:clippy   # cargo clippy -- -D warnings
rust:audit    # cargo audit
ts:test       # vitest
ts:lint       # eslint + tsc --noEmit
ts:audit      # npm audit

# BUILD
rust:build:windows    # cargo build --release --target x86_64-pc-windows-msvc
ts:build              # esbuild → extension/dist/

# PACKAGE
vsix:package          # copies .exe → extension/bin/, vsce package
                      # artifact: openduo-windows-x64-{version}.vsix

# RELEASE (tag-triggered: v*)
gitlab:release        # GitLab Release with .vsix as downloadable asset
```

---

## 9. Implementation Phases

| Phase | Name | Key Deliverables |
|---|---|---|
| **1** | Foundation | Rust workspace, `openduo-core` (PAT auth + REST client), Axum `/health`, VS Code scaffold + PAT command + binary spawn |
| **2** | Agent Engine | `openduo-agent` ReAct loop, `LlmProvider` trait, GitLab AI Gateway SSE integration, end-to-end text chat |
| **3** | Tool Engine | `openduo-tools` registry + all 30+ tools, tool-call parsing, full agentic chat |
| **4** | React Chat UI | Streaming token display, tool-call visualization, message history, StatusBar, error states |
| **5** | Hardening | FIPS TLS, max iteration guard, audit logging, input validation, CSP lockdown, security audits |
| **6** | Release Pipeline | Full `.gitlab-ci.yml`, `vsce package`, GitLab Release automation, README install guide |

**Testing discipline:** TDD throughout — tests written before implementation code in every phase.
