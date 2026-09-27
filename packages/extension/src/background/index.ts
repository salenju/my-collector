import {
  PANEL_REREAD_MESSAGE,
  broadcastPanelContext,
  writePanelContext,
  type RereadReply,
} from '../shared/panelContext';
import { readActiveTab, readTab, titleFromUrl, type PageInfo } from '../shared/pageInfo';

/**
 * MV3 Service Worker：只负责「把当前页面信息带进收藏界面」—— 见 docs/tec/06 §5.6。
 *
 * 保存逻辑不放在 SW 里——SW 会被浏览器随时终止，维护跨会话状态（outbox、退避重试）
 * 复杂度陡增；而 popup / 侧边栏都是普通页面上下文，网络请求与表单状态都更简单可靠。
 *
 * 监听器必须**同步注册**在顶层，否则 SW 被重启后收不到事件。
 *
 * 侧边栏有个硬约束：`sidePanel.open()` 只能待在用户手势的同步路径上
 * （前面不能有 `await`，否则 Chrome 视为「非用户手势」而拒绝）。
 * 因此每个入口都是「先同步 open()，再异步取页面信息」。
 */

const MENU_ID = 'my-collector:collect';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '收藏到满天星',
      contexts: ['page', 'link', 'selection'],
    });
  });
});

/**
 * 键盘命令拿不到触发它的窗口，而 SW 随时可能被回收，所以记一个"最近获得焦点的窗口"，
 * 取不到时退回 WINDOW_ID_CURRENT（-2）。
 */
let lastFocusedWindowId: number | undefined;

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) lastFocusedWindowId = windowId;
});

/**
 * 打开侧边栏并交付上下文。
 *
 * `opening` 必须是**在用户手势里同步发起的**那个 promise，这里只负责等它并投递信息；
 * 顺序是：先 writePanelContext（面板 mount 时能立刻读到），再等 open 完成、
 * 最后广播一次（面板早已打开时即时刷新）。open 失败也不中断——信息已落 storage.session，
 * 用户手动打开面板同样能看到。
 */
async function deliverContext(info: PageInfo, opening: Promise<void>): Promise<void> {
  await writePanelContext(info);
  try {
    await opening;
  } catch (error) {
    console.warn('[my-collector] 打开侧边栏失败：', error);
  }
  broadcastPanelContext({ info, at: new Date().toISOString() });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const targetUrl = info.linkUrl ?? info.pageUrl ?? tab?.url ?? '';
  if (!targetUrl) return;

  // 右键菜单点击会授予 activeTab，因此可以注入脚本读取标题/摘要/选中文字
  const windowId = tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
  const opening = chrome.sidePanel.open({ windowId });

  void (async () => {
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
    await deliverContext({ ...pageInfo, selection }, opening);
  })();
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'quick-save') return;

  const windowId = lastFocusedWindowId ?? chrome.windows.WINDOW_ID_CURRENT;
  const opening = chrome.sidePanel.open({ windowId });

  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;

    const pageInfo = await readTab(tab.id, tab.url, tab.title ?? '');
    await deliverContext(pageInfo, opening);
  })();
});

/**
 * 面板内的「重新读取当前页」。
 *
 * 只能读到 activeTab 授权仍有效的那个标签页——授权在**导航或关闭**标签页时会被回收，
 * 切到别的标签页也无法覆盖。读不到就如实回复，让面板提示用户重新触发一次扩展。
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if ((message as { type?: string } | null)?.type !== PANEL_REREAD_MESSAGE) return false;

  void (async () => {
    const info = await readActiveTab();
    const reply: RereadReply = info
      ? { ok: true, message: '已读取当前页', info }
      : {
          ok: false,
          message: '读不到当前标签页（切换过标签页或页面已导航）。请用右键菜单或 Alt+Shift+S 重新打开面板。',
        };

    if (info) {
      await writePanelContext(info);
      broadcastPanelContext({ info, at: new Date().toISOString() });
    }
    sendResponse(reply);
  })();

  return true; // 异步响应
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
