import { describe, expect, it } from 'vitest';
import {
  imagesFromClipboard,
  imagesFromDataTransfer,
  isEditableTarget,
  shouldTakeOverPaste,
} from './paste';

function file(type: string, name = ''): File {
  return new File([new Uint8Array(8)], name, { type });
}

function dataTransfer(input: {
  files?: File[];
  items?: Array<{ kind: string; type: string; file: File | null }>;
}): DataTransfer {
  return {
    files: (input.files ?? []) as unknown as FileList,
    items: (input.items ?? []).map((entry) => ({
      kind: entry.kind,
      type: entry.type,
      getAsFile: () => entry.file,
    })) as unknown as DataTransferItemList,
  } as DataTransfer;
}

function target(closestResult: Element | null, isContentEditable = false): EventTarget {
  return { closest: () => closestResult, isContentEditable } as unknown as EventTarget;
}

const plainElement = target(null);

describe('isEditableTarget', () => {
  it('在 input / textarea / select 内 → 视为可编辑', () => {
    expect(isEditableTarget(target({} as Element))).toBe(true);
  });

  it('contenteditable 元素 → 视为可编辑', () => {
    expect(isEditableTarget(target(null, true))).toBe(true);
  });

  it('普通元素 / 空目标 → 不是可编辑', () => {
    expect(isEditableTarget(plainElement)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('imagesFromClipboard', () => {
  it('files 里有图片时优先取 files（并从文件名判断来源）', () => {
    const images = imagesFromClipboard(
      dataTransfer({ files: [file('image/png', 'a.png'), file('text/plain', 'x.txt')] }),
    );
    expect(images).toHaveLength(1);
    expect(images[0]?.name).toBe('a.png');
  });

  it('截图 / 网页右键复制图片：files 为空，走 items.getAsFile()', () => {
    const images = imagesFromClipboard(
      dataTransfer({ items: [{ kind: 'file', type: 'image/png', file: file('image/png') }] }),
    );
    expect(images).toHaveLength(1);
    // 剪贴板来源通常没有文件名 → 由 stage 合成「粘贴-…」
    expect(images[0]?.name).toBeUndefined();
  });

  it('忽略非图片的 item（例如复制的文字）', () => {
    expect(
      imagesFromClipboard(
        dataTransfer({ items: [{ kind: 'string', type: 'text/plain', file: null }] }),
      ),
    ).toHaveLength(0);
  });

  it('剪贴板为空时返回空数组', () => {
    expect(imagesFromClipboard(null)).toHaveLength(0);
    expect(imagesFromClipboard(dataTransfer({}))).toHaveLength(0);
  });
});

describe('shouldTakeOverPaste（10 文档 §9.1.1 的拦截规则）', () => {
  const withImage = dataTransfer({ items: [{ kind: 'file', type: 'image/png', file: file('image/png') }] });

  it('⚠️ 目标在输入控件内时**绝不接管**（否则正文里粘贴文字会失效）', () => {
    expect(shouldTakeOverPaste({ target: target({} as Element), clipboardData: withImage })).toBe(false);
  });

  it('目标在编辑区、剪贴板有图片 → 接管', () => {
    expect(shouldTakeOverPaste({ target: plainElement, clipboardData: withImage })).toBe(true);
  });

  it('剪贴板只有文字 → 不接管', () => {
    expect(
      shouldTakeOverPaste({
        target: plainElement,
        clipboardData: dataTransfer({ items: [{ kind: 'string', type: 'text/plain', file: null }] }),
      }),
    ).toBe(false);
  });

  it('剪贴板为空 → 不接管', () => {
    expect(shouldTakeOverPaste({ target: plainElement, clipboardData: null })).toBe(false);
  });
});

describe('imagesFromDataTransfer', () => {
  it('按 MIME 挑出图片', () => {
    const images = imagesFromDataTransfer(
      dataTransfer({ files: [file('image/jpeg', 'a.jpg'), file('application/pdf', 'b.pdf')] }),
    );
    expect(images).toHaveLength(1);
    expect(images[0]?.name).toBe('a.jpg');
  });

  it('MIME 为空时按扩展名兜底（部分平台拖拽不带 type）', () => {
    const images = imagesFromDataTransfer(
      dataTransfer({ files: [file('', 'photo.JPEG'), file('', 'notes.txt')] }),
    );
    expect(images).toHaveLength(1);
    expect(images[0]?.name).toBe('photo.JPEG');
  });

  it('空 dataTransfer 返回空数组', () => {
    expect(imagesFromDataTransfer(null)).toHaveLength(0);
  });
});
