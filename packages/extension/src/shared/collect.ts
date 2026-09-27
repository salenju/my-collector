import {
  CURRENT_SCHEMA_VERSION,
  assertItem,
  faviconFor,
  isSafeUrl,
  newItemId,
  newTagId,
  normalizeUrl,
  parseItemsFile,
  parseJsonSafe,
  parseTagsFile,
  pickTagColor,
  renderItemsFile,
  renderTagsFile,
  shardPath,
  tagsPath,
  type GithubService,
  type Item,
  type ItemType,
  type RepoConfig,
  type Tag,
} from '@my-collector/core';
import { localStore } from './config';

/**
 * 扩展的保存链路 —— 见 docs/tec/06-多端入口设计.md §5.3。
 *
 * 刻意**不做完整的离线队列**：Service Worker 会被浏览器随时终止，在 SW 里维护跨会话的
 * outbox + 退避重试会让复杂度陡增，而扩展的使用场景是「用户主动点击、当时大概率在线」。
 * 因此采用「直连提交 + 失败保留草稿」，与网页版的离线队列形成明确分工。
 */

export interface CollectInput {
  url?: string;
  title?: string;
  excerpt?: string;
  favicon?: string;
  content?: string;
  /** 标签名（扩展不做本地标签库，按名字在远端 tags.json 里匹配或新建） */
  tagNames: string[];
}

export interface CollectResult {
  ok: boolean;
  message: string;
  itemId?: string;
  /** 本次是否新建了标签 */
  createdTags?: string[];
}

export interface RecentEntry {
  id: string;
  url: string;
  title: string;
  at: string;
}

const RECENT_KEY = 'collector:recent';
const RECENT_LIMIT = 500;

export async function loadRecent(): Promise<RecentEntry[]> {
  return (await localStore.get<RecentEntry[]>(RECENT_KEY)) ?? [];
}

async function pushRecent(entry: RecentEntry): Promise<void> {
  const list = await loadRecent();
  const next = [entry, ...list.filter((item) => item.id !== entry.id)].slice(0, RECENT_LIMIT);
  await localStore.set(RECENT_KEY, next);
}

/** 在本地轻量索引里查重（只覆盖最近 500 条，用于给出友好提示而非强约束） */
export async function findRecentDuplicate(url: string): Promise<RecentEntry | null> {
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  const list = await loadRecent();
  return list.find((item) => item.url === normalized) ?? null;
}

function buildItem(input: CollectInput, tagIds: string[]): Item {
  const normalized = input.url ? normalizeUrl(input.url) : '';
  const url = normalized && isSafeUrl(normalized) ? normalized : undefined;
  const type: ItemType = url ? 'link' : 'note';
  const now = new Date().toISOString();

  const item: Item = {
    id: newItemId(),
    type,
    title: (input.title ?? '').trim().slice(0, 500),
    content: input.content ?? '',
    tagIds,
    source: 'extension',
    createdAt: now,
    updatedAt: now,
    archived: false,
    deletedAt: null,
    metadata: { schemaVersion: CURRENT_SCHEMA_VERSION },
  };

  if (url) {
    item.url = url;
    const favicon = input.favicon || faviconFor(url);
    if (favicon) item.favicon = favicon;
  }
  if (input.excerpt) item.excerpt = input.excerpt.slice(0, 500);

  assertItem(item);
  return item;
}

function buildTag(name: string): Tag {
  const now = new Date().toISOString();
  return {
    id: newTagId(),
    name: name.trim(),
    color: pickTagColor(name.trim()),
    parentId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

/** 读一个分片；不存在时返回空数组（首次写入该月） */
async function readShard(
  github: GithubService,
  path: string,
): Promise<{ items: Item[]; existed: boolean; warning?: string }> {
  const file = await github.contents.getTextOrNull(path);
  if (!file) return { items: [], existed: false };

  const parsed = parseItemsFile(parseJsonSafe(file.text));
  if (!parsed.ok || !parsed.data) {
    return {
      items: [],
      existed: true,
      warning: `${path} 结构异常，为避免覆盖已中止（${parsed.warnings[0] ?? '校验失败'}）。`,
    };
  }
  return { items: parsed.data.items, existed: true, warning: parsed.warnings[0] };
}

async function readTags(github: GithubService, path: string): Promise<Tag[]> {
  const file = await github.contents.getTextOrNull(path);
  if (!file) return [];
  const parsed = parseTagsFile(parseJsonSafe(file.text));
  return parsed.ok && parsed.data ? parsed.data.tags : [];
}

async function attemptOnce(
  github: GithubService,
  repo: RepoConfig,
  input: CollectInput,
): Promise<CollectResult> {
  const head = await github.git.getHead();
  if (!head) {
    return { ok: false, message: '数据仓库还是空的，请先在网页版「设置」里执行一次初始化。' };
  }

  const warnings: string[] = [];

  // 1) 标签：按名字匹配远端已有标签，缺的补齐（与分片在同一次提交里写入）
  const remoteTags = await readTags(github, tagsPath(repo));
  const createdTags: string[] = [];
  const tagIds: string[] = [];
  for (const rawName of input.tagNames) {
    const name = rawName.trim();
    if (!name) continue;
    const existing = remoteTags.find(
      (tag) => tag.deletedAt === null && tag.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      if (!tagIds.includes(existing.id)) tagIds.push(existing.id);
      continue;
    }
    const tag = buildTag(name);
    remoteTags.push(tag);
    tagIds.push(tag.id);
    createdTags.push(name);
  }

  // 2) 分片：追加新条目
  const item = buildItem(input, tagIds);
  const month = item.createdAt.slice(0, 7);
  const shard = await readShard(github, shardPath(repo, month));
  if (shard.warning) warnings.push(shard.warning);
  shard.items.push(item);

  const files = [
    { path: shardPath(repo, month), text: renderItemsFile(month, shard.items) },
  ];
  if (createdTags.length > 0) {
    files.push({ path: tagsPath(repo), text: renderTagsFile(remoteTags) });
  }

  await github.git.commitAtomic({
    files,
    message: `collect: ${item.title || item.url || item.id} [device:扩展]`,
    head,
  });

  await pushRecent({
    id: item.id,
    url: item.url ?? '',
    title: item.title,
    at: item.createdAt,
  });

  return {
    ok: true,
    message: warnings.length > 0 ? `已保存（${warnings.join('；')}）` : '已保存到满天星',
    itemId: item.id,
    createdTags,
  };
}

/** 提交失败时最多重试一次：非快进说明远端已被其他设备推进，重新读取后再合并 */
export async function collect(
  github: GithubService,
  repo: RepoConfig,
  input: CollectInput,
): Promise<CollectResult> {
  try {
    return await attemptOnce(github, repo, input);
  } catch (error) {
    const retryable =
      error instanceof Error &&
      'kind' in error &&
      (error as { kind?: string }).kind === 'conflict';
    if (!retryable) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '保存失败，请稍后重试。',
      };
    }
    try {
      return await attemptOnce(github, repo, input);
    } catch (second) {
      return {
        ok: false,
        message: second instanceof Error ? second.message : '与其他设备的改动冲突，请重试。',
      };
    }
  }
}
