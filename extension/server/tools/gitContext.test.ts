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

  it('falls back to main when symbolic-ref throws', async () => {
    const execSync = vi.mocked(cp.execSync);
    execSync
      .mockReturnValueOnce('feature/auth\n' as any)     // branch --show-current
      .mockImplementationOnce(() => { throw new Error('no upstream'); }) // symbolic-ref throws
      .mockReturnValueOnce('abc1234 Add login\n' as any) // log
      .mockReturnValueOnce('' as any)                    // diff --cached (empty)
      .mockReturnValueOnce('' as any);                   // diff --stat

    const result = await tool.execute({});
    const parsed = JSON.parse(result);
    expect(parsed.defaultBranch).toBe('main');
    expect(parsed.currentBranch).toBe('feature/auth');
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
    expect(parsed.stagedDiff.length).toBeLessThanOrEqual(8192); // capped at MAX_DIFF_BYTES
    expect(parsed.stagedDiff).toContain('[truncated]');
  });

  it('returns error when no active folder', async () => {
    const noFolder = gitContextTools(folders, () => undefined);
    const t = noFolder.find(t => t.name === 'get_git_context')!;
    const result = await t.execute({});
    expect(result).toContain('Error');
  });
});