# Conversational MR Creation from Local Work — Design

**Date**: 2026-03-03
**Status**: Approved

## Problem

`create_mr` accepts only `source_branch`, `target_branch`, `title`, and `description`. It cannot auto-assign, apply labels, or attach a milestone. There is no read-only git context tool, so the agent must use `run_command` (which requires user confirmation per command) to read branch name or diff — creating 3–4 friction prompts before an MR is even created.

The goal: a single user message like "Create an MR for my authentication changes" should produce a fully-formed MR with assignee, labels, milestone, and a review checklist — no confirmation prompts for read operations.

## Approach

Three changes, all additive:

1. New read-only `get_git_context` tool (no confirmation required)
2. Expand `create_mr` and `update_mr` with metadata params
3. MR creation protocol in the system prompt

---

## Component 1: `get_git_context` Tool

**File:** `extension/server/tools/gitContext.ts`

Shells out using Node's `child_process.execSync` directly (bypasses `run_command` confirmation flow since it is purely read-only). Runs in the active workspace folder.

### Return shape

```ts
{
  currentBranch: string,      // git branch --show-current
  defaultBranch: string,      // git symbolic-ref refs/remotes/origin/HEAD → strips "refs/remotes/origin/"
  recentCommits: string[],    // git log --oneline -10
  stagedDiff: string,         // git diff --cached, truncated to 8 KB
  unstagedSummary: string,    // git diff --stat (filenames + line counts only)
  hasStaged: boolean          // stagedDiff.length > 0
}
```

**Caps:** `stagedDiff` truncated at 8 KB with a `[truncated]` suffix. `recentCommits` limited to 10 entries.

**Error handling:** if not in a git repo, returns `{ error: "not a git repository" }`. If `execSync` throws for any other reason, returns `{ error: message }`.

**Parameters:** none — always uses the active workspace folder.

### Registration

Added to `registry.ts` alongside `terminalTools`:

```ts
...gitContextTools(config.workspaceFolders, () => this._activeFolder),
```

---

## Component 2: Enhanced `create_mr` and `update_mr`

**File:** `extension/server/tools/mergeRequests.ts`

### `create_mr` — new optional params

| Param | Type | Notes |
|---|---|---|
| `assignee_ids` | `integer[]` | GitLab user IDs to assign |
| `labels` | `string` | comma-separated label names |
| `milestone_id` | `integer` | milestone ID |

### `update_mr` — same additions

`update_mr` gains the same three optional params so the agent can patch an existing MR's metadata.

The agent resolves names → IDs before calling these tools using the already-registered `list_labels`, `list_milestones`, and `list_users` tools.

---

## Component 3: MR Creation Protocol in System Prompt

**File:** `extension/server/prompt.ts`

New block appended alongside the existing `PIPELINE DEBUGGING PROTOCOL`:

```
MR CREATION PROTOCOL:
When the user asks to create an MR, open a PR, or submit their changes, follow these steps IN ORDER:
1. Get local context: call get_git_context to read the current branch, recent commits, and staged diff.
2. Identify project: call get_workspace_info to derive the GitLab project. If ambiguous, ask the user.
3. Determine target branch: use defaultBranch from get_git_context unless the user specified one.
4. Draft title and description: infer from commit messages and staged diff. Title = imperative sentence summarising the change. Description = what changed and why, formatted in Markdown.
5. Resolve metadata (run in parallel):
   - If the user mentioned labels: call list_labels and match by name.
   - If the user mentioned a milestone: call list_milestones and match by title.
   - Assignee: call get_current_user to self-assign unless the user specified someone else.
6. Create the MR: call create_mr with source_branch, target_branch, title, description, assignee_ids, labels, milestone_id.
7. Post a review checklist: call add_mr_comment with a Markdown checklist covering: tests, docs, breaking changes, and any unstaged files mentioned in get_git_context.
```

---

## Files Changed

| File | Change |
|------|--------|
| `extension/server/tools/gitContext.ts` | New — `get_git_context` tool |
| `extension/server/tools/gitContext.test.ts` | New — unit tests |
| `extension/server/tools/mergeRequests.ts` | Add `assignee_ids`, `labels`, `milestone_id` to `create_mr` and `update_mr` |
| `extension/server/tools/registry.ts` | Register `gitContextTools` |
| `extension/server/prompt.ts` | Add MR creation protocol block |

## What Is Not Changing

- No changes to `run_command` or its confirmation flow
- No changes to existing MR tools beyond the new optional params
- No new GitLab API endpoints beyond what `create_mr` already calls
