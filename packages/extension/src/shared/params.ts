import type { PageInfo } from './pageInfo';

/**
 * 快捷保存窗口通过 URL query 传参（background 无法直接把结构化数据交给 popup 页面，
 * 而 chrome.storage 传递会有竞态，query 最简单可靠）。
 */
export function pageInfoFromParams(search: string): PageInfo | null {
  const params = new URLSearchParams(search);
  const url = params.get('url');
  if (!url) return null;
  return {
    url,
    title: params.get('title') ?? '',
    description: params.get('description') ?? '',
    selection: params.get('selection') ?? '',
    favicon: params.get('favicon') ?? '',
  };
}

export function paramsFromPageInfo(info: PageInfo): string {
  const params = new URLSearchParams({
    url: info.url,
    title: info.title,
    description: info.description,
    selection: info.selection,
    favicon: info.favicon,
  });
  return params.toString();
}

/** 是否以「快捷保存窗口」形态打开（与浏览器工具栏弹窗区分：后者可以自动关闭） */
export function isQuickWindow(search: string): boolean {
  return new URLSearchParams(search).get('quick') === '1';
}
