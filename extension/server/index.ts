import * as http from 'http';
import { configFromEnv } from './config';
import { GitLabAiProvider } from './gitlabProvider';
import { GraphQLProvider } from './graphqlProvider';
import { buildInitialHistory } from './prompt';
import { ReactLoop } from './reactLoop';
import { ToolRegistry } from './tools/registry';
import { validateChatRequest } from './validation';
import { ConfirmationManager } from './confirmations';
import type { LlmProvider } from './provider';
import type { ChatMessage } from './types';

const config = configFromEnv();
let provider: LlmProvider;
if (config.chatProvider === 'graphql') {
  console.log('Using GraphQL+ActionCable provider (gitlab.com mode)');
  provider = new GraphQLProvider(config);
} else {
  console.log('Using REST provider (self-managed EE mode)');
  provider = new GitLabAiProvider(config);
}
const tools = new ToolRegistry(config);
const confirmations = new ConfirmationManager();
let history: ChatMessage[] = buildInitialHistory(config.gitlabUrl);

// Serialize chat requests so only one runs at a time.
// Includes a timeout to prevent cascading hangs.
let chatLock: Promise<void> = Promise.resolve();
const LOCK_TIMEOUT_MS = 180_000; // 3 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function isAllowedOrigin(origin: string): boolean {
  if (origin.startsWith('vscode-webview://')) return true;
  try {
    const url = new URL(origin);
    // Strict hostname check — prevents bypass via e.g. "localhost.evil.com"
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

function corsHeaders(req?: http.IncomingMessage): Record<string, string> {
  // Only allow requests from VS Code webview or localhost origins.
  // A wildcard '*' would let any website running in the user's browser
  // interact with this server and exfiltrate GitLab data via the PAT.
  const origin = req?.headers?.origin ?? '';
  return {
    'access-control-allow-origin': isAllowedOrigin(origin) ? origin : '',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

const MAX_BODY_BYTES = 64 * 1024; // 64 KiB — more than enough for chat messages

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    req.on('data', (c: Buffer) => {
      totalLength += c.length;
      if (totalLength > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/**
 * Safely write to an HTTP response, catching errors if the client
 * disconnected mid-stream.
 */
function safeWrite(res: http.ServerResponse, data: string): boolean {
  try {
    if (!res.writableEnded && !res.destroyed) {
      return res.write(data);
    }
  } catch (e) {
    console.warn('[server] Write failed (client disconnected?):', (e as Error).message);
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const url = req.url ?? '/';

  // GET /health
  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'openduo-server' }));
    return;
  }

  // GET /tools
  if (req.method === 'GET' && url === '/tools') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ tools: tools.definitions() }));
    return;
  }

  // GET /workspaces — list available workspace folders and active folder
  if (req.method === 'GET' && url === '/workspaces') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({
      folders: tools.workspaceFolders.map(f => f.name),
      active: tools.activeFolder?.name ?? null,
    }));
    return;
  }

  // POST /chat
  if (req.method === 'POST' && url === '/chat') {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const validationError = validateChatRequest(parsed.message);
    const message = parsed.message as string;

    // Switch active workspace folder if specified by the client
    if (typeof parsed.workspaceFolder === 'string' && parsed.workspaceFolder) {
      tools.setActiveFolder(parsed.workspaceFolder);
    }

    res.writeHead(200, {
      ...cors,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    if (validationError) {
      safeWrite(res, `data: [ERROR] ${validationError}\n\n`);
      safeWrite(res, 'data: [DONE]\n\n');
      res.end();
      return;
    }

    // AbortController lets us cancel an in-flight ReactLoop when the
    // client disconnects (e.g. webview closed mid-stream).
    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) {
        console.log('[server] Client disconnected, aborting chat request');
        abortController.abort();
      }
    });

    // Serialize chat requests via promise chain with a timeout so a
    // hung request doesn't block all subsequent chats.
    const previousLock = chatLock;
    let releaseLock: () => void;
    chatLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      await withTimeout(previousLock, LOCK_TIMEOUT_MS, 'Chat lock wait');

      const reactLoop = new ReactLoop(15, config.gitlabUrl, confirmations);
      const histCopy = [...history];

      try {
        await reactLoop.run(
          message,
          histCopy,
          provider,
          tools,
          (token) => {
            // Newlines in a token would corrupt the SSE frame boundary (\n\n).
            // Replace literal newlines with the SSE multi-line continuation
            // format so the client reassembles them correctly.
            const lines = token.split('\n');
            const ssePayload = lines.map(l => `data: ${l}`).join('\n');
            safeWrite(res, `${ssePayload}\n\n`);
          },
          abortController.signal,
        );

        // Trim history to prevent unbounded growth (keep system prompt + last 50 messages)
        if (histCopy.length > 51) {
          const system = histCopy[0];
          history = [system, ...histCopy.slice(histCopy.length - 50)];
        } else {
          history = histCopy;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== 'Chat request aborted') {
          console.error(`[react] Error: ${msg}`);
          // Use [ERROR] prefix so the client can distinguish errors from
          // regular response text and display them with appropriate styling.
          // Collapse newlines so the error doesn't split into multiple SSE events.
          const safeMsg = msg.replace(/\n/g, ' ');
          safeWrite(res, `data: [ERROR] ${safeMsg}\n\n`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[server] ${msg}`);
      const safeMsg = msg.replace(/\n/g, ' ');
      safeWrite(res, `data: [ERROR] ${safeMsg}\n\n`);
    } finally {
      safeWrite(res, 'data: [DONE]\n\n');
      if (!res.writableEnded) res.end();
      releaseLock!();
    }
    return;
  }

  // POST /chat/reset — reset conversation history
  if (req.method === 'POST' && url === '/chat/reset') {
    history = buildInitialHistory(config.gitlabUrl);
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // POST /command/confirm — resolve a pending tool confirmation
  if (req.method === 'POST' && url === '/command/confirm') {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const id = parsed.id as string;
    const approved = parsed.approved === true;
    if (!id || typeof id !== 'string') {
      res.writeHead(400, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing confirmation id' }));
      return;
    }

    const found = confirmations.resolve(id, approved);
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: found ? 'resolved' : 'not_found' }));
    return;
  }

  // 404
  res.writeHead(404, { ...cors, 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const addr = `127.0.0.1:${config.serverPort}`;
server.listen(config.serverPort, '127.0.0.1', () => {
  console.log(`openduo-server listening on ${addr}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Received shutdown signal, draining connections...');
  server.close(() => {
    console.log('openduo-server shut down gracefully');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
