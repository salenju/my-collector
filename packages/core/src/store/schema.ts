/**
 * 本地存储（IndexedDB / Dexie）—— 见 docs/tec/04-同步引擎与冲突处理.md §1
 *
 * items 是 UI 的唯一数据源（UI 永不直接读 GitHub）；
 * outbox 是"先本地后远端"的落地处；fileCache 保存 ETag 以支持 304 条件请求。
 */
import Dexie, { type Table } from 'dexie';
import type { ImageMime, Item, MetadataSnippet, RemoteSnapshot, Tag } from '../model/types';
import type { KeyValueStore } from '../github/kv';

/**
 * `shard` 表示「该分片文件需要整体重写」，`entityId` 为 `YYYY-MM`。
 * 用于「清理墓碑」：条目行已被物理删除，无法再按条目 id 反推它属于哪个分片。
 *
 * `asset` 表示「有附件图片待上传」，`entityId` 为 asset id（内容 sha）。
 * 它与对应的 `item` 操作在同一次原子提交里落地（10 文档 §6.5）。
 */
export type OutboxEntity = 'item' | 'tag' | 'meta' | 'shard' | 'asset';
export type OutboxAction = 'upsert' | 'delete';

export type AssetKind = 'original' | 'thumb';

/**
 * 附件图片的本地行。
 *
 * **一张表同时承担两个角色**：待上传队列（`status='pending'`，带字节）与已下载缓存
 * （`status='uploaded'`）。两者的生命周期本就重叠（上传成功后就地变成缓存），
 * 分两张表反而要处理搬迁与一致性。代价是 LRU 淘汰必须跳过 `pending`（那是尚未上传的用户数据）。
 */
export interface AssetRow {
  /** `${sha}:${kind}` */
  key: string;
  /** 内容 sha256 前 32 位（= 条目里的 asset id） */
  sha: string;
  kind: AssetKind;
  mime: ImageMime;
  bytes: number;
  /** 压缩后的图片字节；未下载的远端图片为 null（按需拉取后回填） */
  blob: Blob | null;
  width: number;
  height: number;
  name: string;
  status: 'pending' | 'uploaded';
  at: string;
  lastAccessAt: number;
}

export function assetKey(sha: string, kind: AssetKind): string {
  return `${sha}:${kind}`;
}

export interface OutboxRow {
  seq?: number;
  entity: OutboxEntity;
  entityId: string;
  action: OutboxAction;
  at: string;
  /**
   * 仅 `entity='shard'` 使用：本次物理移除的条目 id。
   * 推送前若先发生拉取，远端仍带着这些墓碑，合并时需要它们拦住"墓碑复活"（见 sync/merge.ts）。
   */
  purgedIds?: string[];
}

export interface FileCacheRow {
  path: string;
  sha: string;
  etag: string | null;
  size: number | null;
  updatedAt: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface DraftRow {
  key: string;
  value: string;
  updatedAt: string;
}

export interface MetadataCacheRow {
  url: string;
  value: MetadataSnippet;
  at: number;
}

export const SETTINGS_KEYS = {
  repo: 'repo',
  device: 'device',
  metadata: 'metadata',
  ui: 'ui',
  mergePolicy: 'mergePolicy',
  sync: 'sync',
  assets: 'assets',
} as const;

export const META_KEYS = {
  remote: 'remote',
  metaFile: 'metaFile',
} as const;

export class CollectorDb extends Dexie {
  items!: Table<Item, string>;
  tags!: Table<Tag, string>;
  outbox!: Table<OutboxRow, number>;
  fileCache!: Table<FileCacheRow, string>;
  settings!: Table<SettingRow, string>;
  meta!: Table<SettingRow, string>;
  drafts!: Table<DraftRow, string>;
  metadataCache!: Table<MetadataCacheRow, string>;
  assets!: Table<AssetRow, string>;

  constructor(name = 'my-collector') {
    super(name);
    this.version(1).stores({
      items: 'id, createdAt, updatedAt, type, archived, deletedAt, *tagIds',
      tags: 'id, name, updatedAt, deletedAt',
      outbox: '++seq, entity, entityId, at',
      fileCache: 'path',
      settings: 'key',
      meta: 'key',
      drafts: 'key',
      metadataCache: 'url, at',
    });
    // v2：附件图片（10 文档 §4）。这里把 v1 的表一并重列，避免依赖 Dexie 的"未提及即保留"语义。
    this.version(2).stores({
      items: 'id, createdAt, updatedAt, type, archived, deletedAt, *tagIds',
      tags: 'id, name, updatedAt, deletedAt',
      outbox: '++seq, entity, entityId, at',
      fileCache: 'path',
      settings: 'key',
      meta: 'key',
      drafts: 'key',
      metadataCache: 'url, at',
      assets: 'key, sha, status, at, lastAccessAt',
    });
  }
}

/** 用 Dexie 的 settings 表实现 KeyValueStore（供 auth 使用） */
export class DexieSettingsStore implements KeyValueStore {
  constructor(private readonly db: CollectorDb) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = await this.db.settings.get(key);
    return row?.value as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value });
  }

  async remove(key: string): Promise<void> {
    await this.db.settings.delete(key);
  }
}

/** meta 表的键值读写（远端快照、meta.json 镜像） */
export class DexieMetaStore implements KeyValueStore {
  constructor(private readonly db: CollectorDb) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = await this.db.meta.get(key);
    return row?.value as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  async remove(key: string): Promise<void> {
    await this.db.meta.delete(key);
  }
}

export const EMPTY_REMOTE_SNAPSHOT: RemoteSnapshot = {
  commitSha: null,
  treeSha: null,
  files: {},
  fetchedAt: new Date(0).toISOString(),
};
