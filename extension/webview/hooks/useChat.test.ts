import { describe, it, expect } from 'vitest';
import { appendToken, createMessage, parseToolCallToken } from './useChat';

describe('parseToolCallToken', () => {
  it('parses a basic tool call token', () => {
    const result = parseToolCallToken('[Calling list_issues...]');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('list_issues');
    expect(result!.params).toBe('');
  });

  it('returns null for non-tool-call tokens', () => {
    expect(parseToolCallToken('Hello world')).toBeNull();
    expect(parseToolCallToken('[DONE]')).toBeNull();
    expect(parseToolCallToken('[ERROR] something')).toBeNull();
  });

  it('captures params after the tool name', () => {
    const result = parseToolCallToken('[Calling list_issues state:open...]');
    expect(result!.name).toBe('list_issues');
    expect(result!.params).toBe('state:open');
  });

  it('handles dotted tool names', () => {
    const result = parseToolCallToken('[Calling gitlab.list_issues...]');
    expect(result!.name).toBe('gitlab.list_issues');
  });
});

describe('useChat utilities', () => {
  it('creates a user message', () => {
    const msg = createMessage('user', 'hello');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
    expect(msg.id).toBeDefined();
  });

  it('appends token to message content', () => {
    const msg = createMessage('assistant', '');
    const updated = appendToken(msg, 'Hello');
    expect(updated.content).toBe('Hello');
  });
});
