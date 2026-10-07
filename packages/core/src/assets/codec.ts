/**
 * 浏览器端的图片解码/编码实现（`ImageCodec` 的真实实现）。
 *
 * ⚠️ **实现期偏离（记录在 09-实现记录.md D-15）**：10 文档 §6.1 计划把
 * 「解码 → 缩放 → 编码」放进 Web Worker。v1 先跑在主线程：
 *  - `ImageCodec` 的接口本身就是异步的，将来换成 Worker 实现是本文件内部的替换，
 *    调用方（assets/image.ts、assets/githubStore.ts）一行都不用改；
 *  - 取舍：主线程压缩一张 12MP 照片约有 150–400ms 的可感知停顿，换来的是这条
 *    最容易出错的链路能被类型检查、构建与浏览器冒烟直接验证。
 *
 * 两个必须处理的现实坑：
 *  1. **EXIF 方向**：手机照片的像素是躺倒的，方向写在 EXIF 里。用
 *     `createImageBitmap(file, { imageOrientation: 'from-image' })` 把它烘焙进像素，
 *     否则用户会看到横着的照片。
 *  2. **HEIC**：Safari 能解码、Chrome 不能。解码失败要给明确文案，而不是抛原始异常。
 */
import type { Bytes } from '../utils/bytes';
import type { DecodedSource, EncodeTarget, ImageCodec } from './image';

/** 解码失败（含格式不支持）——调用方据此给出可操作的提示 */
export class AssetDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetDecodeError';
  }
}

interface LoadedSource {
  image: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

function createBitmapFn(): typeof createImageBitmap | undefined {
  return (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
}

function loadViaImgElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new AssetDecodeError('图片加载失败'));
    image.src = url;
  });
}

/**
 * 解码源图。优先 `createImageBitmap`（能带 EXIF 方向选项），
 * 失败时降级到 `<img>`（浏览器对 `<img>` 会自动应用 EXIF 方向）。
 */
async function loadSource(file: Blob): Promise<LoadedSource> {
  const createBitmap = createBitmapFn();
  if (createBitmap) {
    try {
      const bitmap = await createBitmap(file, { imageOrientation: 'from-image' });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // 落到 <img> 路径
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await loadViaImgElement(url);
    return {
      image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (cause) {
    URL.revokeObjectURL(url);
    throw cause;
  }
}

interface WritableCanvas {
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  toBytes(mime: string, quality: number): Promise<Bytes>;
}

function createCanvas(width: number, height: number): WritableCanvas {
  const Offscreen = (globalThis as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
  if (Offscreen) {
    try {
      const canvas = new Offscreen(width, height);
      const context = canvas.getContext('2d');
      if (context) {
        return {
          context,
          async toBytes(mime, quality) {
            const blob = await canvas.convertToBlob({ type: mime, quality });
            return new Uint8Array(await blob.arrayBuffer());
          },
        };
      }
    } catch {
      // 落到 DOM canvas
    }
  }

  if (typeof document === 'undefined') {
    throw new AssetDecodeError('当前环境不支持图片处理（既没有 OffscreenCanvas 也没有 DOM）。');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new AssetDecodeError('当前浏览器不支持画布绘制，无法处理图片。');

  return {
    context,
    toBytes(mime, quality) {
      return new Promise<Bytes>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new AssetDecodeError('图片编码失败'));
              return;
            }
            void blob.arrayBuffer().then(
              (buffer) => resolve(new Uint8Array(buffer)),
              reject,
            );
          },
          mime,
          quality,
        );
      });
    },
  };
}

export function createCanvasCodec(): ImageCodec {
  return {
    async open(file: Blob): Promise<DecodedSource> {
      let loaded: LoadedSource;
      try {
        loaded = await loadSource(file);
      } catch {
        throw new AssetDecodeError(
          '浏览器无法解码这张图片（可能是 HEIC 等格式），请先转换为 JPEG 或 PNG 再试。',
        );
      }

      return {
        width: loaded.width,
        height: loaded.height,
        async encode(target: EncodeTarget): Promise<Bytes> {
          const canvas = createCanvas(target.width, target.height);
          canvas.context.drawImage(loaded.image, 0, 0, target.width, target.height);
          return canvas.toBytes(target.mime, target.quality);
        },
        close(): void {
          loaded.release();
        },
      };
    },
  };
}

/** 默认编解码器；浏览器外（测试/SSR）返回一个会明确报错的实现 */
export function createDefaultCodec(): ImageCodec {
  const hasCanvasApi =
    typeof createBitmapFn() === 'function' || typeof document !== 'undefined';
  if (!hasCanvasApi) {
    return {
      async open(): Promise<DecodedSource> {
        throw new AssetDecodeError('当前环境不支持图片处理。');
      },
    };
  }
  return createCanvasCodec();
}
