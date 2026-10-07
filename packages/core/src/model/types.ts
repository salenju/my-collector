/**
 * 数据模型定义 —— 对应 docs/tec/02-数据模型与存储.md §2
 *
 * 这里是全项目唯一的类型真源：Web 与 Chrome 扩展共用同一份定义，
 * 避免两端字段理解不一致导致同步时互相覆盖。
 */

/**
 * 当前 schema 版本，写入 meta.json；远端更高时进入只读模式。
 *
 * v2：Item 新增 `assets`（附件图片，见 docs/tec/10-图片功能设计.md §3.3）。
 *
 * 为什么这个版本号必须升：`normalizeItem` 是**白名单式重建**，不认识 `assets` 的旧版本
 * 在 pull 之后重写分片时会把该字段静默抹掉（数据丢失）。升版本后旧客户端读到
 * 「远端 2 > 本地 1」会进入只读模式，不再覆盖数据——这正是 02 文档 §4.3 预留的机制。
 */
export const CURRENT_SCHEMA_VERSION = 2;

/** 单个文件内部的结构版本 */
export const FILE_VERSION = 1;

export type ItemType = 'link' | 'note';

/** 允许入库的图片类型（png 保留透明通道，因此不与 jpeg 合并） */
export type ImageMime = 'image/jpeg' | 'image/png';

/**
 * 附件图片的数值边界 —— **单一真源**：校验（guards）、压缩（assets）、UI 三处都读这里，
 * 避免"UI 允许但校验拒绝"这类不一致。
 */
export const ASSET_LIMITS = {
  /** 单条条目最多几张图（一次提交的 blob 请求数 = 图片数） */
  maxPerItem: 20,
  /** 允许上传的源文件上限；超过直接拒绝，避免解码一张 200MB 的图把内存打爆 */
  maxSourceBytes: 20 * 1024 * 1024,
  /** 压缩后仍超过此值就拒绝入库 */
  maxStoredBytes: 1024 * 1024,
  /** 压缩目标：超过则按阶梯继续降质/降尺寸（见 assets/image.ts） */
  targetBytes: 800 * 1024,
  /** 缩略图最长边 */
  thumbEdge: 320,
  /** 文件名保留长度 */
  nameLength: 120,
} as const;

export type AssetMaxEdge = 1600 | 2048 | 2560;

export const ASSET_MAX_EDGES: readonly AssetMaxEdge[] = [1600, 2048, 2560];

/**
 * 附件图片（条目附件形态，见 10 文档 §0 Q1）。
 *
 * 设计要点：`id` 是**内容 sha256 前 32 位**，因此图片不可变、天然去重，
 * 多端同步时永远不会冲突（冲突矩阵不需要为图片新增任何一条）。
 */
export interface ItemAsset {
  /** 内容 sha256 十六进制前 32 位（128 bit）。既是去重键，也是仓库文件名 */
  id: string;
  /** 用户原始文件名，仅用于下载与展示（不参与仓库路径，避免特殊字符进 Git 路径） */
  name: string;
  /** 压缩后的字节数 */
  size: number;
  /** 压缩后的像素尺寸：列表按此比例占位，避免图片加载完成后布局跳动 */
  width: number;
  height: number;
  /** 压缩后的 MIME */
  mime: ImageMime;
  /**
   * 可选直链。`GithubAssetStore` **永不写它**（URL 由带鉴权的读取派生）；
   * 将来接图床/对象存储时由该实现写入，`resolve()` 优先返回它。
   * 现在预留是为了避免到时候再升一次 schema。
   */
  url?: string;
}

/** 图片相关的本地设置（见 10 文档 §9.4） */
export interface AssetsSettings {
  /** 关闭后原样上传（仅 jpeg/png 可通过），并显著加快仓库增长 */
  autoCompress: boolean;
  maxEdge: AssetMaxEdge;
  quality: number;
  /** 本地图片缓存预算（字节），LRU 淘汰时参考 */
  cacheBudgetBytes: number;
}

export const DEFAULT_ASSETS_SETTINGS: AssetsSettings = {
  autoCompress: true,
  maxEdge: 2048,
  quality: 0.8,
  cacheBudgetBytes: 200 * 1024 * 1024,
};

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
  /**
   * 附件图片（v2 新增，顺序即展示顺序）。
   * 缺省表示没有图片——**不用空数组**，避免无意义的 diff。
   */
  assets?: ItemAsset[];
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
  /**
   * 路径 → 字节数（来自 Trees 响应的 `size`）。
   * 用于在设置页展示"数据仓库里的图片占用"而**不需要额外请求**（10 文档 §9.4）。
   */
  sizes?: Record<string, number>;
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
