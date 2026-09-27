/**
 * 极简键值存储抽象：让 auth / settings 不依赖具体的持久化实现。
 * Web 端用 Dexie 的 settings 表，扩展端可换成 chrome.storage，测试里用 MemoryStore。
 */

export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/**
 * sessionStorage 支撑的存储：用于「仅本次会话保存令牌」的选项。
 * 不可用时（例如被禁用）静默退化为内存存储。
 */
export class SessionStore implements KeyValueStore {
  private readonly fallback = new MemoryStore();
  private readonly prefix = 'my-collector:';

  private get storage(): Storage | null {
    try {
      const s = globalThis.sessionStorage;
      // 触发一次写入以确认真的可用（隐私模式下会抛异常）
      s.setItem(`${this.prefix}__probe`, '1');
      s.removeItem(`${this.prefix}__probe`);
      return s;
    } catch {
      return null;
    }
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const storage = this.storage;
    if (!storage) return this.fallback.get<T>(key);
    const raw = storage.getItem(this.prefix + key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    const storage = this.storage;
    if (!storage) return this.fallback.set(key, value);
    storage.setItem(this.prefix + key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    const storage = this.storage;
    if (!storage) return this.fallback.remove(key);
    storage.removeItem(this.prefix + key);
  }
}
