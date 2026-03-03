import { describe, it, expect } from 'vitest';
import { extractLogErrors } from './pipelines';

const ANSI_LOG = '\x1b[0;32mBuilding project\x1b[0m\nStep 1 done\n\x1b[31mERROR: build failed\x1b[0m\nDone.';

describe('extractLogErrors', () => {
  const contentLines = (s: string) => s.split('\n').filter(l => !l.startsWith('['));

  it('strips ANSI escape codes', () => {
    const result = extractLogErrors(ANSI_LOG, 150, 5);
    expect(result).not.toMatch(/\x1b\[/);
  });

  it('extracts lines matching error patterns with context', () => {
    const lines = ['line 1', 'line 2', 'ERROR: something broke', 'line 4', 'line 5'];
    const log = lines.join('\n');
    const result = extractLogErrors(log, 150, 1);
    expect(result).toContain('ERROR: something broke');
    expect(result).toContain('line 2'); // context before
    expect(result).toContain('line 4'); // context after
  });

  it('falls back to last max_lines lines when no error keywords found', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
    const log = lines.join('\n');
    const result = extractLogErrors(log, 20, 5);
    const resultLines = contentLines(result);
    expect(resultLines.length).toBeLessThanOrEqual(20);
    expect(result).toContain('line 300');
    // early lines excluded — check no content line equals 'line 1'
    expect(resultLines.every(l => l !== 'line 1')).toBe(true);
  });

  it('merges overlapping context windows', () => {
    const lines = [
      'ok', 'ok', 'ok',
      'ERROR: first',  // index 3
      'ok',            // index 4
      'ERROR: second', // index 5
      'ok', 'ok', 'ok',
    ];
    const log = lines.join('\n');
    // context_lines=2 means each error ±2. They overlap, should not duplicate.
    const result = extractLogErrors(log, 150, 2);
    const errorOccurrences = (result.match(/ERROR:/g) || []).length;
    expect(errorOccurrences).toBe(2); // not 4
  });

  it('prepends a header line', () => {
    const log = 'ERROR: boom';
    const result = extractLogErrors(log, 150, 1);
    expect(result).toMatch(/^\[Extracted \d+ error lines? from \d+ total\.\]/);
  });

  it('respects max_lines limit', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `ERROR: line ${i}`);
    const log = lines.join('\n');
    const result = extractLogErrors(log, 10, 0);
    expect(contentLines(result).length).toBeLessThanOrEqual(10);
  });
});
