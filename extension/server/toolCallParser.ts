import type { ToolCall } from './types';

/**
 * Parses tool calls from LLM text responses.
 *
 * The LLM is instructed (via the system prompt) to emit tool calls in the format:
 *
 *   <tool_call>
 *   {"name": "tool_name", "arguments": {"key": "value"}}
 *   </tool_call>
 *
 * Multiple tool calls may appear in a single response.  Text before, between,
 * and after tool_call blocks is the "thinking" / narrative the user sees.
 */

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

export interface ParsedResponse {
  /** Narrative text with tool_call blocks stripped. */
  text: string;
  /** Parsed tool calls (may be empty). */
  toolCalls: ToolCall[];
}

export function parseToolCalls(raw: string): ParsedResponse {
  const toolCalls: ToolCall[] = [];
  const text = raw.replace(TOOL_CALL_RE, (_match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim());
      if (parsed && typeof parsed.name === 'string') {
        toolCalls.push({
          name: parsed.name,
          arguments: parsed.arguments ?? {},
        });
      }
    } catch {
      // Malformed JSON inside <tool_call> – skip it
    }
    return '';
  }).trim();

  return { text, toolCalls };
}

/**
 * Returns true if the accumulated text contains an opening <tool_call> tag
 * without a matching closing tag – i.e. the LLM is still emitting the JSON
 * body.  Callers can use this to avoid prematurely treating the text as
 * "no tool calls present".
 */
export function hasPartialToolCall(raw: string): boolean {
  const lastOpen = raw.lastIndexOf('<tool_call>');
  if (lastOpen === -1) return false;
  const lastClose = raw.indexOf('</tool_call>', lastOpen);
  return lastClose === -1;
}
