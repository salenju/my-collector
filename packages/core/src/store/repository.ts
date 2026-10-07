/**
 * 本地写入入口 —— 见 docs/tec/04-同步引擎与冲突处理.md §4.1
 *
 * 所有写操作：单个 Dexie 事务内「写业务数据 + 写 outbox」→ 立即返回成功（乐观更新）
 * → 由同步引擎 debounce 后异步推送。UI 只与这里交互，不直接碰 Dexie 或网络。
 */
import type { AssetService } from '../assets/types';
import { assertItem, assertTag, normalizeAssets } from '../model/guards';
import {
  TAG_COLORS,
  type Item,
  type ItemAsset,
  type ItemSource,
  type ItemType,
  type Tag,
  type TagColor,
} from '../model/types';
import { monthOf, nowIso } from '../utils/date';
import { newItemId, newTagId } from '../utils/id';
import { faviconFor, isSafeUrl, normalizeUrl } from '../utils/url';
import type { SyncEngine } from '../sync/engine';
import { META_KEYS, type CollectorDb, type OutboxAction, type OutboxEntity } from './schema';

export interface ItemDraft {
  id?: string;
  type?: ItemType;
  title?: string;
  url?: string;
  content?: string;
  excerpt?: string;
  favicon?: string;
  tagIds?: string[];
  /** 附件图片（10 文档 §3.1）。传 `[]` 表示清空全部图片 */
  assets?: ItemAsset[];
  source?: ItemSource;
  archived?: boolean;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

/** 稳定的颜色分配：同名标签总是得到同一个颜色 */
export function pickTagColor(name: string): TagColor {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 100_000;
  }
  return TAG_COLORS[hash % TAG_COLORS.length] ?? 'slate';
}

function buildItem(draft: ItemDraft, now: string): Item {
  const normalized = draft.url ? normalizeUrl(draft.url) : '';
  const url = normalized && isSafeUrl(normalized) ? normalized : undefined;
  const type: ItemType = draft.type ?? (url ? 'link' : 'note');

  const item: Item = {
    id: draft.id ?? newItemId(),
    type,
    title: (draft.title ?? '').trim(),
    content: draft.content ?? '',
    tagIds: Array.from(new Set(draft.tagIds ?? [])),
    source: draft.source ?? 'web',
    createdAt: draft.createdAt ?? now,
    updatedAt: now,
    archived: draft.archived ?? false,
    deletedAt: null,
    metadata: draft.metadata ?? {},
  };

  if (url) {
    item.url = url;
    const favicon = draft.favicon ?? faviconFor(url);
    if (favicon) item.favicon = favicon;
  }
  if (typeof draft.excerpt === 'string') item.excerpt = draft.excerpt;

  const assets = normalizeAssets(draft.assets);
  if (assets) item.assets = assets;

  return item;
}

export class CollectorRepository {
  constructor(
    private readonly db: CollectorDb,
    private readonly engine: SyncEngine,
    /** 附件图片服务；缺省时图片相关的登记/清理逻辑直接跳过（不涉及图片的测试用） */
    private readonly assets?: AssetService,
  ) {}

  /**
   * outbox 按实体压缩：同一实体只保留最后一次操作，避免连续编辑产生多次提交。
   * 备注：若「新建后立刻删除」且尚未推送，会留下一个墓碑提交，属可接受的轻微噪声
   * （由设置页的「清理墓碑」处理）。
   */
  private async replaceOps(
    entity: OutboxEntity,
    entityId: string,
    action: OutboxAction,
    at: string,
  ): Promise<void> {
    await this.db.outbox.where('entityId').equals(entityId).delete();
    await this.db.outbox.add({ entity, entityId, action, at });
  }

  /**
   * 登记「清理墓碑」待推送的分片（04 文档 §4.3）。
   *
   * 为什么不能像普通写操作那样按条目 id 入队：条目行已经被物理删掉，
   * push 时无法再由 id 反推它属于哪个月份，因此这里按**分片**入队（entity='shard'），
   * 由 push 把该月的整份文件按本地现状重写（重写后文件里不再有这条墓碑）。
   *
   * purgedIds 与 `replaceOps` 的覆盖语义不同：必须与已有记录**取并集**，
   * 否则同一个月内分两次清理时，先登记的那批 id 会被后一次覆盖掉。
   */
  private async queueShardRewrite(
    purgedByMonth: ReadonlyMap<string, readonly string[]>,
    at: string,
  ): Promise<void> {
    for (const [month, ids] of purgedByMonth) {
      const existing = await this.db.outbox.where('entityId').equals(month).toArray();
      const previous = existing.find((row) => row.entity === 'shard')?.purgedIds ?? [];
      await this.db.outbox.where('entityId').equals(month).delete();
      await this.db.outbox.add({
        entity: 'shard',
        entityId: month,
        action: 'upsert',
        at,
        purgedIds: [...new Set([...previous, ...ids])],
      });
    }
  }

  /**
   * 把新增的图片对象登记进待推送队列（10 文档 §6.3）。
   *
   * 必须与条目写在**同一个 Dexie 事务**里：否则可能出现「条目引用了图片、但图片没进队列」，
   * 那张图将永远不会被上传。这里对同一 id 去重，避免重复入队把待同步计数撑大。
   */
  private async queueAssetOps(ids: readonly string[], at: string): Promise<void> {
    const unique = [...new Set(ids)].filter((id) => id.length > 0);
    if (unique.length === 0) return;
    const rows = await this.db.outbox.where('entityId').anyOf(unique).toArray();
    const queued = new Set(
      rows.filter((row) => row.entity === 'asset').map((row) => row.entityId),
    );
    for (const id of unique) {
      if (queued.has(id)) continue;
      await this.db.outbox.add({ entity: 'asset', entityId: id, action: 'upsert', at });
    }
  }

  // ─────────────────────────── 条目 ───────────────────────────

  async createItem(draft: ItemDraft): Promise<Item> {
    const now = nowIso();
    const item = buildItem(draft, now);
    assertItem(item);

    await this.db.transaction('rw', [this.db.items, this.db.outbox], async () => {
      await this.db.items.put(item);
      await this.replaceOps('item', item.id, 'upsert', now);
      await this.queueAssetOps((item.assets ?? []).map((asset) => asset.id), now);
    });

    this.engine.schedulePush();
    return item;
  }

  async updateItem(id: string, patch: Partial<ItemDraft>): Promise<Item> {
    const now = nowIso();
    let updated: Item | null = null;
    let droppedAssets = false;

    await this.db.transaction('rw', [this.db.items, this.db.outbox], async () => {
      const existing = await this.db.items.get(id);
      if (!existing) throw new Error(`条目不存在：${id}`);

      const merged: Item = {
        ...existing,
        updatedAt: now,
      };

      if (patch.title !== undefined) merged.title = patch.title.trim();
      if (patch.content !== undefined) merged.content = patch.content;
      if (patch.excerpt !== undefined) merged.excerpt = patch.excerpt;
      if (patch.tagIds !== undefined) merged.tagIds = Array.from(new Set(patch.tagIds));
      if (patch.archived !== undefined) merged.archived = patch.archived;
      if (patch.type !== undefined) merged.type = patch.type;
      if (patch.metadata !== undefined) merged.metadata = patch.metadata;

      if (patch.assets !== undefined) {
        // 图片的"删除"就是让数组变短：不需要墓碑，随条目 JSON 走既有的 LWW 合并（10 文档 §7.2）
        const assets = normalizeAssets(patch.assets);
        droppedAssets = (existing.assets?.length ?? 0) > (assets?.length ?? 0);
        if (assets) merged.assets = assets;
        else delete merged.assets;
      }

      if (patch.url !== undefined) {
        const normalized = normalizeUrl(patch.url);
        if (normalized && isSafeUrl(normalized)) {
          merged.url = normalized;
          delete merged.favicon;
          const favicon = patch.favicon ?? faviconFor(normalized);
          if (favicon) merged.favicon = favicon;
        } else {
          delete merged.url;
          delete merged.favicon;
        }
      } else if (patch.favicon !== undefined) {
        merged.favicon = patch.favicon;
      }

      assertItem(merged);
      await this.db.items.put(merged);
      await this.replaceOps('item', id, 'upsert', now);
      await this.queueAssetOps((merged.assets ?? []).map((asset) => asset.id), now);
      updated = merged;
    });

    // 只在图片确实变少时才扫描（这是 O(条目数) 的操作）
    if (droppedAssets) await this.assets?.sweepUnreferenced();

    if (!updated) throw new Error(`条目更新失败：${id}`);
    this.engine.schedulePush();
    return updated;
  }

  /** 软删除（墓碑）：保证多端能正确传播"删除"这个动作 */
  async deleteItem(id: string): Promise<void> {
    const now = nowIso();
    await this.db.transaction('rw', [this.db.items, this.db.outbox], async () => {
      const existing = await this.db.items.get(id);
      if (!existing) return;
      await this.db.items.put({ ...existing, deletedAt: now, updatedAt: now });
      await this.replaceOps('item', id, 'delete', now);
    });
    this.engine.schedulePush();
  }

  async restoreItem(id: string): Promise<void> {
    const now = nowIso();
    await this.db.transaction('rw', [this.db.items, this.db.outbox], async () => {
      const existing = await this.db.items.get(id);
      if (!existing) return;
      await this.db.items.put({ ...existing, deletedAt: null, updatedAt: now });
      await this.replaceOps('item', id, 'upsert', now);
    });
    this.engine.schedulePush();
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    await this.updateItem(id, { archived });
  }

  /** 彻底移除本地记录（「清理墓碑」的单项版本），并让所在分片整体重写、写回远端 */
  async purgeItem(id: string): Promise<void> {
    const existing = await this.db.items.get(id);
    if (!existing) return;

    const now = nowIso();
    const month = monthOf(existing.createdAt);
    await this.db.transaction('rw', [this.db.items, this.db.outbox], async () => {
      await this.db.items.delete(id);
      await this.db.outbox.where('entityId').equals(id).delete();
      await this.queueShardRewrite(new Map([[month, [id]]]), now);
    });

    // 条目被物理移除后，它引用的、尚未上传的图片就成了孤儿（仓库里已上传的图片不动）
    await this.assets?.sweepUnreferenced();
    this.engine.schedulePush();
    this.engine.notifyLocalChange();
  }

  /** 批量打标签 / 去标签（多条目 → 写入对应分片） */
  async addTagsToItems(itemIds: readonly string[], tagIds: readonly string[]): Promise<void> {
    const now = nowIso();
    const extra = Array.from(new Set(tagIds));
    await this.db.transaction('rw', [this.db.items, this.db.outbox], async () => {
      for (const id of itemIds) {
        const existing = await this.db.items.get(id);
        if (!existing) continue;
        const merged: Item = {
          ...existing,
          tagIds: Array.from(new Set([...existing.tagIds, ...extra])),
          updatedAt: now,
        };
        await this.db.items.put(merged);
        await this.replaceOps('item', id, 'upsert', now);
      }
    });
    this.engine.schedulePush();
  }

  async removeTagsFromItems(itemIds: readonly string[], tagIds: readonly string[]): Promise<void> {
    const now = nowIso();
    const remove = new Set(tagIds);
    await this.db.transaction('rw', [this.db.items, this.db.outbox], async () => {
      for (const id of itemIds) {
        const existing = await this.db.items.get(id);
        if (!existing) continue;
        const merged: Item = {
          ...existing,
          tagIds: existing.tagIds.filter((tagId) => !remove.has(tagId)),
          updatedAt: now,
        };
        await this.db.items.put(merged);
        await this.replaceOps('item', id, 'upsert', now);
      }
    });
    this.engine.schedulePush();
  }

  // ─────────────────────────── 标签 ───────────────────────────

  async createTag(name: string, color?: TagColor): Promise<Tag> {
    const now = nowIso();
    const trimmed = name.trim();
    const existing = await this.findTagByName(trimmed);
    if (existing) return existing;

    const tag: Tag = {
      id: newTagId(),
      name: trimmed,
      color: color ?? pickTagColor(trimmed),
      parentId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    assertTag(tag);

    await this.db.transaction('rw', [this.db.tags, this.db.outbox], async () => {
      await this.db.tags.put(tag);
      await this.replaceOps('tag', tag.id, 'upsert', now);
    });
    this.engine.schedulePush();
    return tag;
  }

  /** 按名字批量确保标签存在（新建条目时用），返回标签 id 列表 */
  async ensureTags(names: readonly string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const tag = await this.createTag(trimmed);
      ids.push(tag.id);
    }
    return ids;
  }

  /** 名字去重：大小写不敏感（对应 02 文档 §2.2 的标签规则） */
  async findTagByName(name: string): Promise<Tag | null> {
    const target = name.trim().toLowerCase();
    if (!target) return null;
    const tags = await this.db.tags.toArray();
    return (
      tags.find((tag) => tag.deletedAt === null && tag.name.toLowerCase() === target) ?? null
    );
  }

  async updateTag(id: string, patch: { name?: string; color?: TagColor }): Promise<void> {
    const now = nowIso();
    await this.db.transaction('rw', [this.db.tags, this.db.outbox], async () => {
      const existing = await this.db.tags.get(id);
      if (!existing) throw new Error(`标签不存在：${id}`);
      const merged: Tag = {
        ...existing,
        name: patch.name !== undefined ? patch.name.trim() || existing.name : existing.name,
        color: patch.color ?? existing.color,
        updatedAt: now,
      };
      assertTag(merged);
      await this.db.tags.put(merged);
      await this.replaceOps('tag', id, 'upsert', now);
    });
    this.engine.schedulePush();
  }

  /** 删除标签：墓碑 + 从所有条目中摘除引用（可能跨多个分片） */
  async deleteTag(id: string): Promise<number> {
    const now = nowIso();
    let affected = 0;

    await this.db.transaction('rw', [this.db.tags, this.db.items, this.db.outbox], async () => {
      const tag = await this.db.tags.get(id);
      if (!tag) return;
      await this.db.tags.put({ ...tag, deletedAt: now, updatedAt: now });
      await this.replaceOps('tag', id, 'delete', now);

      const items = await this.db.items.where('tagIds').equals(id).toArray();
      for (const item of items) {
        await this.db.items.put({
          ...item,
          tagIds: item.tagIds.filter((tagId) => tagId !== id),
          updatedAt: now,
        });
        await this.replaceOps('item', item.id, 'upsert', now);
        affected += 1;
      }
    });

    this.engine.schedulePush();
    return affected;
  }

  /** 把 sourceId 合并进 targetId */
  async mergeTag(sourceId: string, targetId: string): Promise<number> {
    if (sourceId === targetId) return 0;
    const now = nowIso();
    let affected = 0;

    await this.db.transaction('rw', [this.db.tags, this.db.items, this.db.outbox], async () => {
      const source = await this.db.tags.get(sourceId);
      const target = await this.db.tags.get(targetId);
      if (!source || !target) throw new Error('标签不存在');

      await this.db.tags.put({ ...source, deletedAt: now, updatedAt: now });
      await this.replaceOps('tag', sourceId, 'delete', now);

      const items = await this.db.items.where('tagIds').equals(sourceId).toArray();
      for (const item of items) {
        const tagIds = Array.from(new Set(item.tagIds.map((tagId) => (tagId === sourceId ? targetId : tagId))));
        await this.db.items.put({ ...item, tagIds, updatedAt: now });
        await this.replaceOps('item', item.id, 'upsert', now);
        affected += 1;
      }
    });

    this.engine.schedulePush();
    return affected;
  }

  // ─────────────────────────── 维护 ───────────────────────────

  /**
   * 清理超过指定天数的墓碑：本地物理移除，并把涉及的分片整体重写回远端
   * （该变更是一次 commit，Git 历史里仍可找回）。见 04 文档 §4.3。
   */
  async purgeTombstones(olderThanDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const tombstones = await this.db.items.filter(
      (item) => item.deletedAt !== null && item.deletedAt < cutoff,
    ).toArray();

    if (tombstones.length === 0) return 0;

    const now = nowIso();
    const purgedByMonth = new Map<string, string[]>();
    for (const item of tombstones) {
      const month = monthOf(item.createdAt);
      const bucket = purgedByMonth.get(month);
      if (bucket) bucket.push(item.id);
      else purgedByMonth.set(month, [item.id]);
    }

    await this.db.transaction('rw', [this.db.items, this.db.outbox], async () => {
      await this.db.items.bulkDelete(tombstones.map((item) => item.id));
      await this.queueShardRewrite(purgedByMonth, now);
    });

    await this.assets?.sweepUnreferenced();
    this.engine.schedulePush();
    this.engine.notifyLocalChange();
    return tombstones.length;
  }

  async countTombstones(): Promise<number> {
    return this.db.items.filter((item) => item.deletedAt !== null).count();
  }

  // ─────────────────────────── 草稿 ───────────────────────────

  async saveDraft(key: string, value: unknown): Promise<void> {
    await this.db.drafts.put({ key, value: JSON.stringify(value), updatedAt: nowIso() });
  }

  async loadDraft<T>(key: string): Promise<T | null> {
    const row = await this.db.drafts.get(key);
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  async clearDraft(key: string): Promise<void> {
    await this.db.drafts.delete(key);
  }

  // ─────────────────────────── 元信息缓存 ───────────────────────────

  async getCachedMetaFile(): Promise<unknown> {
    const row = await this.db.meta.get(META_KEYS.metaFile);
    return row?.value ?? null;
  }
}
