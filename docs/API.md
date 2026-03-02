# Server API Reference

> HTTP endpoints and SSE streaming protocol for the OpenDuo server.

The OpenDuo server is a Node.js HTTP server that runs on `127.0.0.1:8745` (configurable via `OPENDUO_PORT`). It is spawned as a child process by the VS Code extension host.

## Table of Contents

- [Endpoints](#endpoints)
- [SSE Streaming Protocol](#sse-streaming-protocol)
- [CORS Policy](#cors-policy)
- [Environment Variables](#environment-variables)
- [Error Handling](#error-handling)

---

## Endpoints

### `GET /health`

Health check endpoint.

**Response:** `200 OK`
```json
{
  "status": "ok",
  "service": "openduo-server"
}
```

---

### `GET /tools`

Returns all registered tool definitions for inspection.

**Response:** `200 OK`
```json
{
  "tools": [
    {
      "name": "list_issues",
      "description": "List issues for a GitLab project",
      "parameters": {
        "type": "object",
        "properties": {
          "project_id": { "type": "string", "description": "..." }
        },
        "required": ["project_id"]
      }
    }
  ]
}
```

---

### `GET /workspaces`

Returns configured workspace folders.

**Response:** `200 OK`
```json
{
  "folders": [
    { "name": "my-project", "path": "/Users/dev/my-project" }
  ],
  "active": "my-project"
}
```

---

### `POST /chat`

Main chat endpoint. Accepts a user message, runs the ReAct agent loop, and streams the response via SSE.

**Request Body:**
```json
{
  "message": "List my open merge requests in mygroup/myproject",
  "workspaceFolder": "my-project"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `message` | `string` | Yes | The user's message |
| `workspaceFolder` | `string` | No | Active workspace folder name (switches context) |

**Response:** `200 OK`, `Content-Type: text/event-stream`

The response is an SSE stream. See [SSE Streaming Protocol](#sse-streaming-protocol) below.

**Error Responses:**
- `405 Method Not Allowed` — Non-POST request.
- `400 Bad Request` — Invalid JSON or missing `message` field.

---

### `POST /chat/reset`

Resets conversation history to initial state (system prompt only).

**Request Body:** Empty or `{}`

**Response:** `200 OK`
```json
{
  "status": "ok"
}
```

---

### `POST /command/confirm`

Resolves a pending user confirmation (approve or deny a tool action like `run_command`).

**Request Body:**
```json
{
  "confirmationId": "abc-123",
  "approved": true
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `confirmationId` | `string` | Yes | ID from the `[CONFIRM:id]` SSE event |
| `approved` | `boolean` | Yes | `true` to approve, `false` to deny |

**Response:** `200 OK`
```json
{
  "status": "ok"
}
```

---

## SSE Streaming Protocol

The `POST /chat` endpoint returns a Server-Sent Events stream. Each event is a `data:` field followed by two newlines.

### Token Events

Regular text tokens from the LLM:

```
data: Here are your\n\n
data:  open issues:\n\n
```

### Multi-line Tokens

Tokens containing newlines are split across multiple `data:` fields within a single event block:

```
data: Line one
data: Line two
data: Line three\n\n
```

The client reassembles these by joining with `\n`.

### Completion Marker

Indicates the stream is complete:

```
data: [DONE]\n\n
```

### Error Events

Server-side errors during streaming:

```
data: [ERROR] Failed to connect to GitLab API\n\n
```

### Tool Execution Indicator

Emitted when the agent is executing a tool:

```
data: [Calling list_issues...]\n\n
```

### Confirmation Request

Emitted when a tool requires user approval:

```
data: [CONFIRM:abc-123] Run command: npm test\n\n
```

The client should display an approve/deny UI and POST the result to `/command/confirm`.

---

## CORS Policy

The server enforces CORS on all requests:

**Allowed Origins:**
- `vscode-webview://*` — VS Code webview panels
- `http://127.0.0.1:*` — Localhost (development)
- `http://localhost:*` — Localhost (development)

**Blocked:** All other origins receive a `403 Forbidden` response.

**Headers:**
```
Access-Control-Allow-Origin: <matched origin>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

---

## Environment Variables

The server reads configuration from environment variables set by the extension host:

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITLAB_URL` | Yes | — | GitLab instance URL (must be HTTPS, or HTTP for localhost) |
| `GITLAB_PAT` | Yes | — | Personal Access Token (scopes: `api`, `read_user`, `ai_features`) |
| `OPENDUO_PORT` | No | `8745` | Server listen port (1024–65535) |
| `OPENDUO_CHAT_PROVIDER` | No | `rest` | `rest` or `graphql` |
| `OPENDUO_WORKSPACE_FOLDERS` | No | `[]` | JSON array of `{ name, path }` objects |

---

## Error Handling

### HTTP Errors

| Status | When |
|---|---|
| `400 Bad Request` | Invalid JSON body, missing required fields |
| `403 Forbidden` | CORS origin not allowed |
| `404 Not Found` | Unknown route |
| `405 Method Not Allowed` | Wrong HTTP method for endpoint |

### Streaming Errors

Errors during SSE streaming are sent as `[ERROR]` events rather than HTTP error codes (since the response has already started with `200 OK`):

```
data: [ERROR] GitLab API returned 401 Unauthorized\n\n
data: [DONE]\n\n
```

### Chat Lock

The server serializes chat requests. If a request is already in progress, subsequent requests wait (up to 3 minutes) before timing out with an error.
