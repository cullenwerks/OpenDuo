import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendIpcRequest, _resetForTest, _handleMessageForTest } from './ipcBridge';

describe('sendIpcRequest', () => {
  const originalSend = process.send;

  beforeEach(() => {
    _resetForTest();
    process.send = vi.fn();
  });

  afterEach(() => {
    _resetForTest();
    process.send = originalSend;
  });

  it('sends a message with type, id, method, and params', () => {
    sendIpcRequest('getDiagnostics', { filePath: 'src/index.ts' });
    expect(process.send).toHaveBeenCalledOnce();
    const msg = (process.send as any).mock.calls[0][0];
    expect(msg.type).toBe('request');
    expect(msg.method).toBe('getDiagnostics');
    expect(msg.params).toEqual({ filePath: 'src/index.ts' });
    expect(typeof msg.id).toBe('string');
  });

  it('returns a promise that resolves when response arrives', async () => {
    const promise = sendIpcRequest('getEditorContext', {});
    const msg = (process.send as any).mock.calls[0][0];

    // Simulate the extension host responding via the exported handler
    // (avoids colliding with Vitest's own process.on('message') listener)
    _handleMessageForTest({
      type: 'response',
      id: msg.id,
      data: { filePath: 'test.ts' },
    });

    const result = await promise;
    expect(result).toEqual({ filePath: 'test.ts' });
  });

  it('rejects with error when IPC is not available', async () => {
    process.send = undefined as any;
    await expect(sendIpcRequest('test', {})).rejects.toThrow('IPC not available');
  });
});
