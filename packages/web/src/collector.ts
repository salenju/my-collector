import { createCollector } from '@my-collector/core';

/** 全局唯一的数据层实例（Web 与扩展各自独立） */
export const collector = createCollector({
  dbName: 'my-collector',
  repoDefaults: {
    owner: import.meta.env.VITE_DEFAULT_REPO_OWNER ?? 'salenju',
    repo: import.meta.env.VITE_DEFAULT_REPO_NAME ?? 'my-collector-data',
  },
});

export const APP_TITLE = import.meta.env.VITE_APP_TITLE ?? '满天星';

export const APP_VERSION = '0.1.0';
