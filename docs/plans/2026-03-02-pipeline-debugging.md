# Agentic Pipeline Debugging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `get_job_log_errors` tool and a system prompt protocol that lets the agent autonomously chain pipeline → jobs → log extraction → workspace cross-reference → diagnosis → retry/issue creation.

**Architecture:** One new pure helper function (`extractLogErrors`) handles ANSI stripping and error extraction — unit-tested in isolation. The tool wraps it with the GitLab API call. The system prompt gets an explicit `PIPELINE DEBUGGING PROTOCOL` block that tells the LLM exactly which tools to call and in what order. No changes to ReactLoop, ToolRegistry wiring, or confirmation system.

**Tech Stack:** TypeScript, vitest, existing `GitLabClient.getRaw()`, existing `Tool` interface.

**Design doc:** `docs/plans/2026-03-02-pipeline-debugging-design.md`

---

### Task 1: Write failing tests for `extractLogErrors`

**Files:**
- Create: `extension/server/tools/pipelines.test.ts`

**Step 1: Create the test file with all 6 tests**

```typescript
import { describe, it, expect } from 'vitest';
import { extractLogErrors } from './pipelines';

const ANSI_LOG = '\x1b[0;32mBuilding project\x1b[0m\nStep 1 done\n\x1b[31mERROR: build failed\x1b[0m\nDone.';

describe('extractLogErrors', () => {
  it('strips ANSI escape codes', () => {
    const result = extractLogErrors(ANSI_LOG, 150, 5);
    expect(result).not.toMatch(/\x1b\[/);
  });

  it('extracts lines matching error patterns with context', () => {
    const lines = ['line 1', 'line 2', 'ERROR: something broke', 'line 4', 'line 5'];
    const log = lines.join('\n');
    const result = extractLogErrors(log, 150, 1);
    expect(result).toContain('ERROR: something broke');
    expect(result).toContain('line 2'); // context before
    expect(result).toContain('line 4'); // context after
  });

  it('falls back to last max_lines lines when no error keywords found', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
    const log = lines.join('\n');
    const result = extractLogErrors(log, 20, 5);
    const resultLines = result.split('\n').filter(l => !l.startsWith('['));
    expect(resultLines.length).toBeLessThanOrEqual(20);
    expect(result).toContain('line 300');
    expect(result).not.toContain('line 1\n'); // early lines excluded
  });

  it('merges overlapping context windows', () => {
    const lines = [
      'ok', 'ok', 'ok',
      'ERROR: first',  // index 3
      'ok',            // index 4
      'ERROR: second', // index 5
      'ok', 'ok', 'ok',
    ];
    const log = lines.join('\n');
    // context_lines=2 means each error ±2. They overlap, should not duplicate.
    const result = extractLogErrors(log, 150, 2);
    const errorOccurrences = (result.match(/ERROR:/g) || []).length;
    expect(errorOccurrences).toBe(2); // not 4
  });

  it('prepends a header line', () => {
    const log = 'ERROR: boom';
    const result = extractLogErrors(log, 150, 0);
    expect(result).toMatch(/^\[Extracted \d+ error lines? from \d+ total\.\]/);
  });

  it('respects max_lines limit', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `ERROR: line ${i}`);
    const log = lines.join('\n');
    const result = extractLogErrors(log, 10, 0);
    const contentLines = result.split('\n').filter(l => !l.startsWith('['));
    expect(contentLines.length).toBeLessThanOrEqual(10);
  });
});
```

**Step 2: Run the tests to confirm they fail**

```bash
cd extension && npm test -- pipelines.test
```

Expected: 6 failures — `extractLogErrors is not a function` (export doesn't exist yet).

---

### Task 2: Implement `extractLogErrors` and make tests pass

**Files:**
- Modify: `extension/server/tools/pipelines.ts` (add helper before `pipelineTools`, export it)

**Step 1: Add the `extractLogErrors` export above `pipelineTools`**

Insert this block at line 6 (after the existing `enc` function, before `export function pipelineTools`):

```typescript
const ANSI_RE = /\x1b\[[0-9;]*[mGKHF]/g;
const ERROR_RE = /ERROR|FAILED|error:|fatal:|FATAL|assert|Traceback|npm ERR!|exit code [^0]/;

export function extractLogErrors(rawLog: string, maxLines: number, contextLines: number): string {
  const clean = rawLog.replace(ANSI_RE, '');
  const lines = clean.split('\n');
  const total = lines.length;

  // Find all lines matching error patterns
  const errorIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ERROR_RE.test(lines[i])) errorIndexes.push(i);
  }

  let selectedLines: string[];

  if (errorIndexes.length === 0) {
    // Fallback: last max_lines lines
    selectedLines = lines.slice(Math.max(0, total - maxLines));
  } else {
    // Build merged context windows
    const included = new Set<number>();
    for (const idx of errorIndexes) {
      const start = Math.max(0, idx - contextLines);
      const end = Math.min(total - 1, idx + contextLines);
      for (let i = start; i <= end; i++) included.add(i);
    }
    const sortedIndexes = Array.from(included).sort((a, b) => a - b);
    selectedLines = sortedIndexes.map(i => lines[i]);
  }

  // Truncate to max_lines
  if (selectedLines.length > maxLines) {
    selectedLines = selectedLines.slice(selectedLines.length - maxLines);
  }

  const header = `[Extracted ${errorIndexes.length} error lines from ${total} total.]`;
  return [header, ...selectedLines].join('\n');
}
```

**Step 2: Run the tests to confirm they pass**

```bash
cd extension && npm test -- pipelines.test
```

Expected: 6 passing tests, 0 failures.

**Step 3: Commit**

```bash
cd extension && git add server/tools/pipelines.test.ts server/tools/pipelines.ts
git commit -m "feat: add extractLogErrors helper with full test coverage"
```

---

### Task 3: Add the `get_job_log_errors` tool

**Files:**
- Modify: `extension/server/tools/pipelines.ts` (add tool to the returned array in `pipelineTools`)

**Step 1: Add the tool at the end of the array returned by `pipelineTools`**, after the existing `get_job_log` entry (around line 134, before the closing `]`):

```typescript
    {
      name: 'get_job_log_errors',
      description:
        'Get the relevant error/failure section of a CI job log. Strips ANSI codes, ' +
        'finds lines matching error patterns, returns them with context. Much smaller ' +
        'than get_job_log — use this for pipeline debugging.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          job_id: { type: 'integer' },
          max_lines: { type: 'integer', default: 150, description: 'Max lines to return' },
          context_lines: { type: 'integer', default: 5, description: 'Lines of context around each error' },
        },
        required: ['project_id', 'job_id'],
      }),
      async execute(args) {
        const pid = enc(args.project_id as string);
        const maxLines = (args.max_lines as number) ?? 150;
        const contextLines = (args.context_lines as number) ?? 5;
        const raw = await client.getRaw(client.apiUrl(`projects/${pid}/jobs/${args.job_id}/trace`));
        return extractLogErrors(raw, maxLines, contextLines);
      },
    },
```

**Step 2: Run the full test suite to confirm nothing broke**

```bash
cd extension && npm test
```

Expected: All existing tests pass plus the 6 new `pipelines.test` tests.

**Step 3: Commit**

```bash
git add extension/server/tools/pipelines.ts
git commit -m "feat: add get_job_log_errors tool for agent pipeline debugging"
```

---

### Task 4: Add `PIPELINE DEBUGGING PROTOCOL` to system prompt

**Files:**
- Modify: `extension/server/prompt.ts` (inside `buildSystemPrompt`)

**Step 1: Add the protocol block**

In `buildSystemPrompt`, find the closing `return parts.join('\n');` line. Insert this block immediately before it:

```typescript
  parts.push('');
  parts.push('PIPELINE DEBUGGING PROTOCOL:');
  parts.push('When the user asks to debug, diagnose, or investigate a pipeline failure, follow these steps IN ORDER:');
  parts.push('1. Infer project: if project_id not provided, call get_workspace_info to get workspace path, then derive project from the git remote URL. If ambiguous, ask the user.');
  parts.push('2. Find the failure: call list_pipelines with status=failed and per_page=5 to find recent failures. Skip if the user provided a pipeline ID.');
  parts.push('3. Get details: call get_pipeline for status, duration, commit SHA, and branch.');
  parts.push('4. Find failed jobs: call get_pipeline_jobs, then identify jobs where status=failed.');
  parts.push('5. Extract errors: for each failed job call get_job_log_errors (NOT get_job_log). This returns clean, bounded error output.');
  parts.push('6. Cross-reference config: if the error output references a local file path (script, Makefile, package.json, .gitlab-ci.yml), call read_workspace_file for local files or get_pipeline_yaml for the remote .gitlab-ci.yml.');
  parts.push('7. Synthesize: write a structured diagnosis — which stage failed, the exact error message, and which file/line caused it if identifiable.');
  parts.push('8. Offer actions: ask the user "Should I retry the pipeline, or create an issue documenting this failure?"');
  parts.push('9. Execute: on user response, call retry_pipeline OR create_issue with the diagnosis as the issue description. Both require the confirmation flow before executing.');
```

**Step 2: Run the full test suite**

```bash
cd extension && npm test
```

Expected: All tests pass. (The prompt is a string builder with no unit tests; verify visually that the output looks correct by checking `npm test` covers existing prompt-related tests if any.)

**Step 3: Commit**

```bash
git add extension/server/prompt.ts
git commit -m "feat: add pipeline debugging protocol to system prompt"
```

---

### Task 5: Verify the `client.apiUrl` method exists

The `get_job_log_errors` tool calls `client.apiUrl(...)` — same pattern as the existing `get_job_log` tool. Confirm `GitLabClient` exposes this method.

**Step 1: Check `gitlabClient.ts`**

```bash
grep -n 'apiUrl' extension/server/gitlabClient.ts
```

Expected: A method named `apiUrl` is defined. If not found, check how `get_job_log` calls `client.apiUrl` (line 131 of pipelines.ts) and match that pattern exactly. Do not change the implementation — just ensure the tool call matches what's already there.

**Step 2: Build to confirm no TypeScript errors**

```bash
cd extension && npm run build
```

Expected: Clean build, no TypeScript errors.

**Step 3: Commit if build required any fix**

Only commit if a fix was needed. Message: `fix: correct apiUrl usage in get_job_log_errors`

---

### Task 6: Final verification

**Step 1: Run the full test suite one last time**

```bash
cd extension && npm test
```

Expected: All tests pass (previously 23 + 6 new = 29 total).

**Step 2: Check test count**

```bash
cd extension && npm test -- --reporter=verbose 2>&1 | tail -5
```

Confirm 6 new tests appear under `extractLogErrors`.

**Step 3: Final commit (if any loose changes)**

```bash
git status
```

If clean, nothing to do. The branch is ready.
