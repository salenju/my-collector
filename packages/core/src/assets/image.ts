/**
 * 图片压缩的**纯逻辑** —— 不碰 canvas，因此可以在 Node 里单测（10 文档 §6.1、§11.1）。
 *
 * 真正的解码/缩放/编码在 assets/codec.ts 里（依赖浏览器 API），
 * 通过下面的 `ImageCodec` 接口注入，测试可换成假实现。
 */
import {
  ASSET_LIMITS,
  type AssetsSettings,
  type ImageMime,
} from '../model/types';
import type { Bytes } from '../utils/bytes';

/** 解码后的源图：可多次编码成不同尺寸/质量（缩略图与原图共享一次解码） */
export interface DecodedSource {
  width: number;
  height: number;
  encode(target: EncodeTarget): Promise<Bytes>;
  close(): void;
}

export interface EncodeTarget {
  width: number;
  height: number;
  mime: ImageMime;
  quality: number;
}

export interface ImageCodec {
  /** 解码并按 EXIF 方向摆正；无法解码时抛错（HEIC 等） */
  open(file: Blob): Promise<DecodedSource>;
}

export interface CompressedImage {
  bytes: Bytes;
  mime: ImageMime;
  width: number;
  height: number;
}

export interface SourceCheck {
  ok: boolean;
  reason?: string;
}

/** 源文件是否可接受（类型 + 体积）。超限直接拒绝，不做"试试看"。 */
export function checkSource(file: { type: string; size: number }): SourceCheck {
  if (file.type && !file.type.startsWith('image/')) {
    return { ok: false, reason: '只能添加图片文件' };
  }
  if (file.size <= 0) {
    return { ok: false, reason: '这个文件是空的' };
  }
  if (file.size > ASSET_LIMITS.maxSourceBytes) {
    const mb = Math.round(ASSET_LIMITS.maxSourceBytes / 1024 / 1024);
    return { ok: false, reason: `图片超过 ${mb}MB，请先压缩后再添加` };
  }
  return { ok: true };
}

/** 输出格式：png 保留透明通道（转 JPEG 会让透明底变黑），其余统一 JPEG */
export function outputMimeFor(sourceMime: string): ImageMime {
  return sourceMime === 'image/png' ? 'image/png' : 'image/jpeg';
}

export function extFor(mime: ImageMime): string {
  return mime === 'image/png' ? 'png' : 'jpg';
}

export function mimeForExt(ext: string): ImageMime {
  return ext.toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
}

/** 关闭自动压缩时能原样入库的格式；其他格式无法原样保存 */
export function passthroughMime(type: string): ImageMime | null {
  return type === 'image/jpeg' || type === 'image/png' ? type : null;
}

/** 等比缩放到最长边以内；**不放大**（放大只会变糊且体积更大） */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface CompressionStep {
  maxEdge: number;
  quality: number;
}

/**
 * 体积阶梯：先降质，再降尺寸。
 * 默认档（2048 / 0.8）得到 `[2048@0.8, 2048@0.7, 1600@0.7]`；
 * 全部档位都超过 `ASSET_LIMITS.maxStoredBytes` 时由调用方拒绝该张。
 */
export function compressionLadder(maxEdge: number, quality: number): CompressionStep[] {
  const lowerQuality = Math.max(0.6, Number((quality - 0.1).toFixed(2)));
  const steps: CompressionStep[] = [
    { maxEdge, quality },
    { maxEdge, quality: lowerQuality },
  ];
  if (maxEdge > 1600) {
    steps.push({ maxEdge: 1600, quality: lowerQuality });
  } else {
    steps.push({ maxEdge, quality: Math.max(0.5, Number((lowerQuality - 0.1).toFixed(2))) });
  }
  return steps;
}

export interface PreparedAsset {
  original: CompressedImage;
  thumb: CompressedImage;
}

/**
 * 解码一次 → 压缩出原图与缩略图。
 * 只解码一次是刻意的：一张 12MP 照片的解码成本远高于两次编码。
 */
export async function prepareAsset(
  file: Blob,
  settings: AssetsSettings,
  codec: ImageCodec,
): Promise<PreparedAsset> {
  const source = await codec.open(file);
  try {
    const original = await encodeOriginal(source, file, settings);
    const thumb = await encodeThumbnail(source, original.mime);
    return { original, thumb };
  } finally {
    source.close();
  }
}

async function encodeOriginal(
  source: DecodedSource,
  file: Blob,
  settings: AssetsSettings,
): Promise<CompressedImage> {
  if (!settings.autoCompress) {
    const mime = passthroughMime(file.type);
    if (!mime) {
      throw new Error('已关闭自动压缩，只能原样保存 JPEG / PNG；其他格式请先转换。');
    }
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mime,
      width: source.width,
      height: source.height,
    };
  }

  const mime = outputMimeFor(file.type);
  let last: CompressedImage | null = null;
  for (const step of compressionLadder(settings.maxEdge, settings.quality)) {
    const size = fitWithin(source.width, source.height, step.maxEdge);
    const bytes = await source.encode({ ...size, mime, quality: step.quality });
    last = { bytes, mime, width: size.width, height: size.height };
    if (bytes.byteLength <= ASSET_LIMITS.targetBytes) break;
  }
  if (!last) throw new Error('压缩失败：没有可用的编码参数');
  return last;
}

async function encodeThumbnail(source: DecodedSource, mime: ImageMime): Promise<CompressedImage> {
  const size = fitWithin(source.width, source.height, ASSET_LIMITS.thumbEdge);
  const bytes = await source.encode({ ...size, mime, quality: 0.7 });
  return { bytes, mime, width: size.width, height: size.height };
}

/** 文件名里不能出现的字符（含 Windows 保留字符与控制字符） */
const UNSAFE_NAME_RE = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** 把用户文件名清洗成可安全展示/下载的名字；只保留最后一段，避免路径穿越 */
export function sanitizeName(raw: string | undefined | null, fallback: string): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(UNSAFE_NAME_RE, '_').trim();
  if (!cleaned) return fallback;
  return cleaned.length > ASSET_LIMITS.nameLength
    ? cleaned.slice(0, ASSET_LIMITS.nameLength)
    : cleaned;
}

/**
 * 剪贴板来源的图片通常没有文件名（macOS 截图、网页右键"复制图片"），
 * 合成为一个可读的名字。扩展名由**实际编码结果**决定，不信任剪贴板给的 mime。
 */
export function pastedFileName(mime: ImageMime, at: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = [
    at.getFullYear(),
    pad(at.getMonth() + 1),
    pad(at.getDate()),
  ].join('') + `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `粘贴-${stamp}.${extFor(mime)}`;
}
