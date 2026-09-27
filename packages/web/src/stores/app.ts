import { defineStore } from 'pinia';
import { APP_TITLE } from '@/collector';
import { collector } from '@/collector';
import { applyTheme, useSettingsStore } from './settings';
import { useSyncStore } from './sync';
import { refreshData } from './refresh';
import { useToast } from '@/composables/useToast';

export type BootStatus = 'idle' | 'loading' | 'ready' | 'failed';

export const useAppStore = defineStore('app', {
  state: () => ({
    bootStatus: 'idle' as BootStatus,
    bootError: '',
    title: APP_TITLE,
    online: true,
    sidebarOpen: false,
  }),

  getters: {
    ready: (state) => state.bootStatus === 'ready',
  },

  actions: {
    async boot() {
      if (this.bootStatus === 'loading' || this.bootStatus === 'ready') return;
      this.bootStatus = 'loading';
      const toast = useToast();

      try {
        await collector.settings.load();
      } catch (error) {
        this.bootStatus = 'failed';
        this.bootError =
          error instanceof Error
            ? `${error.message}（可能是浏览器隐私模式禁用了本地数据库）`
            : String(error);
        return;
      }

      const settings = useSettingsStore();
      await settings.load();
      applyTheme(settings.ui);

      if (typeof globalThis.matchMedia === 'function') {
        globalThis
          .matchMedia('(prefers-color-scheme: dark)')
          .addEventListener('change', () => applyTheme(settings.ui));
      }

      const sync = useSyncStore();
      sync.attach();

      this.online = typeof navigator === 'undefined' ? true : navigator.onLine;
      globalThis.addEventListener('online', () => {
        this.online = true;
        toast.info('网络已恢复，正在同步…');
      });
      globalThis.addEventListener('offline', () => {
        this.online = false;
      });

      // 离线优先：先用本地缓存渲染，再后台拉取（04 文档 §5.1）
      await refreshData();
      this.bootStatus = 'ready';

      void collector.sync.bootstrap();
      collector.sync.startAutoSync();
    },
  },
});
