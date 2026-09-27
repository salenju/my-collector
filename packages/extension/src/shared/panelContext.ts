import { sessionStore } from './config';
import type { PageInfo } from './pageInfo';

/**
 * 侧边栏上下文 —— 见 docs/tec/06-多端入口设计.md §5.6。
 *
 * SW 里 `sidePanel.open()` 必须待在用户手势的同步路径上（前面不能有 await），
 * 所以流程是「先同步 open()，再异步 readTab()」；取到的页面信息经 `storage.session`
 * 交给面板：面板此时可能还没加载完，`runtime.sendMessage` 会丢，因此**以 session 快照为准**，
 * 消息只用于「面板已打开时」的即时刷新。
 */
export const PANEL_CONTEXT_KEY = 'collector:panel-context';

/** SW → 面板：页面上下文就绪（面板已打开时即时刷新） */
export const PANEL_CONTEXT_MESSAGE = 'panel:context';

/** 面板 → SW：重新读取当前标签页（用户点按钮，不保证 activeTab 仍然有效） */
export const PANEL_REREAD_MESSAGE = 'panel:reread';

export interface PanelContext {
  info: PageInfo;
  /** 捕获时间（ISO） */
  at: string;
}

export interface RereadReply {
  ok: boolean;
  message: string;
  info?: PageInfo;
}

export async function writePanelContext(info: PageInfo): Promise<void> {
  const context: PanelContext = { info, at: new Date().toISOString() };
  await sessionStore.set(PANEL_CONTEXT_KEY, context);
}

export async function readPanelContext(): Promise<PanelContext | null> {
  return (await sessionStore.get<PanelContext>(PANEL_CONTEXT_KEY)) ?? null;
}

/** 侧边栏被打开（或再次被触发）时，把上下文推给已经在运行的面板 */
export function broadcastPanelContext(context: PanelContext): void {
  chrome.runtime
    .sendMessage({ type: PANEL_CONTEXT_MESSAGE, context })
    // 面板没打开时没有接收方，promise 会 reject——这是正常情况，忽略即可
    .catch(() => undefined);
}
