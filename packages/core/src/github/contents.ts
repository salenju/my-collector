/**
 * 读取数据文件 —— 对应 docs/tec/03-GitHub数据层与认证.md §3
 *
 * 采用 Contents API（直接返回 base64 内容 + sha，并支持 If-None-Match 条件请求）。
 * 文件超过 1MB 时 Contents API 不返回内容，此时降级到 Git Blobs API。
 */
import { encodeBase64Utf8, decodeBase64Utf8 } from '../utils/base64';
import type { Bytes } from '../utils/bytes';
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

/**
 * 一次原子提交里要写的一个文件。
 *
 * 文本（JSON 分片/标签/meta）用 `text`，附件图片用 `bytes`——
 * 二者在 `commitAtomic` 里分别用 UTF-8 / 二进制安全的 base64 编码器处理
 * （**不能混用**：`encodeBase64Utf8` 会损坏二进制，见 utils/base64.ts）。
 */
export type AtomicFileWrite =
  | { path: string; text: string }
  | { path: string; bytes: Bytes };

/** 取该条目要写入的原始字节；调用方负责按类型选择编码器 */
export function fileWriteBytes(file: AtomicFileWrite): Bytes {
  return 'bytes' in file ? file.bytes : new TextEncoder().encode(file.text);
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

  /**
   * 读取一个文本文件；文件不存在时返回 null（而不是抛错）。
   * 用于「首次写入某个月的分片」「标签文件还没建」这类正常缺失场景。
   */
  async getTextOrNull(
    path: string,
    etag?: string | null,
    signal?: AbortSignal,
  ): Promise<FileFetchResult | null> {
    try {
      return await this.getText(path, etag, signal);
    } catch (error) {
      if (error instanceof GhError && error.kind === 'not-found') return null;
      throw error;
    }
  }

  /**
   * 读取一个二进制文件（附件图片）。
   *
   * 用 `application/vnd.github.raw` 让 Contents API 直接返回原始字节：
   *  - 没有 base64 的 33% 膨胀；
   *  - 不受「>1MB 不返回 content」的限制，因此不需要回落到 Blobs API；
   *  - 支持 Range（将来可做渐进加载）。
   * 注意这条路径**不能走 `getText`**，否则二进制会被当成 UTF-8 文本解码而损坏。
   */
  async getBytes(path: string, signal?: AbortSignal): Promise<Bytes> {
    const response = await this.http.request<never>(`/contents/${encodePath(path)}${this.refQuery()}`, {
      accept: 'application/vnd.github.raw',
      responseType: 'bytes',
      signal,
    });
    if (!response.bytes) throw new GhError('validation', `${path} 未返回字节内容`);
    return new Uint8Array(response.bytes);
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
