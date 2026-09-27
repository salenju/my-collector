/**
 * 数据模型定义 —— 对应 docs/tec/02-数据模型与存储.md §2
 *
 * 这里是全项目唯一的类型真源：Web 与 Chrome 扩展共用同一份定义，
 * 避免两端字段理解不一致导致同步时互相覆盖。
 */

/** 当前 schema 版本，写入 meta.json；远端更高时进入只读模式 */
export const CURRENT_SCHEMA_VERSION = 1;

/** 单个文件内部的结构版本 */
export const FILE_VERSION = 1;

export type ItemType = 'link' | 'note';

export type ItemSource = 'web' | 'bookmarklet' | 'extension' | 'share' | 'import';

/** 标签预设调色板（Tailwind 颜色键名，具体 class 由 UI 层映射） */
export const TAG_COLORS = [
  'blue',
  'amber',
  'violet',
  'emerald',
  'rose',
  'cyan',
  'orange',
  'teal',
  'indigo',
  'pink',
  'lime',
  'slate',
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

/** 一条收藏：链接或纯笔记 */
export interface Item {
  /** nanoid(10)，客户端生成，全局唯一 */
  id: string;
  type: ItemType;
  /** 链接标题 / 笔记标题；笔记允许为空字符串 */
  title: string;
  /** 仅 type === 'link' 时存在，已做归一化 */
  url?: string;
  /** 用户自己写的正文 */
  content: string;
  /** 抓取到的网页摘要，抓取失败为空字符串或缺失 */
  excerpt?: string;
  /** 站点图标地址（只存 URL，不存 base64） */
  favicon?: string;
  /** 引用的标签 ID 列表 */
  tagIds: string[];
  source: ItemSource;
  /** ISO 8601 UTC，同时决定所属分片 */
  createdAt: string;
  /** ISO 8601 UTC，冲突合并的裁决依据 */
  updatedAt: string;
  /** 归档：默认不入主视图 */
  archived: boolean;
  /** 软删除墓碑，非 null 表示已删除 */
  deletedAt: string | null;
  /** 预留扩展位 */
  metadata: Record<string, unknown>;
}

/** 标签定义（v1 扁平，parentId 预留层级能力） */
export interface Tag {
  id: string;
  name: string;
  color: TagColor;
  parentId: string | null;
  createdAt: string;
  /** 与 Item 一样参与 LWW 合并；标签改名/改色都需靠它裁决冲突 */
  updatedAt: string;
  /** 软删除墓碑 */
  deletedAt: string | null;
}

/**
 * data/meta.json —— 只承载「全局少量元信息」。
 *
 * 实现期的设计修正（见 docs/tec/09-实现记录.md D-01）：
 * 原方案把 shards[].blobSha 放在 meta.json 里用于跳过未变更文件，
 * 但 meta.json 与分片文件属于**同一次提交**，其自身的 sha 无法在提交前得知，形成循环依赖。
 * 现改为用 Git Trees API 一次拿到全仓库文件 sha（1 个请求，比原来更省），
 * meta.json 因此只保留不会自指的字段；lastSyncAt 属于设备本地状态，不再写入远端。
 */
export interface MetaFile {
  schemaVersion: number;
  /** 数据仓库创建时间 */
  createdAt: string;
  /** 令牌过期日期（供所有设备共享提醒） */
  tokenExpiresAt?: string | null;
  /** 设备 ID → 可读名，便于冲突追溯 */
  deviceNames?: Record<string, string>;
}

/** Git Trees API 列出的一个文件 */
export interface RemoteFileEntry {
  path: string;
  sha: string;
  size: number | null;
}

/** 远端快照：缓存 HEAD 与文件 sha，用于变更检测与 CAS */
export interface RemoteSnapshot {
  /** 分支 HEAD 的提交 sha；空仓库为 null */
  commitSha: string | null;
  /** HEAD 对应的根 tree sha，作为 base_tree 使用 */
  treeSha: string | null;
  /** 路径 → blob sha */
  files: Record<string, string>;
  fetchedAt: string;
}

/** data/items/YYYY-MM.json */
export interface ItemsFile {
  version: number;
  month: string;
  items: Item[];
}

/** data/tags.json */
export interface TagsFile {
  version: number;
  tags: Tag[];
}

/** 数据仓库位置配置 */
export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  /** 数据目录，默认 'data' */
  dataDir: string;
}

export const DEFAULT_REPO_CONFIG: RepoConfig = {
  owner: 'salenju',
  repo: 'my-collector-data',
  branch: 'main',
  dataDir: 'data',
};

/** 网页元信息抓取结果 */
export interface MetadataSnippet {
  title?: string;
  excerpt?: string;
  siteName?: string;
  favicon?: string;
}

export type MetadataProvider = 'jina' | 'allorigins' | 'custom';

export interface MetadataSettings {
  enabled: boolean;
  provider: MetadataProvider;
  customUrl: string;
}

export const DEFAULT_METADATA_SETTINGS: MetadataSettings = {
  enabled: true,
  provider: 'jina',
  customUrl: '',
};

/** 合并策略：删除优先 / 编辑优先（见 04 文档 §5.2 #8） */
export type MergePolicy = 'delete-wins' | 'edit-wins';
