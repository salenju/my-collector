/**
 * 读取当前页面的元信息 —— 见 docs/tec/06-多端入口设计.md §5.2。
 *
 * 只申请 `activeTab` + `scripting`（在用户点击扩展图标 / 右键菜单 / 快捷键时才会被授予），
 * 不申请 `<all_urls>`，因此不会「读所有网站」。
 */

export interface PageInfo {
  url: string;
  title: string;
  description: string;
  selection: string;
  favicon: string;
}

/**
 * 注入到目标页面执行的函数。
 * 必须是自包含的（Chrome 会序列化它），不能引用外部变量。
 */
function extractPageInfo(): Omit<PageInfo, 'url'> {
  const metaContent = (selectors: string[]): string => {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const value = node?.getAttribute('content');
      if (value && value.trim()) return value.trim();
    }
    return '';
  };

  let favicon = '';
  try {
    const href = document.querySelector('link[rel~="icon"], link[rel="shortcut icon"]')?.getAttribute('href');
    favicon = href ? new URL(href, location.href).toString() : `${location.origin}/favicon.ico`;
  } catch {
    favicon = '';
  }

  let selection = '';
  try {
    selection = String(window.getSelection?.() ?? '').trim().slice(0, 2000);
  } catch {
    selection = '';
  }

  return {
    title: (document.title || '').slice(0, 500),
    description: metaContent([
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ]).slice(0, 500),
    selection,
    favicon,
  };
}

/** 当前活动标签页（popup 打开时用） */
export async function readActiveTab(): Promise<PageInfo | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return null;
  return readTab(tab.id, tab.url, tab.title ?? '');
}

/** 指定标签页（右键菜单 / 快捷键触发时用） */
export async function readTab(tabId: number, url: string, fallbackTitle = ''): Promise<PageInfo> {
  const base: PageInfo = {
    url,
    title: fallbackTitle,
    description: '',
    selection: '',
    favicon: '',
  };

  // chrome:// 、扩展商店等页面不允许注入脚本，此时降级为只有 URL + 标题
  if (!/^https?:/i.test(url)) return base;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageInfo,
    });
    const info = results[0]?.result;
    if (!info) return base;
    return { url, ...info };
  } catch {
    return base;
  }
}

/** 从 URL 猜一个可读标题（注入失败时的兜底） */
export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last).replace(/[-_]+/g, ' ') : parsed.hostname;
  } catch {
    return url;
  }
}
