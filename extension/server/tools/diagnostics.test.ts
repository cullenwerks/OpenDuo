import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ipcBridge', () => ({
  sendIpcRequest: vi.fn(),
}));

import { sendIpcRequest } from '../ipcBridge';
import { diagnosticsTools } from './diagnostics';

const mockSend = vi.mocked(sendIpcRequest);

describe('get_diagnostics tool', () => {
  const tools = diagnosticsTools();
  const tool = tools.find(t => t.name === 'get_diagnostics')!;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exists and has correct name', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('get_diagnostics');
  });

  it('returns diagnostics from IPC', async () => {
    mockSend.mockResolvedValueOnce([
      {
        file: 'src/index.ts',
        line: 10,
        column: 5,
        severity: 'error',
        message: "Property 'foo' does not exist",
        source: 'typescript',
      },
    ]);

    const result = await tool.execute({});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].severity).toBe('error');
    expect(parsed[0].file).toBe('src/index.ts');
  });

  it('passes file_path and severity filters', async () => {
    mockSend.mockResolvedValueOnce([]);
    await tool.execute({ file_path: 'src/app.ts', severity: 'warning' });
    expect(mockSend).toHaveBeenCalledWith('getDiagnostics', {
      filePath: 'src/app.ts',
      severity: 'warning',
    });
  });

  it('returns message when no diagnostics found', async () => {
    mockSend.mockResolvedValueOnce([]);
    const result = await tool.execute({});
    expect(result).toContain('No diagnostics');
  });

  it('includes filter info in empty message', async () => {
    mockSend.mockResolvedValueOnce([]);
    const result = await tool.execute({ file_path: 'src/app.ts', severity: 'error' });
    expect(result).toContain('src/app.ts');
    expect(result).toContain('error');
  });

  it('handles IPC errors gracefully', async () => {
    mockSend.mockRejectedValueOnce(new Error('IPC timeout'));
    const result = await tool.execute({});
    expect(result).toContain('Error');
  });
});
