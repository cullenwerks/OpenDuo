import { describe, it, expect } from 'vitest';
import { ServerManager } from './server';

describe('ServerManager', () => {
  it('constructs with script path and env', () => {
    const sm = new ServerManager('/fake/dist/server.js', {
      GITLAB_URL: 'https://gitlab.example.com',
      GITLAB_PAT: 'glpat-test',
    });
    expect(sm.isRunning()).toBe(false);
  });

  it('generates a valid localhost URL', () => {
    const sm = new ServerManager('/fake/dist/server.js', {
      GITLAB_URL: 'https://gitlab.example.com',
      GITLAB_PAT: 'glpat-test',
    });
    expect(sm.serverUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('exposes hasIpc method that returns true', () => {
    const sm = new ServerManager('/fake/dist/server.js', {
      GITLAB_URL: 'https://gitlab.example.com',
      GITLAB_PAT: 'glpat-test',
    });
    expect(sm.hasIpc()).toBe(true);
  });
});
