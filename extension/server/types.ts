export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type ModelResponse =
  | { type: 'token'; token: string }
  | { type: 'toolCall'; toolCall: ToolCall }
  | { type: 'done' };
