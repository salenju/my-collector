import { defineStore } from 'pinia';
import type { SyncState, SyncStatus } from '@my-collector/core';
import { collector } from '@/collector';
import { refreshData } from './refresh';

export type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'brand';

export interface StatusMeta {
  label: string;
  tone: Tone;
  hint: string;
}

export const STATUS_META: Record<SyncStatus, StatusMeta> = {
  unconfigured: { label: '未连接', tone: 'brand', hint: '尚未配置数据仓库，当前记录只保存在本设备' },
  idle: { label: '待同步', tone: 'muted', hint: '尚未开始同步' },
  syncing: { label: '同步中', tone: 'brand', hint: '正在与 GitHub 通信' },
  synced: { label: '已同步', tone: 'ok', hint: '本地与远端一致' },
  pending: { label: '待同步', tone: 'warn', hint: '有本地改动尚未推送' },
  offline: { label: '离线', tone: 'muted', hint: '网络不可用，本地记录不受影响' },
  backoff: { label: '重试中', tone: 'warn', hint: '触发限流或服务异常，稍后自动重试' },
  conflict: { label: '冲突', tone: 'danger', hint: '有冲突需人工处理' },
  'auth-error': { label: '令牌失效', tone: 'danger', hint: '访问令牌无效或权限不足' },
  'read-only': { label: '只读', tone: 'warn', hint: '远端数据版本更高，为避免覆盖已进入只读模式' },
  error: { label: '同步异常', tone: 'danger', hint: '同步过程中发生错误' },
};

export const useSyncStore = defineStore('sync', {
  state: () => ({
    state: collector.sync.getState() as SyncState,
    attached: false,
  }),

  getters: {
    status: (state): SyncStatus => state.state.status,
    meta(): StatusMeta {
      return STATUS_META[this.status] ?? STATUS_META.idle;
    },
    pendingCount: (state) => state.state.pendingCount,
    warnings: (state) => state.state.warnings,
    readOnly: (state) => state.state.readOnly,
    initialized: (state) => state.state.initialized,
    shardCount: (state) => state.state.shardCount,
    lastSyncAt: (state) => state.state.lastSyncAt,
    conflicts: (state) => state.state.conflictLog,
    lastError: (state) => state.state.lastError,
    backoffRemainingMs: (state): number =>
      state.state.backoffUntil === null ? 0 : Math.max(0, state.state.backoffUntil - Date.now()),
    /** 令牌失效 —— 需要用户去设置页处理 */
    needsAuth: (state) => state.state.status === 'auth-error',
  },

  actions: {
    attach() {
      if (this.attached) return;
      this.attached = true;
      collector.sync.setDataChangeHandler(() => {
        void refreshData();
      });
      collector.sync.subscribe((next) => {
        this.state = next;
      });
      this.state = collector.sync.getState();
    },

    syncState() {
      this.state = collector.sync.getState();
    },

    async syncNow() {
      await collector.sync.syncNow();
      this.syncState();
    },

    async pullNow() {
      await collector.sync.pull();
      this.syncState();
    },

    async pushNow() {
      await collector.sync.push();
      this.syncState();
    },

    async flushNow() {
      await collector.sync.flushNow();
      this.syncState();
    },

    resetErrors() {
      collector.sync.resetErrors();
      this.syncState();
    },

    async clearConflictLog() {
      await collector.db.meta.put({ key: 'conflictLog', value: [] });
    },
  },
});
