/**
 * 分片路由与文件渲染 —— 见 docs/tec/02-数据模型与存储.md §1.1、§3
 *
 * 分片键固定为 createdAt 的 YYYY-MM：条目永久留在创建时的分片里，
 * 编辑不会导致条目跨分片移动，因此每次提交只改动一个小文件。
 */
import {
  FILE_VERSION,
  type Item,
  type ItemsFile,
  type MetaFile,
  type Tag,
  type TagsFile,
} from '../model/types';
import { monthOf } from '../utils/date';

/** 条目所属分片月份 */
export function shardMonthOf(item: Item): string {
  return monthOf(item.createdAt);
}

/** 按分片分组；同一月份内的条目按 createdAt 升序、id 升序，保证输出稳定（diff 干净） */
export function groupByShard(items: readonly Item[]): Map<string, Item[]> {
  const map = new Map<string, Item[]>();
  for (const item of items) {
    const month = shardMonthOf(item);
    const bucket = map.get(month);
    if (bucket) bucket.push(item);
    else map.set(month, [item]);
  }
  for (const bucket of map.values()) {
    bucket.sort(compareItems);
  }
  return map;
}

export function compareItems(a: Item, b: Item): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 统一 JSON 序列化：2 空格缩进 + 结尾换行（Git diff 友好） */
export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function renderItemsFile(month: string, items: readonly Item[]): string {
  const file: ItemsFile = {
    version: FILE_VERSION,
    month,
    items: [...items].sort(compareItems),
  };
  return serializeJson(file);
}

export function renderTagsFile(tags: readonly Tag[]): string {
  const sorted = [...tags].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const file: TagsFile = { version: FILE_VERSION, tags: sorted };
  return serializeJson(file);
}

export function renderMetaFile(meta: MetaFile): string {
  return serializeJson(meta);
}

/** 默认的初始化标签（03 文档 §4.4） */
export function defaultTags(now: string): Tag[] {
  return [
    { id: 'tag_tech', name: '技术', color: 'blue', parentId: null, createdAt: now, updatedAt: now, deletedAt: null },
    { id: 'tag_read', name: '待读', color: 'amber', parentId: null, createdAt: now, updatedAt: now, deletedAt: null },
    { id: 'tag_idea', name: '想法', color: 'violet', parentId: null, createdAt: now, updatedAt: now, deletedAt: null },
  ];
}

export function defaultMeta(now: string): MetaFile {
  return { schemaVersion: FILE_VERSION, createdAt: now, tokenExpiresAt: null, deviceNames: {} };
}

export function readmeContent(): string {
  return [
    '# 满天星 · 数据仓库',
    '',
    '此仓库是「满天星」收藏工具的数据存储（GitHub 即数据库）。',
    '',
    '- 结构请勿手工修改，所有变更由应用通过 Contents / Git Data API 提交。',
    '- 每次写入都是一次 commit，可通过 git log / git diff 追溯与回滚。',
    '',
  ].join('\n');
}
