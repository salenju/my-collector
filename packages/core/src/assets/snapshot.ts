/**
 * 从已有的远端快照派生图片索引 —— **不额外发任何请求**（10 文档 §4、§8）。
 *
 * `RemoteSnapshot.files` 已经是「全仓库路径 → blob sha」的本地镜像（由 Trees API 一次拿到），
 * 而 asset 的文件名本身就是它的内容 id，因此解析路径即可得到远端索引。
 */
import type { RemoteSnapshot, RepoConfig } from '../model/types';
import { parseAssetPath } from '../sync/paths';

/** 远端**原图**的 asset id 集合（缩略图不算，避免"只有缩略图"被误判为原图存在） */
export function remoteAssetIds(snapshot: RemoteSnapshot | null, cfg: RepoConfig): Set<string> {
  const ids = new Set<string>();
  for (const path of Object.keys(snapshot?.files ?? {})) {
    const parsed = parseAssetPath(cfg, path);
    if (parsed && !parsed.thumb) ids.add(parsed.id);
  }
  return ids;
}

/** 远端已存在的图片文件路径集合（collectPending 用它跳过重复上传） */
export function remoteAssetPaths(snapshot: RemoteSnapshot | null): Set<string> {
  return new Set(Object.keys(snapshot?.files ?? {}));
}

export interface AssetUsage {
  /** 图片张数（按原图计，缩略图不单独计数） */
  count: number;
  /** 原图 + 缩略图的总字节数 */
  bytes: number;
}

/**
 * 数据仓库里的图片占用 —— 用 Trees 响应自带的 `size` 求和，零额外请求。
 * 超过 800MB 时设置页会提示（10 文档 §9.4）。
 */
export function remoteAssetUsage(snapshot: RemoteSnapshot | null, cfg: RepoConfig): AssetUsage {
  let count = 0;
  let bytes = 0;
  for (const [path, size] of Object.entries(snapshot?.sizes ?? {})) {
    const parsed = parseAssetPath(cfg, path);
    if (!parsed) continue;
    bytes += size;
    if (!parsed.thumb) count += 1;
  }
  return { count, bytes };
}

/** 仓库体积告警阈值（GitHub 建议仓库 < 1GB） */
export const ASSET_USAGE_WARN_BYTES = 800 * 1024 * 1024;

/** 人类可读的体积 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
