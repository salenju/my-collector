/**
 * 附件图片模块（见 docs/tec/10-图片功能设计.md）。
 *
 * 分层：
 *  - `image.ts`   纯逻辑（体积阶梯、尺寸、文件名）—— 可在 Node 里单测
 *  - `codec.ts`   浏览器端解码/编码（EXIF 方向、HEIC 提示）
 *  - `hash.ts`    内容寻址（sha256，含纯 JS 降级）
 *  - `cache.ts`   objectURL 引用计数 + IndexedDB LRU
 *  - `snapshot.ts` 从远端快照派生索引与占用（零额外请求）
 *  - `githubStore.ts` 把上面这些组装成 `AssetService` 的 GitHub 实现
 */
export * from './cache';
export * from './codec';
export * from './githubStore';
export * from './hash';
export * from './image';
export * from './snapshot';
export * from './types';
