import WebSocket from 'ws';
import { privateTokenHeaders } from './auth';
import type { Config } from './config';
import type { LlmProvider } from './provider';
import type { ChatMessage, ModelResponse } from './types';
import { randomUUID } from 'crypto';

export class GraphQLProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly pat: string;
  private userGid: string | null = null;

  constructor(config: Config) {
    this.baseUrl = config.gitlabUrl.replace(/\/+$/, '');
    this.pat = config.pat;
  }

  async *chatStream(messages: ChatMessage[]): AsyncIterable<ModelResponse> {
    const userGid = await this.resolveUserGid();

    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const content = lastUser?.content ?? '';

    const clientSubId = randomUUID();
    const wsUrl = buildWsUrl(this.baseUrl);

    const ws = await connectWs(wsUrl, this.pat, this.baseUrl);

    try {
      yield* this.driveWs(ws, content, userGid, clientSubId);
    } finally {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
  }

  private async resolveUserGid(): Promise<string> {
    if (this.userGid) return this.userGid;

    const url = `${this.baseUrl}/api/v4/user`;
    const resp = await fetch(url, { headers: privateTokenHeaders(this.pat) });
    if (!resp.ok) {
      throw new Error(`GitLab user endpoint error: HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as { id: number };
    this.userGid = `gid://gitlab/User/${data.id}`;
    return this.userGid;
  }

  private async *driveWs(
    ws: WebSocket,
    content: string,
    userGid: string,
    clientSubId: string,
  ): AsyncIterable<ModelResponse> {
    // Include a unique channelId so GitLab routes subscription events correctly
    const channelId = randomUUID();
    const identifier = JSON.stringify({ channel: 'GraphqlChannel', channelId });

    // Step 1: wait for ActionCable "welcome"
    await waitForType(ws, 'welcome');

    // Step 2: subscribe to GraphqlChannel
    ws.send(JSON.stringify({ command: 'subscribe', identifier }));

    // Step 3: wait for confirm_subscription
    await waitForType(ws, 'confirm_subscription');

    // Step 4: send subscription query via ActionCable
    const subQuery =
      'subscription OpenDuoCompletion($userId: UserID!, $clientSubscriptionId: String!) { ' +
      'aiCompletionResponse(userId: $userId, clientSubscriptionId: $clientSubscriptionId) { ' +
      'content requestId errors } }';

    const subData = JSON.stringify({
      query: subQuery,
      variables: { userId: userGid, clientSubscriptionId: clientSubId },
      operationName: 'OpenDuoCompletion',
      action: 'execute',
    });

    ws.send(
      JSON.stringify({ command: 'message', identifier, data: subData }),
    );

    // Step 5: wait for subscription acknowledgment before firing the mutation
    await waitForSubscriptionAck(ws);

    // Step 6: fire the aiAction mutation via HTTP
    await this.fireAiAction(content, clientSubId);

    // Step 7: read events from the subscription
    yield* readSubscriptionEvents(ws, clientSubId);
  }

  private async fireAiAction(content: string, clientSubId: string): Promise<void> {
    const mutation =
      'mutation OpenDuoAiAction($input: AiActionInput!) { ' +
      'aiAction(input: $input) { requestId errors } }';

    const variables = {
      input: {
        chat: { content, resourceId: null },
        clientSubscriptionId: clientSubId,
      },
    };

    const resp = await fetch(`${this.baseUrl}/api/graphql`, {
      method: 'POST',
      headers: privateTokenHeaders(this.pat),
      body: JSON.stringify({ query: mutation, variables }),
    });

    if (!resp.ok) {
      throw new Error(`aiAction HTTP error: HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as {
      errors?: { message: string }[];
      data?: { aiAction?: { errors?: string[] } };
    };

    if (data.errors?.length) {
      const msg = data.errors.map((e) => e.message).join('; ');
      throw new Error(`aiAction mutation errors: ${msg}`);
    }
    if (data.data?.aiAction?.errors?.length) {
      throw new Error(`aiAction field errors: ${data.data.aiAction.errors.join('; ')}`);
    }
  }
}

function buildWsUrl(baseUrl: string): string {
  let wsBase: string;
  if (baseUrl.startsWith('https://')) {
    wsBase = baseUrl.replace('https://', 'wss://');
  } else if (baseUrl.startsWith('http://')) {
    wsBase = baseUrl.replace('http://', 'ws://');
  } else {
    throw new Error(`Unsupported URL scheme: ${baseUrl}`);
  }
  return `${wsBase}/-/cable`;
}

function connectWs(wsUrl: string, pat: string, baseUrl: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        'PRIVATE-TOKEN': pat,
        Origin: baseUrl,
      },
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', (err) => reject(new Error(`WebSocket connection failed: ${err.message}`)));
  });
}

function waitForType(ws: WebSocket, expectedType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeListener('message', onMessage);
      reject(new Error(`Timeout waiting for ActionCable '${expectedType}' message`));
    }, 10_000);

    function onMessage(data: WebSocket.Data) {
      try {
        const val = JSON.parse(String(data));
        if (val.type === expectedType) {
          clearTimeout(timeout);
          ws.removeListener('message', onMessage);
          resolve();
        }
      } catch {
        // ignore non-JSON frames
      }
    }
    ws.on('message', onMessage);
  });
}

/**
 * After sending the subscription query with action:"execute", GitLab's
 * GraphqlChannel#execute may transmit {result: {data: null}, more: true}.
 * ActionCable wraps that as {identifier: "...", message: {result: ..., more: true}}.
 * We wait briefly for this ack so we know the subscription is registered before
 * firing the mutation.  However, some GitLab versions omit the result field or
 * do not send the ack at all.  In those cases we resolve after a short timeout
 * and rely on the fact that confirm_subscription already guarantees the channel
 * is active on the server before we get here.
 */
function waitForSubscriptionAck(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.removeListener('message', onMessage);
      // Proceed even without an explicit ack – the subscription should be active.
      resolve();
    }, 3_000);

    function onMessage(data: WebSocket.Data) {
      try {
        const val = JSON.parse(String(data));
        // Ignore ActionCable control frames (ping, etc.)
        if (val.type) return;
        // Accept any non-control message with more:true (result field is optional).
        if (val.message?.more === true) {
          clearTimeout(timeout);
          ws.removeListener('message', onMessage);
          resolve();
        }
      } catch {
        // ignore non-JSON frames
      }
    }
    ws.on('message', onMessage);
  });
}

interface CableResponse {
  message?: {
    result?: {
      data?: {
        aiCompletionResponse?: {
          content?: string;
          errors?: (string | { message: string })[];
        };
      };
    };
  };
  type?: string;
}

async function* readSubscriptionEvents(
  ws: WebSocket,
  _clientSubId: string,
): AsyncIterable<ModelResponse> {
  const timeoutMs = 120_000;
  const start = Date.now();
  let seenTokens = false;

  // Convert WebSocket events to an async iterable
  const messages = wsToAsyncIterable(ws);

  for await (const raw of messages) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('GraphQL subscription timed out after 120s');
    }

    let val: CableResponse;
    try {
      val = JSON.parse(String(raw));
    } catch {
      continue;
    }

    // ActionCable control frames (ping, etc.)
    if (val.type) {
      continue;
    }

    const response = val.message?.result?.data?.aiCompletionResponse;
    if (!response) continue;

    // Check for errors
    if (response.errors?.length) {
      const msg = response.errors
        .map((e) => (typeof e === 'string' ? e : e.message))
        .join('; ');
      throw new Error(`aiCompletionResponse error: ${msg}`);
    }

    const content = response.content ?? '';

    if (!content) {
      if (seenTokens) {
        yield { type: 'done' };
        return;
      }
      continue;
    }

    seenTokens = true;
    yield { type: 'token', token: content };
  }

  if (seenTokens) {
    yield { type: 'done' };
  } else {
    throw new Error('WebSocket stream ended without a response');
  }
}

function wsToAsyncIterable(ws: WebSocket): AsyncIterable<WebSocket.Data> {
  const queue: WebSocket.Data[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  ws.on('message', (data) => {
    queue.push(data);
    if (resolve) {
      resolve();
      resolve = null;
    }
  });

  ws.on('close', () => {
    done = true;
    if (resolve) {
      resolve();
      resolve = null;
    }
  });

  ws.on('error', () => {
    done = true;
    if (resolve) {
      resolve();
      resolve = null;
    }
  });

  // Respond to pings
  ws.on('ping', (data) => {
    ws.pong(data);
  });

  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<WebSocket.Data>> {
          while (queue.length === 0 && !done) {
            await new Promise<void>((r) => { resolve = r; });
          }
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          return { value: undefined as unknown as WebSocket.Data, done: true };
        },
      };
    },
  };
}
