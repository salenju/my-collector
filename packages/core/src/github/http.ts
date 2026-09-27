/**
 * GitHub REST API 的薄封装（基于 fetch）。
 *
 * 设计说明（对 03 文档的偏离已记录在 09-实现记录.md）：
 * 本方案只用 7 个端点，且强依赖 ETag、CAS、限流头部等细节，
 * 因此不用 @octokit/*，改为手写薄封装——体积更小、行为完全可控。
 * 错误语义仍严格按 03 文档 §2 的 GhErrorKind 翻译。
 */
import type { RepoConfig } from '../model/types';
import type { AuthProvider } from './auth';
import { GhError } from './errors';

export const GH_API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export type GhMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface GhResponse<T> {
  status: number;
  data: T;
  etag: string | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: number | null;
}

export interface GhRequestInit {
  method?: GhMethod;
  token?: string | null;
  body?: unknown;
  /** 条件请求：命中则返回 304 且不计入限流额度 */
  etag?: string | null;
  signal?: AbortSignal;
}

function numHeader(response: Response, name: string): number | null {
  const raw = response.headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function extractMessage(payload: unknown): string | null {
  if (typeof payload === 'string' && payload) return payload.slice(0, 300);
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return null;
}

function buildError(
  status: number,
  path: string,
  payload: unknown,
  response: Response,
  remaining: number | null,
  resetAt: number | null,
): GhError {
  const message = extractMessage(payload) ?? `GitHub 返回 ${status}`;

  if (status === 401) return new GhError('auth', message, { status });

  if (status === 403 || status === 429) {
    const retryAfterHeader = Number(response.headers.get('retry-after'));
    const fromHeader = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : null;
    if (remaining === 0 || status === 429 || fromHeader !== null) {
      const fromReset = resetAt === null ? null : Math.max(1000, resetAt - Date.now());
      return new GhError('rate-limit', message, {
        status,
        retryAfterMs: fromHeader ?? fromReset ?? 60_000,
      });
    }
    return new GhError('forbidden', message, { status });
  }

  if (status === 404) return new GhError('not-found', message, { status });
  if (status === 409) return new GhError('conflict', message, { status });
  if (status === 422) {
    const kind = path.includes('/git/') ? 'conflict' : 'validation';
    return new GhError(kind, message, { status });
  }
  if (status >= 500) return new GhError('server', message, { status });
  return new GhError('unknown', message, { status });
}

export async function ghRequest<T>(path: string, init: GhRequestInit = {}): Promise<GhResponse<T>> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': API_VERSION,
  };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.etag) headers['if-none-match'] = init.etag;

  let response: Response;
  try {
    response = await fetch(`${GH_API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      cache: 'no-store',
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new GhError('network', `无法连接 GitHub：${String(cause)}`, { cause });
  }

  const remaining = numHeader(response, 'x-ratelimit-remaining');
  const resetSeconds = numHeader(response, 'x-ratelimit-reset');
  const resetAt = resetSeconds === null ? null : resetSeconds * 1000;
  const etag = response.headers.get('etag');

  if (response.status === 304) {
    return { status: 304, data: undefined as T, etag, rateLimitRemaining: remaining, rateLimitResetAt: resetAt };
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw buildError(response.status, path, payload, response, remaining, resetAt);
  }

  return { status: response.status, data: payload as T, etag, rateLimitRemaining: remaining, rateLimitResetAt: resetAt };
}

/** 路径片段编码：保留 `/`，其余逐段编码 */
export function encodePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * 绑定认证与仓库配置的请求器。
 * 配置是动态的（用户可在设置页换仓库），因此用 getter 而非快照。
 */
export class GhHttp {
  constructor(
    private readonly auth: AuthProvider,
    private readonly getConfig: () => RepoConfig,
  ) {}

  get config(): RepoConfig {
    return this.getConfig();
  }

  /** 生成 /repos/{owner}/{repo} 前缀的路径 */
  repoPath(suffix: string): string {
    const { owner, repo } = this.config;
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
  }

  async request<T>(suffix: string, init: Omit<GhRequestInit, 'token'> = {}): Promise<GhResponse<T>> {
    const token = (await this.auth.isConfigured()) ? await this.auth.getToken() : null;
    return ghRequest<T>(this.repoPath(suffix), { ...init, token });
  }

  /** 用于探测仓库是否存在（不抛 not-found） */
  async repoExists(): Promise<boolean> {
    try {
      await this.request('', { method: 'GET' });
      return true;
    } catch (error) {
      if (error instanceof GhError && error.kind === 'not-found') return false;
      throw error;
    }
  }
}
