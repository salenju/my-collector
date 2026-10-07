/**
 * 搜索与筛选 —— 见 docs/tec/05-前端应用设计.md §4.6
 *
 * v1 范围（D8）：关键词模糊匹配（标题/内容/摘要/URL/标签名）+ 标签筛选 + 类型 + 归档。
 * 零依赖、纯函数、中文友好；条目量大后可按 02 文档 §5 的触发条件引入 Fuse.js。
 */
import type { Item, ItemType, Tag } from '../model/types';
import { splitKeywords } from '../utils/text';

export type SortField = 'createdAt' | 'updatedAt' | 'title';
export type SortDirection = 'asc' | 'desc';

export interface ItemFilter {
  keyword: string;
  /** 命中所选标签中的任意一个即可（v1 固定 OR；AND 留给 a2） */
  tagIds: string[];
  type: 'all' | ItemType;
  /** false = 主视图；true = 归档视图 */
  archived: boolean;
  sortBy?: SortField;
  sortDir?: SortDirection;
}

export const DEFAULT_ITEM_FILTER: ItemFilter = {
  keyword: '',
  tagIds: [],
  type: 'all',
  archived: false,
  sortBy: 'createdAt',
  sortDir: 'desc',
};

/** 单条目是否命中关键词，并给出相关度分数（标题命中权重更高） */
function scoreItem(item: Item, tagNames: readonly string[], keywords: readonly string[]): number {
  const title = item.title.toLowerCase();
  const rest = [
    item.content,
    item.excerpt ?? '',
    item.url ?? '',
    tagNames.join(' '),
    // 附件图片的文件名也参与命中：用户常常记得"那张叫 xxx 的图"
    (item.assets ?? []).map((asset) => asset.name).join(' '),
  ]
    .join('\n')
    .toLowerCase();

  let score = 0;
  for (const keyword of keywords) {
    if (title.includes(keyword)) {
      score += 2;
    } else if (rest.includes(keyword)) {
      score += 1;
    } else {
      return -1; // 多词 AND 语义：任一关键词未命中即淘汰
    }
  }
  return score;
}

function compareItems(
  a: Item,
  b: Item,
  sortBy: SortField,
  sortDir: SortDirection,
): number {
  const factor = sortDir === 'asc' ? 1 : -1;
  if (sortBy === 'title') {
    const at = a.title || a.content;
    const bt = b.title || b.content;
    return at.localeCompare(bt, 'zh-Hans-CN') * factor;
  }
  const av = sortBy === 'updatedAt' ? a.updatedAt : a.createdAt;
  const bv = sortBy === 'updatedAt' ? b.updatedAt : b.createdAt;
  if (av === bv) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return (av < bv ? -1 : 1) * factor;
}

export function filterItems(
  items: readonly Item[],
  tags: readonly Tag[],
  filter: ItemFilter,
): Item[] {
  const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]));
  const keywords = splitKeywords(filter.keyword).map((word) => word.toLowerCase());
  const selectedTags = new Set(filter.tagIds);
  const sortBy = filter.sortBy ?? 'createdAt';
  const sortDir = filter.sortDir ?? 'desc';

  const scored: Array<{ item: Item; score: number }> = [];

  for (const item of items) {
    // 墓碑在任何视图都不显示
    if (item.deletedAt !== null) continue;
    if (item.archived !== filter.archived) continue;
    if (filter.type !== 'all' && item.type !== filter.type) continue;
    if (selectedTags.size > 0 && !item.tagIds.some((id) => selectedTags.has(id))) continue;

    if (keywords.length > 0) {
      const names = item.tagIds.map((id) => tagNameById.get(id) ?? '');
      const score = scoreItem(item, names, keywords);
      if (score < 0) continue;
      scored.push({ item, score });
    } else {
      scored.push({ item, score: 0 });
    }
  }

  scored.sort((a, b) => {
    if (keywords.length > 0 && a.score !== b.score) return b.score - a.score;
    return compareItems(a.item, b.item, sortBy, sortDir);
  });

  return scored.map((entry) => entry.item);
}

/** 侧栏用的标签计数（只统计未归档、未删除的条目） */
export function collectTagCounts(items: readonly Item[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (item.deletedAt !== null || item.archived) continue;
    for (const tagId of item.tagIds) {
      counts[tagId] = (counts[tagId] ?? 0) + 1;
    }
  }
  return counts;
}

export interface ListCounts {
  active: number;
  links: number;
  notes: number;
  archived: number;
}

export function collectListCounts(items: readonly Item[]): ListCounts {
  const counts: ListCounts = { active: 0, links: 0, notes: 0, archived: 0 };
  for (const item of items) {
    if (item.deletedAt !== null) continue;
    if (item.archived) {
      counts.archived += 1;
      continue;
    }
    counts.active += 1;
    if (item.type === 'link') counts.links += 1;
    else counts.notes += 1;
  }
  return counts;
}

/** 重复链接检测（归一化后完全相同视为重复） */
export function findDuplicateByUrl(items: readonly Item[], url: string): Item | null {
  const target = url.trim();
  if (!target) return null;
  return (
    items.find(
      (item) => item.deletedAt === null && item.url !== undefined && item.url === target,
    ) ?? null
  );
}

/** 未使用的标签（用于「清理未使用的标签」） */
export function findUnusedTags(tags: readonly Tag[], items: readonly Item[]): Tag[] {
  const used = new Set<string>();
  for (const item of items) {
    if (item.deletedAt !== null) continue;
    for (const tagId of item.tagIds) used.add(tagId);
  }
  return tags.filter((tag) => tag.deletedAt === null && !used.has(tag.id));
}
