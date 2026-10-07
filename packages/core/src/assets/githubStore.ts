/**
 * 附件图片的 GitHub 实现（10 文档 §5.1）。
 *
 * 三条链路：
 *  - **写入**：压缩 → 内容寻址 → 落本地待上传表；真正的上传由同步引擎在提交时调用
 *    `collectPending` 取字节，与条目 JSON 一起进同一次原子提交（§6.5）；
 *  - **读取**：本地缓存命中即用；未命中时带鉴权拉原始字节（§5.3），
 *    因为数据仓库是 Private，`raw.githubusercontent.com` 的裸 `<img>` 请求拿不到授权；
 *  - **维护**：清理未被引用的待上传对象、按预算做 LRU 淘汰。
 */
import type { AtomicFileWrite } from '../github/contents';
import { GhError } from '../github/errors';
import type { GithubService } from '../github/service';
import {
  ASSET_LIMITS,
  type AssetsSettings,
  type ItemAsset,
  type RemoteSnapshot,
  type RepoConfig,
} from '../model/types';
import { assetKey, type AssetRow, type CollectorDb } from '../store/schema';
import { assetPath, assetThumbPath } from '../sync/paths';
import {
  assetCacheBytes,
  assetCacheCount,
  evictAssetCache,
  ObjectUrlRegistry,
  touchAsset,
} from './cache';
import { createDefaultCodec } from './codec';
import { assetIdOfBytes } from './hash';
import { checkSource, extFor, pastedFileName, prepareAsset, sanitizeName, type ImageCodec } from './image';
import { formatBytes, remoteAssetPaths } from './snapshot';
import type { AssetCacheUsage, AssetService, AssetVariant, StageInput } from './types';

export interface GithubAssetStoreOptions {
  db: CollectorDb;
  github: GithubService;
  getConfig: () => RepoConfig;
  getSettings: () => AssetsSettings;
  /** 可注入编解码器（测试用假实现；浏览器里默认走 canvas） */
  codec?: ImageCodec;
}

export class GithubAssetStore implements AssetService {
  private readonly db: CollectorDb;
  private readonly github: GithubService;
  private readonly getConfig: () => RepoConfig;
  private readonly getSettings: () => AssetsSettings;
  private readonly codec: ImageCodec;
  private readonly urls = new ObjectUrlRegistry();
  private persistRequested = false;

  constructor(options: GithubAssetStoreOptions) {
    this.db = options.db;
    this.github = options.github;
    this.getConfig = options.getConfig;
    this.getSettings = options.getSettings;
    this.codec = options.codec ?? createDefaultCodec();
  }

  // ────────────────────────────── 写入 ──────────────────────────────

  async stage(input: StageInput): Promise<ItemAsset> {
    const { file } = input;
    const check = checkSource({ type: file.type, size: file.size });
    if (!check.ok) throw new Error(check.reason ?? '无法添加这张图片');

    const prepared = await prepareAsset(file, this.getSettings(), this.codec);
    const stored = prepared.original.bytes.byteLength;
    if (stored > ASSET_LIMITS.maxStoredBytes) {
      throw new Error(`压缩后仍有 ${formatBytes(stored)}，超过单张上限，请先裁剪或降低画质。`);
    }

    const id = await assetIdOfBytes(prepared.original.bytes);
    const now = new Date();
    const at = now.toISOString();
    const mime = prepared.original.mime;
    const name = sanitizeName(
      input.name,
      input.fromClipboard ? pastedFileName(mime, now) : `image.${extFor(mime)}`,
    );

    // 同一张图重复添加：内容寻址下路径必然相同 → 不必重写（也不会产生新的上传）
    const existing = await this.db.assets.get(assetKey(id, 'original'));
    if (!existing) {
      const base = { sha: id, name, status: 'pending' as const, at, lastAccessAt: now.getTime() };
      const rows: AssetRow[] = [
        {
          ...base,
          key: assetKey(id, 'original'),
          kind: 'original',
          mime,
          bytes: stored,
          blob: new Blob([prepared.original.bytes], { type: mime }),
          width: prepared.original.width,
          height: prepared.original.height,
        },
        {
          ...base,
          key: assetKey(id, 'thumb'),
          kind: 'thumb',
          mime: prepared.thumb.mime,
          bytes: prepared.thumb.bytes.byteLength,
          blob: new Blob([prepared.thumb.bytes], { type: prepared.thumb.mime }),
          width: prepared.thumb.width,
          height: prepared.thumb.height,
        },
      ];
      await this.db.assets.bulkPut(rows);
      void this.requestPersistence();
    }

    return {
      id,
      name,
      size: stored,
      width: prepared.original.width,
      height: prepared.original.height,
      mime,
    };
  }

  async collectPending(
    ids: readonly string[],
    snapshot: RemoteSnapshot | null,
  ): Promise<AtomicFileWrite[]> {
    const cfg = this.getConfig();
    const remote = remoteAssetPaths(snapshot);
    const files: AtomicFileWrite[] = [];
    const seen = new Set<string>();

    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const original = await this.db.assets.get(assetKey(id, 'original'));
      if (!original?.blob) continue;

      const candidates: Array<{ path: string; row: AssetRow }> = [
        { path: assetPath(cfg, id, extFor(original.mime)), row: original },
      ];
      const thumb = await this.db.assets.get(assetKey(id, 'thumb'));
      if (thumb?.blob) {
        candidates.push({ path: assetThumbPath(cfg, id, extFor(thumb.mime)), row: thumb });
      }

      for (const candidate of candidates) {
        if (remote.has(candidate.path)) continue; // 远端已有 → 不重复上传
        const blob = candidate.row.blob;
        if (!blob) continue;
        files.push({ path: candidate.path, bytes: new Uint8Array(await blob.arrayBuffer()) });
      }
    }

    return files;
  }

  async markPublished(ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return;
    const rows = await this.db.assets.where('sha').anyOf(unique).toArray();
    const stale = rows.filter((row) => row.status !== 'uploaded');
    if (stale.length === 0) return;
    await this.db.transaction('rw', this.db.assets, async () => {
      for (const row of stale) await this.db.assets.update(row.key, { status: 'uploaded' });
    });
  }

  // ────────────────────────────── 读取 ──────────────────────────────

  async resolve(asset: ItemAsset, variant: AssetVariant = 'original'): Promise<string> {
    // 图床实现会把直链写进 asset.url；GitHub 实现永远不写，因此下面走"带鉴权取字节"
    if (asset.url) return asset.url;

    const key = assetKey(asset.id, variant);
    let row = await this.db.assets.get(key);

    if (!row?.blob) {
      const blob = await this.fetchBlob(asset, variant);
      const next: AssetRow = {
        key,
        sha: asset.id,
        kind: variant,
        mime: asset.mime,
        bytes: blob.size,
        blob,
        // 缩略图从远端取回时不知道像素尺寸；UI 用条目里的元信息做比例占位
        width: variant === 'original' ? asset.width : 0,
        height: variant === 'original' ? asset.height : 0,
        name: asset.name,
        status: 'uploaded',
        at: new Date().toISOString(),
        lastAccessAt: Date.now(),
      };
      await this.db.assets.put(next);
      row = next;
      await evictAssetCache(this.db, this.getSettings().cacheBudgetBytes);
    } else {
      void touchAsset(this.db, asset.id, variant);
    }

    const blob = row.blob;
    if (!blob) throw new Error(`图片缓存缺失：${asset.id}`);
    return this.urls.acquire(key, blob);
  }

  release(url: string): void {
    this.urls.release(url);
  }

  private async fetchBlob(asset: ItemAsset, variant: AssetVariant): Promise<Blob> {
    const cfg = this.getConfig();
    const ext = extFor(asset.mime);
    const path =
      variant === 'thumb'
        ? assetThumbPath(cfg, asset.id, ext)
        : assetPath(cfg, asset.id, ext);
    try {
      const bytes = await this.github.contents.getBytes(path);
      return new Blob([bytes], { type: asset.mime });
    } catch (error) {
      // 缩略图缺失（历史数据 / 手工删过）→ 退化为加载原图，不留破图
      if (variant === 'thumb' && error instanceof GhError && error.kind === 'not-found') {
        return this.fetchBlob(asset, 'original');
      }
      throw error;
    }
  }

  // ────────────────────────────── 维护 ──────────────────────────────

  async sweepUnreferenced(): Promise<number> {
    const referenced = new Set<string>();
    await this.db.items.each((item) => {
      for (const asset of item.assets ?? []) referenced.add(asset.id);
    });

    const pending = await this.db.assets.where('status').equals('pending').toArray();
    const victims = pending.filter((row) => !referenced.has(row.sha)).map((row) => row.key);
    if (victims.length > 0) await this.db.assets.bulkDelete(victims);
    return victims.length;
  }

  async cacheUsage(): Promise<AssetCacheUsage> {
    return { bytes: await assetCacheBytes(this.db), count: await assetCacheCount(this.db) };
  }

  /**
   * 清空本地图片缓存。**保留 `pending` 行**——那是尚未上传到远端的用户数据，
   * 清掉就等于丢图；已上传的可以随时重新拉取。
   */
  async clearCache(): Promise<void> {
    const keys = (await this.db.assets.where('status').equals('uploaded').primaryKeys()) as string[];
    if (keys.length > 0) await this.db.assets.bulkDelete(keys);
    this.urls.releaseAll();
  }

  /** 首次添加图片时请求持久化存储，降低浏览器清缓存把待上传图片带走的风险 */
  private async requestPersistence(): Promise<void> {
    if (this.persistRequested) return;
    this.persistRequested = true;
    try {
      const storage = (globalThis as { navigator?: Navigator }).navigator?.storage;
      await storage?.persist?.();
    } catch {
      // 不支持或被拒绝都不影响功能
    }
  }
}
