import { describe, it, expect, vi } from 'vitest';
import { extractProjectPath } from './gitRemote';

// Mock child_process.execFile to avoid real git calls
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'child_process';

function mockGitRemote(url: string): void {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, url + '\n');
    },
  );
}

function mockGitRemoteError(): void {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
      cb(new Error('not a git repo'));
    },
  );
}

describe('extractProjectPath', () => {
  it('extracts from HTTPS remote', async () => {
    mockGitRemote('https://gitlab.com/my-group/my-project.git');
    const result = await extractProjectPath('/workspace', 'https://gitlab.com');
    expect(result).toBe('my-group/my-project');
  });

  it('extracts from HTTPS remote without .git suffix', async () => {
    mockGitRemote('https://gitlab.com/my-group/my-project');
    const result = await extractProjectPath('/workspace', 'https://gitlab.com');
    expect(result).toBe('my-group/my-project');
  });

  it('extracts from SSH remote', async () => {
    mockGitRemote('git@gitlab.com:my-group/my-project.git');
    const result = await extractProjectPath('/workspace', 'https://gitlab.com');
    expect(result).toBe('my-group/my-project');
  });

  it('handles subgroups', async () => {
    mockGitRemote('https://gitlab.com/org/team/subteam/project.git');
    const result = await extractProjectPath('/workspace', 'https://gitlab.com');
    expect(result).toBe('org/team/subteam/project');
  });

  it('handles trailing slash on gitlabUrl', async () => {
    mockGitRemote('https://gitlab.com/my-group/my-project.git');
    const result = await extractProjectPath('/workspace', 'https://gitlab.com/');
    expect(result).toBe('my-group/my-project');
  });

  it('returns null when host does not match', async () => {
    mockGitRemote('https://github.com/user/repo.git');
    const result = await extractProjectPath('/workspace', 'https://gitlab.com');
    expect(result).toBeNull();
  });

  it('returns null when git command fails', async () => {
    mockGitRemoteError();
    const result = await extractProjectPath('/workspace', 'https://gitlab.com');
    expect(result).toBeNull();
  });

  it('handles self-managed instance URL', async () => {
    mockGitRemote('https://git.example.com/devops/infra.git');
    const result = await extractProjectPath('/workspace', 'https://git.example.com');
    expect(result).toBe('devops/infra');
  });

  it('handles SSH remote for self-managed instance', async () => {
    mockGitRemote('git@git.example.com:devops/infra.git');
    const result = await extractProjectPath('/workspace', 'https://git.example.com');
    expect(result).toBe('devops/infra');
  });
});
