import { describe, expect, it, vi } from 'vitest';
import { ASSET_LIMITS, DEFAULT_ASSETS_SETTINGS, type AssetsSettings, type ImageMime } from '../model/types';
import {
  checkSource,
  compressionLadder,
  extFor,
  fitWithin,
  mimeForExt,
  outputMimeFor,
  passthroughMime,
  pastedFileName,
  prepareAsset,
  sanitizeName,
  type DecodedSource,
  type EncodeTarget,
  type ImageCodec,
} from './image';

interface FakeOptions {
  width?: number;
  height?: number;
  /** 每次编码返回多少字节；可以是函数（按质量/尺寸变化） */
  sizeFor?: (target: EncodeTarget) => number;
}

interface FakeLog {
  decodes: number;
  encodes: EncodeTarget[];
  closed: number;
}

function fakeCodec(options: FakeOptions = {}): { codec: ImageCodec; log: FakeLog } {
  const log: FakeLog = { decodes: 0, encodes: [], closed: 0 };
  const width = options.width ?? 4000;
  const height = options.height ?? 3000;
  const sizeFor = options.sizeFor ?? (() => 100);

  const codec: ImageCodec = {
    async open(): Promise<DecodedSource> {
      log.decodes += 1;
      return {
        width,
        height,
        async encode(target: EncodeTarget) {
          log.encodes.push(target);
          const size = Math.max(1, Math.round(sizeFor(target)));
          const bytes = new Uint8Array(size);
          bytes[0] = target.quality * 100;
          return bytes;
        },
        close() {
          log.closed += 1;
        },
      };
    },
  };
  return { codec, log };
}

function fakeFile(type = 'image/jpeg', size = 1024): File {
  return new File([new Uint8Array(size)], `photo.${extFor(outputMimeFor(type))}`, { type });
}

const settings: AssetsSettings = { ...DEFAULT_ASSETS_SETTINGS };

describe('图片压缩 · 纯逻辑', () => {
  it('输出格式：png 保留透明通道，其余统一 jpeg', () => {
    expect(outputMimeFor('image/png')).toBe('image/png');
    expect(outputMimeFor('image/jpeg')).toBe('image/jpeg');
    expect(outputMimeFor('image/webp')).toBe('image/jpeg');
    expect(outputMimeFor('')).toBe('image/jpeg');
  });

  it('扩展名与 MIME 互为逆映射', () => {
    expect(extFor('image/png')).toBe('png');
    expect(extFor('image/jpeg')).toBe('jpg');
    expect(mimeForExt('png')).toBe('image/png');
    expect(mimeForExt('JPG')).toBe('image/jpeg');
  });

  it('关闭自动压缩时只接受 jpeg / png', () => {
    expect(passthroughMime('image/jpeg')).toBe('image/jpeg');
    expect(passthroughMime('image/png')).toBe('image/png');
    expect(passthroughMime('image/webp')).toBeNull();
  });

  it('fitWithin 等比缩放且**不放大**', () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(100, 80, 2048)).toEqual({ width: 100, height: 80 });
    expect(fitWithin(4000, 4000, 320)).toEqual({ width: 320, height: 320 });
    // 极端窄图不会缩到 0
    expect(fitWithin(1, 5000, 320)).toEqual({ width: 1, height: 320 });
  });

  it('体积阶梯：默认档先降质再降尺寸', () => {
    expect(compressionLadder(2048, 0.8)).toEqual([
      { maxEdge: 2048, quality: 0.8 },
      { maxEdge: 2048, quality: 0.7 },
      { maxEdge: 1600, quality: 0.7 },
    ]);
  });

  it('体积阶梯：已经是 1600 档时继续降到更低质量（不会重复同一档）', () => {
    expect(compressionLadder(1600, 0.8)).toEqual([
      { maxEdge: 1600, quality: 0.8 },
      { maxEdge: 1600, quality: 0.7 },
      { maxEdge: 1600, quality: 0.6 },
    ]);
  });

  it('源文件校验：非图片 / 空文件 / 超过上限都拒绝', () => {
    expect(checkSource({ type: 'text/plain', size: 100 }).ok).toBe(false);
    expect(checkSource({ type: 'image/jpeg', size: 0 }).ok).toBe(false);
    expect(checkSource({ type: 'image/jpeg', size: ASSET_LIMITS.maxSourceBytes + 1 }).ok).toBe(false);
    expect(checkSource({ type: 'image/jpeg', size: ASSET_LIMITS.maxSourceBytes }).ok).toBe(true);
    expect(checkSource({ type: '', size: 10 }).ok).toBe(true); // 某些来源没有 type，交给解码器判断
  });

  it('文件名清洗：去掉路径与非法字符，超长截断，空则用兜底', () => {
    expect(sanitizeName('../../etc/passwd', 'fallback.jpg')).toBe('passwd');
    expect(sanitizeName('C:\\Users\\me\\截图 2026.png', 'x.png')).toBe('截图 2026.png');
    expect(sanitizeName('a<b>c:d"e|f?g*h.jpg', 'x.jpg')).toBe('a_b_c_d_e_f_g_h.jpg');
    expect(sanitizeName('', 'fallback.jpg')).toBe('fallback.jpg');
    expect(sanitizeName(undefined, 'fallback.jpg')).toBe('fallback.jpg');
    expect(sanitizeName('x'.repeat(400), 'f.jpg')).toHaveLength(ASSET_LIMITS.nameLength);
  });

  it('剪贴板来源合成文件名（扩展名由实际编码结果决定）', () => {
    const at = new Date(2026, 9, 7, 9, 30, 0);
    expect(pastedFileName('image/png', at)).toBe('粘贴-20261007-093000.png');
    expect(pastedFileName('image/jpeg', at)).toBe('粘贴-20261007-093000.jpg');
  });
});

describe('prepareAsset', () => {
  it('只解码一次，产出原图 + 320px 缩略图（原图按 maxEdge 缩放）', async () => {
    const { codec, log } = fakeCodec();
    const result = await prepareAsset(fakeFile(), settings, codec);

    expect(log.decodes).toBe(1);
    expect(log.closed).toBe(1);
    expect(log.encodes).toHaveLength(2);

    expect(result.original.width).toBe(2048);
    expect(result.original.height).toBe(1536);
    expect(result.original.mime).toBe('image/jpeg');
    expect(result.original.bytes.byteLength).toBe(100);

    expect(result.thumb.width).toBe(320);
    expect(result.thumb.height).toBe(240);
    expect(log.encodes[1]?.quality).toBe(0.7);
  });

  it('小图不放大，缩略图也不放大', async () => {
    const { codec } = fakeCodec({ width: 200, height: 100 });
    const result = await prepareAsset(fakeFile(), settings, codec);
    expect(result.original).toMatchObject({ width: 200, height: 100 });
    expect(result.thumb).toMatchObject({ width: 200, height: 100 });
  });

  it('PNG 源保持 PNG（避免透明底变黑）', async () => {
    const { codec } = fakeCodec({ width: 800, height: 600 });
    const result = await prepareAsset(fakeFile('image/png'), settings, codec);
    expect(result.original.mime).toBe('image/png');
    expect(result.thumb.mime).toBe('image/png');
  });

  it('未达目标体积时只用第一档（不做无用功）', async () => {
    const { codec, log } = fakeCodec({ sizeFor: () => 400 * 1024 });
    await prepareAsset(fakeFile(), settings, codec);
    expect(log.encodes).toHaveLength(2); // 原图 1 次 + 缩略图 1 次
    expect(log.encodes[0]?.quality).toBe(0.8);
  });

  it('超过目标体积时逐档降质，直到落到 800KB 以内', async () => {
    // 第一档 1.5MB、第二档 900KB、第三档 500KB
    const sizes = [1536, 900, 500].map((kb) => kb * 1024);
    let index = 0;
    const { codec, log } = fakeCodec({
      sizeFor: () => sizes[Math.min(index++, sizes.length - 1)] ?? 0,
    });
    const result = await prepareAsset(fakeFile(), settings, codec);

    expect(result.original.bytes.byteLength).toBe(500 * 1024);
    // 原图走了 3 档 + 缩略图 1 次
    expect(log.encodes).toHaveLength(4);
    expect(log.encodes.map((entry) => entry.quality)).toEqual([0.8, 0.7, 0.7, 0.7]);
    expect(log.encodes[2]?.width).toBe(1600);
  });

  it('所有档位都超限时返回最后一档（由 stage 决定是否拒绝）', async () => {
    const { codec } = fakeCodec({ sizeFor: () => 5 * 1024 * 1024 });
    const result = await prepareAsset(fakeFile(), settings, codec);
    expect(result.original.bytes.byteLength).toBeGreaterThan(ASSET_LIMITS.targetBytes);
  });

  it('关闭自动压缩：原样使用源字节，但仍解码一次以取得尺寸', async () => {
    const { codec, log } = fakeCodec({ width: 1234, height: 567 });
    const file = fakeFile('image/jpeg', 4096);
    const result = await prepareAsset(file, { ...settings, autoCompress: false }, codec);

    expect(result.original.bytes.byteLength).toBe(4096);
    expect(result.original).toMatchObject({ width: 1234, height: 567 });
    expect(log.decodes).toBe(1);
    // 缩略图仍然会生成（只编码 1 次）
    expect(log.encodes).toHaveLength(1);
  });

  it('关闭自动压缩且源为 webp → 明确报错而不是静默存坏数据', async () => {
    const { codec } = fakeCodec();
    await expect(prepareAsset(fakeFile('image/webp'), { ...settings, autoCompress: false }, codec)).rejects.toThrow(
      /只能原样保存/,
    );
  });

  it('解码失败时把 codec 的错误原样抛出（由 codec 给出可读文案）', async () => {
    const codec: ImageCodec = {
      open: vi.fn().mockRejectedValue(new Error('浏览器无法解码这张图片')),
    };
    await expect(prepareAsset(fakeFile(), settings, codec)).rejects.toThrow(/无法解码/);
  });
});

describe('ASSET_LIMITS 约束', () => {
  it('与文档承诺的数值一致（改动会被这里抓住）', () => {
    expect(ASSET_LIMITS.maxPerItem).toBe(20);
    expect(ASSET_LIMITS.maxSourceBytes).toBe(20 * 1024 * 1024);
    expect(ASSET_LIMITS.maxStoredBytes).toBe(1024 * 1024);
    expect(ASSET_LIMITS.targetBytes).toBe(800 * 1024);
    expect(ASSET_LIMITS.thumbEdge).toBe(320);
  });

  it('默认设置：开启压缩 / 2048 / 0.8 / 200MB 缓存', () => {
    expect(DEFAULT_ASSETS_SETTINGS).toEqual({
      autoCompress: true,
      maxEdge: 2048,
      quality: 0.8,
      cacheBudgetBytes: 200 * 1024 * 1024,
    });
  });
});

describe('ImageMime 类型收窄（编译期约束的运行时体现）', () => {
  it('mimeForExt 只会返回两种合法 mime', () => {
    const values: ImageMime[] = [mimeForExt('png'), mimeForExt('jpg'), mimeForExt('anything')];
    expect(new Set(values)).toEqual(new Set(['image/png', 'image/jpeg']));
  });
});
