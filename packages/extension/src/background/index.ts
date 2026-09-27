import { paramsFromPageInfo } from '../shared/params';
import { readTab, titleFromUrl, type PageInfo } from '../shared/pageInfo';

/**
 * MV3 Service Worker：只负责「把当前页面信息带进保存窗口」。
 *
 * 保存逻辑不放在 SW 里——SW 会被浏览器随时终止，维护跨会话状态（outbox、退避重试）
 * 复杂度陡增；而 popup 是普通页面上下文，网络请求与表单状态都更简单可靠。
 *
 * 监听器必须**同步注册**在顶层，否则 SW 被重启后收不到事件。
 */

const MENU_ID = 'my-collector:collect';
const QUICK_WINDOW_WIDTH = 420;
const QUICK_WINDOW_HEIGHT = 620;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '收藏到满天星',
      contexts: ['page', 'link', 'selection'],
    });
  });
});

async function openQuickWindow(info: PageInfo): Promise<void> {
  await chrome.windows.create({
    url: `${chrome.runtime.getURL('popup.html')}?quick=1&${paramsFromPageInfo(info)}`,
    type: 'popup',
    width: QUICK_WINDOW_WIDTH,
    height: QUICK_WINDOW_HEIGHT,
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const targetUrl = info.linkUrl ?? info.pageUrl ?? tab?.url ?? '';
  if (!targetUrl) return;

  // 右键菜单点击会授予 activeTab，因此可以注入脚本读取标题/摘要/选中文字
  const pageInfo =
    tab?.id !== undefined
      ? await readTab(tab.id, targetUrl, tab.title ?? '')
      : {
          url: targetUrl,
          title: titleFromUrl(targetUrl),
          description: '',
          selection: '',
          favicon: '',
        };

  const selection = info.selectionText?.trim() || pageInfo.selection;
  await openQuickWindow({ ...pageInfo, selection });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'quick-save') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;

  const pageInfo = await readTab(tab.id, tab.url, tab.title ?? '');
  await openQuickWindow(pageInfo);
});

/** 供网页版通过 externally_connectable 一键同步令牌（a2 预留，当前仅接受并忽略） */
chrome.runtime.onMessageExternal.addListener((message: unknown, _sender, sendResponse) => {
  const payload = message as { type?: string } | null;
  if (payload?.type === 'ping') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return true;
  }
  sendResponse({ ok: false, message: '不支持的消息类型' });
  return true;
});
