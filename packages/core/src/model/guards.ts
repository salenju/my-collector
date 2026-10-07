/**
 * 数据校验与归一化 —— 对应 docs/tec/02-数据模型与存储.md §4
 *
 * 原则：宁可少显示一条，也不让一条坏数据破坏整个本地缓存。
 * 远端 JSON 一律视为「不可信输入」（可被手工编辑、可被其他版本写入）。
 */
import {
  ASSET_LIMITS,
  CURRENT_SCHEMA_VERSION,
  FILE_VERSION,
  TAG_COLORS,
  type ImageMime,
  type Item,
  type ItemAsset,
  type ItemSource,
  type ItemType,
  type ItemsFile,
  type MetaFile,
  type Tag,
  type TagColor,
  type TagsFile,
} from './types';

/** 字段长度上限，超出即截断（防止异常数据把页面撑爆） */
export const LIMITS = {
  title: 500,
  content: 20_000,
  excerpt: 500,
  tagIds: 50,
  tags: 2000,
} as const;

const ITEM_TYPES: readonly ItemType[] = ['link', 'note'];
const ITEM_SOURCES: readonly ItemSource[] = ['web', 'bookmarklet', 'extension', 'share', 'import'];

/** 危险键名，解析外部 JSON 时剔除，防止原型污染 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 递归剔除原型污染键；在 JSON.parse 之后立刻调用 */
export function sanitizeJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeJson(v)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = sanitizeJson(v);
    }
    return out as unknown as T;
  }
  return value;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

function isIsoDate(v: unknown): v is string {
  return isStr(v) && !Number.isNaN(Date.parse(v));
}

function clampText(v: unknown, max: number, fallback = ''): string {
  if (!isStr(v)) return fallback;
  return v.length > max ? v.slice(0, max) : v;
}

function toTagColor(v: unknown): TagColor {
  return TAG_COLORS.includes(v as TagColor) ? (v as TagColor) : 'slate';
}

/** asset id 是 sha256 的十六进制前 32 位（见 10 文档 §3.1） */
const ASSET_ID_RE = /^[0-9a-f]{32}$/;
const IMAGE_MIMES: readonly ImageMime[] = ['image/jpeg', 'image/png'];

/** 严格校验一个附件图片条目；任一处不合法即整体拒绝（由调用方剔除） */
export function isItemAsset(v: unknown): v is ItemAsset {
  if (!isPlainObject(v)) return false;
  if (!isStr(v.id) || !ASSET_ID_RE.test(v.id)) return false;
  if (!isStr(v.name)) return false;
  if (typeof v.size !== 'number' || !Number.isInteger(v.size)) return false;
  if (v.size <= 0 || v.size > ASSET_LIMITS.maxStoredBytes) return false;
  if (typeof v.width !== 'number' || !Number.isInteger(v.width) || v.width <= 0) return false;
  if (typeof v.height !== 'number' || !Number.isInteger(v.height) || v.height <= 0) return false;
  if (!IMAGE_MIMES.includes(v.mime as ImageMime)) return false;
  if (v.url !== undefined && !isStr(v.url)) return false;
  return true;
}

/**
 * 归一化 `assets`：剔除非法项 → 按 id 去重 → 按 id 升序（输出稳定，diff 干净）→ 截断到上限。
 * 结果为空时返回 `undefined`，让调用方**不写该字段**（避免无意义 diff）。
 */
export function normalizeAssets(raw: unknown): ItemAsset[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: ItemAsset[] = [];
  for (const candidate of raw) {
    if (!isItemAsset(candidate)) continue;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const asset: ItemAsset = {
      id: candidate.id,
      name: clampText(candidate.name, ASSET_LIMITS.nameLength),
      size: candidate.size,
      width: candidate.width,
      height: candidate.height,
      mime: candidate.mime,
    };
    if (candidate.url) asset.url = candidate.url;
    out.push(asset);
  }
  if (out.length === 0) return undefined;
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.slice(0, ASSET_LIMITS.maxPerItem);
}

/**
 * 严格校验一个 Item。
 * 只校验「结构性」字段；可无损修复的文本长度问题由 normalizeItem 处理。
 */
export function isItem(v: unknown): v is Item {
  if (!isPlainObject(v)) return false;
  if (!isStr(v.id) || v.id.length === 0) return false;
  if (!ITEM_TYPES.includes(v.type as ItemType)) return false;
  if (!isStr(v.title)) return false;
  if (!isStr(v.content)) return false;
  if (v.url !== undefined && !isStr(v.url)) return false;
  if (v.excerpt !== undefined && !isStr(v.excerpt)) return false;
  if (v.favicon !== undefined && !isStr(v.favicon)) return false;
  if (!Array.isArray(v.tagIds) || !v.tagIds.every(isStr)) return false;
  if (v.assets !== undefined && (!Array.isArray(v.assets) || !v.assets.every(isItemAsset))) {
    return false;
  }
  if (!ITEM_SOURCES.includes(v.source as ItemSource)) return false;
  if (!isIsoDate(v.createdAt) || !isIsoDate(v.updatedAt)) return false;
  if (!isBool(v.archived)) return false;
  if (v.deletedAt !== null && !isIsoDate(v.deletedAt)) return false;
  if (!isPlainObject(v.metadata)) return false;
  return true;
}

/** 在 isItem 通过之后做无损归一化（截断超长文本、规整 tagIds、补默认值） */
export function normalizeItem(v: Item): Item {
  const tagIds = Array.from(new Set(v.tagIds)).slice(0, LIMITS.tagIds);
  const type: ItemType = v.type === 'link' && !v.url ? 'note' : v.type;
  const item: Item = {
    id: v.id,
    type,
    title: clampText(v.title, LIMITS.title),
    content: clampText(v.content, LIMITS.content),
    excerpt: clampText(v.excerpt, LIMITS.excerpt),
    tagIds,
    source: v.source,
    createdAt: new Date(v.createdAt).toISOString(),
    updatedAt: new Date(v.updatedAt).toISOString(),
    archived: v.archived,
    deletedAt: v.deletedAt ? new Date(v.deletedAt).toISOString() : null,
    metadata: v.metadata,
  };
  if (v.url) item.url = v.url;
  if (v.favicon) item.favicon = v.favicon;
  if (v.excerpt === undefined) delete item.excerpt;
  // 附件图片必须显式搬运：这里是白名单式重建，漏掉就会在下次 push 时把字段写没
  const assets = normalizeAssets(v.assets);
  if (assets) item.assets = assets;
  return item;
}

export function isTag(v: unknown): v is Tag {
  if (!isPlainObject(v)) return false;
  if (!isStr(v.id) || v.id.length === 0) return false;
  if (!isStr(v.name) || v.name.trim().length === 0) return false;
  if (!isStr(v.color)) return false;
  if (v.parentId !== null && !isStr(v.parentId)) return false;
  if (!isIsoDate(v.createdAt)) return false;
  if (!isIsoDate(v.updatedAt)) return false;
  if (v.deletedAt !== null && !isIsoDate(v.deletedAt)) return false;
  return true;
}

export function normalizeTag(v: Tag): Tag {
  return {
    id: v.id,
    name: clampText(v.name, 60).trim(),
    color: toTagColor(v.color),
    parentId: v.parentId,
    createdAt: new Date(v.createdAt).toISOString(),
    updatedAt: new Date(v.updatedAt).toISOString(),
    deletedAt: v.deletedAt ? new Date(v.deletedAt).toISOString() : null,
  };
}

/**
 * meta.json 采用「宽松校验」：只有 schemaVersion 是必须的，
 * 这样未来版本新增字段不会导致旧版本直接判定整个文件非法。
 */
export function isMetaFile(v: unknown): v is MetaFile {
  if (!isPlainObject(v)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  if (v.createdAt !== undefined && !isIsoDate(v.createdAt)) return false;
  if (v.tokenExpiresAt !== undefined && v.tokenExpiresAt !== null && !isStr(v.tokenExpiresAt)) return false;
  if (v.deviceNames !== undefined && !isPlainObject(v.deviceNames)) return false;
  return true;
}

export function normalizeMetaFile(v: MetaFile): MetaFile {
  const meta: MetaFile = {
    schemaVersion: v.schemaVersion,
    createdAt: isIsoDate(v.createdAt) ? new Date(v.createdAt).toISOString() : new Date(0).toISOString(),
  };
  if (v.tokenExpiresAt) meta.tokenExpiresAt = v.tokenExpiresAt;
  if (v.deviceNames) {
    const names: Record<string, string> = {};
    for (const [key, value] of Object.entries(v.deviceNames)) {
      if (isStr(value)) names[key] = clampText(value, 60);
    }
    meta.deviceNames = names;
  }
  return meta;
}

export function isItemsFile(v: unknown): v is ItemsFile {
  return (
    isPlainObject(v) &&
    typeof v.version === 'number' &&
    isStr(v.month) &&
    Array.isArray(v.items)
  );
}

export function isTagsFile(v: unknown): v is TagsFile {
  return isPlainObject(v) && typeof v.version === 'number' && Array.isArray(v.tags);
}

export interface ParseOutcome<T> {
  ok: boolean;
  data?: T;
  /** 被跳过的异常条目数 */
  skipped: number;
  warnings: string[];
}

/**
 * 解析一个分片文件：整体结构校验 + 逐条校验。
 * 坏条目只跳过不中断（对应 02 文档 §4.1 的三层校验）。
 */
export function parseItemsFile(raw: unknown): ParseOutcome<ItemsFile> {
  if (!isItemsFile(raw)) {
    return { ok: false, skipped: 0, warnings: ['分片文件结构非法（缺少 version/month/items）'] };
  }
  const file = raw as unknown as Record<string, unknown>;
  if (file.version !== FILE_VERSION) {
    return { ok: false, skipped: 0, warnings: [`未知的文件版本 ${String(file.version)}`] };
  }
  const items: Item[] = [];
  let skipped = 0;
  const warnings: string[] = [];
  for (const candidate of raw.items) {
    if (isItem(candidate)) {
      items.push(normalizeItem(candidate));
    } else {
      skipped += 1;
    }
  }
  if (skipped > 0) warnings.push(`${raw.month} 跳过 ${skipped} 条结构异常的数据`);
  return { ok: true, data: { version: raw.version, month: raw.month, items }, skipped, warnings };
}

export function parseTagsFile(raw: unknown): ParseOutcome<TagsFile> {
  if (!isTagsFile(raw)) {
    return { ok: false, skipped: 0, warnings: ['tags.json 结构非法'] };
  }
  const tags: Tag[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const candidate of raw.tags) {
    if (!isTag(candidate)) {
      skipped += 1;
      continue;
    }
    const tag = normalizeTag(candidate);
    if (seen.has(tag.id)) {
      skipped += 1;
      continue;
    }
    seen.add(tag.id);
    tags.push(tag);
  }
  const warnings: string[] = [];
  if (skipped > 0) warnings.push(`标签文件跳过 ${skipped} 条异常数据`);
  return {
    ok: true,
    data: { version: raw.version, tags: tags.slice(0, LIMITS.tags) },
    skipped,
    warnings,
  };
}

export function parseMetaFile(raw: unknown): ParseOutcome<MetaFile> {
  if (!isMetaFile(raw)) {
    return { ok: false, skipped: 0, warnings: ['meta.json 结构非法'] };
  }
  return { ok: true, data: normalizeMetaFile(raw), skipped: 0, warnings: [] };
}

/** 校验通过与否的统一断言入口（写入前调用） */
export function assertItem(v: unknown): asserts v is Item {
  if (!isItem(v)) {
    throw new Error(`写入前的条目校验失败：${JSON.stringify(v)?.slice(0, 200)}`);
  }
}

export function assertTag(v: unknown): asserts v is Tag {
  if (!isTag(v)) {
    throw new Error(`写入前的标签校验失败：${JSON.stringify(v)?.slice(0, 200)}`);
  }
}

export function isSchemaCompatible(remoteSchemaVersion: number): boolean {
  return remoteSchemaVersion <= CURRENT_SCHEMA_VERSION;
}
