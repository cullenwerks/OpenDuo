import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { workspaceTools } from './workspace';

describe('edit_workspace_file tool', () => {
  let tmpDir: string;
  let tools: ReturnType<typeof workspaceTools>;
  let editTool: (typeof tools)[number];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openduo-test-'));
    tools = workspaceTools(
      [{ name: 'test', path: tmpDir }],
      () => ({ name: 'test', path: tmpDir }),
    );
    editTool = tools.find(t => t.name === 'edit_workspace_file')!;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exists in the workspace tools', () => {
    expect(editTool).toBeDefined();
    expect(editTool.name).toBe('edit_workspace_file');
  });

  it('replaces a single line', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'line1\nline2\nline3\n');
    const result = await editTool.execute({
      file_path: 'test.ts',
      edits: [{ start_line: 2, end_line: 2, new_text: 'replaced' }],
    });
    expect(result).toContain('Success');
    const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toBe('line1\nreplaced\nline3\n');
  });

  it('deletes lines when new_text is empty', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'a\nb\nc\nd\n');
    const result = await editTool.execute({
      file_path: 'test.ts',
      edits: [{ start_line: 2, end_line: 3, new_text: '' }],
    });
    expect(result).toContain('Success');
    const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toBe('a\nd\n');
  });

  it('inserts lines (single-line range with added content)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'a\nb\nc\n');
    const result = await editTool.execute({
      file_path: 'test.ts',
      edits: [{ start_line: 2, end_line: 2, new_text: 'x\nb' }],
    });
    expect(result).toContain('Success');
    const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toBe('a\nx\nb\nc\n');
  });

  it('applies multiple edits bottom-up', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), '1\n2\n3\n4\n5\n');
    const result = await editTool.execute({
      file_path: 'test.ts',
      edits: [
        { start_line: 2, end_line: 2, new_text: 'TWO' },
        { start_line: 4, end_line: 4, new_text: 'FOUR' },
      ],
    });
    expect(result).toContain('Success');
    const content = fs.readFileSync(path.join(tmpDir, 'test.ts'), 'utf-8');
    expect(content).toBe('1\nTWO\n3\nFOUR\n5\n');
  });

  it('rejects paths outside workspace', async () => {
    const result = await editTool.execute({
      file_path: '../../../etc/passwd',
      edits: [{ start_line: 1, end_line: 1, new_text: 'hacked' }],
    });
    expect(result).toContain('outside the workspace');
  });

  it('rejects non-existent files', async () => {
    const result = await editTool.execute({
      file_path: 'nonexistent.ts',
      edits: [{ start_line: 1, end_line: 1, new_text: 'x' }],
    });
    expect(result).toContain('Error');
  });

  it('rejects binary files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'image.png'), 'fake');
    const result = await editTool.execute({
      file_path: 'image.png',
      edits: [{ start_line: 1, end_line: 1, new_text: 'x' }],
    });
    expect(result).toContain('binary');
  });
});
