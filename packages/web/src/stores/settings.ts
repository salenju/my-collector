import { defineStore } from 'pinia';
import type {
  AuthPersist,
  ConnectionReport,
  DeviceInfo,
  MergePolicy,
  MetadataSettings,
  RepoConfig,
  UiSettings,
} from '@my-collector/core';
import { collector } from '@/collector';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    repo: collector.settings.repoConfig as RepoConfig,
    device: collector.settings.device as DeviceInfo,
    metadata: collector.settings.metadataSettings as MetadataSettings,
    mergePolicy: collector.settings.mergePolicy as MergePolicy,
    ui: collector.settings.ui as UiSettings,

    hasToken: false,
    maskedToken: null as string | null,
    expiresAt: null as string | null,
    persist: 'local' as AuthPersist,

    testing: false,
    initializing: false,
    connection: null as ConnectionReport | null,
  }),

  getters: {
    isConfigured: (state) => state.hasToken,
    repoSlug: (state) => `${state.repo.owner}/${state.repo.repo}`,
    /** 令牌剩余天数（null 表示未填写过期日期或无法解析） */
    tokenDaysLeft: (state): number | null => {
      if (!state.expiresAt) return null;
      const timestamp = Date.parse(state.expiresAt);
      if (Number.isNaN(timestamp)) return null;
      return Math.floor((timestamp - Date.now()) / 86_400_000);
    },
  },

  actions: {
    async load() {
      this.repo = collector.settings.repoConfig;
      this.device = collector.settings.device;
      this.metadata = collector.settings.metadataSettings;
      this.mergePolicy = collector.settings.mergePolicy;
      this.ui = collector.settings.ui;
      await this.refreshAuth();
    },

    async refreshAuth() {
      this.hasToken = await collector.auth.isConfigured();
      this.maskedToken = await collector.auth.getMasked();
      this.expiresAt = await collector.auth.getExpiresAt();
      this.persist = (await collector.auth.getPersist()) ?? 'local';
    },

    async saveToken(token: string, expiresAt: string | null, persist: AuthPersist) {
      await collector.auth.save({ token: token.trim(), expiresAt, persist });
      await this.refreshAuth();
    },

    async clearToken() {
      await collector.auth.clear();
      await this.refreshAuth();
    },

    async updateRepo(patch: Partial<RepoConfig>) {
      const previous = this.repo;
      this.repo = await collector.settings.setRepoConfig(patch);
      const changed =
        previous.owner !== this.repo.owner ||
        previous.repo !== this.repo.repo ||
        previous.branch !== this.repo.branch ||
        previous.dataDir !== this.repo.dataDir;
      if (changed) {
        // 换仓库后必须清掉远端缓存，否则会用旧 sha 误判「无变化」
        await collector.sync.resetRemoteCache();
        this.connection = null;
      }
    },

    async setDeviceName(name: string) {
      this.device = await collector.settings.setDeviceName(name);
    },

    async setMetadata(patch: Partial<MetadataSettings>) {
      this.metadata = await collector.settings.setMetadataSettings(patch);
    },

    async setMergePolicy(policy: MergePolicy) {
      await collector.settings.setMergePolicy(policy);
      this.mergePolicy = collector.settings.mergePolicy;
    },

    async setUi(patch: Partial<UiSettings>) {
      this.ui = await collector.settings.setUi(patch);
      applyTheme(this.ui);
    },

    async testConnection() {
      this.testing = true;
      try {
        this.connection = await collector.github.testConnection();
        return this.connection;
      } finally {
        this.testing = false;
      }
    },

    async initializeRepo() {
      this.initializing = true;
      try {
        await collector.sync.initializeRepo();
        this.connection = null;
      } finally {
        this.initializing = false;
      }
    },

    /** 危险操作：清空全部本地数据 */
    async wipeLocalData() {
      const { db } = collector;
      await db.transaction(
        'rw',
        [db.items, db.tags, db.outbox, db.fileCache, db.meta, db.drafts, db.metadataCache],
        async () => {
          await Promise.all([
            db.items.clear(),
            db.tags.clear(),
            db.outbox.clear(),
            db.fileCache.clear(),
            db.meta.clear(),
            db.drafts.clear(),
            db.metadataCache.clear(),
          ]);
        },
      );
      await collector.sync.resetRemoteCache();
    },
  },
});

/** 把主题偏好应用到 <html>（class 策略，见 05 文档 §5.1） */
export function applyTheme(ui: UiSettings): void {
  if (typeof document === 'undefined') return;
  const prefersDark =
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = ui.theme === 'dark' || (ui.theme === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
}
