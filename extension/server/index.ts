import * as http from 'http';
import { configFromEnv } from './config';
import { GitLabAiProvider } from './gitlabProvider';
import { buildInitialHistory } from './prompt';
import { ReactLoop } from './reactLoop';
import { ToolRegistry } from './tools/registry';
import { validateChatRequest } from './validation';
import type { ChatMessage } from './types';

const config = configFromEnv();
const provider = new GitLabAiProvider(config);
const tools = new ToolRegistry(config);
let history: ChatMessage[] = buildInitialHistory(config.gitlabUrl);

// Serialize chat requests so only one runs at a time
let chatLock: Promise<void> = Promise.resolve();

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': '*',
    'access-control-allow-headers': '*',
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = req.url ?? '/';

  // GET /health
  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { ...corsHeaders(), 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'openduo-server' }));
    return;
  }

  // GET /tools
  if (req.method === 'GET' && url === '/tools') {
    res.writeHead(200, { ...corsHeaders(), 'content-type': 'application/json' });
    res.end(JSON.stringify({ tools: tools.definitions() }));
    return;
  }

  // POST /chat
  if (req.method === 'POST' && url === '/chat') {
    const body = await readBody(req);
    let message: string;
    try {
      message = JSON.parse(body).message;
    } catch {
      res.writeHead(400, { ...corsHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const validationError = validateChatRequest(message);

    res.writeHead(200, {
      ...corsHeaders(),
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    if (validationError) {
      res.write(`data: [ERROR] ${validationError}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Serialize chat requests via promise chain
    const previousLock = chatLock;
    let releaseLock: () => void;
    chatLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      await previousLock;
      const reactLoop = new ReactLoop(15);
      const histCopy = [...history];

      try {
        await reactLoop.run(message, histCopy, provider, tools, (token) => {
          res.write(`data: ${token}\n\n`);
        });

        // Trim history to prevent unbounded growth (keep system prompt + last 50 messages)
        if (histCopy.length > 51) {
          const system = histCopy[0];
          history = [system, ...histCopy.slice(histCopy.length - 50)];
        } else {
          history = histCopy;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[react] Error: ${msg}`);
        res.write(`data: Error: ${msg}\n\n`);
      }
    } finally {
      res.write('data: [DONE]\n\n');
      res.end();
      releaseLock!();
    }
    return;
  }

  // 404
  res.writeHead(404, { ...corsHeaders(), 'content-type': 'application/json' });
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
