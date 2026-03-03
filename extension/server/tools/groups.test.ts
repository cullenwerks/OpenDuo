import { describe, it, expect } from 'vitest';
import { matchesPaths, aggregateWorkload } from './groups';

describe('matchesPaths', () => {
  const changes = [
    { old_path: 'src/auth/login.ts', new_path: 'src/auth/login.ts' },
    { old_path: 'src/utils/helper.ts', new_path: 'src/utils/helper.ts' },
    { old_path: 'old/path.ts', new_path: 'src/auth/renamed.ts' },
  ];

  it('returns new_path when it matches the pattern', () => {
    const result = matchesPaths(changes, 'auth/');
    expect(result).toContain('src/auth/login.ts');
    expect(result).toContain('src/auth/renamed.ts');
    expect(result).not.toContain('src/utils/helper.ts');
  });

  it('also matches on old_path', () => {
    const result = matchesPaths(changes, 'old/');
    expect(result).toContain('old/path.ts');
    expect(result).not.toContain('src/auth/login.ts');
  });

  it('returns all paths when pattern is empty string', () => {
    const result = matchesPaths(changes, '');
    expect(result.length).toBe(3);
  });

  it('returns empty array when nothing matches', () => {
    const result = matchesPaths(changes, 'nonexistent/');
    expect(result).toEqual([]);
  });

  it('returns both old_path and new_path when each independently matches', () => {
    const dupe = [{ old_path: 'auth/x.ts', new_path: 'auth/y.ts' }];
    const result = matchesPaths(dupe, 'auth/');
    expect(result.length).toBe(2);
    expect(result).toContain('auth/x.ts');
    expect(result).toContain('auth/y.ts');
  });

  it('deduplicates when old_path and new_path are the same', () => {
    const same = [{ old_path: 'auth/x.ts', new_path: 'auth/x.ts' }];
    const result = matchesPaths(same, 'auth/');
    expect(result.length).toBe(1);
    expect(result).toContain('auth/x.ts');
  });
});

describe('aggregateWorkload', () => {
  const members = [
    { username: 'alice', name: 'Alice A' },
    { username: 'bob', name: 'Bob B' },
  ];

  it('counts open issues per assignee, sorted descending', () => {
    const issues = [
      { assignee: { username: 'alice' } },
      { assignee: { username: 'alice' } },
      { assignee: { username: 'bob' } },
    ];
    const result = aggregateWorkload(issues, members);
    expect(result[0]).toMatchObject({ username: 'alice', open_issues: 2 });
    expect(result[1]).toMatchObject({ username: 'bob', open_issues: 1 });
  });

  it('includes an unassigned bucket for issues with no assignee', () => {
    const issues = [
      { assignee: null },
      { assignee: undefined },
    ];
    const result = aggregateWorkload(issues, members);
    const unassigned = result.find(r => r.username === 'unassigned');
    expect(unassigned?.open_issues).toBe(2);
  });

  it('includes members with zero issues', () => {
    const result = aggregateWorkload([], members);
    expect(result.some(r => r.username === 'alice' && r.open_issues === 0)).toBe(true);
    expect(result.some(r => r.username === 'bob' && r.open_issues === 0)).toBe(true);
  });

  it('handles unknown assignees not in the members list', () => {
    const issues = [{ assignee: { username: 'ghost' } }];
    const result = aggregateWorkload(issues, members);
    const ghost = result.find(r => r.username === 'ghost');
    expect(ghost?.open_issues).toBe(1);
    expect(ghost?.name).toBe('ghost');
  });

  it('returns empty array when no issues and no members', () => {
    expect(aggregateWorkload([], [])).toEqual([]);
  });
});
