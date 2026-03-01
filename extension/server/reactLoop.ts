import type { LlmProvider } from './provider';
import type { ChatMessage } from './types';
import { appendAssistant, appendToolResult, appendUser, buildSystemPrompt } from './prompt';
import type { ToolRegistry } from './tools/registry';
import { parseToolCalls, getStreamableText } from './toolCallParser';

export class ReactLoop {
  constructor(
    private readonly maxIterations: number,
    private readonly gitlabUrl: string,
  ) {}

  async run(
    userMessage: string,
    history: ChatMessage[],
    provider: LlmProvider,
    tools: ToolRegistry,
    onToken: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    appendUser(history, userMessage);
    const toolDefs = tools.definitions();

    // Update the system prompt with tool definitions and workspace context
    // so the LLM knows how to call tools via <tool_call> blocks.
    if (history.length > 0 && history[0].role === 'system') {
      history[0].content = buildSystemPrompt(this.gitlabUrl, toolDefs, tools.activeFolder);
    }

    let finalResponse = '';

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      if (signal?.aborted) {
        throw new Error('Chat request aborted');
      }

      console.log(`[react] Iteration ${iteration + 1}`);

      let currentResponse = '';
      const providerToolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

      // Track how many characters of clean (tool-call-stripped) text have
      // already been sent to the client so we never double-emit narrative
      // text or leak raw <tool_call> JSON to the user.
      let streamedCleanLen = 0;

      for await (const event of provider.chatStream([...history], toolDefs)) {
        if (signal?.aborted) {
          throw new Error('Chat request aborted');
        }

        switch (event.type) {
          case 'token': {
            currentResponse += event.token;
            // Compute the safe-to-stream portion: complete <tool_call> blocks
            // are removed, and the tail is held back until we know it isn't
            // the start of a new block.  This prevents raw JSON from reaching
            // the client even when an entire <tool_call>...</tool_call> arrives
            // in a single chunk.
            const streamable = getStreamableText(currentResponse);
            if (streamable.length > streamedCleanLen) {
              onToken(streamable.slice(streamedCleanLen));
              streamedCleanLen = streamable.length;
            }
            break;
          }
          case 'toolCall':
            // Native tool calls from providers that support them
            providerToolCalls.push(event.toolCall);
            break;
          case 'done':
            // Provider has signalled end-of-stream — stop consuming.
            break;
        }
        if (event.type === 'done') break;
      }

      // Parse text-based tool calls from the complete accumulated response.
      // This enables agentic behaviour even when the LLM backend (GitLab
      // Duo Chat) doesn't natively support function calling.
      const parsed = parseToolCalls(currentResponse);
      const allToolCalls = [...providerToolCalls, ...parsed.toolCalls];

      // Emit any narrative text that wasn't streamed yet.  This handles text
      // that follows a </tool_call> close tag and was held back by the
      // lookahead buffer, plus any trailing trim differences.
      if (parsed.text.length > streamedCleanLen) {
        onToken(parsed.text.slice(streamedCleanLen));
      }

      if (allToolCalls.length > 0) {
        // Append the narrative text (if any) as the assistant's "thinking".
        if (parsed.text) {
          appendAssistant(history, parsed.text);
        }

        for (const tc of allToolCalls) {
          console.log(`[react] Executing tool: ${tc.name}`);
          // Emit the tool indicator BEFORE execution so the user sees
          // immediate feedback rather than seeing it appear after the fact.
          onToken(`\n[Calling ${tc.name}...]\n`);
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
        // No tool calls — this is the final answer.
        finalResponse = parsed.text || currentResponse;
        appendAssistant(history, finalResponse);
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
