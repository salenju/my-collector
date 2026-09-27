/**
 * 书签小工具（Bookmarklet）—— 见 docs/tec/06-多端入口设计.md §2
 *
 * 设计取舍：
 *  - 不向目标页面注入脚本（部分站点 CSP 会阻断 javascript: 注入的脚本执行），
 *    只同步读取 location / document.title / og:description / 选区，然后开一个小窗口；
 *  - 用 window.open 而非 POST：静态站点没有常驻接口可接收 POST，且用户在点击手势内不会被拦截；
 *  - 弹窗被拦截时降级为当前标签页跳转。
 */

export interface BookmarkletInfo {
  /** 可直接放到 <a href> 上的 javascript: URL */
  href: string;
  /** 编码前的源码，用于「复制代码」与帮助说明 */
  source: string;
  appBaseUrl: string;
}

/** 当前部署下的应用根地址（自动适配 GitHub Pages 子路径与本地开发） */
export function currentAppBaseUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  if (typeof globalThis.location === 'undefined') return base;
  return new URL(base, globalThis.location.origin).toString();
}

export function buildBookmarkletSource(appBaseUrl: string): string {
  const base = JSON.stringify(appBaseUrl);

  return [
    '(function () {',
    '  try {',
    '    var u = location.href;',
    "    var t = document.title || '';",
    "    var d = '';",
    '    var m = document.querySelector(\'meta[name="description"],meta[property="og:description"]\');',
    '    if (m) d = m.getAttribute(\'content\') || \'\';',
    "    var s = '';",
    '    try { s = String(window.getSelection ? window.getSelection() : \'\'); } catch (e) {}',
    "    var q = 'url=' + encodeURIComponent(u)",
    "          + '&title=' + encodeURIComponent(t.slice(0, 500))",
    "          + '&excerpt=' + encodeURIComponent(d.slice(0, 500))",
    "          + '&content=' + encodeURIComponent(s.slice(0, 2000))",
    "          + '&source=bookmarklet';",
    `    var target = ${base} + 'new?' + q;`,
    "    var w = window.open(target, 'my-collector', 'width=560,height=680,popup=1');",
    '    if (!w) location.href = target;',
    '  } catch (e) {',
    `    location.href = ${base} + 'new?source=bookmarklet';`,
    '  }',
    '})();',
  ].join('\n');
}

export function buildBookmarklet(appBaseUrl = currentAppBaseUrl()): BookmarkletInfo {
  const source = buildBookmarkletSource(appBaseUrl);
  return {
    href: `javascript:${encodeURIComponent(source)}`,
    source,
    appBaseUrl,
  };
}
