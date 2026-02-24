# OpenDuo — Superpowers Project Prompt

> **Runtime:** Claude Code Local · Sonnet 4.6 · Superpowers skills framework active **Methodology:** Brainstorming → Design Doc → Writing Plans → Subagent-Driven Development

---

## 1. Project Identity

**Name:** OpenDuo **Repository:** `openduo` (MIT License) **Tagline:** Open-source, self-hosted GitLab AI agentic chat — PAT-authenticated, built for Federal Enterprise environments where OAuth is broken.

---

## 2. Problem Statement

The official GitLab Duo VS Code extension (`gitlab-workflow`) ships a Language Server that exclusively attempts OAuth-based authentication when communicating with GitLab's AI Gateway for Duo Chat features. In Federal Enterprise and GovCloud GitLab Self-Managed instances, OAuth flows are routinely blocked, unsupported, or restricted by network policy and security posture. Even when a valid Personal Access Token (PAT) is configured via the GitLab extension — and works perfectly for repository browsing, merge request reviews, issue management, pipeline viewing, and every other extension feature — the Duo Chat / Agentic Chat functionality refuses to authenticate because the Language Server never falls back to PAT-based auth. This is a confirmed upstream bug (the LS hardcodes OAuth discovery) with no published ETA for resolution.

**OpenDuo exists to solve this:** provide a fully-featured, open-source agentic AI chat VS Code extension that authenticates to GitLab's REST API v4 and GraphQL API exclusively via PAT, replicating and extending the capabilities of GitLab Duo Agentic Chat for environments where OAuth is not viable.

---

## 3. Required PAT Configuration

The PAT used by OpenDuo **MUST** have exactly these scopes:

**`read_user`** — Read the authenticated user's profile, validate identity, confirm license/seat assignment.

**`api`** — Full REST and GraphQL API access (needed for MR, issue, pipeline, repository, code search, snippet, and project operations).

**`ai_features`** — Access to GitLab Duo / AI Gateway endpoints (`/api/v4/chat/completions`, `/api/v4/code_suggestions/*`).

Authentication is exclusively via the `PRIVATE-TOKEN` header or `Authorization: Bearer <PAT>` header against the GitLab instance's `/api/v4/` endpoints. **No OAuth flows, no token refresh, no OIDC, no session cookies — ever.**

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    VS Code Extension                      │
│               (TypeScript + React Webview)                 │
│                                                           │
│  ┌─────────────────┐    ┌──────────────────────────────┐  │
│  │   Chat Webview   │    │   Context Provider System    │  │
│  │   (React + TW)   │    │                              │  │
│  │                   │    │  • Active file + selection   │  │
│  │  • Markdown render│    │  • Workspace file tree       │  │
│  │  • Code blocks    │    │  • Git diff (staged/HEAD)    │  │
│  │  • Tool call UI   │    │  • MR context (remote)       │  │
│  │  • File diff view │    │  • Issue context (remote)    │  │
│  │  • Streaming SSE  │    │  • Pipeline/job logs         │  │
│  │  • Chat history   │    │  • Snippet context           │  │
│  │  • Agent selector │    │  • Terminal output capture    │  │
│  └────────┬──────────┘    └─────────────┬────────────────┘  │
│           │                             │                   │
│           └──────────────┬──────────────┘                   │
│                          │ HTTP (localhost:PORT)             │
│                          │ WebSocket (streaming)             │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                  OpenDuo Backend (Rust)                       │
│                                                              │
│  ┌──────────────┐  ┌────────────────────┐  ┌──────────────┐ │
│  │  Auth Module  │  │   Agent Engine     │  │  GitLab API  │ │
│  │              │  │                    │  │   Client     │ │
│  │ PAT-only     │  │ • ReAct loop       │  │              │ │
│  │ PRIVATE-TOKEN│  │ • Tool dispatch    │  │ • REST v4    │ │
│  │ validation   │  │ • Streaming SSE    │  │ • GraphQL    │ │
│  │ at startup   │  │ • Conversation     │  │ • Pagination │ │
│  │              │  │   memory           │  │ • Rate limit │ │
│  │ Scope check: │  │ • Multi-agent      │  │   backoff    │ │
│  │  read_user   │  │   routing          │  │              │ │
│  │  api         │  │                    │  │ Auth header: │ │
│  │  ai_features │  │                    │  │ PRIVATE-TOKEN│ │
│  └──────┬───────┘  └─────────┬──────────┘  └──────┬───────┘ │
│         │                    │                     │         │
│         └────────────────────┼─────────────────────┘         │
│                              │                               │
│  ┌───────────────────────────┴─────────────────────────────┐ │
│  │              LLM Provider Layer (configurable)          │ │
│  │                                                         │ │
│  │  Option A: GitLab AI Gateway (via /api/v4/chat/         │ │
│  │            completions with PAT auth)                   │ │
│  │  Option B: Direct Anthropic Claude API                  │ │
│  │  Option C: Direct OpenAI API                            │ │
│  │  Option D: Local Ollama / vLLM / LM Studio              │ │
│  │  Option E: AWS Bedrock (for GovCloud envs)              │ │
│  │                                                         │ │
│  │  All providers implement a common `LlmProvider` trait   │ │
│  │  with streaming support via SSE                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Tool Registry                              │ │
│  │                                                         │ │
│  │  Each tool = a Rust struct implementing `AgentTool`     │ │
│  │  trait. Tools are registered at startup, filtered by    │ │
│  │  user's PAT scope and GitLab instance version.          │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Tech Stack

### Backend (Rust)

**Web framework:** `axum` (async, tower-based, excellent for streaming SSE responses). **HTTP client:** `reqwest` with connection pooling, automatic retry with exponential backoff, and TLS configuration for environments with custom CA certificates (common in Federal). **Serialization:** `serde` + `serde_json`. **Async runtime:** `tokio` (multi-threaded). **Streaming:** Server-Sent Events via `axum`'s built-in SSE support for token-by-token streaming from LLM to frontend. **GraphQL client:** `graphql_client` (code-gen from GitLab's public schema) for complex nested queries like MR discussions. **Configuration:** `config` crate with layered resolution: defaults → `~/.openduo/config.toml` → environment variables → CLI flags. **Logging:** `tracing` + `tracing-subscriber` with filter rules that automatically redact auth headers. **Error handling:** `thiserror` for library errors, `anyhow` for application errors. **Security:** `secrecy` crate wraps all PAT values — `Debug` and `Display` impls print `[REDACTED]`, memory is zeroized on drop. **Database:** `rusqlite` for local conversation persistence. **Testing:** Built-in Rust test framework + `wiremock` for HTTP mocking + `assert_cmd` for CLI integration tests.

### VS Code Extension (TypeScript)

**Extension API:** VS Code Extension API. **Webview UI:** React 18 + Tailwind CSS, bundled via `esbuild`. **Markdown rendering:** `react-markdown` with `remark-gfm` + `rehype-highlight` for syntax-highlighted code blocks. **State management:** React Context + `useReducer` — no heavy external deps needed for a chat UI. **Communication:** VS Code `postMessage` API between extension host and webview, plus `fetch` for HTTP calls to local backend. **Testing:** Vitest for unit tests, `@vscode/test-electron` for extension integration tests. **Bundling:** `esbuild` for both extension host and webview, producing a single `.vsix` package.

### Monorepo Structure

```
openduo/
├── backend/                    # Rust workspace
│   ├── Cargo.toml              # Workspace Cargo.toml
│   ├── crates/
│   │   ├── openduo-core/       # Agent engine, ReAct loop, tool registry, LLM provider trait
│   │   ├── openduo-gitlab/     # GitLab API client (REST + GraphQL), PAT auth, scope validation
│   │   ├── openduo-server/     # Axum HTTP/SSE server, routes, middleware, CORS
│   │   └── openduo-tools/      # Individual tool implementations (each tool = a module)
│   └── tests/                  # Integration tests (spin up server, mock GitLab, test full flows)
├── extension/                  # VS Code extension (TypeScript)
│   ├── package.json
│   ├── src/
│   │   ├── extension.ts        # Activation, command registration, lifecycle
│   │   ├── backend/            # Backend process management (spawn, health check, kill)
│   │   ├── providers/          # Context providers (active file, git, terminal)
│   │   ├── webview/            # React chat UI (separate esbuild entry point)
│   │   │   ├── App.tsx
│   │   │   ├── components/     # ChatMessage, ToolCallCard, DiffView, AgentSelector, etc.
│   │   │   ├── hooks/          # useChat, useStreaming, useHistory
│   │   │   └── index.tsx
│   │   └── commands/           # VS Code command handlers (explain, refactor, tests, etc.)
│   ├── test/
│   └── esbuild.config.js
├── docs/
│   └── plans/                  # Design docs and implementation plans (Superpowers convention)
├── .github/
│   └── workflows/              # CI: test, build, cross-compile, release
├── CLAUDE.md                   # Claude Code project instructions
└── README.md
```

---

## 6. Complete Feature & Tool Inventory

This is the full set of capabilities that OpenDuo must replicate from GitLab Duo Agentic Chat, plus enhancements specific to Federal Enterprise use cases. Each tool listed below maps to a Rust struct implementing the `AgentTool` trait.

### 6.1 Codebase Understanding Tools (Local)

**`read_file`** — Read the contents of a local file by path. Supports partial reads via line ranges. The agent uses this to examine code without the user needing to specify exact paths.

**`list_files`** — List files and directories in the local workspace. Supports glob patterns and configurable depth limits. Used for project structure discovery.

**`search_workspace`** — Full-text search (ripgrep-style) across the workspace. Returns matching lines with file paths and line numbers. The agent's primary way to find relevant code by keyword.

**`read_git_diff`** — Get the current git diff (staged, unstaged, or between arbitrary refs). Critical for understanding what the user is currently working on.

**`read_git_log`** — Read recent git history with configurable depth. Provides context on how code has evolved.

**`read_git_blame`** — Blame a specific file or line range to understand authorship and change history.

### 6.2 GitLab Remote Context Tools (all PAT-authenticated via PRIVATE-TOKEN header)

**`get_project`** — Fetch project metadata via `GET /api/v4/projects/:id`.

**`search_projects`** — Search across projects the user has access to via `GET /api/v4/projects?search=<query>`.

**`get_issue`** — Fetch issue details including description, labels, assignees, due dates, and full discussion thread via `GET /api/v4/projects/:id/issues/:iid` plus `GET /api/v4/projects/:id/issues/:iid/notes`.

**`search_issues`** — Search issues within a project or globally via `GET /api/v4/projects/:id/issues?search=<query>`.

**`create_issue`** — Create a new issue via `POST /api/v4/projects/:id/issues`. The agent can create issues from conversations.

**`get_merge_request`** — Fetch MR details including diff stats, reviewers, approvals, and discussion via `GET /api/v4/projects/:id/merge_requests/:iid`.

**`get_merge_request_changes`** — Fetch the actual file-by-file diff of an MR via `GET /api/v4/projects/:id/merge_requests/:iid/changes`.

**`search_merge_requests`** — Search MRs via `GET /api/v4/projects/:id/merge_requests?search=<query>`.

**`create_merge_request`** — Create a new MR via `POST /api/v4/projects/:id/merge_requests`.

**`get_pipeline`** — Fetch pipeline details and status via `GET /api/v4/projects/:id/pipelines/:pipeline_id`.

**`get_pipeline_jobs`** — List all jobs in a pipeline via `GET /api/v4/projects/:id/pipelines/:pipeline_id/jobs`.

**`get_job_log`** — Fetch the full trace/log of a CI/CD job via `GET /api/v4/projects/:id/jobs/:job_id/trace`. Critical for debugging pipeline failures.

**`get_repository_tree`** — List the remote repository file tree via `GET /api/v4/projects/:id/repository/tree?ref=<branch>&recursive=true`.

**`get_repository_file`** — Fetch a file's contents from the remote repository at any branch/ref via `GET /api/v4/projects/:id/repository/files/:file_path/raw?ref=<branch>`.

**`search_code`** — Search code across the entire GitLab instance via `GET /api/v4/search?scope=blobs&search=<query>`.

**`get_snippet`** — Fetch project or personal snippet content via `GET /api/v4/projects/:id/snippets/:snippet_id` or `GET /api/v4/snippets/:snippet_id`.

**`get_vulnerability`** — Fetch vulnerability details via `GET /api/v4/projects/:id/vulnerabilities/:vuln_id`.

**`list_vulnerabilities`** — List project vulnerabilities via `GET /api/v4/projects/:id/vulnerabilities`.

**`add_note`** — Add a comment/note to an issue or MR via `POST /api/v4/projects/:id/issues/:iid/notes` or `POST /api/v4/projects/:id/merge_requests/:iid/notes`.

### 6.3 Mutation / Action Tools (local workspace)

**`create_file`** — Create a new local file with specified content. Presents a diff view in the UI for user approval before writing.

**`edit_file`** — Edit an existing local file using search-and-replace or line-range replacement. Supports multi-location edits within a single file. Shows diff preview for approval.

**`run_terminal_command`** — Execute a shell command in the user's integrated terminal and capture stdout/stderr. Every command requires explicit user approval via a confirmation dialog before execution (security gate — never auto-execute).

### 6.4 AI / Duo-Specific Tools

**`gitlab_duo_chat`** — Proxy a chat request to GitLab's AI Gateway via `POST /api/v4/chat/completions` using `PRIVATE-TOKEN: <PAT>` header. Sends `content`, `resource_type`, `resource_id`, `project_id`, and `additional_context` (array of `{category, id, content, metadata}` objects). This is the same endpoint the official extension calls via OAuth — we just use PAT auth instead.

**`code_suggestions`** — Get code completions via `POST /api/v4/code_suggestions/completions` with PAT auth. Sends `current_file` object (filename, content_above_cursor, content_below_cursor) and `intent` field ("completion" or "generation").

**`explain_code`** — Send a code snippet to the configured LLM with a structured explanation prompt. Works even when GitLab AI Gateway is unavailable by routing to the direct LLM provider.

**`refactor_code`** — Send code with refactoring instructions to the LLM. Returns the refactored version with explanations of changes made.

**`generate_tests`** — Given a code file or function, generate unit tests in the appropriate test framework for the detected language.

**`explain_vulnerability`** — Given a vulnerability ID or description, use security context to explain risk, impact, CVSS score interpretation, and remediation steps.

### 6.5 Slash Commands (mapped to agent tool chains)

These are user-facing commands that trigger specific tool chains. The agent's system prompt includes awareness of these commands and maps them to appropriate tool sequences.

**`/explain`** — Explain the selected code or referenced resource. **`/refactor`** — Suggest refactoring for selected code. **`/tests`** — Generate tests for selected code. **`/fix`** — Diagnose and fix a bug in selected code. **`/review`** — Review a merge request for issues, code quality, and security concerns. **`/pipeline`** — Analyze the current or specified pipeline status, explain failures, suggest fixes. **`/issue`** — Create, analyze, or summarize an issue. **`/security`** — Analyze vulnerabilities in the project, explain severity, suggest remediation order. **`/reset`** — Clear conversation history and start fresh. **`/include <path|url>`** — Inject context from a specific file, issue URL, or MR URL into the conversation.

---

## 7. Agent Architecture Details

### 7.1 ReAct Loop

The agent follows a ReAct (Reasoning + Acting) loop, identical in concept to what GitLab Duo uses internally via the `GLAgentRemoteExecutor`:

The loop begins when the user sends a message, optionally with context attachments. The backend constructs the full prompt: system prompt (agent persona + tool definitions in function-calling schema) + conversation history + new user message. This is sent to the configured LLM provider. The LLM responds with either a final text answer or a tool call request (function name + arguments). If a tool call is requested, the backend executes it (e.g., calls GitLab API with PAT, reads a local file, runs a search), then appends the tool result to the conversation and loops back to the LLM for another reasoning step. This continues until the LLM produces a final text answer, which is streamed to the user via SSE. A configurable maximum iteration count (default: 15) prevents infinite loops.

### 7.2 Multi-Agent Routing

Like GitLab Duo's agent selector, OpenDuo supports multiple agent personas. Each agent has a distinct system prompt and tool subset:

**Default Agent** — General-purpose, all tools available, optimized for broad development questions. **Planner Agent** — Focused on issue/epic management with a system prompt emphasizing product management patterns. Tool subset limited to issues, MRs, project search. **Security Analyst Agent** — Focused on vulnerability analysis with a system prompt emphasizing security triage methodology. Tool subset limited to vulnerabilities, code search, explain_vulnerability. **Code Review Agent** — Focused on MR review with a system prompt emphasizing code quality, SOLID principles, and common bug patterns. Tool subset limited to MR changes, file reading, git diff. **Custom Agents** — User-defined via TOML config specifying system prompt, tool allowlist/denylist, and optional LLM provider override.

### 7.3 Conversation Persistence

Conversations are persisted locally in a SQLite database at `~/.openduo/conversations.db`. The schema stores messages (role, content, timestamp), tool calls (name, arguments, result), conversation metadata (agent used, model used, token counts), and allows full chat history browsing and search from the UI. Conversations never leave the local machine.

### 7.4 Context Window Management

The backend implements intelligent context window management. Conversation history is truncated to fit the configured context window (default: 200k tokens for Claude, configurable per provider). Most recent messages are always preserved. Older messages are progressively dropped using a sliding window. Large tool results (e.g., a 5000-line file read) are truncated with a `[TRUNCATED — showing first/last N lines]` note. The user can manually inject high-priority context via `/include` which gets placement priority.

---

## 8. LLM Provider Configuration

OpenDuo supports multiple LLM backends, configured via `~/.openduo/config.toml`:

```toml
[llm]
# Options: "gitlab_gateway", "anthropic", "openai", "ollama", "bedrock"
provider = "anthropic"

[llm.anthropic]
api_key_env = "ANTHROPIC_API_KEY"   # Read from env var, never stored in config file
model = "claude-sonnet-4-5-20250929"
max_tokens = 8192

[llm.gitlab_gateway]
# Uses the same PAT and GitLab instance URL from [gitlab] section
# Routes through POST /api/v4/chat/completions with PRIVATE-TOKEN header
model = "default"

[llm.ollama]
base_url = "http://localhost:11434"
model = "llama3.1:70b"

[llm.openai]
api_key_env = "OPENAI_API_KEY"
model = "gpt-4o"
base_url = "https://api.openai.com/v1"  # Can be overridden for Azure OpenAI

[llm.bedrock]
region = "us-gov-west-1"   # GovCloud region
model_id = "anthropic.claude-sonnet-4-5-20250929-v1:0"
# Uses AWS credential chain (env vars → IAM role → instance profile)

[gitlab]
instance_url = "https://gitlab.example.com"
pat_env = "GITLAB_PAT"   # Read from env var, never stored in config file
# PAT must have scopes: read_user, api, ai_features
# Optional: custom CA cert for self-signed TLS in Federal envs
ca_cert_path = "/path/to/custom-ca.pem"
```

---

## 9. Security & Federal Compliance Considerations

Since this targets Federal Enterprise environments, these are non-negotiable requirements:

**PAT never logged.** The `secrecy` crate wraps all PAT values. `Debug` and `Display` trait impls print `[REDACTED]`. The `tracing` subscriber is configured with filter rules that strip `PRIVATE-TOKEN` and `Authorization` headers from any log output.

**PAT never leaves the backend process.** The VS Code extension sends the PAT to the local backend at startup via a secure localhost connection. The backend uses it exclusively for GitLab API calls. The PAT is never included in LLM prompts or sent to any LLM provider (except when using GitLab AI Gateway, where PAT is the auth mechanism for that specific endpoint).

**No telemetry.** Zero telemetry, analytics, crash reporting, or phone-home behavior. No external network calls except to the configured GitLab instance and the configured LLM provider. This is auditable by reviewing the codebase.

**Air-gap friendly.** When configured with `ollama` or any self-hosted LLM provider, OpenDuo operates with zero external internet access. The only network traffic is between VS Code ↔ localhost backend and backend ↔ local GitLab instance.

**Local-only persistence.** The SQLite conversation database lives in the user's home directory (`~/.openduo/`). No cloud sync, no remote storage, no shared state.

**Static binary distribution.** The Rust backend compiles to a single statically-linked binary with no runtime dependencies. Cross-compiled for Linux x86_64, macOS ARM64, macOS x86_64, Windows x86_64.

**Custom CA support.** The `reqwest` HTTP client is configured to accept custom CA certificates via the `ca_cert_path` config option, supporting environments with internal PKI (extremely common in Federal).

**Content filtering.** A configurable content filter module can be enabled to scan outgoing LLM prompts for classification markings (e.g., `//CUI`, `SECRET`, `FOUO` patterns) and PII patterns, blocking the request and alerting the user before any sensitive data reaches an external LLM provider.

---

## 10. VS Code Extension UX Specification

### 10.1 Activation & Setup Flow

On first activation, the extension checks for the backend binary in `~/.openduo/bin/`. If not found, it offers to download the platform-appropriate binary from GitHub Releases or prompts for a manual file path (for air-gapped environments where the binary is distributed via sneakernet/artifact server). The extension then presents a setup wizard:

Step 1: Enter GitLab instance URL (validated with a test request to `/api/v4/version`). Step 2: Enter PAT (stored in VS Code's `SecretStorage` API, which uses the OS keychain — never written to `settings.json`). Validated by calling `GET /api/v4/personal_access_tokens/self` to confirm scopes include `read_user`, `api`, and `ai_features`. Step 3: Select LLM provider and enter provider-specific configuration (API key also stored in `SecretStorage`).

The backend is spawned as a child process listening on `127.0.0.1` on a randomly selected available port. The extension communicates exclusively via localhost HTTP + SSE.

### 10.2 Chat Panel

The primary UI is a React webview panel rendered in a VS Code editor group or sidebar:

Markdown rendering with syntax-highlighted code blocks (language-auto-detected, using `highlight.js` or `shiki`). Streaming token display — characters appear in real-time as SSE events arrive from the backend. Collapsible "thinking" sections that show which tools the agent called, what arguments were used, and a summary of the result. This gives the user full transparency into the agent's reasoning process. File diff view for `create_file` and `edit_file` results — inline unified diff with "Accept" and "Reject" buttons that apply or discard the changes. Agent selector dropdown at the top of the panel (Default, Planner, Security Analyst, Code Review, plus any custom agents). Model/provider selector (shows configured LLM providers). Context attachment bar — the user can pin files, issue URLs, or MR URLs to the conversation, and these are included as high-priority context in every message. Chat history sidebar (list of past conversations, searchable by keyword, sortable by date). Slash command palette — typing `/` triggers autocomplete for available slash commands.

### 10.3 Registered VS Code Commands

`openduo.openChat` — Open the chat panel. `openduo.explainSelection` — Send currently selected code to chat with the `/explain` intent. `openduo.refactorSelection` — Send selected code with `/refactor`. `openduo.generateTests` — Send selected code with `/tests`. `openduo.fixSelection` — Send selected code with `/fix`. `openduo.reviewMR` — Open chat with the current branch's MR pre-loaded as context. `openduo.analyzePipeline` — Open chat with the current branch's latest pipeline pre-loaded. `openduo.configure` — Open the OpenDuo settings panel.

### 10.4 Status Bar

A status bar item on the bottom bar shows connection status (green checkmark when connected to backend + GitLab verified, red X otherwise), the current agent name, and acts as a quick-click shortcut to open the chat panel.

---

## 11. Implementation Phases

### Phase 1: Foundation (Weeks 1–2)

Rust workspace scaffolding with all four crates (`openduo-core`, `openduo-gitlab`, `openduo-server`, `openduo-tools`). PAT authentication module with scope validation against `GET /api/v4/user` and `GET /api/v4/personal_access_tokens/self`. GitLab REST API client with connection pooling, automatic retry with exponential backoff, rate limit detection and backoff, custom CA cert support. Basic Axum server with health endpoint, CORS configuration for localhost, and graceful shutdown. VS Code extension scaffolding with backend process lifecycle management (spawn, health poll, kill on deactivate). Basic React webview with message input, message display, and postMessage communication to extension host.

### Phase 2: Agent Engine (Weeks 3–4)

`LlmProvider` trait definition with `stream_chat` method returning a `Stream<Item = StreamEvent>`. Anthropic Claude provider implementation (direct API) with streaming SSE parsing. ReAct agent loop implementation: receives user message → constructs prompt → calls LLM → parses tool calls → executes tools → loops until final answer. Tool registry with dynamic tool definition generation (each tool exposes its JSON Schema for the LLM's function-calling format). SSE streaming endpoint from backend to extension (`GET /api/v4/chat/:conversation_id/stream`). Local tools implementation: `read_file`, `list_files`, `search_workspace` (using `grep`/`ripgrep` subprocess), `create_file`, `edit_file`.

### Phase 3: GitLab Integration (Weeks 5–6)

All remote GitLab tools: issues (get, search, create), MRs (get, changes, search, create), pipelines (get, jobs, logs), repository (tree, file, search), snippets, vulnerabilities, notes. GraphQL client setup for complex nested queries (MR discussions with inline notes, issue with linked MRs). GitLab AI Gateway integration — `POST /api/v4/chat/completions` with `PRIVATE-TOKEN` header, including `additional_context` construction. Code suggestions integration — `POST /api/v4/code_suggestions/completions` with PAT auth. `access_rest_chat` feature flag detection and user guidance.

### Phase 4: Chat UX Polish (Weeks 7–8)

Full markdown rendering with syntax-highlighted code blocks and language detection. Tool call visualization (collapsible cards showing agent's thinking process). File diff view component with accept/reject workflow for agent file operations. Chat history with SQLite persistence — conversation CRUD, search, and browsing. Slash command palette with autocomplete and documentation tooltips. Context attachment system (pin files, issues, MRs to conversations). Agent selector and model selector dropdown components.

### Phase 5: Multi-Agent & Advanced (Weeks 9–10)

Multi-agent routing with configurable persona definitions. Custom agent TOML configuration loader. Additional LLM providers: OpenAI, Ollama, AWS Bedrock. Content filtering module for classification marking and PII detection. Terminal command execution tool with user approval dialog flow. Git diff and blame tools. Cross-platform binary builds via GitHub Actions CI/CD matrix.

### Phase 6: Hardening & Release (Weeks 11–12)

Comprehensive test suite: Rust unit tests for every crate, `wiremock`-based integration tests for GitLab API client, end-to-end tests for agent flows, Vitest unit tests for React components, VS Code extension integration tests. Security audit: verify PAT never logged, never sent to LLM, zeroized on drop, no telemetry. Documentation: README with setup guide, architecture doc, contributing guide, security model doc. CI/CD: GitHub Actions for test, cross-compile (Linux/macOS/Windows), release with `.vsix` packaging. Federal environment testing checklist with manual verification steps.

---

## 12. Key API Endpoints Reference

All endpoints use `PRIVATE-TOKEN: <pat>` header for authentication.

### Chat Completions (GitLab AI Gateway)

```http
POST /api/v4/chat/completions
Headers:
  PRIVATE-TOKEN: <pat>
  Content-Type: application/json

Body:
{
  "content": "Why is the pipeline failing on MR !423?",
  "additional_context": [
    {"category": "file", "id": "main.rs", "content": "...truncated file..."},
    {"category": "merge_request", "id": "423", "content": "...MR description & diff stats..."},
    {"category": "issue", "id": "156", "content": "...linked issue details..."}
  ],
  "resource_type": "merge_request",
  "resource_id": 423,
  "project_id": 42
}
```

**Note:** On GitLab Self-Managed, this endpoint requires the `access_rest_chat` feature flag to be enabled. If the endpoint returns 404, OpenDuo should display guidance instructing the user to ask their GitLab admin to enable it via Rails console: `Feature.enable(:access_rest_chat)`.

### Code Suggestions

```http
POST /api/v4/code_suggestions/completions
Headers:
  Authorization: Bearer <pat>
  Content-Type: application/json

Body:
{
  "current_file": {
    "file_name": "src/auth.rs",
    "content_above_cursor": "fn validate_pat(pat: &str) -> Result<User> {\n    let client = ",
    "content_below_cursor": "\n}"
  },
  "intent": "completion"
}
```

### PAT Validation

```http
GET /api/v4/user
Headers: PRIVATE-TOKEN: <pat>
→ Confirms PAT is valid, returns user profile

GET /api/v4/personal_access_tokens/self
Headers: PRIVATE-TOKEN: <pat>
→ Returns token metadata including scopes array — verify ["read_user", "api", "ai_features"]
```

---

## 13. Non-Functional Requirements

**Startup time:** Backend must be ready to accept requests within 2 seconds on modern hardware. **Streaming latency:** First token from LLM should appear in the webview within 500ms of the LLM provider's first SSE event. **Memory footprint:** Backend process should use less than 50MB RSS in idle state. **Binary size:** Compiled backend binary should be under 30MB (stripped, LTO, no debug symbols). **Offline resilience:** Local tools (file read/write, workspace search, git operations) must function even when GitLab instance is unreachable. **Graceful degradation:** If GitLab API calls fail (network error, auth error, rate limit), the agent should inform the user clearly and continue with available local context rather than crashing.

---

## 14. Constraints & Out-of-Scope (v1)

No OAuth support — this is the entire raison d'être. No GitLab.com SaaS support initially, since the `chat/completions` API is internal-only on .com (focus is Self-Managed instances). No browser-based UI — VS Code only for v1. No multi-user or shared server mode — single user, local backend. No real-time collaboration. No inline ghost-text code completion in the editor (code suggestions are accessed via the chat interface in v1). No JetBrains or other IDE support in v1.

---

## 15. Success Criteria

A user in a Federal Enterprise environment with a GitLab Self-Managed instance (17.9+) can install OpenDuo, configure their PAT, and have a working agentic chat that understands their codebase, issues, MRs, and pipelines — all authenticated via PAT with zero OAuth involvement.

The agent can autonomously gather context from multiple GitLab sources to answer complex multi-step questions like "Why is the pipeline failing on my MR and how do I fix it?" (which requires fetching the MR, finding the pipeline, reading job logs, reading the relevant source files, and synthesizing an answer).

The agent can create and edit local files based on user requests, with a diff preview and approval workflow.

All authentication throughout the entire codebase uses PAT exclusively. A `grep -r "oauth\|OAuth\|OIDC\|oidc\|session_cookie" backend/ extension/` returns zero results.

The tool works in air-gapped environments when configured with a local LLM provider (Ollama or similar).

---

## 16. Superpowers Workflow Instructions

When starting this project in Claude Code with Superpowers active, follow this exact sequence:

**Step 1:** Read this prompt in full — it is the complete project specification and source of truth.

**Step 2:** Invoke `superpowers:brainstorming` — Walk through the design with the user section by section. Confirm architecture decisions, tool inventory, tech stack choices, and any adjustments the user wants. Present the design in digestible sections for approval. Do NOT write any code until the design is fully approved.

**Step 3:** Invoke `superpowers:writing-plans` — After design approval, create a detailed implementation plan saved to `docs/plans/YYYY-MM-DD-openduo-implementation.md`. Break the work into bite-sized TDD tasks (2–5 minutes each) following the Superpowers methodology: write failing test → verify it fails → implement minimal code → verify it passes → commit.

**Step 4:** Invoke `superpowers:subagent-driven-development` — Execute the plan task-by-task with fresh subagents per task and code review between tasks. Use `superpowers:using-git-worktrees` if isolation is needed between phases.

**Step 5:** Use `superpowers:test-driven-development` throughout — every feature gets a failing test before implementation, no exceptions.

**Step 6:** Use `superpowers:systematic-debugging` for any issues encountered — four-phase diagnosis before proposing fixes.

**Step 7:** Use `superpowers:verification-before-completion` before claiming any task is done — run the tests, check the output, provide evidence before making success claims.

**Step 8:** Use `superpowers:finishing-a-development-branch` when implementation phases complete — structured options for merge, PR, or cleanup.

---

## 17. Reference Materials

GitLab REST API docs: https://docs.gitlab.com/api/rest/
GitLab REST API authentication: https://docs.gitlab.com/api/rest/authentication/
GitLab Chat Completions API: https://docs.gitlab.com/api/chat/
GitLab Code Suggestions API: https://docs.gitlab.com/api/code_suggestions/
GitLab Personal Access Token scopes: https://docs.gitlab.com/user/profile/personal_access_tokens/
GitLab Duo Chat internals (developer docs): https://docs.gitlab.com/development/ai_features/duo_chat/
GitLab Duo Self-Hosted configuration: https://docs.gitlab.com/administration/gitlab_duo_self_hosted/configuration_types/
GitLab Duo Agentic Chat feature reference: https://docs.gitlab.com/user/gitlab_duo_chat/agentic_chat/
GitLab Duo Agent Platform overview: https://docs.gitlab.com/user/duo_agent_platform/
Axum framework: https://docs.rs/axum/latest/axum/
VS Code Extension API: https://code.visualstudio.com/api

---

## 18. Domain Skill Files for Claude Code

OpenDuo includes seven Superpowers-compatible `SKILL.md` files that provide compressed domain expertise to Claude Code (Sonnet 4.5). These significantly reduce token usage by giving Claude the exact patterns, API references, and code templates it needs instead of reasoning from first principles. Install all skills into your Superpowers personal skills directory before starting development.

**Installation:**

```bash
cp -r openduo-skills/* ~/.config/superpowers/skills/
```

**Skill Inventory:**

`gitlab-pat-auth` — PAT authentication patterns, scope validation, secrecy crate usage, custom CA certs, Federal security rules. Load first for any auth work.

`gitlab-rest-api` — Complete endpoint reference for every GitLab REST v4 endpoint OpenDuo calls: issues, MRs, pipelines, jobs, repos, search, vulnerabilities. Includes pagination, URL encoding, Rust client template.

`gitlab-duo-api` — AI Gateway endpoints: chat/completions request/response format, additional_context construction, code_suggestions, feature flag detection for Self-Managed. The most specialized skill.

`react-agent-loop` — ReAct loop implementation: StreamEvent enum, AgentTool trait, tool dispatch, context window truncation, multi-agent routing. The heart of the agent engine.

`axum-sse-streaming` — Axum server setup, SSE streaming pattern, CORS for VS Code, health checks, port discovery. Backend HTTP layer.

`vscode-extension-webview` — Extension lifecycle, SecretStorage, backend process management, React webview provider, postMessage protocol, CSP configuration.

`rust-workspace-patterns` — Four-crate workspace structure, shared traits (LlmProvider, AgentTool), thiserror error handling, wiremock integration testing, layered config.

`openduo-skills-index` — Meta-skill that indexes all others with loading strategy guidance.

See the `openduo-skills/` directory for all skill files.
