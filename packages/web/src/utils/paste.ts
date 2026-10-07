/**
 * 粘贴上传的拦截判定 —— 对应 docs/tec/10-图片功能设计.md §9.1.1。
 *
 * 抽成纯函数（不碰 DOM 之外的东西）是为了能单测：粘贴是"写错了会打断主流程"的逻辑。
 * 用户在「标题」「正文」里粘贴文字/链接是高频操作，**绝不能**因为"粘贴上传图片"
 * 这个新功能而失效——所以判定必须显式、可测、有回归。
 */

/** 应当保留浏览器默认粘贴行为的输入控件 */
const EDITABLE_SELECTOR = 'input, textarea, select';

interface MaybeElement {
  closest?: (selector: string) => Element | null;
  isContentEditable?: boolean;
}

/** 事件目标是否在可编辑控件内（含 contenteditable） */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as MaybeElement | null;
  if (!element) return false;
  if (typeof element.closest === 'function' && element.closest(EDITABLE_SELECTOR)) return true;
  return element.isContentEditable === true;
}

export interface PastedImage {
  blob: Blob;
  /** 剪贴板来源通常没有文件名（截图 / 网页右键复制图片） */
  name?: string;
}

function isImageType(type: string): boolean {
  return type.startsWith('image/');
}

/**
 * 从剪贴板取出图片。
 *
 * 两条路径都要看：
 *  - `files`：复制的是**文件**时（Finder/资源管理器里复制图片文件）有值；
 *  - `items`：截图、网页右键"复制图片"只有 items，需要 `getAsFile()`。
 */
export function imagesFromClipboard(data: DataTransfer | null): PastedImage[] {
  if (!data) return [];

  const images: PastedImage[] = [];
  for (const file of Array.from(data.files ?? [])) {
    if (!isImageType(file.type)) continue;
    images.push({ blob: file, name: file.name || undefined });
  }
  if (images.length > 0) return images;

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !isImageType(item.type)) continue;
    const file = item.getAsFile();
    if (file) images.push({ blob: file });
  }
  return images;
}

/**
 * 是否应当由我们接管这次粘贴。
 * 目标是输入控件 → 让浏览器照常插入文本；剪贴板里没有图片 → 不接管。
 */
export function shouldTakeOverPaste(event: {
  target: EventTarget | null;
  clipboardData: DataTransfer | null;
}): boolean {
  if (isEditableTarget(event.target)) return false;
  return imagesFromClipboard(event.clipboardData).length > 0;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif)$/i;

/** 拖拽进来的文件里挑出图片 */
export function imagesFromDataTransfer(data: DataTransfer | null): PastedImage[] {
  if (!data) return [];
  const images: PastedImage[] = [];
  for (const file of Array.from(data.files ?? [])) {
    // 某些平台拖拽时 `type` 为空，用扩展名兜底
    if (!isImageType(file.type) && !IMAGE_EXT_RE.test(file.name)) continue;
    images.push({ blob: file, name: file.name || undefined });
  }
  return images;
}
