import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ipcBridge', () => ({
  sendIpcRequest: vi.fn(),
}));

import { sendIpcRequest } from '../ipcBridge';
import { editorContextTools } from './editorContext';

const mockSend = vi.mocked(sendIpcRequest);

describe('get_editor_context tool', () => {
  const tools = editorContextTools();
  const tool = tools.find(t => t.name === 'get_editor_context')!;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exists and has correct name', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('get_editor_context');
  });

  it('returns editor context from IPC', async () => {
    mockSend.mockResolvedValueOnce({
      filePath: 'src/index.ts',
      languageId: 'typescript',
      selection: 'const x = 1;',
      selectionRange: { startLine: 5, startCol: 0, endLine: 5, endCol: 12 },
      visibleRange: { startLine: 1, endLine: 40 },
      isDirty: false,
      lineCount: 100,
    });

    const result = await tool.execute({});
    expect(mockSend).toHaveBeenCalledWith('getEditorContext', {});
    const parsed = JSON.parse(result);
    expect(parsed.filePath).toBe('src/index.ts');
    expect(parsed.languageId).toBe('typescript');
    expect(parsed.selection).toBe('const x = 1;');
  });

  it('returns message when no editor is open', async () => {
    mockSend.mockResolvedValueOnce(null);
    const result = await tool.execute({});
    expect(result).toContain('No editor');
  });

  it('handles IPC errors gracefully', async () => {
    mockSend.mockRejectedValueOnce(new Error('IPC timeout'));
    const result = await tool.execute({});
    expect(result).toContain('Error');
    expect(result).toContain('IPC timeout');
  });
});
