/**
 * 读取数据文件 —— 对应 docs/tec/03-GitHub数据层与认证.md §3
 *
 * 采用 Contents API（直接返回 base64 内容 + sha，并支持 If-None-Match 条件请求）。
 * 文件超过 1MB 时 Contents API 不返回内容，此时降级到 Git Blobs API。
 */
import { encodeBase64Utf8, decodeBase64Utf8 } from '../utils/base64';
import { GhError } from './errors';
import { encodePath, type GhHttp } from './http';

interface ContentsFileResponse {
  type: string;
  sha: string;
  size: number;
  content?: string;
  encoding?: string;
}

interface BlobResponse {
  sha: string;
  size: number;
  content?: string;
  encoding?: string;
}

export interface FileFetchResult {
  /** true 表示远端未变更（304），调用方应沿用本地数据 */
  notModified: boolean;
  sha: string | null;
  etag: string | null;
  text: string | null;
  size: number | null;
}

export interface AtomicFileWrite {
  path: string;
  text: string;
}

export class ContentsApi {
  constructor(private readonly http: GhHttp) {}

  private refQuery(): string {
    return `?ref=${encodeURIComponent(this.http.config.branch)}`;
  }

  /**
   * 读取一个文本文件。
   * @param path 仓库内相对路径，如 data/meta.json
   * @param etag 本地缓存的 etag，命中则返回 notModified
   */
  async getText(path: string, etag?: string | null, signal?: AbortSignal): Promise<FileFetchResult> {
    const response = await this.http.request<ContentsFileResponse | ContentsFileResponse[]>(
      `/contents/${encodePath(path)}${this.refQuery()}`,
      { etag: etag ?? null, signal },
    );

    if (response.status === 304) {
      return { notModified: true, sha: null, etag: response.etag, text: null, size: null };
    }

    const payload = response.data;
    if (Array.isArray(payload)) {
      throw new GhError('validation', `${path} 是目录，不是文件`);
    }

    if (typeof payload.content === 'string' && payload.content.length > 0) {
      return {
        notModified: false,
        sha: payload.sha,
        etag: response.etag,
        text: decodeBase64Utf8(payload.content),
        size: payload.size,
      };
    }

    // 大文件（>1MB）：Contents API 只给 sha，回落到 Blobs API（上限 100MB）
    const blob = await this.http.request<BlobResponse>(`/git/blobs/${payload.sha}`, { signal });
    return {
      notModified: false,
      sha: payload.sha,
      etag: response.etag,
      text: typeof blob.data.content === 'string' ? decodeBase64Utf8(blob.data.content) : null,
      size: payload.size,
    };
  }

  /** 文件是否存在（用于区分「未初始化」与「网络问题」） */
  async exists(path: string): Promise<boolean> {
    try {
      await this.getText(path);
      return true;
    } catch (error) {
      if (error instanceof GhError && error.kind === 'not-found') return false;
      throw error;
    }
  }

  /** 单文件写入（仅用于极少见的场景，正常提交走 GitDataApi 原子提交） */
  async putText(path: string, text: string, message: string, sha?: string | null): Promise<string> {
    const body: Record<string, unknown> = {
      message,
      content: encodeBase64Utf8(text),
      branch: this.http.config.branch,
    };
    if (sha) body.sha = sha;

    const response = await this.http.request<{ content: { sha: string } }>(
      `/contents/${encodePath(path)}`,
      { method: 'PUT', body },
    );
    return response.data.content.sha;
  }
}
