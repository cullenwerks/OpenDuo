# Security Model

> Security architecture, threat mitigations, and compliance considerations for OpenDuo.

## Table of Contents

- [Design Principles](#design-principles)
- [Credential Management](#credential-management)
- [Network Security](#network-security)
- [Input Validation](#input-validation)
- [Workspace Isolation](#workspace-isolation)
- [Command Execution](#command-execution)
- [Content Security Policy](#content-security-policy)
- [Streaming Safety](#streaming-safety)
- [Supply Chain Security](#supply-chain-security)
- [Audit Logging](#audit-logging)
- [Telemetry](#telemetry)
- [Threat Model](#threat-model)

---

## Design Principles

1. **Least Privilege** — The extension requests minimal VS Code permissions and the server only binds to localhost.
2. **Defense in Depth** — Multiple layers: input validation, CORS, CSP, path isolation, and user confirmation for destructive actions.
3. **Zero Trust for External Data** — All GitLab API responses and LLM outputs are treated as untrusted data.
4. **No Telemetry** — Nothing leaves the machine except calls to the configured GitLab host.

---

## Credential Management

### PAT Storage

The GitLab Personal Access Token (PAT) is stored using VS Code's `SecretStorage` API, which delegates to the platform's secure credential store:

- **Windows:** DPAPI (Data Protection API) via Windows Credential Manager
- **macOS:** Keychain
- **Linux:** libsecret / GNOME Keyring

The PAT is:
- Never written to disk in plaintext.
- Never logged or included in error messages.
- Never exposed in CLI arguments (passed to the server via environment variables).
- Validated at entry (must start with `glpat-` prefix and have minimum length).

### Required PAT Scopes

| Scope | Purpose |
|---|---|
| `api` | Full REST and GraphQL API access for tools |
| `read_user` | Validate identity and license assignment |
| `ai_features` | Access GitLab Duo / AI Gateway endpoints |

---

## Network Security

### Localhost-Only Server

The Node.js server binds to `127.0.0.1` only (not `0.0.0.0`). It is not accessible from the network.

### TLS

All outbound connections to the GitLab instance use HTTPS (TLS 1.2+). The server validates that the configured `GITLAB_URL` is HTTPS (HTTP is only permitted for `localhost` development URLs).

Node.js uses the system's TLS implementation. On Windows, this leverages SChannel, which is FIPS 140-2 validated.

### No External Calls

The server makes zero network requests to any host other than the configured GitLab instance. There are no analytics endpoints, update checks, or third-party service calls.

---

## Input Validation

### Request Body

- JSON body size is bounded at the HTTP server level.
- The `message` field is required and must be a non-empty string.
- The `workspaceFolder` field (if provided) must match a configured folder name.

### URL/Path Validation

- `GITLAB_URL` must be a valid HTTPS URL (or HTTP for localhost).
- `OPENDUO_PORT` must be an integer between 1024 and 65535.
- All tool parameters containing project IDs are URL-encoded before use in API paths.

---

## Workspace Isolation

All workspace file tools (`read_workspace_file`, `write_workspace_file`, `list_workspace_files`, `search_workspace`, `delete_workspace_file`, `edit_workspace_file`) enforce path isolation via `safePath()`:

1. The requested path is resolved to an absolute path.
2. The resolved path must start with the workspace root path.
3. Any attempt to escape the workspace (e.g., `../../etc/passwd`) is rejected.

Additional protections:
- File reads are limited to 100 KB.
- Binary files are detected and skipped.
- Directory listings exclude `node_modules`, `.git`, `dist`, and other common artifacts (max 200 entries).
- Search results are capped at 50 matches.

---

## Command Execution

The `run_command` tool executes shell commands in the workspace. Safety controls:

1. **User Confirmation Required** — Before any command executes, a `[CONFIRM:id]` event is sent to the webview. The user must explicitly approve or deny. If no response comes within 2 minutes, the command is automatically denied.

2. **Timeout** — Commands are killed after 60 seconds.

3. **Output Limits** — Command output is truncated at 50 KB.

4. **Working Directory** — Defaults to the active workspace folder. Custom directories must be within the workspace root.

5. **No ANSI Codes** — `FORCE_COLOR=0` prevents color escape sequences in output.

---

## Content Security Policy

The webview is locked down with a strict CSP:

- `script-src` is restricted to the extension's own bundle (with nonce).
- `connect-src` is restricted to the localhost server.
- No inline scripts, no `eval()`, no external script sources.
- Styles are scoped to the extension.

---

## Streaming Safety

The `getStreamableText()` function in `toolCallParser.ts` prevents raw `<tool_call>` XML blocks from leaking to the client during streaming:

1. Complete `<tool_call>...</tool_call>` blocks are stripped from the streamed text.
2. A lookahead buffer prevents partial opening tags (`<tool`, `<tool_ca`, etc.) from being sent.
3. Only the narrative portion of the LLM's response reaches the webview.

This prevents:
- User-visible raw JSON/XML from tool invocations.
- Potential injection of malicious content via crafted tool call blocks.

---

## Supply Chain Security

### Dependency Auditing

- `npm audit --audit-level=high` runs in CI on every pipeline.
- `package-lock.json` is committed to ensure reproducible installs.
- Dependencies are pinned to specific version ranges.

### CI Checks

- TypeScript strict mode enabled across all three tsconfigs.
- Type checking (`tsc --noEmit`) runs in CI.
- No dynamic `require()` or `eval()` in production code.

---

## Audit Logging

All agent tool invocations are logged to the VS Code Output Channel ("OpenDuo"):

- Tool name and parameters (with sensitive values redacted).
- Execution success/failure.
- Timestamps.

Logs are:
- Visible to the user in the VS Code Output panel.
- Local only — never transmitted externally.
- Not persisted to disk beyond VS Code's internal log rotation.

---

## Telemetry

**OpenDuo has zero telemetry.** No analytics, crash reporting, usage tracking, or any form of data collection. The only network traffic is between the server and the configured GitLab instance.

---

## Threat Model

### In Scope

| Threat | Mitigation |
|---|---|
| **PAT exposure via disk** | SecretStorage (DPAPI). Never written to files. |
| **PAT exposure via logs** | Excluded from all logging. |
| **PAT exposure via CLI** | Passed via env vars, not arguments. |
| **Network eavesdropping** | TLS 1.2+ for all GitLab connections. |
| **Remote server access** | Localhost-only binding (127.0.0.1). |
| **Cross-origin attacks** | CORS allowlist (vscode-webview + localhost). |
| **XSS in webview** | CSP nonce, no inline scripts, HTML stripped from markdown. |
| **Directory traversal** | `safePath()` validates all workspace paths. |
| **Arbitrary command execution** | User confirmation required for `run_command`. |
| **LLM prompt injection** | Tool calls are XML-parsed, not eval'd. Output is sanitized. |
| **Unbounded agent loops** | Max 15 iterations per request. |
| **Unbounded memory** | History trimmed to system prompt + 50 messages. |
| **Supply chain compromise** | `npm audit`, lockfile, CI checks. |

### Out of Scope

- The security of the GitLab instance itself.
- The behavior of the LLM model (managed by GitLab AI Gateway).
- Physical access to the machine.
- VS Code extension marketplace supply chain (distribute via `.vsix`).

---

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly by opening a private security advisory on the repository rather than a public issue.
