import * as http from 'http';
import { configFromEnv, classifyError, formatCauseChain, unwrapCauseChain } from './config';
import { GitLabAiProvider } from './gitlabProvider';
import { GraphQLProvider } from './graphqlProvider';
import { buildInitialHistory } from './prompt';
import { ReactLoop } from './reactLoop';
import { ToolRegistry } from './tools/registry';
import { validateChatRequest } from './validation';
import { ConfirmationManager } from './confirmations';
import type { LlmProvider } from './provider';
import type { ChatMessage } from './types';

// ---------------------------------------------------------------------------
// Logging helpers — server process writes to stdout; extension pipes to OutputChannel
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString();
}

function serverLog(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', ...args: unknown[]): void {
  const prefix = `[${ts()}] [${level}] [openduo-server]`;
  if (level === 'ERROR') {
    console.error(prefix, ...args);
  } else if (level === 'WARN') {
    console.warn(prefix, ...args);
  } else {
    console.log(prefix, ...args);
  }
}

// ---------------------------------------------------------------------------
// Config — exit immediately if environment is misconfigured
// ---------------------------------------------------------------------------

const config = (() => {
  try {
    return configFromEnv();
  } catch (err) {
    console.error(`[openduo-server] FATAL: Failed to load config: ${(err as Error).message}`);
    process.exit(1);
  }
})()!;

// ---------------------------------------------------------------------------
// Proxy — configure undici global dispatcher so all fetch() calls use
// VS Code's http.proxy setting (passed via env) rather than the system proxy.
// undici ships with Node.js 18+ and backs the built-in global fetch().
// Setting the global dispatcher affects ALL fetch() calls in this process
// without needing to modify individual call sites.
// ---------------------------------------------------------------------------

if (config.proxyUrl) {
  serverLog('INFO', `Proxy configured: ${config.proxyUrl}`);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setGlobalDispatcher, ProxyAgent } = require('undici') as typeof import('undici');
    setGlobalDispatcher(new ProxyAgent({ uri: config.proxyUrl }));
    serverLog('INFO', 'undici global ProxyAgent installed — all fetch() calls will use VS Code proxy');
  } catch (err) {
    serverLog('WARN', `Failed to configure proxy via undici: ${(err as Error).message}`);
    if (config.debug.proxyErrors) {
      serverLog('DEBUG', `[proxyErrors] Proxy setup error: ${(err as Error).stack ?? ''}`);
    }
  }
} else {
  serverLog('DEBUG', 'No proxy configured');
}

// ---------------------------------------------------------------------------
// SSL/TLS — log current settings for diagnostics
// ---------------------------------------------------------------------------

if (!config.rejectUnauthorized) {
  serverLog('WARN', 'SSL certificate validation is DISABLED (rejectUnauthorized=false)');
}
if (config.customCaCertPath) {
  serverLog('INFO', `Custom CA certificate loaded via NODE_EXTRA_CA_CERTS: ${config.customCaCertPath}`);
}

// ---------------------------------------------------------------------------
// Debug logging — helper that emits verbose diagnostics only when the
// corresponding debug category is enabled in the user's settings.
// ---------------------------------------------------------------------------

function debugLogError(context: string, err: unknown): void {
  const categories = classifyError(err, !!config.proxyUrl);
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as any)?.code ?? '';
  const stack = err instanceof Error ? err.stack ?? '' : '';
  const causeChain = formatCauseChain(err);

  for (const cat of categories) {
    if (config.debug[cat]) {
      serverLog('DEBUG', `[${cat}] ${context}: ${msg}${code ? ` (code=${code})` : ''}`);
      if (stack) serverLog('DEBUG', `[${cat}] stack: ${stack}`);
      serverLog('DEBUG', `[${cat}] cause chain:\n${causeChain}`);
    }
  }

  // If no category matched but serverErrors is enabled, log as a generic server error
  if (categories.length === 0 && config.debug.serverErrors) {
    serverLog('DEBUG', `[serverErrors] ${context}: ${msg}${code ? ` (code=${code})` : ''}`);
    if (stack) serverLog('DEBUG', `[serverErrors] stack: ${stack}`);
    serverLog('DEBUG', `[serverErrors] cause chain:\n${causeChain}`);
  }
}

// Log which debug categories are active
const activeDebug = Object.entries(config.debug).filter(([, v]) => v).map(([k]) => k);
if (activeDebug.length > 0) {
  serverLog('INFO', `Debug logging categories: ${activeDebug.join(', ')}`);
}

serverLog('INFO', `GitLab URL: ${config.gitlabUrl}`);
serverLog('INFO', `Chat provider: ${config.chatProvider}`);
serverLog('INFO', `Workspace folders: ${config.workspaceFolders.map(f => f.name).join(', ') || '(none)'}`);

// ---------------------------------------------------------------------------
// Providers and tools
// ---------------------------------------------------------------------------

let provider: LlmProvider;
if (config.chatProvider === 'graphql') {
  serverLog('INFO', 'Using GraphQL+ActionCable provider (gitlab.com mode)');
  provider = new GraphQLProvider(config);
} else {
  serverLog('INFO', 'Using REST provider (self-managed EE mode)');
  provider = new GitLabAiProvider(config);
}
const tools = new ToolRegistry(config);
const confirmations = new ConfirmationManager();
let history: ChatMessage[] = buildInitialHistory(config.gitlabUrl);

// Serialize chat requests so only one runs at a time.
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

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function isAllowedOrigin(origin: string): boolean {
  if (origin.startsWith('vscode-webview://')) return true;
  try {
    const url = new URL(origin);
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

function corsHeaders(req?: http.IncomingMessage): Record<string, string> {
  const origin = req?.headers?.origin ?? '';
  return {
    'access-control-allow-origin': isAllowedOrigin(origin) ? origin : '',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

const MAX_BODY_BYTES = 64 * 1024; // 64 KiB

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

function safeWrite(res: http.ServerResponse, data: string): boolean {
  try {
    if (!res.writableEnded && !res.destroyed) {
      return res.write(data);
    }
  } catch (e) {
    serverLog('WARN', `Write failed (client disconnected?): ${(e as Error).message}`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req);
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  serverLog('DEBUG', `${method} ${url} — origin=${req.headers.origin ?? ''}`);

  if (method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (method === 'GET' && url === '/health') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'openduo-server' }));
    return;
  }

  if (method === 'GET' && url === '/tools') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ tools: tools.definitions() }));
    return;
  }

  if (method === 'GET' && url === '/workspaces') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({
      folders: tools.workspaceFolders.map(f => f.name),
      active: tools.activeFolder?.name ?? null,
    }));
    return;
  }

  if (method === 'POST' && url === '/chat') {
    let body: string;
    try {
      body = await readBody(req);
    } catch (e) {
      serverLog('WARN', `Failed to read /chat body: ${(e as Error).message}`);
      res.writeHead(400, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read request body' }));
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      serverLog('WARN', 'POST /chat — invalid JSON body');
      res.writeHead(400, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const validationError = validateChatRequest(parsed.message);
    const message = parsed.message as string;

    if (typeof parsed.workspaceFolder === 'string' && parsed.workspaceFolder) {
      serverLog('DEBUG', `Switching workspace folder to: ${parsed.workspaceFolder}`);
      tools.setActiveFolder(parsed.workspaceFolder);
    }

    serverLog('INFO', `POST /chat — message length=${typeof message === 'string' ? message.length : 'n/a'}`);

    res.writeHead(200, {
      ...cors,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    if (validationError) {
      serverLog('WARN', `Chat validation error: ${validationError}`);
      safeWrite(res, `data: [ERROR] ${validationError}\n\n`);
      safeWrite(res, 'data: [DONE]\n\n');
      res.end();
      return;
    }

    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) {
        serverLog('INFO', 'Client disconnected — aborting chat request');
        abortController.abort();
      }
    });

    const previousLock = chatLock;
    let releaseLock: () => void;
    chatLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      await withTimeout(previousLock, LOCK_TIMEOUT_MS, 'Chat lock wait');

      const emitToken = (token: string) => {
        const lines = token.split('\n');
        const ssePayload = lines.map(l => `data: ${l}`).join('\n');
        safeWrite(res, `${ssePayload}\n\n`);
      };

      try {
        if (config.chatProvider === 'graphql') {
          // GraphQL provider: GitLab's backend runs its own agent loop.
          // Stream the response directly without ReactLoop.
          serverLog('DEBUG', 'Starting direct graphql stream...');
          const msgs: ChatMessage[] = [{ role: 'user', content: message }];
          for await (const event of provider.chatStream(msgs, [])) {
            if (abortController.signal.aborted) {
              throw new Error('Chat request aborted');
            }
            if (event.type === 'token') emitToken(event.token);
            if (event.type === 'done') break;
          }
          serverLog('DEBUG', 'GraphQL stream completed');
        } else {
          // REST provider: OpenDuo manages its own ReactLoop with custom tools.
          const reactLoop = new ReactLoop(15, config.gitlabUrl, confirmations);
          const histCopy = [...history];

          serverLog('DEBUG', 'Starting ReactLoop...');
          await reactLoop.run(
            message,
            histCopy,
            provider,
            tools,
            emitToken,
            abortController.signal,
          );
          serverLog('DEBUG', 'ReactLoop completed');

          if (histCopy.length > 51) {
            const system = histCopy[0];
            history = [system, ...histCopy.slice(histCopy.length - 50)];
          } else {
            history = histCopy;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== 'Chat request aborted') {
          const fullCause = unwrapCauseChain(e);
          serverLog('ERROR', `Chat error: ${msg}`, e instanceof Error ? e.stack : '');
          if (fullCause !== msg) {
            serverLog('ERROR', `Chat root cause: ${fullCause}`);
          }
          debugLogError('Chat', e);
          const userMsg = fullCause !== msg ? `${msg} — root cause: ${fullCause}` : msg;
          const safeMsg = userMsg.replace(/\n/g, ' ');
          safeWrite(res, `data: [ERROR] ${safeMsg}\n\n`);
        } else {
          serverLog('INFO', 'Chat request aborted by client');
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      serverLog('ERROR', `Chat lock/timeout error: ${msg}`);
      debugLogError('Chat lock/timeout', e);
      const safeMsg = msg.replace(/\n/g, ' ');
      safeWrite(res, `data: [ERROR] ${safeMsg}\n\n`);
    } finally {
      safeWrite(res, 'data: [DONE]\n\n');
      if (!res.writableEnded) res.end();
      releaseLock!();
    }
    return;
  }

  if (method === 'POST' && url === '/chat/reset') {
    serverLog('INFO', 'Chat history reset');
    history = buildInitialHistory(config.gitlabUrl);
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (method === 'POST' && url === '/command/confirm') {
    let body: string;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read request body' }));
      return;
    }

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
      serverLog('WARN', 'POST /command/confirm — missing confirmation id');
      res.writeHead(400, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing confirmation id' }));
      return;
    }

    serverLog('INFO', `Confirmation ${id}: approved=${approved}`);
    const found = confirmations.resolve(id, approved);
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: found ? 'resolved' : 'not_found' }));
    return;
  }

  serverLog('WARN', `404 — ${method} ${url}`);
  res.writeHead(404, { ...cors, 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.on('error', (err) => {
  serverLog('ERROR', `HTTP server error: ${err.message}`, err.stack ?? '');
  process.exit(1);
});

const addr = `127.0.0.1:${config.serverPort}`;
server.listen(config.serverPort, '127.0.0.1', () => {
  serverLog('INFO', `openduo-server listening on ${addr}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  serverLog('INFO', 'Received SIGINT — shutting down gracefully');
  server.close(() => {
    serverLog('INFO', 'openduo-server shut down gracefully');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  serverLog('INFO', 'Received SIGTERM — shutting down');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  serverLog('ERROR', `Uncaught exception: ${err.message}`, err.stack ?? '');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  serverLog('ERROR', `Unhandled rejection: ${String(reason)}`);
});
