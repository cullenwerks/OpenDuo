# Agentic Pipeline Debugging Design

**Date**: 2026-03-02
**Status**: Approved

## Problem

OpenDuo has all the primitive pipeline tools (`get_pipeline`, `get_pipeline_jobs`, `get_job_log`, `retry_pipeline`, `create_issue`) but no guidance to chain them into a zero-manual-digging diagnostic workflow. The additional blocker: CI job logs are often 10,000+ lines of ANSI-escaped text — dumping them into the LLM context is wasteful and unreliable.

## Approach: New Tool + System Prompt Protocol

Approach C from brainstorm: one new focused tool handles the log quality problem; the system prompt gives the LLM an explicit diagnostic chain to follow via the existing ReAct loop.

No compound orchestrator tool. No changes to ReactLoop, ToolRegistry wiring, or confirmation system.

## New Tool: `get_job_log_errors`

**Location**: `extension/server/tools/pipelines.ts`

**Parameters**:
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `project_id` | string | yes | — | Project ID or URL-encoded path |
| `job_id` | integer | yes | — | GitLab job ID |
| `max_lines` | integer | no | 150 | Max lines to return |
| `context_lines` | integer | no | 5 | Lines of context around each error hit |

**Algorithm**:
1. Fetch raw trace via `client.getRaw(client.apiUrl('projects/{pid}/jobs/{job_id}/trace'))`
2. Strip ANSI escape codes: `/\x1b\[[0-9;]*[mGKHF]/g`
3. Split into lines
4. Search for lines matching: `ERROR|FAILED|error:|fatal:|FATAL|assert|Traceback|npm ERR!|exit code [^0]`
5. For each match, collect `context_lines` above and below; merge overlapping windows
6. Fallback: if no error lines found, return last `max_lines` lines (tail always contains failure)
7. Prepend header: `[Extracted N error lines from TOTAL total.]`
8. Truncate to `max_lines`

**Returns**: Clean plain text, bounded by `max_lines`, header prepended.

**Export**: `extractLogErrors(rawLog: string, maxLines: number, contextLines: number): string` — pure helper, exported for unit testing.

## System Prompt Protocol

**Location**: `extension/server/prompt.ts` — new `PIPELINE DEBUGGING PROTOCOL` block in `buildSystemPrompt`, always emitted (not conditional).

```
PIPELINE DEBUGGING PROTOCOL:
When the user asks to debug, diagnose, or investigate a pipeline failure, follow these steps:

1. Infer project: if project_id not provided, call get_workspace_info to get the workspace path,
   then derive the project from the git remote URL. If ambiguous, ask the user.
2. Find the failure: call list_pipelines with status=failed, per_page=5 to get recent failures.
   If the user specified a pipeline ID, skip this step.
3. Get details: call get_pipeline for overall status, duration, commit SHA, and branch.
4. Find failed jobs: call get_pipeline_jobs, then filter for jobs where status=failed.
5. Extract errors: for each failed job, call get_job_log_errors (NOT get_job_log).
6. Cross-reference config: if the error output references a local file (script path, Makefile,
   package.json, .gitlab-ci.yml), call read_workspace_file (local copy) or get_pipeline_yaml
   (remote .gitlab-ci.yml) to show the relevant source context.
7. Synthesize: produce a structured diagnosis — which stage failed, the exact error, and which
   file/line caused it if identifiable.
8. Offer actions: ask "Should I retry the pipeline, or create an issue documenting this failure?"
9. Execute: on user response, call retry_pipeline OR create_issue (with diagnosis as description).
   Both use the confirmation flow before executing.
```

## Testing

**New file**: `extension/server/tools/pipelines.test.ts`

Tests cover `extractLogErrors` only (pure function, no network):

| Test | Input | Expected |
|------|-------|----------|
| ANSI stripping | log with `\x1b[0;32m` codes | clean plain text |
| Error extraction | log with `ERROR:` lines | those lines + context, ≤ max_lines |
| Fallback | log with no error keywords | last max_lines lines |
| Context merging | two errors 3 lines apart, context_lines=5 | single merged window |
| Header present | any input | output starts with `[Extracted ...` |
| max_lines respected | many errors | output line count ≤ max_lines |

## Files Changed

| File | Change |
|------|--------|
| `extension/server/tools/pipelines.ts` | Add `get_job_log_errors` tool, export `extractLogErrors` |
| `extension/server/prompt.ts` | Add `PIPELINE DEBUGGING PROTOCOL` block |
| `extension/server/tools/pipelines.test.ts` | New — unit tests for `extractLogErrors` |

## Design Decisions

- **No compound tool**: A single `diagnose_pipeline` orchestrator would bypass the ReAct loop's streaming reasoning and confirmation flow. The LLM reasoning across tool results is the feature.
- **Prompt always present**: The protocol block is not gated on workspace presence — pipeline debugging is relevant whether or not a workspace is open.
- **`get_job_log_errors` not replacing `get_job_log`**: `get_job_log` stays for cases where the user explicitly wants raw output. The new tool is for agent-driven diagnosis.
- **Retry/issue always confirmed**: Both `retry_pipeline` and `create_issue` route through the existing confirmation system — no special handling needed.
