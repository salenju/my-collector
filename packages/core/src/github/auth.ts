/**
 * 认证抽象 —— 对应 docs/tec/03-GitHub数据层与认证.md §1.5
 *
 * v1 只实现 Fine-grained PAT；接口保持不变，将来接 OAuth Device Flow
 * 只需新增一个 DeviceFlowAuthProvider，业务代码无感。
 */
import type { KeyValueStore } from './kv';

export type AuthPersist = 'local' | 'session';

export interface AuthRecord {
  token: string;
  /** 令牌过期日期（ISO 或 YYYY-MM-DD），用于到期提醒；未知为 null */
  expiresAt: string | null;
  persist: AuthPersist;
}

export interface AuthProvider {
  readonly kind: 'pat' | 'device-flow';
  /** 是否已配置可用凭据 */
  isConfigured(): Promise<boolean>;
  /** 取令牌；未配置时抛错（调用方应先 isConfigured） */
  getToken(): Promise<string>;
  getExpiresAt(): Promise<string | null>;
  /** 只返回掩码，用于 UI 展示；绝不返回明文 */
  getMasked(): Promise<string | null>;
  clear(): Promise<void>;
}

const AUTH_KEY = 'auth';

export function maskToken(token: string): string {
  if (token.length <= 12) return '****';
  return `${token.slice(0, 11)}****${token.slice(-4)}`;
}

export class PatAuthProvider implements AuthProvider {
  readonly kind = 'pat' as const;

  /** 内存缓存，避免每次请求都读一遍存储；不放入任何全局 store */
  private cache: AuthRecord | null | undefined;
  private loaded = false;

  constructor(
    private readonly local: KeyValueStore,
    private readonly session: KeyValueStore,
  ) {}

  private async read(): Promise<AuthRecord | null> {
    if (this.loaded) return this.cache ?? null;
    const fromSession = await this.session.get<AuthRecord>(AUTH_KEY);
    if (fromSession?.token) {
      this.cache = { ...fromSession, persist: 'session' };
      this.loaded = true;
      return this.cache;
    }
    const fromLocal = await this.local.get<AuthRecord>(AUTH_KEY);
    this.cache = fromLocal?.token ? fromLocal : null;
    this.loaded = true;
    return this.cache;
  }

  private invalidate(): void {
    this.loaded = false;
    this.cache = undefined;
  }

  async save(record: AuthRecord): Promise<void> {
    // 切换持久化方式时先清理另一侧，避免"旧令牌仍生效"
    if (record.persist === 'session') {
      await this.local.remove(AUTH_KEY);
      await this.session.set(AUTH_KEY, record);
    } else {
      await this.session.remove(AUTH_KEY);
      await this.local.set(AUTH_KEY, record);
    }
    this.invalidate();
  }

  async isConfigured(): Promise<boolean> {
    const record = await this.read();
    return Boolean(record?.token);
  }

  async getToken(): Promise<string> {
    const record = await this.read();
    if (!record?.token) {
      throw new Error('尚未配置 GitHub 访问令牌');
    }
    return record.token;
  }

  async getExpiresAt(): Promise<string | null> {
    const record = await this.read();
    return record?.expiresAt ?? null;
  }

  async getPersist(): Promise<AuthPersist | null> {
    const record = await this.read();
    return record?.persist ?? null;
  }

  async getMasked(): Promise<string | null> {
    const record = await this.read();
    return record?.token ? maskToken(record.token) : null;
  }

  async clear(): Promise<void> {
    await this.local.remove(AUTH_KEY);
    await this.session.remove(AUTH_KEY);
    this.invalidate();
  }
}
