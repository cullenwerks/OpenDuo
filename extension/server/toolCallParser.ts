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

const TOOL_CALL_OPEN = '<tool_call>';

/**
 * Extracts the portion of the accumulated LLM response that is safe to stream
 * to the client in real time.
 *
 * - Complete <tool_call>...</tool_call> blocks are removed entirely.
 * - Everything up to (but not including) the start of an incomplete <tool_call>
 *   block is returned, so raw JSON is never shown to the user mid-stream.
 * - A short lookahead buffer is held back at the tail of the text so that
 *   partial "<tool_call>" openings (e.g. "<tool_c" still being received) are
 *   not prematurely streamed to the client.
 */
export function getStreamableText(raw: string): string {
  // Remove all complete tool_call blocks first
  let cleaned = raw.replace(TOOL_CALL_RE, '');

  // Stop before any incomplete (unclosed) <tool_call> opening tag
  const partialOpen = cleaned.indexOf(TOOL_CALL_OPEN);
  if (partialOpen !== -1) {
    cleaned = cleaned.slice(0, partialOpen);
  }

  // Lookahead: hold back the trailing characters if they could be the beginning
  // of a <tool_call> tag that hasn't fully arrived yet (e.g. just "<" or "<tool_c").
  const maxLookback = TOOL_CALL_OPEN.length - 1; // 10 chars max
  for (let i = 1; i <= Math.min(maxLookback, cleaned.length); i++) {
    const tail = cleaned.slice(-i);
    if (TOOL_CALL_OPEN.startsWith(tail)) {
      cleaned = cleaned.slice(0, -i);
      break;
    }
  }

  return cleaned;
}
