import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfirmationManager } from './confirmations';

describe('ConfirmationManager', () => {
  let manager: ConfirmationManager;

  beforeEach(() => {
    manager = new ConfirmationManager();
  });

  it('creates a pending confirmation and resolves on approve', async () => {
    const emitted: string[] = [];
    const emitToken = (t: string) => emitted.push(t);

    const promise = manager.requestConfirmation('npm test', emitToken);
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toMatch(/\[CONFIRM:[\w-]+\] npm test/);

    // Extract ID from emitted token
    const match = emitted[0].match(/\[CONFIRM:([\w-]+)\]/);
    const id = match![1];

    manager.resolve(id, true);
    const result = await promise;
    expect(result).toBe(true);
  });

  it('resolves false on deny', async () => {
    const emitToken = vi.fn();
    const promise = manager.requestConfirmation('rm -rf /', emitToken);

    const match = (emitToken.mock.calls[0][0] as string).match(/\[CONFIRM:([\w-]+)\]/);
    manager.resolve(match![1], false);

    const result = await promise;
    expect(result).toBe(false);
  });

  it('returns false for unknown confirmation IDs', () => {
    const result = manager.resolve('nonexistent', true);
    expect(result).toBe(false);
  });
});
