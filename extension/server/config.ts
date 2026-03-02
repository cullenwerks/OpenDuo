export type ChatProvider = 'rest' | 'graphql';

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface Config {
  gitlabUrl: string;
  pat: string;
  serverPort: number;
  chatProvider: ChatProvider;
  workspaceFolders: WorkspaceFolder[];
  proxyUrl: string | null;
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

  return { gitlabUrl, pat, serverPort, chatProvider, workspaceFolders, proxyUrl };
}
