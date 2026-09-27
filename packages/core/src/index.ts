/**
 * @my-collector/core —— 与运行端无关的数据层。
 *
 * Web 与 Chrome 扩展共用同一份「模型 / 读写 / 同步 / 合并」实现，
 * 避免两端行为漂移（见 docs/tec/01-架构总览.md §4）。
 */
import { PatAuthProvider } from './github/auth';
import { SessionStore, type KeyValueStore } from './github/kv';
import { GhHttp } from './github/http';
import { GithubService } from './github/service';
import { DEFAULT_REPO_CONFIG, type RepoConfig } from './model/types';
import { CollectorRepository } from './store/repository';
import { CollectorDb, DexieSettingsStore } from './store/schema';
import { SettingsService } from './store/settings';
import { SyncEngine } from './sync/engine';

export * from './model/types';
export * from './model/guards';
export * from './github/errors';
export * from './github/auth';
export * from './github/kv';
export * from './github/http';
export * from './github/contents';
export * from './github/gitData';
export * from './github/service';
export * from './store/schema';
export * from './store/settings';
export * from './store/repository';
export * from './sync/engine';
export * from './sync/merge';
export * from './sync/shard';
export * from './sync/paths';
export * from './search/filter';
export * from './services/metadata';
export * from './utils/base64';
export * from './utils/url';
export * from './utils/date';
export * from './utils/id';
export * from './utils/limit';
export * from './utils/json';
export * from './utils/text';

export interface CollectorOptions {
  /** IndexedDB 数据库名（同一浏览器下 Web 与扩展的库天然隔离） */
  dbName?: string;
  /** 仓库默认值，可被本地设置覆盖 */
  repoDefaults?: Partial<RepoConfig>;
}

export interface Collector {
  db: CollectorDb;
  auth: PatAuthProvider;
  github: GithubService;
  sync: SyncEngine;
  repo: CollectorRepository;
  settings: SettingsService;
}

/**
 * 组装数据层。调用方在启动时需 `await collector.settings.load()`，
 * 之后同步 getter（repoConfig / device / mergePolicy）才可用。
 */
export function createCollector(options: CollectorOptions = {}): Collector {
  const db = new CollectorDb(options.dbName ?? 'my-collector');

  const localStore: KeyValueStore = new DexieSettingsStore(db);
  const sessionStore = new SessionStore();

  const auth = new PatAuthProvider(localStore, sessionStore);
  const settings = new SettingsService(localStore, {
    ...DEFAULT_REPO_CONFIG,
    ...options.repoDefaults,
  });

  const http = new GhHttp(auth, () => settings.repoConfig);
  const github = new GithubService(http);

  const sync = new SyncEngine({
    db,
    github,
    auth,
    getConfig: () => settings.repoConfig,
    getDevice: () => settings.device,
    getMergePolicy: () => settings.mergePolicy,
  });

  const repo = new CollectorRepository(db, sync);

  return { db, auth, github, sync, repo, settings };
}
