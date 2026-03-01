import type { ChatMessage, ModelResponse, ToolDefinition } from './types';

export interface LlmProvider {
  chatStream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): AsyncIterable<ModelResponse>;
}
