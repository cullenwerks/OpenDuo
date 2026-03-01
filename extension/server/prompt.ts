import type { ChatMessage, ToolDefinition } from './types';

export function buildInitialHistory(gitlabUrl: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: buildSystemPrompt(gitlabUrl, []),
    },
  ];
}

/**
 * Builds the system prompt that enables agentic tool calling.
 *
 * When tool definitions are supplied the prompt instructs the LLM to emit
 * structured <tool_call> blocks that the ReactLoop can parse and execute.
 */
export function buildSystemPrompt(
  gitlabUrl: string,
  tools: ToolDefinition[],
): string {
  const parts: string[] = [
    `You are OpenDuo, an AI assistant integrated with GitLab at ${gitlabUrl}. ` +
    'You help the user interact with their GitLab instance.',
    '',
    'RULES:',
    '- Always think step-by-step.',
    '- Use tools to fetch real data before answering.',
    '- Never fabricate issue numbers, pipeline IDs, or commit hashes.',
    '- When you have enough information, provide a clear, concise answer.',
  ];

  if (tools.length > 0) {
    parts.push('');
    parts.push('AVAILABLE TOOLS:');
    parts.push('You have access to the following tools to interact with GitLab.');
    parts.push('To call a tool, output a <tool_call> block with JSON inside:');
    parts.push('');
    parts.push('<tool_call>');
    parts.push('{"name": "tool_name", "arguments": {"param": "value"}}');
    parts.push('</tool_call>');
    parts.push('');
    parts.push('You may call multiple tools in a single response. ' +
      'After tool results are returned, continue reasoning until you can give a final answer. ' +
      'Do NOT output <tool_call> when you already have the data you need.');
    parts.push('');

    for (const tool of tools) {
      parts.push(`### ${tool.name}`);
      parts.push(tool.description);
      if (tool.parameters && Object.keys(tool.parameters).length > 0) {
        parts.push('Parameters: ' + JSON.stringify(tool.parameters));
      }
      parts.push('');
    }
  }

  return parts.join('\n');
}

export function appendUser(history: ChatMessage[], content: string): void {
  history.push({ role: 'user', content });
}

export function appendAssistant(history: ChatMessage[], content: string): void {
  history.push({ role: 'assistant', content });
}

export function appendToolResult(history: ChatMessage[], toolName: string, result: string): void {
  history.push({ role: 'tool', content: `Tool \`${toolName}\` returned:\n${result}` });
}

/**
 * Flattens the full message history into a single content string.
 *
 * GitLab's Duo Chat APIs (REST and GraphQL) accept a single `content` string
 * rather than an array of messages.  This function serialises the conversation
 * so the LLM sees the complete context including tool results and prior turns.
 */
export function flattenMessages(messages: ChatMessage[]): string {
  return messages.map((m) => {
    switch (m.role) {
      case 'system':
        return `[SYSTEM]\n${m.content}`;
      case 'user':
        return `[USER]\n${m.content}`;
      case 'assistant':
        return `[ASSISTANT]\n${m.content}`;
      case 'tool':
        return `[TOOL RESULT]\n${m.content}`;
      default:
        return m.content;
    }
  }).join('\n\n');
}
