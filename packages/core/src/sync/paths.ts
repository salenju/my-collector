/**
 * 数据仓库内的路径规则。全部路径都由 dataDir 派生，不硬编码。
 */
import type { RepoConfig } from '../model/types';

export const ITEMS_DIR = 'items';

export function metaPath(cfg: RepoConfig): string {
  return `${cfg.dataDir}/meta.json`;
}

export function tagsPath(cfg: RepoConfig): string {
  return `${cfg.dataDir}/tags.json`;
}

export function itemsPrefix(cfg: RepoConfig): string {
  return `${cfg.dataDir}/${ITEMS_DIR}/`;
}

export function shardPath(cfg: RepoConfig, month: string): string {
  return `${itemsPrefix(cfg)}${month}.json`;
}

/** 从仓库路径反解月份；不是分片文件则返回 null */
export function monthFromShardPath(cfg: RepoConfig, path: string): string | null {
  const prefix = itemsPrefix(cfg);
  if (!path.startsWith(prefix) || !path.endsWith('.json')) return null;
  const month = path.slice(prefix.length, -'.json'.length);
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

/** 提交历史页地址，便于在 UI 上提供「查看 Git 历史」 */
export function fileHistoryUrl(cfg: RepoConfig, path: string): string {
  return `https://github.com/${cfg.owner}/${cfg.repo}/commits/${cfg.branch}/${path}`;
}

export function commitUrl(cfg: RepoConfig, sha: string): string {
  return `https://github.com/${cfg.owner}/${cfg.repo}/commit/${sha}`;
}

export function repoUrl(cfg: RepoConfig): string {
  return `https://github.com/${cfg.owner}/${cfg.repo}`;
}
