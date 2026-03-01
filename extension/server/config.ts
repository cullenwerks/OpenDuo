export type ChatProvider = 'rest' | 'graphql';

export interface Config {
  gitlabUrl: string;
  pat: string;
  serverPort: number;
  chatProvider: ChatProvider;
}

export function configFromEnv(): Config {
  const gitlabUrl = process.env.GITLAB_URL;
  if (!gitlabUrl) throw new Error('GITLAB_URL environment variable not set');

  const pat = process.env.GITLAB_PAT;
  if (!pat) throw new Error('GITLAB_PAT environment variable not set');

  const portStr = process.env.OPENDUO_PORT ?? '8745';
  const serverPort = parseInt(portStr, 10);
  if (isNaN(serverPort)) throw new Error('OPENDUO_PORT must be a valid port number');

  const chatProvider = (process.env.OPENDUO_CHAT_PROVIDER ?? 'rest') as ChatProvider;
  if (chatProvider !== 'rest' && chatProvider !== 'graphql') {
    throw new Error(`OPENDUO_CHAT_PROVIDER must be 'rest' or 'graphql', got '${chatProvider}'`);
  }

  return { gitlabUrl, pat, serverPort, chatProvider };
}
