/**
 * Git Data API 封装 —— 原子写入 + 远端快照。
 *
 * 见 docs/tec/03-GitHub数据层与认证.md §4.2 与 docs/tec/09-实现记录.md D-01。
 *
 * 原子提交：createBlob × N → createTree(base_tree) → createCommit(parents) → updateRef(force=false)
 * 只有最后一步会真正改变分支；前面几步只是创建游离对象，失败无副作用（垃圾对象由 GitHub 自动回收）。
 * updateRef 的 force=false 是天然 CAS：分支被其他设备推进时返回 422。
 * 空仓库（尚无任何提交）走 POST /git/refs 创建分支。
 */
import type { RemoteFileEntry } from '../model/types';
import { encodeBase64Utf8 } from '../utils/base64';
import { mapLimit } from '../utils/limit';
import type { AtomicFileWrite } from './contents';
import { GhError } from './errors';
import type { GhHttp } from './http';

export interface HeadInfo {
  commitSha: string;
  treeSha: string;
}

export interface TreeListing {
  treeSha: string;
  entries: RemoteFileEntry[];
  truncated: boolean;
}

export interface AtomicCommitInput {
  files: AtomicFileWrite[];
  message: string;
  /** 父提交；null 表示创建首个提交 */
  head: HeadInfo | null;
}

export interface AtomicCommitResult {
  commitSha: string;
  treeSha: string;
  blobShas: Record<string, string>;
  /** true 表示这是仓库的第一个提交 */
  created: boolean;
}

interface RefResponse {
  object: { sha: string };
}

interface CommitResponse {
  sha: string;
  tree: { sha: string };
}

interface BlobResponse {
  sha: string;
}

interface TreeResponse {
  sha: string;
  truncated?: boolean;
  tree: Array<{ path?: string; sha?: string; type?: string; size?: number }>;
}

export class GitDataApi {
  constructor(private readonly http: GhHttp) {}

  /**
   * 读取单个 ref：`GET /git/ref/{ref}`（单数 ref）。
   * 注意与下面的更新路径不同——GitHub 的读接口是 ref、写接口是 refs，
   * 写成同一个会让所有推送都返回 404。
   */
  private readRefPath(): string {
    return `/git/ref/heads/${encodeURIComponent(this.http.config.branch)}`;
  }

  /** 更新 ref：`PATCH /git/refs/{ref}`（复数 refs） */
  private updateRefPath(): string {
    return `/git/refs/heads/${encodeURIComponent(this.http.config.branch)}`;
  }

  /**
   * 取分支 HEAD 与根 tree。
   * 返回 null 表示「仓库存在但尚无任何提交」，需要与「仓库不存在」区分开。
   */
  async getHead(): Promise<HeadInfo | null> {
    try {
      const ref = await this.http.request<RefResponse>(this.readRefPath());
      const commitSha = ref.data.object.sha;
      const commit = await this.http.request<CommitResponse>(`/git/commits/${commitSha}`);
      return { commitSha, treeSha: commit.data.tree.sha };
    } catch (error) {
      if (error instanceof GhError && (error.kind === 'not-found' || error.kind === 'conflict')) {
        if (await this.http.repoExists()) return null;
      }
      throw error;
    }
  }

  /**
   * 一次请求列出全仓库文件及 sha（Git Trees API）。
   * 这是变更检测的核心：比逐个文件发条件请求更省额度。
   */
  async listFiles(): Promise<TreeListing> {
    const response = await this.http.request<TreeResponse>(
      `/git/trees/${encodeURIComponent(this.http.config.branch)}?recursive=1`,
    );
    const entries: RemoteFileEntry[] = [];
    for (const node of response.data.tree) {
      if (node.type !== 'blob') continue;
      if (typeof node.path !== 'string' || typeof node.sha !== 'string') continue;
      entries.push({ path: node.path, sha: node.sha, size: node.size ?? null });
    }
    return {
      treeSha: response.data.sha,
      entries,
      truncated: response.data.truncated === true,
    };
  }

  async commitAtomic(input: AtomicCommitInput): Promise<AtomicCommitResult> {
    if (input.files.length === 0) {
      throw new GhError('validation', '没有需要提交的文件');
    }

    const { head } = input;

    // 每个文件一个 blob（并发 3，保持顺序）
    const blobs = await mapLimit(input.files, 3, async (file) => {
      const response = await this.http.request<BlobResponse>('/git/blobs', {
        method: 'POST',
        body: { content: encodeBase64Utf8(file.text), encoding: 'base64' },
      });
      return { path: file.path, sha: response.data.sha };
    });

    const treeBody: Record<string, unknown> = {
      tree: blobs.map((blob) => ({
        path: blob.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      })),
    };
    // base_tree 保证未列出的文件（历史分片、README 等）不被删除
    if (head) treeBody.base_tree = head.treeSha;

    const tree = await this.http.request<TreeResponse>('/git/trees', {
      method: 'POST',
      body: treeBody,
    });

    const commitBody: Record<string, unknown> = {
      message: input.message,
      tree: tree.data.sha,
    };
    if (head) commitBody.parents = [head.commitSha];

    const commit = await this.http.request<CommitResponse>('/git/commits', {
      method: 'POST',
      body: commitBody,
    });

    if (head) {
      await this.http.request(this.updateRefPath(), {
        method: 'PATCH',
        body: { sha: commit.data.sha, force: false },
      });
    } else {
      await this.http.request('/git/refs', {
        method: 'POST',
        body: { ref: `refs/heads/${this.http.config.branch}`, sha: commit.data.sha },
      });
    }

    return {
      commitSha: commit.data.sha,
      treeSha: tree.data.sha,
      blobShas: Object.fromEntries(blobs.map((blob) => [blob.path, blob.sha])) as Record<string, string>,
      created: head === null,
    };
  }
}
