import { privateTokenHeaders } from './auth';
import { classifyError, formatCauseChain, type Config, type DebugFlags } from './config';

export class GitLabClient {
  private readonly baseUrl: string;
  private readonly pat: string;
  private readonly debug: DebugFlags;
  private readonly hasProxy: boolean;

  constructor(config: Config) {
    this.baseUrl = config.gitlabUrl.replace(/\/+$/, '');
    this.pat = config.pat;
    this.debug = config.debug;
    this.hasProxy = !!config.proxyUrl;
  }

  apiUrl(path: string): string {
    return `${this.baseUrl}/api/v4/${path.replace(/^\/+/, '')}`;
  }

  private debugLog(context: string, err: unknown): void {
    const categories = classifyError(err, this.hasProxy);
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as any)?.code ?? '';
    const stack = err instanceof Error ? err.stack ?? '' : '';
    const causeChain = formatCauseChain(err);

    for (const cat of categories) {
      if (this.debug[cat]) {
        console.log(`[${cat}] [gitlabClient] ${context}: ${msg}${code ? ` (code=${code})` : ''}`);
        if (causeChain) console.log(`[${cat}] [gitlabClient] cause chain:\n${causeChain}`);
        if (stack) console.log(`[${cat}] [gitlabClient] stack: ${stack}`);
      }
    }
    if (categories.length === 0 && this.debug.serverErrors) {
      console.log(`[serverErrors] [gitlabClient] ${context}: ${msg}`);
      if (causeChain) console.log(`[serverErrors] [gitlabClient] cause chain:\n${causeChain}`);
    }
  }

  private logApiError(method: string, url: string, status: number, body: string): void {
    if (this.debug.apiErrors) {
      console.log(`[apiErrors] [gitlabClient] ${method} ${url}: HTTP ${status}`);
      console.log(`[apiErrors] [gitlabClient] response body: ${body.slice(0, 2000)}`);
    }
  }

  async get<T = unknown>(path: string): Promise<T> {
    const url = this.apiUrl(path);
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: privateTokenHeaders(this.pat),
      });
    } catch (err) {
      this.debugLog(`GET ${url}`, err);
      throw err;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.logApiError('GET', path, resp.status, text);
      throw new Error(`GitLab API GET ${path} returned ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<T>;
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const url = this.apiUrl(path);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: privateTokenHeaders(this.pat),
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.debugLog(`POST ${url}`, err);
      throw err;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.logApiError('POST', path, resp.status, text);
      throw new Error(`GitLab API POST ${path} returned ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<T>;
  }

  async put<T = unknown>(path: string, body: unknown): Promise<T> {
    const url = this.apiUrl(path);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'PUT',
        headers: privateTokenHeaders(this.pat),
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.debugLog(`PUT ${url}`, err);
      throw err;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.logApiError('PUT', path, resp.status, text);
      throw new Error(`GitLab API PUT ${path} returned ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<T>;
  }

  async getRaw(url: string): Promise<string> {
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: privateTokenHeaders(this.pat),
      });
    } catch (err) {
      this.debugLog(`GET (raw) ${url}`, err);
      throw err;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.logApiError('GET', url, resp.status, text);
      throw new Error(`GitLab API GET ${url} returned ${resp.status}: ${text}`);
    }
    return resp.text();
  }

  async delete<T = unknown>(path: string): Promise<T> {
    const url = this.apiUrl(path);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'DELETE',
        headers: privateTokenHeaders(this.pat),
      });
    } catch (err) {
      this.debugLog(`DELETE ${url}`, err);
      throw err;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.logApiError('DELETE', path, resp.status, text);
      throw new Error(`GitLab API DELETE ${path} returned ${resp.status}: ${text}`);
    }
    // DELETE often returns 204 No Content
    if (resp.status === 204) return {} as T;
    return resp.json() as Promise<T>;
  }

  async postStream(url: string, body: unknown): Promise<Response> {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: privateTokenHeaders(this.pat),
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.debugLog(`POST (stream) ${url}`, err);
      throw err;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.logApiError('POST', url, resp.status, text);
      throw new Error(`GitLab API POST stream ${url} returned ${resp.status}: ${text}`);
    }
    return resp;
  }

  /**
   * Execute a GraphQL query against GitLab's `/api/graphql` endpoint.
   * Returns the `data` portion of the response, or throws on errors.
   */
  async graphql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/graphql`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: privateTokenHeaders(this.pat),
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      this.debugLog(`POST ${url} (graphql)`, err);
      throw err;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      this.logApiError('POST', url, resp.status, text);
      throw new Error(`GitLab GraphQL returned ${resp.status}: ${text}`);
    }
    const json = (await resp.json()) as {
      data?: T;
      errors?: { message: string }[];
    };
    if (json.errors?.length) {
      if (this.debug.apiErrors) {
        console.log(`[apiErrors] [gitlabClient] GraphQL errors: ${JSON.stringify(json.errors)}`);
      }
      throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    return json.data as T;
  }
}
