# Tools Reference

> Complete reference for all agent tools available in OpenDuo.

The ReAct agent can call any of these tools during a conversation. Tools are organized by domain and registered in `extension/server/tools/registry.ts`.

## Table of Contents

- [Issues](#issues)
- [Merge Requests](#merge-requests)
- [Pipelines](#pipelines)
- [Repositories](#repositories)
- [Projects](#projects)
- [Users](#users)
- [CI/CD](#cicd)
- [Milestones](#milestones)
- [Labels](#labels)
- [Snippets](#snippets)
- [Groups](#groups)
- [Environments](#environments)
- [Wiki](#wiki)
- [GraphQL](#graphql)
- [Workspace](#workspace)
- [Terminal](#terminal)
- [Editor Context](#editor-context)

---

## Issues

**Source:** `extension/server/tools/issues.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_issues` | List issues for a project | `project_id` | `state`, `assignee_username`, `labels`, `per_page` |
| `get_issue` | Get a single issue by IID | `project_id`, `issue_iid` | — |
| `create_issue` | Create a new issue | `project_id`, `title` | `description`, `labels` |
| `update_issue` | Update an existing issue | `project_id`, `issue_iid` | `title`, `description`, `labels`, `state_event` |
| `close_issue` | Close an issue | `project_id`, `issue_iid` | — |

**Notes:**
- `project_id` can be a numeric ID or URL-encoded path (e.g., `mygroup%2Fmyproject`).
- `state` accepts `opened`, `closed`, or `all`.
- `labels` is a comma-separated string.

---

## Merge Requests

**Source:** `extension/server/tools/mergeRequests.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_merge_requests` | List MRs for a project | `project_id` | `state`, `assignee_username`, `labels`, `per_page` |
| `get_merge_request` | Get a single MR by IID | `project_id`, `merge_request_iid` | — |
| `create_merge_request` | Create a new MR | `project_id`, `title`, `source_branch`, `target_branch` | `description` |
| `update_merge_request` | Update an existing MR | `project_id`, `merge_request_iid` | `title`, `description`, `target_branch`, `state_event` |
| `merge_merge_request` | Merge an MR | `project_id`, `merge_request_iid` | — |

---

## Pipelines

**Source:** `extension/server/tools/pipelines.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_pipelines` | List pipelines for a project | `project_id` | `status`, `ref`, `per_page` |
| `get_pipeline` | Get pipeline details | `project_id`, `pipeline_id` | — |
| `get_pipeline_jobs` | List jobs in a pipeline | `project_id`, `pipeline_id` | — |
| `cancel_pipeline` | Cancel a running pipeline | `project_id`, `pipeline_id` | — |
| `retry_pipeline` | Retry a failed pipeline | `project_id`, `pipeline_id` | — |

---

## Repositories

**Source:** `extension/server/tools/repositories.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_repository_tree` | List files/dirs in a repo | `project_id` | `path`, `ref`, `recursive` |
| `get_file` | Get file content from repo | `project_id`, `file_path` | `ref` |
| `search_code` | Search code across a project | `project_id`, `search` | — |

**Notes:**
- `ref` defaults to the project's default branch.
- `file_path` is relative to the repository root.

---

## Projects

**Source:** `extension/server/tools/projects.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_projects` | List accessible projects | — | `search`, `per_page` |
| `get_project` | Get project details | `project_id` | — |

---

## Users

**Source:** `extension/server/tools/users.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `get_current_user` | Get the authenticated user | — | — |
| `list_users` | Search users | — | `search`, `per_page` |

---

## CI/CD

**Source:** `extension/server/tools/cicd.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_ci_variables` | List CI/CD variables for a project | `project_id` | — |
| `get_ci_variable` | Get a specific variable | `project_id`, `key` | — |

---

## Milestones

**Source:** `extension/server/tools/milestones.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_milestones` | List project milestones | `project_id` | `state` |
| `get_milestone` | Get a single milestone | `project_id`, `milestone_id` | — |
| `create_milestone` | Create a milestone | `project_id`, `title` | `description`, `due_date`, `start_date` |

---

## Labels

**Source:** `extension/server/tools/labels.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_labels` | List project labels | `project_id` | — |
| `get_label` | Get a single label | `project_id`, `label_id` | — |

---

## Snippets

**Source:** `extension/server/tools/snippets.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_snippets` | List project snippets | `project_id` | `per_page` |
| `get_snippet` | Get a single snippet | `project_id`, `snippet_id` | — |
| `create_snippet` | Create a snippet | `project_id`, `title`, `file_name`, `content` | `visibility` |

---

## Groups

**Source:** `extension/server/tools/groups.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_groups` | List accessible groups | — | `search`, `per_page` |
| `get_group` | Get group details + members | `group_id` | — |

---

## Environments

**Source:** `extension/server/tools/environments.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_environments` | List project environments | `project_id` | — |

---

## Wiki

**Source:** `extension/server/tools/wiki.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `list_wiki_pages` | List wiki pages | `project_id` | — |
| `get_wiki_page` | Get a wiki page | `project_id`, `slug` | — |

---

## GraphQL

**Source:** `extension/server/tools/graphqlQueries.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `graphql_query` | Execute a custom GraphQL query | `query` | `variables` |

**Notes:**
- The agent can construct arbitrary GraphQL queries to retrieve data not covered by the REST tools.
- `variables` is a JSON object of query variables.

---

## Workspace

**Source:** `extension/server/tools/workspace.ts`

Local file system tools scoped to the active workspace folder.

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `read_workspace_file` | Read a file from the workspace | `file_path` | — |
| `list_workspace_files` | List directory contents | — | `path` |
| `search_workspace` | Regex search across workspace files | `pattern` | `path`, `file_glob` |
| `write_workspace_file` | Create or overwrite a file | `file_path`, `content` | — |
| `delete_workspace_file` | Delete a file | `file_path` | — |
| `edit_workspace_file` | Apply line-range edits | `file_path`, `edits` | — |
| `get_workspace_info` | Get workspace metadata | — | — |

**Security:**
- All paths are validated by `safePath()` to prevent directory traversal.
- Files are limited to 100 KB for reads.
- Directory listings skip `node_modules`, `.git`, `dist`, and other common build artifacts.
- Binary files are detected and skipped.

**`edit_workspace_file` edits format:**
```json
{
  "edits": [
    { "start_line": 5, "end_line": 7, "new_content": "replacement text" }
  ]
}
```
Lines are 1-indexed and inclusive.

---

## Terminal

**Source:** `extension/server/tools/terminal.ts`

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `run_command` | Execute a shell command | `command` | `working_directory` |

**Safety:**
- Requires user confirmation before execution. The agent sends a `[CONFIRM:id]` event to the webview, and the user must approve or deny.
- Timeout: 60 seconds.
- Max output: 50 KB.
- ANSI color codes are stripped from output.
- `working_directory` defaults to the active workspace folder.

---

## Editor Context

**Source:** `extension/server/tools/editorContext.ts`, `extension/server/tools/diagnostics.ts`

These tools use the IPC bridge to access VS Code APIs in the extension host.

| Tool | Description | Required Params | Optional Params |
|---|---|---|---|
| `get_editor_context` | Get active editor file, selection, visible range | — | — |
| `get_diagnostics` | Get diagnostics (errors, warnings) | — | `filePath`, `severity` |

**Notes:**
- `get_editor_context` returns the currently active file path, selected text, and visible range.
- `get_diagnostics` returns diagnostics from VS Code's language services. Filter by file path or severity (`error`, `warning`, `info`, `hint`).
