import { privateTokenHeaders } from './auth';
import type { Config } from './config';

export class GitLabClient {
  private readonly baseUrl: string;
  private readonly pat: string;

  constructor(config: Config) {
    this.baseUrl = config.gitlabUrl.replace(/\/+$/, '');
    this.pat = config.pat;
  }

  apiUrl(path: string): string {
    return `${this.baseUrl}/api/v4/${path.replace(/^\/+/, '')}`;
  }

  async get<T = unknown>(path: string): Promise<T> {
    const resp = await fetch(this.apiUrl(path), {
      headers: privateTokenHeaders(this.pat),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`GitLab API GET ${path} returned ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<T>;
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(this.apiUrl(path), {
      method: 'POST',
      headers: privateTokenHeaders(this.pat),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`GitLab API POST ${path} returned ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<T>;
  }

  async put<T = unknown>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(this.apiUrl(path), {
      method: 'PUT',
      headers: privateTokenHeaders(this.pat),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`GitLab API PUT ${path} returned ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<T>;
  }

  async getRaw(url: string): Promise<string> {
    const resp = await fetch(url, {
      headers: privateTokenHeaders(this.pat),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`GitLab API GET ${url} returned ${resp.status}: ${text}`);
    }
    return resp.text();
  }

  async delete<T = unknown>(path: string): Promise<T> {
    const resp = await fetch(this.apiUrl(path), {
      method: 'DELETE',
      headers: privateTokenHeaders(this.pat),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`GitLab API DELETE ${path} returned ${resp.status}: ${text}`);
    }
    // DELETE often returns 204 No Content
    if (resp.status === 204) return {} as T;
    return resp.json() as Promise<T>;
  }

  async postStream(url: string, body: unknown): Promise<Response> {
    const resp = await fetch(url, {
      method: 'POST',
      headers: privateTokenHeaders(this.pat),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
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
    const resp = await fetch(url, {
      method: 'POST',
      headers: privateTokenHeaders(this.pat),
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`GitLab GraphQL returned ${resp.status}: ${text}`);
    }
    const json = (await resp.json()) as {
      data?: T;
      errors?: { message: string }[];
    };
    if (json.errors?.length) {
      throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    return json.data as T;
  }
}
