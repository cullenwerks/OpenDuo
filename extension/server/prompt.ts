import type { ChatMessage } from './types';

export function buildInitialHistory(gitlabUrl: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        `You are OpenDuo, an AI assistant integrated with GitLab at ${gitlabUrl}. ` +
        'You help the user interact with their GitLab instance by using available tools. ' +
        'Always think step-by-step. Use tools to fetch real data before answering. ' +
        'Never fabricate issue numbers, pipeline IDs, or commit hashes. ' +
        'When you have enough information, provide a clear, concise answer.',
    },
  ];
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
