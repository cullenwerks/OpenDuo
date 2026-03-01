import type { ToolDefinition } from '../types';

export interface Tool {
  name: string;
  description: string;
  parametersSchema(): Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
}

export function toolDefinition(tool: Tool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parametersSchema(),
  };
}
