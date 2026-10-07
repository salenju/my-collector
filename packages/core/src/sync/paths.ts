/**
 * 数据仓库内的路径规则。全部路径都由 dataDir 派生，不硬编码。
 */
import type { RepoConfig } from '../model/types';

export const ITEMS_DIR = 'items';
export const ASSETS_DIR = 'assets';

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

// ─────────────────────────── 附件图片（10 文档 §3.2）───────────────────────────

/**
 * `data/assets/<id 前两位>/<id>.<ext>`
 *
 * 两级目录：单目录堆几千个文件对 Git 与 GitHub 网页端都不友好，按 id 前两位分桶后分布均匀。
 * 缩略图沿用**原图**的 id 加 `.thumb` 后缀——它是确定的派生结果，1:1 对应原图，便于反查。
 */
export function assetsPrefix(cfg: RepoConfig): string {
  return `${cfg.dataDir}/${ASSETS_DIR}/`;
}

export function assetBucket(id: string): string {
  return id.slice(0, 2);
}

export function assetPath(cfg: RepoConfig, id: string, ext: string): string {
  return `${assetsPrefix(cfg)}${assetBucket(id)}/${id}.${ext}`;
}

export function assetThumbPath(cfg: RepoConfig, id: string, ext: string): string {
  return `${assetsPrefix(cfg)}${assetBucket(id)}/${id}.thumb.${ext}`;
}

/**
 * `<32 位 hex>` + 可选 `.thumb` + 扩展名；只允许一级目录。
 *
 * 扩展名用**白名单**（我们只会写 jpg / png）：否则 `<id>.thumb` 会被解析成
 * 「扩展名为 thumb 的原图」，让远端索引误判成"原图已存在"，从而跳过本该上传的原图。
 */
const ASSET_FILE_RE = /^([0-9a-f]{32})(\.thumb)?\.(jpe?g|png)$/;

export interface ParsedAssetPath {
  id: string;
  thumb: boolean;
  ext: string;
}

/**
 * 从仓库路径反解资产信息；**不是**资产文件一律返回 null（不抛错）。
 * 手工往 assets/ 里放的文件若不符合命名规则会被忽略，从而不会污染远端索引。
 */
export function parseAssetPath(cfg: RepoConfig, path: string): ParsedAssetPath | null {
  const prefix = assetsPrefix(cfg);
  if (!path.startsWith(prefix)) return null;

  const rest = path.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash === -1) return null;

  const bucket = rest.slice(0, slash);
  const fileName = rest.slice(slash + 1);
  if (fileName.includes('/')) return null;

  const match = ASSET_FILE_RE.exec(fileName);
  if (!match) return null;

  const [, id, thumbSuffix, ext] = match;
  if (!id || !ext) return null;
  // 分桶必须与 id 一致，否则说明是手工放错目录的文件
  if (bucket !== assetBucket(id)) return null;

  return { id, thumb: thumbSuffix !== undefined, ext };
}

/** 只要 id（pull 侧构建远端索引）；缩略图与原图返回同一个 id */
export function assetIdFromPath(cfg: RepoConfig, path: string): string | null {
  return parseAssetPath(cfg, path)?.id ?? null;
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
