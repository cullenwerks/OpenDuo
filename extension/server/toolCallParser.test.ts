import { describe, it, expect } from 'vitest';
import { parseToolCalls, hasPartialToolCall, getStreamableText } from './toolCallParser';

describe('parseToolCalls', () => {
  it('returns empty toolCalls when no tool_call blocks present', () => {
    const result = parseToolCalls('Just a plain response from the LLM.');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.text).toBe('Just a plain response from the LLM.');
  });

  it('parses a single tool call', () => {
    const raw = `Let me look that up.
<tool_call>
{"name": "get_issue", "arguments": {"project_id": "mygroup/myproject", "issue_iid": 42}}
</tool_call>`;
    const result = parseToolCalls(raw);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('get_issue');
    expect(result.toolCalls[0].arguments).toEqual({
      project_id: 'mygroup/myproject',
      issue_iid: 42,
    });
    expect(result.text).toBe('Let me look that up.');
  });

  it('parses multiple tool calls', () => {
    const raw = `I'll check both.
<tool_call>
{"name": "list_issues", "arguments": {"project_id": "a/b"}}
</tool_call>
And also:
<tool_call>
{"name": "list_mrs", "arguments": {"project_id": "a/b"}}
</tool_call>`;
    const result = parseToolCalls(raw);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe('list_issues');
    expect(result.toolCalls[1].name).toBe('list_mrs');
    expect(result.text).toContain("I'll check both.");
    expect(result.text).toContain('And also:');
  });

  it('skips malformed JSON inside tool_call blocks', () => {
    const raw = `<tool_call>not valid json</tool_call> remaining text`;
    const result = parseToolCalls(raw);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.text).toBe('remaining text');
  });

  it('handles tool call with no arguments', () => {
    const raw = `<tool_call>{"name": "get_current_user"}</tool_call>`;
    const result = parseToolCalls(raw);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('get_current_user');
    expect(result.toolCalls[0].arguments).toEqual({});
  });
});

describe('getStreamableText', () => {
  it('returns full text when no tool_call blocks present', () => {
    expect(getStreamableText('Hello world')).toBe('Hello world');
  });

  it('strips a complete tool_call block', () => {
    const raw = 'Narrative\n<tool_call>\n{"name":"t"}\n</tool_call>';
    expect(getStreamableText(raw)).toBe('Narrative\n');
  });

  it('stops at an unclosed tool_call opening tag', () => {
    const raw = 'Before <tool_call>{"name":';
    expect(getStreamableText(raw)).toBe('Before ');
  });

  it('strips complete block and returns text after it', () => {
    const raw = 'A<tool_call>{"name":"t"}</tool_call>B';
    expect(getStreamableText(raw)).toBe('AB');
  });

  it('holds back trailing chars that could be start of <tool_call>', () => {
    // The single "<" at the end could be the start of "<tool_call>"
    expect(getStreamableText('text <')).toBe('text ');
    expect(getStreamableText('text <t')).toBe('text ');
    expect(getStreamableText('text <to')).toBe('text ');
  });

  it('does NOT hold back trailing text that cannot start <tool_call>', () => {
    // "z" cannot be the start of "<tool_call>"
    expect(getStreamableText('text z')).toBe('text z');
    // "<x" cannot grow into "<tool_call>" (wrong second char)
    expect(getStreamableText('text <x')).toBe('text <x');
  });

  it('handles complete block followed by partial opening', () => {
    const raw = 'A<tool_call>{"name":"t"}</tool_call>B<tool_call>{"na';
    // After removing complete block: 'AB<tool_call>{"na' → stops at <tool_call>
    expect(getStreamableText(raw)).toBe('AB');
  });
});

describe('hasPartialToolCall', () => {
  it('returns false when no tool_call tags present', () => {
    expect(hasPartialToolCall('plain text')).toBe(false);
  });

  it('returns true when opening tag exists without closing tag', () => {
    expect(hasPartialToolCall('Let me check <tool_call>{"name":')).toBe(true);
  });

  it('returns false when both tags are present', () => {
    expect(hasPartialToolCall('<tool_call>{"name": "test"}</tool_call>')).toBe(false);
  });

  it('returns true when the last opening tag is unclosed', () => {
    const text = '<tool_call>{"name": "a"}</tool_call> text <tool_call>{"name":';
    expect(hasPartialToolCall(text)).toBe(true);
  });
});
