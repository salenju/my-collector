import { describe, expect, it } from 'vitest';
import {
  LONG_IMAGE_RATIO,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  defaultFitMode,
  fitZoom,
  isLongImage,
  scrollAfterZoom,
  zoomBy,
  zoomPercent,
} from './zoom';

const viewport = { width: 1000, height: 800 };
/** 常见竖屏截图 1080×2400（比值 2.22，未到长图） */
const phoneShot = { width: 1080, height: 2400 };
/** 网页长截图 1080×10800（比值 10，典型长图） */
const longShot = { width: 1080, height: 10800 };
/** 横向照片 */
const landscape = { width: 4000, height: 3000 };

describe('clampZoom', () => {
  it('夹在上下限之间', () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it('非法值退回 1', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('zoomPercent', () => {
  it('1 表示 100%', () => {
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(0.333)).toBe(33);
    expect(zoomPercent(2.5)).toBe(250);
  });
});

describe('fitZoom', () => {
  it('适应窗口取宽高比例的较小值', () => {
    // 横向照片：1000/4000=0.25 < 800/3000=0.267 → 0.25
    expect(fitZoom('contain', landscape, viewport)).toBeCloseTo(0.25, 5);
  });

  it('适应窗口对长图会缩到很小——正是要避开的情况', () => {
    // 由高度决定：800 / 10800 ≈ 0.074，宽度只剩 80px
    expect(fitZoom('contain', longShot, viewport)).toBeCloseTo(viewport.height / longShot.height, 5);
  });

  it('适应宽度只看宽度', () => {
    expect(fitZoom('width', longShot, viewport)).toBeCloseTo(1000 / 1080, 5);
    expect(fitZoom('width', landscape, viewport)).toBeCloseTo(0.25, 5);
  });

  it('尺寸缺失时退回 1（不产生 NaN）', () => {
    expect(fitZoom('contain', { width: 0, height: 0 }, viewport)).toBe(1);
    expect(fitZoom('width', landscape, { width: 0, height: 0 })).toBe(1);
  });

  it('超小图适应窗口时不突破上限', () => {
    expect(fitZoom('contain', { width: 4, height: 4 }, viewport)).toBe(ZOOM_MAX);
  });
});

describe('zoomBy', () => {
  it('放大 / 缩小互为逆操作', () => {
    expect(zoomBy(1, 1)).toBeCloseTo(1.25, 5);
    expect(zoomBy(zoomBy(1, 1), -1)).toBeCloseTo(1, 5);
  });

  it('不越过上下限', () => {
    expect(zoomBy(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(zoomBy(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });
});

describe('isLongImage / defaultFitMode', () => {
  it('高宽比达到阈值才算长图', () => {
    expect(isLongImage(longShot)).toBe(true);
    expect(isLongImage(phoneShot)).toBe(false);
    // 正好等于阈值 → 算长图
    expect(isLongImage({ width: 1000, height: 1000 * LONG_IMAGE_RATIO })).toBe(true);
    expect(isLongImage({ width: 1000, height: 1000 * LONG_IMAGE_RATIO - 1 })).toBe(false);
  });

  it('尺寸缺失时不当作长图', () => {
    expect(isLongImage({ width: 0, height: 0 })).toBe(false);
  });

  it('长图默认适应宽度，其余适应窗口', () => {
    expect(defaultFitMode(longShot)).toBe('width');
    expect(defaultFitMode(landscape)).toBe('contain');
  });
});

describe('scrollAfterZoom', () => {
  it('以指针为锚点缩放后，指针下的内容坐标不变', () => {
    const input = { pointer: 100, scroll: 200, from: 1, to: 2 };
    const next = scrollAfterZoom(input);
    expect(next).toBe(500);
    // 缩放前：(200 + 100) / 1 = 300；缩放后：(500 + 100) / 2 = 300
    expect((input.scroll + input.pointer) / input.from).toBeCloseTo(
      (next + input.pointer) / input.to,
      5,
    );
  });

  it('缩小时不会出现负的滚动值', () => {
    expect(scrollAfterZoom({ pointer: 10, scroll: 0, from: 4, to: 1 })).toBe(0);
  });

  it('非法的 from 不会产生 NaN', () => {
    expect(scrollAfterZoom({ pointer: 50, scroll: 30, from: 0, to: 2 })).toBe(
      Math.round((30 + 50) * 2 - 50),
    );
  });
});
