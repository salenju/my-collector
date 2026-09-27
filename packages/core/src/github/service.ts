/**
 * 面向应用层的 GitHub 门面：连接测试 + 暴露 contents / git 两个 API。
 * 错误提示文案见 docs/tec/03-GitHub数据层与认证.md §1.3。
 */
import type { RepoConfig } from '../model/types';
import { metaPath, monthFromShardPath } from '../sync/paths';
import { ContentsApi } from './contents';
import { humanMessage, isGhError, type GhErrorKind } from './errors';
import { GitDataApi, type HeadInfo } from './gitData';
import { GhHttp } from './http';

export interface RepoInfo {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  canPush: boolean;
}

export interface ConnectionReport {
  ok: boolean;
  kind?: GhErrorKind;
  message: string;
  repo: RepoInfo | null;
  /** data/meta.json 是否存在；false 表示需要初始化 */
  initialized: boolean;
  /** 远端分片文件数 */
  shardCount: number;
  headSha: string | null;
  warnings: string[];
}

interface RepoResponse {
  full_name: string;
  private: boolean;
  default_branch: string;
  permissions?: { push?: boolean; admin?: boolean };
}

export class GithubService {
  readonly contents: ContentsApi;
  readonly git: GitDataApi;
  readonly http: GhHttp;

  constructor(http: GhHttp) {
    this.http = http;
    this.contents = new ContentsApi(http);
    this.git = new GitDataApi(http);
  }

  get config(): RepoConfig {
    return this.http.config;
  }

  async getRepo(): Promise<RepoInfo> {
    const response = await this.http.request<RepoResponse>('');
    const data = response.data;
    return {
      fullName: data.full_name,
      isPrivate: data.private,
      defaultBranch: data.default_branch,
      // Fine-grained PAT 有时不返回 permissions，缺失时不做否定判断
      canPush: data.permissions?.push !== false,
    };
  }

  /** 设置页「测试连接」按钮的实现 */
  async testConnection(): Promise<ConnectionReport> {
    const warnings: string[] = [];
    let repo: RepoInfo | null = null;

    try {
      repo = await this.getRepo();
    } catch (error) {
      return {
        ok: false,
        kind: isGhError(error) ? error.kind : 'unknown',
        message: isGhError(error) ? humanMessage(error) : String(error),
        repo: null,
        initialized: false,
        shardCount: 0,
        headSha: null,
        warnings,
      };
    }

    if (!repo.isPrivate) {
      warnings.push('数据仓库当前是 Public，你的所有收藏将对任何人可见，建议改为 Private。');
    }
    if (!repo.canPush) {
      warnings.push('令牌似乎没有写入权限，请确认已勾选 Contents: Read and write。');
    }
    if (repo.defaultBranch !== this.http.config.branch) {
      warnings.push(
        `仓库默认分支是 ${repo.defaultBranch}，当前配置为 ${this.http.config.branch}，请确认两者一致。`,
      );
    }

    let head: HeadInfo | null = null;
    let initialized = false;
    let shardCount = 0;

    try {
      head = await this.git.getHead();
      if (head) {
        const listing = await this.git.listFiles();
        shardCount = listing.entries.filter(
          (entry) => monthFromShardPath(this.http.config, entry.path) !== null,
        ).length;
        initialized = listing.entries.some((entry) => entry.path === metaPath(this.http.config));
        if (listing.truncated) {
          warnings.push('仓库文件数量过多，GitHub 返回的文件列表被截断。');
        }
      }
    } catch (error) {
      if (!isGhError(error)) throw error;
      return {
        ok: false,
        kind: error.kind,
        message: humanMessage(error),
        repo,
        initialized: false,
        shardCount: 0,
        headSha: null,
        warnings,
      };
    }

    const parts: string[] = ['连接成功'];
    if (!head) {
      parts.push('数据仓库是空的，等待初始化');
    } else {
      parts.push(`已发现 ${shardCount} 个数据分片`);
      if (!initialized) parts.push('但缺少 meta.json，建议重新初始化');
    }

    return {
      ok: true,
      message: `${parts.join('，')}。`,
      repo,
      initialized,
      shardCount,
      headSha: head?.commitSha ?? null,
      warnings,
    };
  }
}
