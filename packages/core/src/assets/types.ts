/**
 * 附件图片的存储抽象（10 文档 §5）。
 *
 * 拆成三段而不是一个大接口，是因为「登记 / 发布 / 解析」是三件不同的事：
 *  - `stage` 与后端无关（压缩与内容寻址都在本地完成）；
 *  - `collectPending` 是 GitHub 实现特有的（把待上传字节并入原子提交）；
 *  - `resolve` 是唯一真正与后端耦合的部分（GitHub 要带鉴权取字节 + blob 缓存，图床直接给直链）。
 *
 * 因此未来接入图床（Lsky/R2）只需要换 `collectPending` 与 `resolve` 的实现，
 * `ItemAsset` 的数据模型与已存在的数据都不用动（`ItemAsset.url` 已预留）。
 */
import type { AtomicFileWrite } from '../github/contents';
import type { ItemAsset, RemoteSnapshot } from '../model/types';

export type AssetVariant = 'original' | 'thumb';

export interface StageInput {
  file: Blob;
  /** 原始文件名；剪贴板来源可省略，由实现合成 */
  name?: string;
  /** 来自剪贴板（没有文件名）时为 true，用于合成可读的文件名 */
  fromClipboard?: boolean;
}

export interface AssetCacheUsage {
  bytes: number;
  count: number;
}

export interface AssetService {
  /**
   * 登记一张图片：压缩 → 计算内容 id → 落本地待上传表 → 返回可直接写入 `item.assets` 的元信息。
   *
   * **不写 outbox**：入队由 `CollectorRepository` 在同一个 Dexie 事务里和条目一起做，
   * 保证「条目引用了图片」与「图片进了待推送队列」不可能只完成一半。
   */
  stage(input: StageInput): Promise<ItemAsset>;

  /** 把待上传对象转成本次原子提交要写的文件（远端已有的按路径跳过） */
  collectPending(ids: readonly string[], snapshot: RemoteSnapshot | null): Promise<AtomicFileWrite[]>;

  /** 提交成功后把对象标记为已上传 */
  markPublished(ids: readonly string[]): Promise<void>;

  /** 解析成可直接喂给 `<img src>` 的 URL（带引用计数，用完必须 `release`） */
  resolve(asset: ItemAsset, variant?: AssetVariant): Promise<string>;

  /** 引用计数减一；归零时 revokeObjectURL */
  release(url: string): void;

  /** 清理「没有任何条目引用、且尚未上传」的对象（例如拖错一张图又删掉） */
  sweepUnreferenced(): Promise<number>;

  /** 本地图片缓存占用 */
  cacheUsage(): Promise<AssetCacheUsage>;

  /** 清空本地图片缓存（**不删除仓库里的图片**） */
  clearCache(): Promise<void>;
}
