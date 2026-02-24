import { describe, it, expect } from 'vitest';
import { ServerManager } from './server';

describe('ServerManager', () => {
  it('constructs with binary path and env', () => {
    const sm = new ServerManager('/fake/openduo-server.exe', {
      GITLAB_URL: 'https://gitlab.example.com',
      GITLAB_PAT: 'glpat-test',
    });
    expect(sm.isRunning()).toBe(false);
  });

  it('generates a valid localhost URL', () => {
    const sm = new ServerManager('/fake/openduo-server.exe', {
      GITLAB_URL: 'https://gitlab.example.com',
      GITLAB_PAT: 'glpat-test',
    });
    expect(sm.serverUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
