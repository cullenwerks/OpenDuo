import type { LlmProvider } from './provider';
import type { ChatMessage } from './types';
import { appendAssistant, appendToolResult, appendUser } from './prompt';
import type { ToolRegistry } from './tools/registry';

export class ReactLoop {
  constructor(private readonly maxIterations: number) {}

  async run(
    userMessage: string,
    history: ChatMessage[],
    provider: LlmProvider,
    tools: ToolRegistry,
    onToken: (token: string) => void,
  ): Promise<string> {
    appendUser(history, userMessage);
    const toolDefs = tools.definitions();
    let finalResponse = '';

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      console.log(`[react] Iteration ${iteration + 1}`);

      let currentResponse = '';
      const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

      for await (const event of provider.chatStream([...history], toolDefs)) {
        switch (event.type) {
          case 'token':
            onToken(event.token);
            currentResponse += event.token;
            break;
          case 'toolCall':
            toolCalls.push(event.toolCall);
            break;
          case 'done':
            break;
        }
      }

      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          console.log(`[react] Executing tool: ${tc.name}`);
          let result: string;
          try {
            result = await tools.execute(tc.name, tc.arguments);
          } catch (e) {
            result = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
          }
          appendAssistant(history, `[Using tool: ${tc.name}]`);
          appendToolResult(history, tc.name, result);
        }
      } else {
        finalResponse = currentResponse;
        appendAssistant(history, currentResponse);
        break;
      }

      if (iteration + 1 === this.maxIterations) {
        console.warn(`[react] Max iterations (${this.maxIterations}) reached`);
        finalResponse =
          "I've reached the maximum number of reasoning steps. Please try rephrasing your question.";
        onToken(finalResponse);
        appendAssistant(history, finalResponse);
      }
    }

    return finalResponse;
  }
}
