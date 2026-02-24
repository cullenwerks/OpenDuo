import { describe, it, expect, vi } from 'vitest';
import { PatManager } from './patManager';

const mockSecrets = {
  store: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  onDidChange: { event: vi.fn() },
};

describe('PatManager', () => {
  it('stores PAT via SecretStorage', async () => {
    const pm = new PatManager(mockSecrets as any);
    await pm.store('glpat-abc123');
    expect(mockSecrets.store).toHaveBeenCalledWith('openduo.pat', 'glpat-abc123');
  });

  it('retrieves PAT from SecretStorage', async () => {
    mockSecrets.get.mockResolvedValue('glpat-abc123');
    const pm = new PatManager(mockSecrets as any);
    const pat = await pm.get();
    expect(pat).toBe('glpat-abc123');
  });

  it('returns undefined when no PAT stored', async () => {
    mockSecrets.get.mockResolvedValue(undefined);
    const pm = new PatManager(mockSecrets as any);
    const pat = await pm.get();
    expect(pat).toBeUndefined();
  });
});
