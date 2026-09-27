import type { KeyValueStore } from '@my-collector/core';

/**
 * chrome.storage 版的 KeyValueStore —— 让 core 的 PatAuthProvider / 设置读写
 * 不依赖 Dexie（扩展不需要完整离线库，见 docs/tec/06-多端入口设计.md §5.3）。
 */
export class ChromeStorageStore implements KeyValueStore {
  constructor(private readonly area: 'local' | 'session' = 'local') {}

  private get storage(): chrome.storage.StorageArea {
    return this.area === 'session' ? chrome.storage.session : chrome.storage.local;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const result = await this.storage.get(key);
    const value = result[key];
    return value === undefined ? undefined : (value as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.storage.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await this.storage.remove(key);
  }

  async keys(): Promise<string[]> {
    return Object.keys(await this.storage.get(null));
  }
}
