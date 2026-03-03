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
