/**
 * 同步引擎 —— 见 docs/tec/04-同步引擎与冲突处理.md
 *
 * 不变式：
 *  1. 本地写入永远是同步的、立即成功的（由 repository 层完成）；
 *  2. 网络同步永远是异步的、可失败的、可重试的；
 *  3. 远端写入永远是一次原子提交（Git Data API）。
 */
import type { PatAuthProvider } from '../github/auth';
import { humanMessage, isGhError, type GhErrorKind } from '../github/errors';
import type { GithubService } from '../github/service';
import { isSchemaCompatible, parseItemsFile, parseMetaFile, parseTagsFile } from '../model/guards';
import {
  CURRENT_SCHEMA_VERSION,
  type Item,
  type MergePolicy,
  type MetaFile,
  type RemoteSnapshot,
  type RepoConfig,
  type Tag,
} from '../model/types';
import { META_KEYS, type CollectorDb, type OutboxRow } from '../store/schema';
import { currentMonth, nowIso } from '../utils/date';
import { parseJsonSafe } from '../utils/json';
import { mapLimit, sleep } from '../utils/limit';
import { acquireLock, type LockHandle } from './lock';
import { findStaleOutboxIds, mergeItems, mergeTags, type MergeConflict } from './merge';
import { metaPath, monthFromShardPath, shardPath, tagsPath } from './paths';
import {
  defaultMeta,
  defaultTags,
  readmeContent,
  renderItemsFile,
  renderMetaFile,
  renderTagsFile,
} from './shard';

export type SyncStatus =
  | 'unconfigured'
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'pending'
  | 'offline'
  | 'backoff'
  | 'conflict'
  | 'auth-error'
  | 'read-only'
  /** 非网络类错误（数据校验、程序缺陷）：自动重试无意义，需人工介入 */
  | 'error';

export interface SyncError {
  kind: GhErrorKind | 'validation';
  message: string;
}

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: string | null;
  pendingCount: number;
  conflictLog: MergeConflict[];
  lastError: SyncError | null;
  /** 退避重试的时间点（epoch ms） */
  backoffUntil: number | null;
  /** 拉取过程中的非致命告警（坏数据、分支不一致等） */
  warnings: string[];
  /** 远端是否已初始化（存在 meta.json） */
  initialized: boolean;
  /** 远端分片数 */
  shardCount: number;
  /** 远端 schema 版本更高时为只读模式 */
  readOnly: boolean;
}

export interface SyncEngineOptions {
  db: CollectorDb;
  github: GithubService;
  auth: PatAuthProvider;
  getConfig: () => RepoConfig;
  getDevice: () => { id: string; name: string };
  getMergePolicy: () => MergePolicy;
  onDataChanged?: () => void;
}

/** 退避阶梯：2s → 5s → 15s → 60s → 300s 封顶（04 文档 §6） */
const BACKOFF_STEPS_MS = [2_000, 5_000, 15_000, 60_000, 300_000];
const MAX_CONFLICT_RETRIES = 3;
const PULL_CONCURRENCY = 6;
const LOCK_NAME = 'my-collector:sync';
const PUSH_DEBOUNCE_MS = 2_000;
const PUSH_MAX_DELAY_MS = 5_000;
const FOCUS_PULL_INTERVAL_MS = 60_000;

const README_PATH = 'README.md';

interface ShardPlan {
  path: string;
  month: string;
  sha: string;
}

export class SyncEngine {
  private readonly db: CollectorDb;
  private readonly github: GithubService;
  private readonly auth: PatAuthProvider;
  private readonly getConfig: () => RepoConfig;
  private readonly getDevice: () => { id: string; name: string };
  private readonly getMergePolicy: () => MergePolicy;
  /** 拉取到新数据后的回调；可在 Pinia 就绪后再注入（见 setDataChangeHandler） */
  private onDataChanged: (() => void) | undefined;

  private state: SyncState = {
    status: 'idle',
    lastSyncAt: null,
    pendingCount: 0,
    conflictLog: [],
    lastError: null,
    backoffUntil: null,
    warnings: [],
    initialized: false,
    shardCount: 0,
    readOnly: false,
  };

  private readonly listeners = new Set<(state: SyncState) => void>();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private autoStarted = false;

  constructor(options: SyncEngineOptions) {
    this.db = options.db;
    this.github = options.github;
    this.auth = options.auth;
    this.getConfig = options.getConfig;
    this.getDevice = options.getDevice;
    this.getMergePolicy = options.getMergePolicy;
    this.onDataChanged = options.onDataChanged;
  }

  // ────────────────────────────── 状态 ──────────────────────────────

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setDataChangeHandler(handler: () => void): void {
    this.onDataChanged = handler;
  }

  private patch(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.state);
  }

  private setError(error: unknown): SyncError {
    if (isGhError(error)) {
      return { kind: error.kind, message: humanMessage(error) };
    }
    return { kind: 'validation', message: error instanceof Error ? error.message : String(error) };
  }

  private emitDataChanged(): void {
    this.onDataChanged?.();
  }

  async refreshPendingCount(): Promise<number> {
    const pendingCount = await this.db.outbox.count();
    const partial: Partial<SyncState> = { pendingCount };
    if (pendingCount > 0 && (this.state.status === 'synced' || this.state.status === 'idle')) {
      partial.status = 'pending';
    }
    this.patch(partial);
    return pendingCount;
  }

  async pendingIds(): Promise<Set<string>> {
    const rows = await this.db.outbox.toArray();
    return new Set(rows.map((row) => row.entityId));
  }

  // ────────────────────────────── 启动 ──────────────────────────────

  /** 应用启动：先渲染本地（由上层负责），再后台拉取 */
  async bootstrap(): Promise<void> {
    await this.refreshPendingCount();
    if (!(await this.auth.isConfigured())) {
      this.patch({ status: 'unconfigured' });
      return;
    }
    await this.syncNow();
  }

  /** 注册自动同步触发器：online / focus / visibilitychange（04 文档 §6） */
  startAutoSync(): void {
    if (this.autoStarted || typeof globalThis.addEventListener !== 'function') return;
    this.autoStarted = true;

    globalThis.addEventListener('online', () => {
      this.retryAttempt = 0;
      void this.syncNow();
    });
    globalThis.addEventListener('focus', () => {
      void this.pullIfStale();
    });

    const doc = (globalThis as { document?: Document }).document;
    doc?.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') {
        // 用户在移动端切走之前，尽量把待同步数据推出去
        void this.flushNow();
      }
    });
  }

  private async pullIfStale(): Promise<void> {
    const last = this.state.lastSyncAt ? Date.parse(this.state.lastSyncAt) : 0;
    if (Date.now() - last < FOCUS_PULL_INTERVAL_MS) return;
    await this.syncNow();
  }

  /** 立即推送（忽略 debounce），用于页面隐藏等场景 */
  async flushNow(): Promise<void> {
    this.clearTimers();
    if (!(await this.auth.isConfigured())) return;
    if ((await this.db.outbox.count()) === 0) return;
    await this.push();
  }

  /** 手动/自动的完整同步：先拉后推 */
  async syncNow(): Promise<void> {
    if (!(await this.auth.isConfigured())) {
      this.patch({ status: 'unconfigured' });
      return;
    }
    try {
      await this.pull();
    } catch {
      // pull 内部已记录错误状态
    }
    if ((await this.db.outbox.count()) > 0) {
      await this.push();
    } else {
      await this.refreshPendingCount();
    }
  }

  // ────────────────────────────── 拉取 ──────────────────────────────

  async pull(): Promise<void> {
    const lock = await acquireLock(LOCK_NAME);
    if (!lock) return;
    try {
      await this.pullInternal();
    } finally {
      lock.release();
    }
  }

  private async pullInternal(): Promise<void> {
    const cfg = this.getConfig();
    this.patch({ status: 'syncing', lastError: null });

    try {
      const head = await this.github.git.getHead();
      if (!head) {
        // 仓库存在但没有任何提交 → 等待初始化
        this.patch({
          status: 'synced',
          initialized: false,
          shardCount: 0,
          lastSyncAt: nowIso(),
          warnings: ['数据仓库是空的，请到设置页执行「初始化数据仓库」。'],
        });
        return;
      }

      const listing = await this.github.git.listFiles();
      const remoteShas: Record<string, string> = {};
      for (const entry of listing.entries) remoteShas[entry.path] = entry.sha;

      const cacheRows = await this.db.fileCache.toArray();
      const cacheMap = new Map(cacheRows.map((row) => [row.path, row]));

      const warnings: string[] = [];
      if (listing.truncated) warnings.push('仓库文件列表被 GitHub 截断，可能漏读部分分片。');

      // 1) meta.json
      const remoteMeta = await this.readRemoteMeta(cfg, remoteShas, cacheMap.get(metaPath(cfg)));
      if (remoteMeta?.notModified) {
        // 保持本地已有镜像
      }
      const metaFile = remoteMeta?.value ?? ((await this.db.meta.get(META_KEYS.metaFile))?.value as MetaFile | undefined) ?? null;

      if (metaFile && !isSchemaCompatible(metaFile.schemaVersion)) {
        this.patch({
          status: 'read-only',
          readOnly: true,
          initialized: true,
          lastSyncAt: nowIso(),
          warnings: [
            `远端数据的 schema 版本为 ${metaFile.schemaVersion}，高于当前应用的 ${CURRENT_SCHEMA_VERSION}。已进入只读模式，请升级应用。`,
          ],
        });
        return;
      }

      if (metaFile) {
        warnings.push(...remoteMeta?.warnings ?? []);
      } else if (!remoteShas[metaPath(cfg)]) {
        warnings.push('远端缺少 meta.json，建议重新初始化数据仓库。');
      }

      // 2) 需要拉取的分片
      const plans: ShardPlan[] = [];
      for (const entry of listing.entries) {
        const month = monthFromShardPath(cfg, entry.path);
        if (!month) continue;
        if (cacheMap.get(entry.path)?.sha === entry.sha) continue;
        plans.push({ path: entry.path, month, sha: entry.sha });
      }

      const tagsDirty = remoteShas[tagsPath(cfg)] !== cacheMap.get(tagsPath(cfg))?.sha;

      // 3) 网络拉取（事务外完成，避免长事务）
      const fetchedShards = await mapLimit(plans, PULL_CONCURRENCY, async (plan) => {
        const file = await this.github.contents.getText(plan.path, cacheMap.get(plan.path)?.etag ?? null);
        if (file.notModified) {
          // 理论上不会发生（sha 已不同），保持本地数据即可
          return { plan, parsed: null as ReturnType<typeof parseItemsFile> | null, etag: file.etag };
        }
        return { plan, parsed: parseItemsFile(parseJsonSafe(file.text)), etag: file.etag };
      });

      let fetchedTags: ReturnType<typeof parseTagsFile> | null = null;
      let tagsEtag: string | null = null;
      if (tagsDirty) {
        const file = await this.github.contents.getText(
          tagsPath(cfg),
          cacheMap.get(tagsPath(cfg))?.etag ?? null,
        );
        if (!file.notModified) {
          fetchedTags = parseTagsFile(parseJsonSafe(file.text));
          tagsEtag = file.etag;
        }
      }

      // 4) 合并 + 落库（单个事务，避免半新半旧）
      const mergeOptions = {
        policy: this.getMergePolicy(),
        now: nowIso(),
        pending: await this.pendingIds(),
      };
      const conflicts: MergeConflict[] = [];
      let skipped = 0;

      await this.db.transaction(
        'rw',
        [this.db.items, this.db.tags, this.db.fileCache, this.db.meta, this.db.outbox],
        async () => {
          for (const entry of fetchedShards) {
            if (!entry.parsed) continue;
            if (!entry.parsed.ok || !entry.parsed.data) {
              warnings.push(...entry.parsed.warnings);
              continue;
            }
            skipped += entry.parsed.skipped;
            warnings.push(...entry.parsed.warnings);

            const remoteItems = entry.parsed.data.items;
            const localItems = await this.db.items
              .where('createdAt')
              .startsWith(entry.plan.month)
              .toArray();

            const outcome = mergeItems(localItems, remoteItems, mergeOptions);
            conflicts.push(...outcome.conflicts);

            const mergedMap = new Map(outcome.values.map((item) => [item.id, item]));
            const staleIds = findStaleOutboxIds(outcome.values, localItems);

            // 丢弃已被远端版本覆盖的本地待推送操作
            for (const id of staleIds) {
              await this.db.outbox.where('entityId').equals(id).delete();
            }

            // 本地存在但远端已无（且不在合并结果里）→ 删除本地
            for (const localItem of localItems) {
              if (!mergedMap.has(localItem.id)) await this.db.items.delete(localItem.id);
            }
            for (const item of outcome.values) {
              await this.db.items.put(item);
            }

            await this.db.fileCache.put({
              path: entry.plan.path,
              sha: entry.plan.sha,
              etag: entry.etag,
              size: null,
              updatedAt: nowIso(),
            });
          }

          if (fetchedTags) {
            if (!fetchedTags.ok || !fetchedTags.data) {
              warnings.push(...fetchedTags.warnings);
            } else {
              warnings.push(...fetchedTags.warnings);
              skipped += fetchedTags.skipped;
              const localTags = await this.db.tags.toArray();
              const outcome = mergeTags(localTags, fetchedTags.data.tags, mergeOptions);
              conflicts.push(...outcome.conflicts);
              const mergedIds = new Set(outcome.values.map((tag) => tag.id));
              for (const localTag of localTags) {
                if (!mergedIds.has(localTag.id)) await this.db.tags.delete(localTag.id);
              }
              for (const tag of outcome.values) await this.db.tags.put(tag);

              for (const id of findStaleOutboxIds(outcome.values, localTags)) {
                await this.db.outbox.where('entityId').equals(id).delete();
              }

              await this.db.fileCache.put({
                path: tagsPath(cfg),
                sha: remoteShas[tagsPath(cfg)] ?? '',
                etag: tagsEtag,
                size: null,
                updatedAt: nowIso(),
              });
            }
          }

          if (metaFile) {
            await this.db.meta.put({ key: META_KEYS.metaFile, value: metaFile });
          }

          const snapshot: RemoteSnapshot = {
            commitSha: head.commitSha,
            treeSha: listing.treeSha,
            files: remoteShas,
            fetchedAt: nowIso(),
          };
          await this.db.meta.put({ key: META_KEYS.remote, value: snapshot });
        },
      );

      if (skipped > 0) warnings.push(`本次同步共跳过 ${skipped} 条结构异常的数据。`);

      this.patch({
        status: conflicts.length > 0 ? 'pending' : 'synced',
        initialized: Boolean(metaFile),
        shardCount: plans.length > 0 || listing.entries.length > 0
          ? listing.entries.filter((entry) => monthFromShardPath(cfg, entry.path) !== null).length
          : this.state.shardCount,
        lastSyncAt: nowIso(),
        warnings,
        conflictLog: conflicts.length > 0 ? [...conflicts, ...this.state.conflictLog].slice(0, 50) : this.state.conflictLog,
        readOnly: false,
      });
      this.emitDataChanged();
      await this.refreshPendingCount();
    } catch (error) {
      this.handleSyncFailure(error);
      throw error;
    }
  }

  private async readRemoteMeta(
    cfg: RepoConfig,
    remoteShas: Record<string, string>,
    cached: { sha: string; etag: string | null } | undefined,
  ): Promise<{ value: MetaFile | null; warnings: string[]; notModified: boolean } | null> {
    const path = metaPath(cfg);
    if (!remoteShas[path]) return null;
    if (cached?.sha === remoteShas[path]) return { value: null, warnings: [], notModified: true };

    const file = await this.github.contents.getText(path, cached?.etag ?? null);
    if (file.notModified) return { value: null, warnings: [], notModified: true };

    const parsed = parseMetaFile(parseJsonSafe(file.text));
    const warnings: string[] = [];
    if (!parsed.ok || !parsed.data) {
      warnings.push('meta.json 结构非法，已忽略。');
      return { value: null, warnings, notModified: false };
    }
    return { value: parsed.data, warnings, notModified: false };
  }

  // ────────────────────────────── 推送 ──────────────────────────────

  /** 本地写入后调用：debounce 合并多次操作为一次提交 */
  schedulePush(): void {
    if (this.pushTimer === null) {
      this.pushTimer = setTimeout(() => {
        this.pushTimer = null;
        void this.push();
      }, PUSH_DEBOUNCE_MS);
      // 最长 5s 强制 flush，避免连续操作导致永远不推送
      this.pushDeadlineTimer = setTimeout(() => {
        this.pushDeadlineTimer = null;
        if (this.pushTimer !== null) {
          clearTimeout(this.pushTimer);
          this.pushTimer = null;
          void this.push();
        }
      }, PUSH_MAX_DELAY_MS);
    }
    void this.refreshPendingCount();
  }

  private clearTimers(): void {
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    if (this.pushDeadlineTimer !== null) clearTimeout(this.pushDeadlineTimer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.pushTimer = null;
    this.pushDeadlineTimer = null;
    this.retryTimer = null;
  }

  async push(): Promise<void> {
    const lock = await acquireLock(LOCK_NAME);
    if (!lock) return;
    try {
      await this.pushWithRetries();
    } finally {
      lock.release();
    }
  }

  private async pushWithRetries(): Promise<void> {
    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
      try {
        await this.pushInternal();
        return;
      } catch (error) {
        if (isGhError(error) && error.kind === 'conflict' && attempt < MAX_CONFLICT_RETRIES - 1) {
          // 分支已前进：先拉取并合并，再重试（04 文档 §5）
          await this.pullInternal();
          continue;
        }
        if (attempt === MAX_CONFLICT_RETRIES - 1 && isGhError(error) && error.kind === 'conflict') {
          this.patch({
            status: 'conflict',
            lastError: this.setError(error),
          });
          return;
        }
        this.handleSyncFailure(error);
        return;
      }
    }
  }

  private async pushInternal(): Promise<void> {
    if (!(await this.auth.isConfigured())) {
      this.patch({ status: 'unconfigured' });
      return;
    }
    if (this.state.readOnly) return;

    const ops = await this.db.outbox.orderBy('seq').toArray();
    if (ops.length === 0) {
      await this.refreshPendingCount();
      return;
    }

    const cfg = this.getConfig();
    this.patch({ status: 'syncing', lastError: null });

    const head = await this.github.git.getHead();
    const files = await this.renderAffectedFiles(ops, cfg);

    const result = await this.github.git.commitAtomic({
      files,
      message: this.buildMessage(ops),
      head,
    });

    const now = nowIso();
    await this.db.transaction('rw', [this.db.outbox, this.db.fileCache, this.db.meta], async () => {
      const seqs = ops.map((op) => op.seq).filter((seq): seq is number => typeof seq === 'number');
      if (seqs.length > 0) await this.db.outbox.bulkDelete(seqs);

      for (const [path, sha] of Object.entries(result.blobShas)) {
        const existing = await this.db.fileCache.get(path);
        await this.db.fileCache.put({
          path,
          sha,
          etag: existing?.etag ?? null,
          size: null,
          updatedAt: now,
        });
      }

      const previous = ((await this.db.meta.get(META_KEYS.remote))?.value as RemoteSnapshot | undefined) ?? null;
      const snapshot: RemoteSnapshot = {
        commitSha: result.commitSha,
        treeSha: result.treeSha,
        files: { ...(previous?.files ?? {}), ...result.blobShas },
        fetchedAt: now,
      };
      await this.db.meta.put({ key: META_KEYS.remote, value: snapshot });
    });

    this.retryAttempt = 0;
    this.patch({
      status: 'synced',
      lastSyncAt: now,
      lastError: null,
      backoffUntil: null,
      initialized: true,
    });
    await this.refreshPendingCount();
    if (this.state.pendingCount > 0) this.schedulePush();
  }

  private async renderAffectedFiles(
    ops: readonly OutboxRow[],
    cfg: RepoConfig,
  ): Promise<Array<{ path: string; text: string }>> {
    const files: Array<{ path: string; text: string }> = [];
    const months = new Set<string>();
    let needTags = false;
    let needMeta = false;

    const itemIds = ops.filter((op) => op.entity === 'item').map((op) => op.entityId);
    if (itemIds.length > 0) {
      const items = await this.db.items.bulkGet(itemIds);
      for (const item of items) {
        if (item) months.add(item.createdAt.slice(0, 7));
      }
    }
    for (const op of ops) {
      if (op.entity === 'tag') needTags = true;
      if (op.entity === 'meta') needMeta = true;
    }

    for (const month of [...months].sort()) {
      const items = await this.db.items.where('createdAt').startsWith(month).toArray();
      files.push({ path: shardPath(cfg, month), text: renderItemsFile(month, items) });
    }

    if (needTags) {
      const tags = await this.db.tags.toArray();
      files.push({ path: tagsPath(cfg), text: renderTagsFile(tags) });
    }

    if (needMeta) {
      const meta = await this.buildMetaFile();
      files.push({ path: metaPath(cfg), text: renderMetaFile(meta) });
    }

    return files;
  }

  private async buildMetaFile(): Promise<MetaFile> {
    const existing = (await this.db.meta.get(META_KEYS.metaFile))?.value as MetaFile | undefined;
    const base: MetaFile = existing ?? defaultMeta(nowIso());
    const device = this.getDevice();
    const expiresAt = await this.auth.getExpiresAt();
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: base.createdAt,
      tokenExpiresAt: expiresAt ?? base.tokenExpiresAt ?? null,
      deviceNames: { ...(base.deviceNames ?? {}), [device.id]: device.name },
    };
  }

  private buildMessage(ops: readonly OutboxRow[]): string {
    const device = this.getDevice();
    const itemOps = ops.filter((op) => op.entity === 'item');
    const tagOps = ops.filter((op) => op.entity === 'tag');
    const header = `sync: ${itemOps.length} 条条目, ${tagOps.length} 个标签 [device:${device.name || device.id}]`;
    const lines = ops.map((op) => {
      const mark = op.action === 'delete' ? '-' : '±';
      return `${mark} ${op.entity}\t${op.entityId}`;
    });
    return [header, '', ...lines].join('\n');
  }

  // ────────────────────────────── 初始化 ──────────────────────────────

  /**
   * 在尚未初始化的仓库上创建 data/ 骨架（一次原子提交）。
   *
   * 不要求仓库为空：GitHub 新建仓库时勾选「Add a README」会产生首个提交，
   * 这是很常见的情况（而且完全没有理由要求用户先删掉它）。
   * 因此判据是「是否已存在 data/meta.json」，而不是「是否为空仓库」。
   *
   * 原则：**已存在的文件一律不覆盖**。已有提交时在既有 tree 上增量提交
   * （base_tree = 当前 HEAD 的 tree），README / 已有的 tags.json 等原样保留。
   */
  async initializeRepo(): Promise<void> {
    const lock = await this.lockOrThrow();
    try {
      const cfg = this.getConfig();
      const head = await this.github.git.getHead();
      const existingPaths = new Set<string>();

      if (head) {
        const listing = await this.github.git.listFiles();
        for (const entry of listing.entries) existingPaths.add(entry.path);
        if (existingPaths.has(metaPath(cfg))) {
          throw new Error(
            `数据仓库已经初始化过了（已存在 ${metaPath(cfg)}）。如需重建，请先在 GitHub 上删除 data/ 目录。`,
          );
        }
      }

      const now = nowIso();
      const month = currentMonth();
      const device = this.getDevice();
      const meta: MetaFile = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: now,
        tokenExpiresAt: await this.auth.getExpiresAt(),
        deviceNames: { [device.id]: device.name },
      };
      const tags = defaultTags(now);

      const candidates = [
        { path: metaPath(cfg), text: renderMetaFile(meta) },
        { path: tagsPath(cfg), text: renderTagsFile(tags) },
        { path: shardPath(cfg, month), text: renderItemsFile(month, []) },
        { path: README_PATH, text: readmeContent() },
      ];
      const files = candidates.filter((file) => !existingPaths.has(file.path));
      const preserved = candidates
        .filter((file) => existingPaths.has(file.path))
        .map((file) => file.path);
      const wroteTags = files.some((file) => file.path === tagsPath(cfg));

      const result = await this.github.git.commitAtomic({
        files,
        message: head
          ? 'chore: 初始化满天星数据仓库（保留仓库中已有文件）'
          : 'chore: 初始化满天星数据仓库',
        head,
      });

      await this.db.transaction('rw', [this.db.fileCache, this.db.meta, this.db.tags], async () => {
        for (const [path, sha] of Object.entries(result.blobShas)) {
          await this.db.fileCache.put({ path, sha, etag: null, size: null, updatedAt: now });
        }
        // 只有真正写入了 tags.json 才把默认标签落到本地，否则以远端已有内容为准
        if (wroteTags) {
          for (const tag of tags) {
            if (!(await this.db.tags.get(tag.id))) await this.db.tags.put(tag);
          }
        }
        await this.db.meta.put({ key: META_KEYS.metaFile, value: meta });
        await this.db.meta.put({
          key: META_KEYS.remote,
          value: {
            commitSha: result.commitSha,
            treeSha: result.treeSha,
            files: result.blobShas,
            fetchedAt: now,
          } satisfies RemoteSnapshot,
        });
      });

      const warnings = preserved.length > 0
        ? [`已保留仓库中已有的文件，未做覆盖：${preserved.join('、')}`]
        : [];

      this.patch({
        status: 'synced',
        initialized: true,
        shardCount: files.some((file) => monthFromShardPath(cfg, file.path) !== null) ? 1 : 0,
        lastSyncAt: now,
        lastError: null,
        warnings,
      });
      this.emitDataChanged();
    } finally {
      lock.release();
    }
  }

  private async lockOrThrow(): Promise<LockHandle> {
    const lock = await acquireLock(LOCK_NAME);
    if (!lock) throw new Error('另一个同步任务正在进行，请稍后重试。');
    return lock;
  }

  // ────────────────────────────── 失败处理 ──────────────────────────────

  private handleSyncFailure(error: unknown): void {
    const classified = this.setError(error);

    if (!isGhError(error)) {
      this.patch({ status: 'error', lastError: classified });
      return;
    }

    switch (error.kind) {
      case 'auth':
      case 'forbidden':
        this.patch({ status: 'auth-error', lastError: classified, backoffUntil: null });
        return;
      case 'rate-limit': {
        const waitMs = Math.min(error.retryAfterMs ?? 60_000, 15 * 60_000);
        this.patch({ status: 'backoff', lastError: classified, backoffUntil: Date.now() + waitMs });
        this.scheduleRetry(waitMs);
        return;
      }
      case 'network': {
        this.patch({ status: 'offline', lastError: classified });
        this.scheduleRetry(this.nextBackoff());
        return;
      }
      case 'server': {
        const waitMs = this.nextBackoff();
        this.patch({ status: 'backoff', lastError: classified, backoffUntil: Date.now() + waitMs });
        this.scheduleRetry(waitMs);
        return;
      }
      case 'conflict':
        this.patch({ status: 'conflict', lastError: classified });
        return;
      default:
        // not-found / validation / unknown：自动重试无意义，进入需要人工介入的终态
        this.patch({ status: 'error', lastError: classified, backoffUntil: null });
    }
  }

  private nextBackoff(): number {
    const step = BACKOFF_STEPS_MS[Math.min(this.retryAttempt, BACKOFF_STEPS_MS.length - 1)] ?? 300_000;
    this.retryAttempt += 1;
    return step;
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.syncNow();
    }, Math.max(1_000, delayMs));
  }

  /** 网络恢复后的等待（供 UI 展示倒计时使用） */
  async waitForBackoff(): Promise<void> {
    const until = this.state.backoffUntil;
    if (until === null) return;
    const remaining = until - Date.now();
    if (remaining > 0) await sleep(remaining);
  }

  /** 清空错误（用户手动重试） */
  resetErrors(): void {
    this.retryAttempt = 0;
    this.clearTimers();
    this.patch({ lastError: null, backoffUntil: null, warnings: [] });
  }

  /** 本地标签/条目被整体替换后调用（导入备份等场景） */
  notifyLocalChange(): void {
    this.emitDataChanged();
    void this.refreshPendingCount();
  }

  /**
   * 清空远端缓存（fileCache / 远端快照）。
   * 更换数据仓库后必须调用，否则会用旧仓库的 sha 做变更检测而误判「无变化」。
   */
  async resetRemoteCache(): Promise<void> {
    await this.db.transaction('rw', [this.db.fileCache, this.db.meta], async () => {
      await this.db.fileCache.clear();
      await this.db.meta.clear();
    });
    this.patch({
      initialized: false,
      shardCount: 0,
      warnings: [],
      lastError: null,
      status: 'idle',
    });
  }

  /** 供 repository 使用的只读能力：拿到当前远端文件 sha 映射 */
  async getRemoteFileShas(): Promise<Record<string, string>> {
    const snapshot = (await this.db.meta.get(META_KEYS.remote))?.value as RemoteSnapshot | undefined;
    return snapshot?.files ?? {};
  }

  /** 判断某条目是否在远端存在（用于 UI 展示「未同步」角标） */
  async hasPendingFor(entityId: string): Promise<boolean> {
    const count = await this.db.outbox.where('entityId').equals(entityId).count();
    return count > 0;
  }

  /** 供 UI 展示：当前本地有效条目数（不含墓碑） */
  async localItemCount(): Promise<number> {
    let live = 0;
    await this.db.items.each((item) => {
      if (item.deletedAt === null) live += 1;
    });
    return live;
  }

  /** 供测试与调试 */
  async listTags(): Promise<Tag[]> {
    return this.db.tags.toArray();
  }

  async listItems(): Promise<Item[]> {
    return this.db.items.toArray();
  }
}
