import { describe, it, expect, vi } from 'vitest';
import { terminalTools } from './terminal';
import type { ToolContext } from './tool';

describe('run_command tool', () => {
  const tools = terminalTools(
    [{ name: 'test', path: process.cwd() }],
    () => ({ name: 'test', path: process.cwd() }),
  );
  const tool = tools.find(t => t.name === 'run_command')!;

  it('exists and has correct name', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('run_command');
  });

  it('runs a simple command after confirmation', async () => {
    const ctx: ToolContext = {
      emitToken: vi.fn(),
      requestConfirmation: vi.fn().mockResolvedValue(true),
    };

    const result = await tool.execute({ command: 'echo hello' }, ctx);
    expect(ctx.requestConfirmation).toHaveBeenCalledWith('echo hello');
    expect(result).toContain('hello');
    expect(result).toContain('Exit code: 0');
  });

  it('returns denial message when user denies', async () => {
    const ctx: ToolContext = {
      emitToken: vi.fn(),
      requestConfirmation: vi.fn().mockResolvedValue(false),
    };

    const result = await tool.execute({ command: 'echo denied' }, ctx);
    expect(result).toContain('denied');
  });

  it('requires context with requestConfirmation', async () => {
    const result = await tool.execute({ command: 'echo hi' });
    expect(result).toContain('Error');
  });

  it('returns empty tools array when no workspace folders', () => {
    const noTools = terminalTools([], () => undefined);
    expect(noTools).toHaveLength(0);
  });
});
