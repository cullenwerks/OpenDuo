import { bearerHeaders } from './auth';
import type { Config } from './config';
import type { LlmProvider } from './provider';
import type { ChatMessage, ModelResponse, ToolDefinition } from './types';
import { flattenMessages } from './prompt';

export class GitLabAiProvider implements LlmProvider {
  private readonly gatewayUrl: string;
  private readonly pat: string;

  constructor(config: Config) {
    this.gatewayUrl = `${config.gitlabUrl.replace(/\/+$/, '')}/api/v4/chat/completions`;
    this.pat = config.pat;
  }

  async *chatStream(
    messages: ChatMessage[],
    _tools: ToolDefinition[],
  ): AsyncIterable<ModelResponse> {
    // Flatten the full conversation (system prompt + history + tool results)
    // into a single content string so the LLM sees the complete context,
    // including tool definitions and prior tool results.
    const content = flattenMessages(messages);

    const resp = await fetch(this.gatewayUrl, {
      method: 'POST',
      headers: bearerHeaders(this.pat),
      body: JSON.stringify({ content }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`GitLab Duo Chat returned HTTP ${resp.status} — ${body}`);
    }

    const contentType = resp.headers.get('content-type') ?? '';

    if (contentType.includes('text/event-stream')) {
      // SSE streaming response
      if (!resp.body) {
        throw new Error('No response body for SSE stream');
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6).trim();

          if (data === '[DONE]' || data === '') {
            yield { type: 'done' };
            continue;
          }

          // Try parsing as JSON
          try {
            const val = JSON.parse(data);
            // OpenAI format: choices[0].delta.content
            const deltaContent = val?.choices?.[0]?.delta?.content;
            if (deltaContent) {
              yield { type: 'token', token: deltaContent };
            }
            // GitLab format: "content" or "response" at top level
            else if (val?.content) {
              yield { type: 'token', token: val.content };
            } else if (val?.response) {
              yield { type: 'token', token: val.response };
            }

            if (val?.choices?.[0]?.finish_reason === 'stop') {
              yield { type: 'done' };
            }
          } catch {
            // Plain text data line — treat as a token
            yield { type: 'token', token: data };
          }
        }
      }
    } else {
      // Non-streaming response — read entire body
      let bodyText = await resp.text();
      // Response may be a JSON string or plain text
      if (bodyText.startsWith('"')) {
        try {
          bodyText = JSON.parse(bodyText) as string;
        } catch {
          // keep as-is
        }
      }
      yield { type: 'token', token: bodyText };
      yield { type: 'done' };
    }
  }
}
