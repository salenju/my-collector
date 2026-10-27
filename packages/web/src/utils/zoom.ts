/**
 * 图片灯箱的缩放模型（纯函数，便于单测）。
 *
 * 为什么单独抽出来：缩放比例、适应窗口/适应宽度的换算、以及「缩放后让指针下的
 * 那一点不动」的滚动补偿都是纯数值计算，写错了只表现为手感怪异（长图尤其明显），
 * 单测是唯一低成本的回归手段。
 *
 * 约定：`zoom` 是**相对原图像素**的比例，`1` 即 1:1（100%）。
 */

export interface Size {
  width: number;
  height: number;
}

/** 适应窗口 / 适应宽度 / 手动缩放 */
export type FitMode = 'contain' | 'width' | 'custom';

/** 缩放下限：再小就只剩一条看不清的线 */
export const ZOOM_MIN = 0.05;
/** 缩放上限 */
export const ZOOM_MAX = 8;
/** 单次点按 / 按键的缩放倍率 */
export const ZOOM_STEP = 1.25;
/**
 * 高宽比超过这个值就视为「长图」（长截图、聊天记录、网页长图）。
 * 长图若按「适应窗口」压进一屏，宽度会缩到几十像素、完全没法读，
 * 所以默认按「适应宽度」铺满——这正是本次要解决的核心问题。
 */
export const LONG_IMAGE_RATIO = 2.5;

/** 长宽均为正数才算有效尺寸（元信息缺失 / 图片还没解码时是 0） */
function isValidSize(size: Size | null | undefined): size is Size {
  return (
    !!size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** 界面上显示的百分比（100% = 原始像素） */
export function zoomPercent(zoom: number): number {
  return Math.round(clampZoom(zoom) * 100);
}

/**
 * 适应模式下的缩放比例。尺寸无效时退回 1，避免出现 NaN / 0 导致的空白画布。
 */
export function fitZoom(
  mode: Exclude<FitMode, 'custom'>,
  natural: Size,
  viewport: Size,
): number {
  if (!isValidSize(natural) || !isValidSize(viewport)) return 1;
  const byWidth = viewport.width / natural.width;
  if (mode === 'width') return clampZoom(byWidth);
  return clampZoom(Math.min(byWidth, viewport.height / natural.height));
}

/** 放大 / 缩小一档（乘法步进，等比手感比加法更自然） */
export function zoomBy(zoom: number, direction: 1 | -1): number {
  return clampZoom(zoom * (direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
}

export function isLongImage(natural: Size, ratio = LONG_IMAGE_RATIO): boolean {
  if (!isValidSize(natural)) return false;
  return natural.height / natural.width >= ratio;
}

/** 打开一张图时的默认适应方式：长图铺满宽度，其余压进窗口 */
export function defaultFitMode(natural: Size): Exclude<FitMode, 'custom'> {
  return isLongImage(natural) ? 'width' : 'contain';
}

/**
 * 以指针位置为锚点缩放时，滚动条应当落到哪里。
 *
 * 推导：缩放前后，指针下的**内容坐标**不变
 *   (scroll + pointer) / from === (next + pointer) / to
 * 解得 next === (scroll + pointer) * (to / from) - pointer。
 */
export function scrollAfterZoom(input: {
  pointer: number;
  scroll: number;
  from: number;
  to: number;
}): number {
  const from = input.from > 0 ? input.from : 1;
  const to = input.to > 0 ? input.to : 1;
  const next = (input.scroll + input.pointer) * (to / from) - input.pointer;
  if (!Number.isFinite(next)) return Math.max(0, input.scroll);
  return Math.max(0, Math.round(next));
}
