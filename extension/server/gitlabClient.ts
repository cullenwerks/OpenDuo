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
}
