import {
  DEFAULT_REPO_CONFIG,
  GhHttp,
  GithubService,
  PatAuthProvider,
  type RepoConfig,
} from '@my-collector/core';
import { ChromeStorageStore } from './store';

/**
 * 扩展的本地配置。**与网页版各自独立保存令牌**（见 06 文档 §5.4 / D14）：
 * 扩展读不到网页版的 IndexedDB，因此需要各自粘贴一次；
 * 后续可用 externally_connectable 做一键同步（已列在 manifest 里，暂未使用）。
 */
export interface ExtensionConfig {
  repo: RepoConfig;
  deviceName: string;
}

const CONFIG_KEY = 'collector:config';

export const defaultConfig = (): ExtensionConfig => ({
  repo: { ...DEFAULT_REPO_CONFIG },
  deviceName: 'Chrome 扩展',
});

export const localStore = new ChromeStorageStore('local');
export const sessionStore = new ChromeStorageStore('session');
export const auth = new PatAuthProvider(localStore, sessionStore);

export async function loadConfig(): Promise<ExtensionConfig> {
  const stored = await localStore.get<Partial<ExtensionConfig>>(CONFIG_KEY);
  const defaults = defaultConfig();
  return {
    repo: { ...defaults.repo, ...(stored?.repo ?? {}) },
    deviceName: stored?.deviceName ?? defaults.deviceName,
  };
}

export async function saveConfig(patch: Partial<ExtensionConfig>): Promise<ExtensionConfig> {
  const current = await loadConfig();
  const next: ExtensionConfig = {
    repo: { ...current.repo, ...(patch.repo ?? {}) },
    deviceName: patch.deviceName ?? current.deviceName,
  };
  await localStore.set(CONFIG_KEY, next);
  return next;
}

export function createGithub(repo: RepoConfig): GithubService {
  return new GithubService(new GhHttp(auth, () => repo));
}

export async function isConfigured(): Promise<boolean> {
  return auth.isConfigured();
}
