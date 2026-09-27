/**
 * 本地存储（IndexedDB / Dexie）—— 见 docs/tec/04-同步引擎与冲突处理.md §1
 *
 * items 是 UI 的唯一数据源（UI 永不直接读 GitHub）；
 * outbox 是"先本地后远端"的落地处；fileCache 保存 ETag 以支持 304 条件请求。
 */
import Dexie, { type Table } from 'dexie';
import type { Item, MetadataSnippet, RemoteSnapshot, Tag } from '../model/types';
import type { KeyValueStore } from '../github/kv';

/**
 * `shard` 表示「该分片文件需要整体重写」，`entityId` 为 `YYYY-MM`。
 * 用于「清理墓碑」：条目行已被物理删除，无法再按条目 id 反推它属于哪个分片。
 */
export type OutboxEntity = 'item' | 'tag' | 'meta' | 'shard';
export type OutboxAction = 'upsert' | 'delete';

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
