# Conversational MR Creation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the agent to create a fully-formed GitLab MR (with assignee, labels, milestone, and review checklist) from a single conversational message by adding a read-only `get_git_context` tool, expanding `create_mr`/`update_mr` params, and adding an MR creation protocol to the system prompt.

**Architecture:** New `get_git_context` tool shells out via `execSync` (no user confirmation needed — read-only) to collect branch, diff, and commit info. `create_mr` and `update_mr` gain `assignee_ids`, `labels`, `milestone_id` optional params. A new system prompt protocol instructs the agent to chain these tools in order when the user asks to create an MR.

**Tech Stack:** TypeScript, Node.js `child_process.execSync`, Vitest, existing `Tool` interface pattern from `terminal.ts`.

---

### Task 1: `get_git_context` tool — write failing test

**Files:**
- Create: `extension/server/tools/gitContext.test.ts`

**Step 1: Write the failing test**

Create `extension/server/tools/gitContext.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as cp from 'child_process';

vi.mock('child_process');

import { gitContextTools } from './gitContext';

describe('get_git_context tool', () => {
  const folders = [{ name: 'test', path: '/workspace' }];
  const tools = gitContextTools(folders, () => folders[0]);
  const tool = tools.find(t => t.name === 'get_git_context')!;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('exists with correct name and no required params', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('get_git_context');
    const schema = tool.parametersSchema();
    expect((schema as any).required).toBeUndefined();
  });

  it('returns structured git context', async () => {
    const execSync = vi.mocked(cp.execSync);
    execSync
      .mockReturnValueOnce('feature/auth\n' as any)           // branch --show-current
      .mockReturnValueOnce('refs/remotes/origin/main\n' as any) // symbolic-ref
      .mockReturnValueOnce('abc1234 Add login\ndef5678 Fix typo\n' as any) // log
      .mockReturnValueOnce('+++ b/auth.ts\n@@ ...' as any)    // diff --cached
      .mockReturnValueOnce(' auth.ts | 10 +++++\n' as any);   // diff --stat

    const result = await tool.execute({});
    const parsed = JSON.parse(result);

    expect(parsed.currentBranch).toBe('feature/auth');
    expect(parsed.defaultBranch).toBe('main');
    expect(parsed.recentCommits).toEqual(['abc1234 Add login', 'def5678 Fix typo']);
    expect(parsed.stagedDiff).toContain('auth.ts');
    expect(parsed.hasStaged).toBe(true);
    expect(parsed.unstagedSummary).toContain('auth.ts');
  });

  it('returns error object when not in a git repo', async () => {
    const execSync = vi.mocked(cp.execSync);
    execSync.mockImplementation(() => { throw new Error('not a git repository'); });

    const result = await tool.execute({});
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('not a git repository');
  });

  it('returns empty tools array when no workspace folders', () => {
    const noTools = gitContextTools([], () => undefined);
    expect(noTools).toHaveLength(0);
  });

  it('truncates staged diff at 8 KB', async () => {
    const execSync = vi.mocked(cp.execSync);
    const bigDiff = 'x'.repeat(9000);
    execSync
      .mockReturnValueOnce('main\n' as any)
      .mockReturnValueOnce('refs/remotes/origin/main\n' as any)
      .mockReturnValueOnce('' as any)
      .mockReturnValueOnce(bigDiff as any)
      .mockReturnValueOnce('' as any);

    const result = await tool.execute({});
    const parsed = JSON.parse(result);
    expect(parsed.stagedDiff.length).toBeLessThanOrEqual(8200); // 8KB + "[truncated]"
    expect(parsed.stagedDiff).toContain('[truncated]');
  });

  it('returns error when no active folder', async () => {
    const noFolder = gitContextTools(folders, () => undefined);
    const t = noFolder.find(t => t.name === 'get_git_context')!;
    const result = await t.execute({});
    expect(result).toContain('Error');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd extension && npm test -- --reporter=verbose gitContext
```

Expected: FAIL with "Cannot find module './gitContext'"

---

### Task 2: `get_git_context` tool — implement

**Files:**
- Create: `extension/server/tools/gitContext.ts`

**Step 1: Write implementation**

Create `extension/server/tools/gitContext.ts`:

```typescript
import * as cp from 'child_process';
import type { WorkspaceFolder } from '../config';
import type { Tool } from './tool';

const MAX_DIFF_BYTES = 8 * 1024; // 8 KB

function exec(cmd: string, cwd: string): string {
  return cp.execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

export function gitContextTools(
  folders: WorkspaceFolder[],
  getActiveFolder: () => WorkspaceFolder | undefined,
): Tool[] {
  if (folders.length === 0) return [];

  return [
    {
      name: 'get_git_context',
      description:
        'Get the current git context for the workspace: active branch, default branch, ' +
        'recent commits, staged diff, and unstaged file summary. ' +
        'Use this at the start of MR creation to understand what changed. ' +
        'No user confirmation required — read-only.',
      parametersSchema: () => ({
        type: 'object',
        properties: {},
      }),
      async execute(_args) {
        const folder = getActiveFolder();
        if (!folder) return JSON.stringify({ error: 'No workspace folder selected.' });

        const cwd = folder.path;

        try {
          const currentBranch = exec('git branch --show-current', cwd).trim();

          let defaultBranch = 'main';
          try {
            const symref = exec('git symbolic-ref refs/remotes/origin/HEAD', cwd).trim();
            defaultBranch = symref.replace('refs/remotes/origin/', '');
          } catch {
            // fall back to 'main' if no remote HEAD is set
          }

          const logRaw = exec('git log --oneline -10', cwd).trim();
          const recentCommits = logRaw ? logRaw.split('\n') : [];

          let stagedDiff = '';
          try {
            const raw = exec('git diff --cached', cwd);
            if (raw.length > MAX_DIFF_BYTES) {
              stagedDiff = raw.slice(0, MAX_DIFF_BYTES) + '\n[truncated]';
            } else {
              stagedDiff = raw;
            }
          } catch {
            stagedDiff = '';
          }

          let unstagedSummary = '';
          try {
            unstagedSummary = exec('git diff --stat', cwd).trim();
          } catch {
            unstagedSummary = '';
          }

          return JSON.stringify({
            currentBranch,
            defaultBranch,
            recentCommits,
            stagedDiff,
            unstagedSummary,
            hasStaged: stagedDiff.length > 0,
          }, null, 2);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: msg });
        }
      },
    },
  ];
}
```

**Step 2: Run test to verify it passes**

```bash
cd extension && npm test -- --reporter=verbose gitContext
```

Expected: All 6 tests PASS

**Step 3: Commit**

```bash
git add extension/server/tools/gitContext.ts extension/server/tools/gitContext.test.ts
git commit -m "feat: add get_git_context tool for read-only git state"
```

---

### Task 3: Register `gitContextTools` in the tool registry

**Files:**
- Modify: `extension/server/tools/registry.ts`

**Step 1: Add the import**

In `extension/server/tools/registry.ts`, add after the `terminalTools` import (line 23):

```typescript
import { gitContextTools } from './gitContext';
```

**Step 2: Register in the `allTools` array**

In the same file, add after the `terminalTools(...)` call (after line 68):

```typescript
      // Git context tool (read-only, no confirmation required)
      ...gitContextTools(
        config.workspaceFolders,
        () => this._activeFolder,
      ),
```

**Step 3: Verify with a smoke test — confirm the tool appears in definitions**

```bash
cd extension && npm test -- --reporter=verbose registry
```

There is no registry test file — this is fine. The build will catch type errors:

```bash
cd extension && npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
git add extension/server/tools/registry.ts
git commit -m "feat: register get_git_context in tool registry"
```

---

### Task 4: Enhance `create_mr` and `update_mr` with metadata params

**Files:**
- Create: `extension/server/tools/mergeRequests.test.ts`
- Modify: `extension/server/tools/mergeRequests.ts`

**Step 1: Write the failing test**

Create `extension/server/tools/mergeRequests.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { mergeRequestTools } from './mergeRequests';
import type { GitLabClient } from '../gitlabClient';

function makeClient(postFn = vi.fn(), putFn = vi.fn()): GitLabClient {
  return {
    post: postFn,
    put: putFn,
    get: vi.fn(),
  } as unknown as GitLabClient;
}

describe('create_mr tool', () => {
  it('passes assignee_ids, labels, and milestone_id to the API', async () => {
    const post = vi.fn().mockResolvedValue({ iid: 1, web_url: 'https://gitlab.com/mr/1' });
    const tools = mergeRequestTools(makeClient(post));
    const tool = tools.find(t => t.name === 'create_mr')!;

    await tool.execute({
      project_id: 'mygroup/myproject',
      source_branch: 'feature/auth',
      target_branch: 'main',
      title: 'Add authentication',
      assignee_ids: [42, 99],
      labels: 'backend,security',
      milestone_id: 7,
    });

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('merge_requests'),
      expect.objectContaining({
        assignee_ids: [42, 99],
        labels: 'backend,security',
        milestone_id: 7,
      }),
    );
  });

  it('creates MR without optional metadata params', async () => {
    const post = vi.fn().mockResolvedValue({ iid: 2, web_url: 'https://gitlab.com/mr/2' });
    const tools = mergeRequestTools(makeClient(post));
    const tool = tools.find(t => t.name === 'create_mr')!;

    await tool.execute({
      project_id: 'mygroup/myproject',
      source_branch: 'feature/foo',
      target_branch: 'main',
      title: 'My MR',
    });

    const body = post.mock.calls[0][1];
    expect(body.assignee_ids).toBeUndefined();
    expect(body.labels).toBeUndefined();
    expect(body.milestone_id).toBeUndefined();
  });
});

describe('update_mr tool', () => {
  it('passes assignee_ids, labels, and milestone_id to the API', async () => {
    const put = vi.fn().mockResolvedValue({ iid: 1 });
    const tools = mergeRequestTools(makeClient(vi.fn(), put));
    const tool = tools.find(t => t.name === 'update_mr')!;

    await tool.execute({
      project_id: 'mygroup/myproject',
      mr_iid: 1,
      assignee_ids: [10],
      labels: 'frontend',
      milestone_id: 3,
    });

    expect(put).toHaveBeenCalledWith(
      expect.stringContaining('merge_requests/1'),
      expect.objectContaining({
        assignee_ids: [10],
        labels: 'frontend',
        milestone_id: 3,
      }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd extension && npm test -- --reporter=verbose mergeRequests
```

Expected: FAIL — `assignee_ids` is not passed through

**Step 3: Update `create_mr` in `mergeRequests.ts`**

In `extension/server/tools/mergeRequests.ts`, replace the `create_mr` tool definition (lines 49–70):

```typescript
    {
      name: 'create_mr',
      description: 'Create a merge request.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          source_branch: { type: 'string' },
          target_branch: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          assignee_ids: {
            type: 'array',
            items: { type: 'integer' },
            description: 'List of user IDs to assign',
          },
          labels: {
            type: 'string',
            description: 'Comma-separated label names',
          },
          milestone_id: {
            type: 'integer',
            description: 'Milestone ID to attach',
          },
        },
        required: ['project_id', 'source_branch', 'target_branch', 'title'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const body: Record<string, unknown> = {};
        if (args.source_branch) body.source_branch = args.source_branch;
        if (args.target_branch) body.target_branch = args.target_branch;
        if (args.title) body.title = args.title;
        if (args.description) body.description = args.description;
        if (args.assignee_ids) body.assignee_ids = args.assignee_ids;
        if (args.labels) body.labels = args.labels;
        if (args.milestone_id) body.milestone_id = args.milestone_id;
        return JSON.stringify(await client.post(`projects/${pid}/merge_requests`, body), null, 2);
      },
    },
```

**Step 4: Update `update_mr` in `mergeRequests.ts`**

In `extension/server/tools/mergeRequests.ts`, replace the `update_mr` tool definition (lines 73–97):

```typescript
    {
      name: 'update_mr',
      description: 'Update a merge request.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          mr_iid: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string' },
          state_event: { type: 'string', enum: ['close', 'reopen'] },
          assignee_ids: {
            type: 'array',
            items: { type: 'integer' },
            description: 'List of user IDs to assign',
          },
          labels: {
            type: 'string',
            description: 'Comma-separated label names',
          },
          milestone_id: {
            type: 'integer',
            description: 'Milestone ID to attach',
          },
        },
        required: ['project_id', 'mr_iid'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const body: Record<string, unknown> = {};
        if (args.title) body.title = args.title;
        if (args.description) body.description = args.description;
        if (args.state_event) body.state_event = args.state_event;
        if (args.assignee_ids) body.assignee_ids = args.assignee_ids;
        if (args.labels) body.labels = args.labels;
        if (args.milestone_id) body.milestone_id = args.milestone_id;
        return JSON.stringify(
          await client.put(`projects/${pid}/merge_requests/${args.mr_iid}`, body),
          null, 2
        );
      },
    },
```

**Step 5: Run test to verify it passes**

```bash
cd extension && npm test -- --reporter=verbose mergeRequests
```

Expected: All 3 tests PASS

**Step 6: Commit**

```bash
git add extension/server/tools/mergeRequests.ts extension/server/tools/mergeRequests.test.ts
git commit -m "feat: add assignee_ids, labels, milestone_id to create_mr and update_mr"
```

---

### Task 5: Add MR creation protocol to system prompt

**Files:**
- Modify: `extension/server/prompt.ts`

**Step 1: Add the protocol block**

In `extension/server/prompt.ts`, after line 83 (the last `parts.push` in the pipeline debugging protocol block, before `}`), add:

```typescript
    parts.push('');
    parts.push('MR CREATION PROTOCOL:');
    parts.push('When the user asks to create an MR, open a PR, or submit their changes, follow these steps IN ORDER:');
    parts.push('1. Get local context: call get_git_context to read the current branch, recent commits, and staged diff.');
    parts.push('2. Identify project: call get_workspace_info to derive the GitLab project. If ambiguous, ask the user.');
    parts.push('3. Determine target branch: use defaultBranch from get_git_context unless the user specified one.');
    parts.push('4. Draft title and description: infer from commit messages and staged diff. Title = imperative sentence summarising the change. Description = what changed and why, formatted in Markdown.');
    parts.push('5. Resolve metadata (call in parallel if needed):');
    parts.push('   - If the user mentioned labels: call list_labels and match by name.');
    parts.push('   - If the user mentioned a milestone: call list_milestones and match by title.');
    parts.push('   - Assignee: call get_current_user to self-assign unless the user specified someone else.');
    parts.push('6. Create the MR: call create_mr with source_branch, target_branch, title, description, assignee_ids, labels, milestone_id.');
    parts.push('7. Post a review checklist: call add_mr_comment with a Markdown checklist covering tests, docs, breaking changes, and any unstaged files noted in get_git_context.');
```

**Step 2: Type-check**

```bash
cd extension && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Run full test suite**

```bash
cd extension && npm test
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add extension/server/prompt.ts
git commit -m "feat: add MR creation protocol to system prompt"
```

---

### Task 6: Final verification

**Step 1: Run full test suite one more time**

```bash
cd extension && npm test -- --reporter=verbose
```

Expected: All tests pass, no skipped tests.

**Step 2: Type-check**

```bash
cd extension && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Verify `get_git_context` appears in tool definitions**

```bash
cd extension && node -e "
const { ToolRegistry } = require('./dist/server/tools/registry');
" 2>&1 || echo "(build check — see tsc above)"
```

The above may not run without a build; tsc --noEmit is sufficient.
