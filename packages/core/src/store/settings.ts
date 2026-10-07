/**
 * 本地设置服务 —— 见 docs/tec/04-同步引擎与冲突处理.md §1
 *
 * 同步引擎需要**同步地**读取仓库配置/设备信息/合并策略，
 * 因此这里在启动时把设置一次性读入内存缓存，之后用同步 getter 暴露。
 */
import type { KeyValueStore } from '../github/kv';
import {
  DEFAULT_ASSETS_SETTINGS,
  DEFAULT_METADATA_SETTINGS,
  DEFAULT_REPO_CONFIG,
  type AssetsSettings,
  type MergePolicy,
  type MetadataSettings,
  type RepoConfig,
} from '../model/types';
import { newDeviceId } from '../utils/id';
import { SETTINGS_KEYS } from './schema';

export interface DeviceInfo {
  id: string;
  name: string;
}

export interface UiSettings {
  theme: 'light' | 'dark' | 'system';
  density: 'comfortable' | 'compact';
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  theme: 'system',
  density: 'comfortable',
};

/** 根据 UA 猜一个可读的设备名（可在设置页修改） */
export function guessDeviceName(): string {
  const ua = (globalThis.navigator as { userAgent?: string } | undefined)?.userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Safari\//.test(ua)
        ? 'Safari'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : 'Browser';
  const platform = /iPhone|iPad|iPod/.test(ua)
    ? 'iPhone/iPad'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown';
  return `${platform} ${browser}`;
}

export class SettingsService {
  private repoConfigCache: RepoConfig = DEFAULT_REPO_CONFIG;
  private deviceCache: DeviceInfo = { id: '', name: '' };
  private metadataCache: MetadataSettings = DEFAULT_METADATA_SETTINGS;
  private mergePolicyCache: MergePolicy = 'delete-wins';
  private uiCache: UiSettings = DEFAULT_UI_SETTINGS;
  private assetsCache: AssetsSettings = DEFAULT_ASSETS_SETTINGS;
  private lastSyncAtCache: string | null = null;
  private loaded = false;

  constructor(
    private readonly store: KeyValueStore,
    private readonly repoDefaults: RepoConfig = DEFAULT_REPO_CONFIG,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;

    this.repoConfigCache = { ...this.repoDefaults, ...((await this.store.get<RepoConfig>(SETTINGS_KEYS.repo)) ?? {}) };

    const storedDevice = await this.store.get<DeviceInfo>(SETTINGS_KEYS.device);
    if (storedDevice?.id) {
      this.deviceCache = storedDevice;
    } else {
      this.deviceCache = { id: newDeviceId(), name: guessDeviceName() };
      await this.store.set(SETTINGS_KEYS.device, this.deviceCache);
    }

    this.metadataCache = { ...DEFAULT_METADATA_SETTINGS, ...((await this.store.get<MetadataSettings>(SETTINGS_KEYS.metadata)) ?? {}) };
    this.mergePolicyCache = (await this.store.get<MergePolicy>(SETTINGS_KEYS.mergePolicy)) ?? 'delete-wins';
    this.uiCache = { ...DEFAULT_UI_SETTINGS, ...((await this.store.get<UiSettings>(SETTINGS_KEYS.ui)) ?? {}) };
    this.assetsCache = { ...DEFAULT_ASSETS_SETTINGS, ...((await this.store.get<AssetsSettings>(SETTINGS_KEYS.assets)) ?? {}) };
    this.lastSyncAtCache = (await this.store.get<string>(SETTINGS_KEYS.sync)) ?? null;

    this.loaded = true;
  }

  // ── 同步 getter（供引擎使用）──

  get repoConfig(): RepoConfig {
    return this.repoConfigCache;
  }

  get device(): DeviceInfo {
    return this.deviceCache;
  }

  get metadataSettings(): MetadataSettings {
    return this.metadataCache;
  }

  get mergePolicy(): MergePolicy {
    return this.mergePolicyCache;
  }

  get ui(): UiSettings {
    return this.uiCache;
  }

  get assetsSettings(): AssetsSettings {
    return this.assetsCache;
  }

  get lastSyncAt(): string | null {
    return this.lastSyncAtCache;
  }

  // ── 写接口 ──

  async setRepoConfig(config: Partial<RepoConfig>): Promise<RepoConfig> {
    this.repoConfigCache = { ...this.repoConfigCache, ...config };
    await this.store.set(SETTINGS_KEYS.repo, this.repoConfigCache);
    return this.repoConfigCache;
  }

  async setDeviceName(name: string): Promise<DeviceInfo> {
    this.deviceCache = { ...this.deviceCache, name: name.trim() || this.deviceCache.name };
    await this.store.set(SETTINGS_KEYS.device, this.deviceCache);
    return this.deviceCache;
  }

  async setMetadataSettings(settings: Partial<MetadataSettings>): Promise<MetadataSettings> {
    this.metadataCache = { ...this.metadataCache, ...settings };
    await this.store.set(SETTINGS_KEYS.metadata, this.metadataCache);
    return this.metadataCache;
  }

  async setMergePolicy(policy: MergePolicy): Promise<void> {
    this.mergePolicyCache = policy;
    await this.store.set(SETTINGS_KEYS.mergePolicy, policy);
  }

  async setUi(settings: Partial<UiSettings>): Promise<UiSettings> {
    this.uiCache = { ...this.uiCache, ...settings };
    await this.store.set(SETTINGS_KEYS.ui, this.uiCache);
    return this.uiCache;
  }

  async setAssetsSettings(settings: Partial<AssetsSettings>): Promise<AssetsSettings> {
    this.assetsCache = { ...this.assetsCache, ...settings };
    await this.store.set(SETTINGS_KEYS.assets, this.assetsCache);
    return this.assetsCache;
  }

  async setLastSyncAt(iso: string): Promise<void> {
    this.lastSyncAtCache = iso;
    await this.store.set(SETTINGS_KEYS.sync, iso);
  }
}
