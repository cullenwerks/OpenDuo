import { describe, it, expect } from 'vitest';
import { appendToken, createMessage } from './useChat';

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
