export type ChatProvider = 'rest' | 'graphql';

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface DebugFlags {
  networkErrors: boolean;
  sslErrors: boolean;
  proxyErrors: boolean;
  apiErrors: boolean;
  webSocketErrors: boolean;
  serverErrors: boolean;
}

export interface Config {
  gitlabUrl: string;
  pat: string;
  serverPort: number;
  chatProvider: ChatProvider;
  workspaceFolders: WorkspaceFolder[];
  proxyUrl: string | null;
  rejectUnauthorized: boolean;
  customCaCertPath: string | null;
  debug: DebugFlags;
}

/**
 * Classify an error into one or more debug categories so callers can decide
 * whether to emit verbose diagnostics based on the user's debug settings.
 */
export type ErrorCategory = keyof DebugFlags;

const SSL_PATTERNS = [
  'certificate', 'CERT_', 'SSL', 'TLS', 'self signed', 'self-signed',
  'UNABLE_TO_VERIFY', 'ERR_TLS', 'DEPTH_ZERO', 'UNABLE_TO_GET_ISSUER',
];
const NETWORK_PATTERNS = [
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETUNREACH', 'EAI_AGAIN', 'connect', 'timeout', 'DNS', 'fetch failed',
];
const PROXY_PATTERNS = ['proxy', 'ECONNREFUSED', 'tunnel'];

/**
 * Collect the full text of an error including its `.cause` chain.
 * Node.js's undici wraps the real error (SSL, DNS, etc.) inside
 * `TypeError: fetch failed` with the actual error in `.cause`.
 * We must walk the chain to find the real error for classification.
 */
function collectErrorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof Error) {
      parts.push(`${current.message} ${(current as any).code ?? ''}`);
      current = (current as any).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' ');
}

/**
 * Format the full cause chain of an error for diagnostic output.
 * Returns a human-readable string showing each nested cause.
 */
export function formatCauseChain(err: unknown): string {
  const lines: string[] = [];
  let current: unknown = err;
  let depth = 0;
  while (current instanceof Error && depth < 5) {
    const code = (current as any).code ? ` [${(current as any).code}]` : '';
    lines.push(`${'  '.repeat(depth)}${current.constructor.name}: ${current.message}${code}`);
    current = (current as any).cause;
    depth++;
  }
  if (current && !(current instanceof Error)) {
    lines.push(`${'  '.repeat(depth)}${String(current)}`);
  }
  return lines.join('\n');
}

export function classifyError(err: unknown, proxyConfigured: boolean): ErrorCategory[] {
  const text = collectErrorText(err);
  const upper = text.toUpperCase();
  const categories: ErrorCategory[] = [];
  if (SSL_PATTERNS.some(p => upper.includes(p.toUpperCase()))) categories.push('sslErrors');
  if (NETWORK_PATTERNS.some(p => upper.includes(p.toUpperCase()))) categories.push('networkErrors');
  if (proxyConfigured && PROXY_PATTERNS.some(p => upper.includes(p.toUpperCase()))) categories.push('proxyErrors');
  return categories;
}

export function configFromEnv(): Config {
  const gitlabUrl = process.env.GITLAB_URL;
  if (!gitlabUrl) throw new Error('GITLAB_URL environment variable not set');

  // Validate URL scheme — only HTTPS (and http://localhost for local dev)
  try {
    const parsed = new URL(gitlabUrl);
    const isLocalDev = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalDev)) {
      throw new Error('GITLAB_URL must use HTTPS (or http://localhost for local development)');
    }
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`GITLAB_URL is not a valid URL: ${gitlabUrl}`);
    throw e;
  }

  const pat = process.env.GITLAB_PAT;
  if (!pat) throw new Error('GITLAB_PAT environment variable not set');

  const portStr = process.env.OPENDUO_PORT ?? '8745';
  const serverPort = parseInt(portStr, 10);
  if (isNaN(serverPort) || serverPort < 1024 || serverPort > 65535) {
    throw new Error('OPENDUO_PORT must be a valid port number (1024–65535)');
  }

  const chatProvider = (process.env.OPENDUO_CHAT_PROVIDER ?? 'rest') as ChatProvider;
  if (chatProvider !== 'rest' && chatProvider !== 'graphql') {
    throw new Error(`OPENDUO_CHAT_PROVIDER must be 'rest' or 'graphql', got '${chatProvider}'`);
  }

  let workspaceFolders: WorkspaceFolder[] = [];
  const foldersJson = process.env.OPENDUO_WORKSPACE_FOLDERS;
  if (foldersJson) {
    try {
      workspaceFolders = JSON.parse(foldersJson);
    } catch {
      console.warn('[config] Invalid OPENDUO_WORKSPACE_FOLDERS JSON, ignoring');
    }
  }

  // Proxy: passed from the VS Code extension via HTTP_PROXY / HTTPS_PROXY env vars.
  // The extension reads the proxy from VS Code's own http.proxy setting (not the OS),
  // so the child process receives the right value here rather than the system proxy.
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    null;

  const rejectUnauthorized = process.env.OPENDUO_REJECT_UNAUTHORIZED !== '0';
  const customCaCertPath = process.env.OPENDUO_CA_CERT || null;

  const envBool = (key: string): boolean => process.env[key] === '1';
  const debug: DebugFlags = {
    networkErrors: envBool('OPENDUO_DEBUG_NETWORK'),
    sslErrors: envBool('OPENDUO_DEBUG_SSL'),
    proxyErrors: envBool('OPENDUO_DEBUG_PROXY'),
    apiErrors: envBool('OPENDUO_DEBUG_API'),
    webSocketErrors: envBool('OPENDUO_DEBUG_WEBSOCKET'),
    serverErrors: envBool('OPENDUO_DEBUG_SERVER'),
  };

  return {
    gitlabUrl, pat, serverPort, chatProvider, workspaceFolders,
    proxyUrl, rejectUnauthorized, customCaCertPath, debug,
  };
}
