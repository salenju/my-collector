/**
 * 图片缓存的两件事：objectURL 的引用计数、IndexedDB 的 LRU 淘汰（10 文档 §7.1）。
 */
import type { CollectorDb } from '../store/schema';
import { assetKey } from '../store/schema';

/**
 * objectURL 的引用计数中心。
 *
 * 为什么必须引用计数：同一张图可能同时被列表缩略图、详情画廊、灯箱渲染。
 * 如果"组件卸载就 revoke"，另一个仍在渲染的组件会立刻拿到失效的 URL
 * （表现为图片突然变空白）。因此只有计数归零才真正释放。
 */
export class ObjectUrlRegistry {
  private readonly entries = new Map<string, { url: string; refs: number }>();

  /** 取得（必要时创建）一个 objectURL，并把引用计数 +1 */
  acquire(key: string, blob: Blob): string {
    const existing = this.entries.get(key);
    if (existing) {
      existing.refs += 1;
      return existing.url;
    }
    const url = URL.createObjectURL(blob);
    this.entries.set(key, { url, refs: 1 });
    return url;
  }

  /** 引用计数 -1；归零时 revokeObjectURL 并移除记录 */
  release(url: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.url !== url) continue;
      entry.refs -= 1;
      if (entry.refs <= 0) {
        URL.revokeObjectURL(entry.url);
        this.entries.delete(key);
      }
      return;
    }
  }

  releaseAll(): void {
    for (const entry of this.entries.values()) URL.revokeObjectURL(entry.url);
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** 已缓存的字节总数（含缩略图） */
export async function assetCacheBytes(db: CollectorDb): Promise<number> {
  let total = 0;
  // 只遍历元数据列会更省，但 Dexie 没有列投影；行数在个人规模下很小
  await db.assets.each((row) => {
    total += row.bytes;
  });
  return total;
}

export async function assetCacheCount(db: CollectorDb): Promise<number> {
  return db.assets.count();
}

/**
 * 按 `lastAccessAt` 淘汰，直到占用落到预算内。
 *
 * **`status='pending'` 的行永不淘汰**：那是尚未上传到远端的用户数据，
 * 删掉就等于丢图（上传成功后就地变成 `uploaded`，那时才可以被回收）。
 */
export async function evictAssetCache(db: CollectorDb, budgetBytes: number): Promise<number> {
  const rows = await db.assets.orderBy('lastAccessAt').toArray();
  let total = 0;
  for (const row of rows) total += row.bytes;
  if (total <= budgetBytes) return 0;

  const victims: string[] = [];
  for (const row of rows) {
    if (total <= budgetBytes) break;
    if (row.status === 'pending') continue;
    victims.push(row.key);
    total -= row.bytes;
  }
  if (victims.length > 0) await db.assets.bulkDelete(victims);
  return victims.length;
}

/** 记录一次访问（LRU 的"最近使用"依据） */
export async function touchAsset(db: CollectorDb, sha: string, kind: 'original' | 'thumb'): Promise<void> {
  const key = assetKey(sha, kind);
  const row = await db.assets.get(key);
  if (!row) return;
  await db.assets.update(key, { lastAccessAt: Date.now() });
}
