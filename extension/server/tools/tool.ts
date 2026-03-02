import type { ToolDefinition } from '../types';

export interface ToolContext {
  /** Emit text to the SSE stream (same as onToken in ReactLoop). */
  emitToken: (text: string) => void;
  /**
   * Request user confirmation. Returns true if approved, false if denied.
   * Emits a [CONFIRM:id] SSE event and waits for the user's response.
   */
  requestConfirmation: (prompt: string) => Promise<boolean>;
}

export interface Tool {
  name: string;
  description: string;
  parametersSchema(): Record<string, unknown>;
  execute(args: Record<string, unknown>, context?: ToolContext): Promise<string>;
}

export function toolDefinition(tool: Tool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parametersSchema(),
  };
}
