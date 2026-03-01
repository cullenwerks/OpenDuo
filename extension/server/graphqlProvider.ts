import WebSocket from 'ws';
import { privateTokenHeaders } from './auth';
import type { Config } from './config';
import type { LlmProvider } from './provider';
import type { ChatMessage, ModelResponse } from './types';
import { flattenMessages } from './prompt';
import { randomUUID } from 'crypto';

const TAG = '[graphql]';

function log(...args: unknown[]): void {
  console.log(TAG, ...args);
}

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
    log('userGid resolved:', userGid);

    // Flatten the full conversation (system prompt + history + tool results)
    // into a single content string so the LLM sees the complete context.
    const content = flattenMessages(messages);

    const clientSubId = randomUUID();
    log('clientSubId:', clientSubId);

    const wsUrl = buildWsUrl(this.baseUrl);
    log('connecting WS:', wsUrl);

    const ws = await connectWs(wsUrl, this.pat, this.baseUrl);
    log('WS connected');

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
  ): AsyncGenerator<ModelResponse> {
    // Build the GraphQL subscription query.
    // All three filter arguments (userId, resourceId, clientSubscriptionId)
    // must be present so the subscription topic matches what the server
    // publishes when the aiAction mutation completes.  For Duo Chat the
    // resourceId is the user's own GID.
    const subQuery =
      'subscription OpenDuoCompletion($userId: UserID!, $resourceId: AiModelID!, $clientSubscriptionId: String!) { ' +
      'aiCompletionResponse(userId: $userId, resourceId: $resourceId, clientSubscriptionId: $clientSubscriptionId) { ' +
      'content requestId errors } }';

    // GitLab's GraphqlChannel#subscribed reads query, variables, and
    // operationName from the channel params (the identifier).  It does NOT
    // have an `execute` action – the query must be part of the subscribe.
    const channelId = randomUUID();
    const identifier = JSON.stringify({
      channel: 'GraphqlChannel',
      channelId,
      query: subQuery,
      variables: { userId: userGid, resourceId: userGid, clientSubscriptionId: clientSubId },
      operationName: 'OpenDuoCompletion',
    });

    // Step 1: wait for ActionCable "welcome"
    log('waiting for welcome...');
    await waitForType(ws, 'welcome');
    log('got welcome');

    // Step 2: subscribe to GraphqlChannel with the query in the identifier.
    // The server's subscribed() callback executes the query and registers
    // the subscription before ActionCable sends confirm_subscription.
    log('sending subscribe, channelId:', channelId);
    ws.send(JSON.stringify({ command: 'subscribe', identifier }));

    // Step 3: wait for confirm_subscription.
    // The initial subscription result (more:true) from subscribed() may
    // arrive before confirm_subscription – waitForType skips non-matching
    // frames.  By the time confirm_subscription arrives, subscribed() has
    // completed and the subscription is fully registered server-side.
    log('waiting for confirm_subscription...');
    await waitForType(ws, 'confirm_subscription');
    log('got confirm_subscription');

    // Step 4: fire the aiAction mutation via HTTP
    log('firing aiAction mutation...');
    await this.fireAiAction(content, clientSubId, userGid);
    log('aiAction mutation complete');

    // Step 5: read events from the subscription
    log('reading subscription events...');
    yield* readSubscriptionEvents(ws, clientSubId);
  }

  private async fireAiAction(content: string, clientSubId: string, userGid: string): Promise<void> {
    const mutation =
      'mutation OpenDuoAiAction($input: AiActionInput!) { ' +
      'aiAction(input: $input) { requestId errors } }';

    const variables = {
      input: {
        chat: { content, resourceId: userGid },
        clientSubscriptionId: clientSubId,
      },
    };

    log('aiAction POST to', `${this.baseUrl}/api/graphql`);
    const resp = await fetch(`${this.baseUrl}/api/graphql`, {
      method: 'POST',
      headers: privateTokenHeaders(this.pat),
      body: JSON.stringify({ query: mutation, variables }),
    });

    log('aiAction HTTP status:', resp.status);

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      log('aiAction error body:', body);
      throw new Error(`aiAction HTTP error: HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as {
      errors?: { message: string }[];
      data?: { aiAction?: { requestId?: string; errors?: string[] } };
    };

    log('aiAction response:', JSON.stringify(data));

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
    const connectTimeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('WebSocket connection timed out after 15s'));
    }, 15_000);

    const ws = new WebSocket(wsUrl, {
      headers: {
        'PRIVATE-TOKEN': pat,
        Origin: baseUrl,
      },
    });
    ws.once('open', () => {
      clearTimeout(connectTimeout);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(connectTimeout);
      reject(new Error(`WebSocket connection failed: ${err.message}`));
    });
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
        log(`  <- ${val.type ?? 'message'}:`, JSON.stringify(val));
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
  let frameCount = 0;

  // Convert WebSocket events to an async iterable
  const messages = wsToAsyncIterable(ws);

  for await (const raw of messages) {
    frameCount++;
    const elapsed = Date.now() - start;

    if (elapsed > timeoutMs) {
      throw new Error('GraphQL subscription timed out after 120s');
    }

    const rawStr = String(raw);
    log(`  <- frame #${frameCount} (+${elapsed}ms):`, rawStr.length > 500 ? rawStr.slice(0, 500) + '…' : rawStr);

    let val: CableResponse;
    try {
      val = JSON.parse(rawStr);
    } catch {
      log('  (non-JSON frame, skipping)');
      continue;
    }

    // ActionCable control frames (ping, etc.)
    if (val.type) {
      log(`  (control frame type=${val.type}, skipping)`);
      continue;
    }

    const response = val.message?.result?.data?.aiCompletionResponse;
    if (!response) {
      log('  (no aiCompletionResponse in frame, skipping)');
      continue;
    }

    log('  aiCompletionResponse:', JSON.stringify(response));

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
        log('  empty content after tokens → done');
        yield { type: 'done' };
        return;
      }
      log('  empty content, no tokens yet → skipping');
      continue;
    }

    seenTokens = true;
    log(`  yielding token (${content.length} chars)`);
    yield { type: 'token', token: content };
  }

  log(`WS stream ended after ${frameCount} frames, seenTokens=${seenTokens}`);

  if (seenTokens) {
    yield { type: 'done' };
  } else {
    throw new Error('WebSocket stream ended without a response');
  }
}

/**
 * Converts WebSocket events to an async iterable with a stall timeout.
 *
 * If no message (including ActionCable pings) arrives within `stallMs`,
 * the iterator signals "done" and the WebSocket is terminated.  This
 * prevents the chat from hanging forever when the server goes silent.
 */
function wsToAsyncIterable(ws: WebSocket, stallMs = 60_000): AsyncIterable<WebSocket.Data> {
  const queue: WebSocket.Data[] = [];
  let resolve: (() => void) | null = null;
  let done = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;

  function resetStallTimer(): void {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      log('WS stall timeout — no frames received in', stallMs, 'ms, terminating');
      done = true;
      ws.terminate();
      if (resolve) {
        resolve();
        resolve = null;
      }
    }, stallMs);
  }

  // Start the stall timer immediately
  resetStallTimer();

  ws.on('message', (data) => {
    resetStallTimer();
    queue.push(data);
    if (resolve) {
      resolve();
      resolve = null;
    }
  });

  ws.on('close', (code, reason) => {
    log(`WS closed: code=${code} reason=${String(reason)}`);
    if (stallTimer) clearTimeout(stallTimer);
    done = true;
    if (resolve) {
      resolve();
      resolve = null;
    }
  });

  ws.on('error', (err) => {
    log('WS error:', err.message);
    if (stallTimer) clearTimeout(stallTimer);
    done = true;
    if (resolve) {
      resolve();
      resolve = null;
    }
  });

  // Respond to pings (keeps the stall timer alive)
  ws.on('ping', (data) => {
    resetStallTimer();
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
          if (stallTimer) clearTimeout(stallTimer);
          return { value: undefined as unknown as WebSocket.Data, done: true };
        },
      };
    },
  };
}
