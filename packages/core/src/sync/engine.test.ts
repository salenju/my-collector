import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PatAuthProvider } from '../github/auth';
import { GhHttp } from '../github/http';
import { MemoryStore } from '../github/kv';
import { GithubService } from '../github/service';
import type { Item } from '../model/types';
import { DEFAULT_REPO_CONFIG } from '../model/types';
import { CollectorRepository } from '../store/repository';
import { CollectorDb, DexieSettingsStore } from '../store/schema';
import { SettingsService } from '../store/settings';
import { FAKE_REPO, installFakeGithub, type FakeGithub } from '../testing/fakeGithub';
import { SyncEngine } from './engine';
import { metaPath, shardPath, tagsPath } from './paths';
import { renderItemsFile } from './shard';

let fake: FakeGithub;
let counter = 0;

beforeEach(() => {
  fake = installFakeGithub();
});

afterEach(() => {
  fake.restore();
});

interface Harness {
  db: CollectorDb;
  engine: SyncEngine;
  repo: CollectorRepository;
  settings: SettingsService;
  dispose: () => Promise<void>;
}

async function createHarness(): Promise<Harness> {
  counter += 1;
  const db = new CollectorDb(`test-db-${counter}`);
  const localStore = new DexieSettingsStore(db);
  const auth = new PatAuthProvider(localStore, new MemoryStore());
  await auth.save({ token: 'github_pat_test', expiresAt: null, persist: 'local' });

  const settings = new SettingsService(localStore, { ...DEFAULT_REPO_CONFIG, repo: FAKE_REPO });
  await settings.load();

  const http = new GhHttp(auth, () => settings.repoConfig);
  const github = new GithubService(http);

  const engine = new SyncEngine({
    db,
    github,
    auth,
    getConfig: () => settings.repoConfig,
    getDevice: () => settings.device,
    getMergePolicy: () => settings.mergePolicy,
  });
  const repo = new CollectorRepository(db, engine);

  return {
    db,
    engine,
    repo,
    settings,
    async dispose() {
      // 清掉 debounce / 退避定时器，避免测试结束后触发对已删除数据库的访问
      engine.resetErrors();
      await db.delete();
    },
  };
}

function foreignItem(id: string, createdAt: string, title: string): Item {
  return {
    id,
    type: 'note',
    title,
    content: '',
    tagIds: [],
    source: 'web',
    createdAt,
    updatedAt: createdAt,
    archived: false,
    deletedAt: null,
    metadata: {},
  };
}

const CFG = DEFAULT_REPO_CONFIG;

describe('SyncEngine · 初始化', () => {
  it('空仓库初始化：一次提交创建 4 个文件', async () => {
    const harness = await createHarness();
    try {
      await harness.engine.initializeRepo();

      expect(fake.commitCount()).toBe(1);
      expect(fake.files.has(metaPath(CFG))).toBe(true);
      expect(fake.files.has(tagsPath(CFG))).toBe(true);
      expect(fake.files.has('README.md')).toBe(true);
      expect(fake.headSha()).not.toBeNull();

      const meta = JSON.parse(fake.files.get(metaPath(CFG)) ?? '{}');
      expect(meta.schemaVersion).toBe(1);
      expect(meta.deviceNames[harness.settings.device.id]).toBeTruthy();

      const tags = JSON.parse(fake.files.get(tagsPath(CFG)) ?? '{}');
      expect(new Set(tags.tags.map((t: { name: string }) => t.name))).toEqual(
        new Set(['技术', '待读', '想法']),
      );

      expect(harness.engine.getState().status).toBe('synced');
      expect(harness.engine.getState().initialized).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it('已初始化的仓库拒绝重复初始化（判据是 meta.json 是否存在）', async () => {
    const harness = await createHarness();
    try {
      await harness.engine.initializeRepo();
      await expect(harness.engine.initializeRepo()).rejects.toThrow('已经初始化过');
    } finally {
      await harness.dispose();
    }
  });

  it('仓库里已有 README（GitHub 建仓时勾选 Add a README）也能初始化，且不覆盖原文件', async () => {
    const harness = await createHarness();
    try {
      // 模拟建仓时已有一个提交
      fake.forceWrite('README.md', '# my-collector-data\n');
      const commitsBefore = fake.commitCount();

      await harness.engine.initializeRepo();

      expect(fake.commitCount()).toBe(commitsBefore + 1);
      // 已存在的文件不被覆盖
      expect(fake.files.get('README.md')).toBe('# my-collector-data\n');
      expect(fake.files.has(metaPath(CFG))).toBe(true);
      expect(harness.engine.getState().initialized).toBe(true);
      expect(harness.engine.getState().warnings.join('')).toContain('README.md');
    } finally {
      await harness.dispose();
    }
  });

  it('空仓库时 pull 不报错，只提示需要初始化', async () => {
    const harness = await createHarness();
    try {
      await harness.engine.pull();
      expect(harness.engine.getState().initialized).toBe(false);
      expect(harness.engine.getState().warnings.join('')).toContain('空的');
    } finally {
      await harness.dispose();
    }
  });
});

describe('SyncEngine · 推送', () => {
  it('本地新增条目 → 远端分片包含该条目，且 URL 已归一化', async () => {
    const harness = await createHarness();
    try {
      await harness.engine.initializeRepo();
      const created = await harness.repo.createItem({
        title: 'React 19 新特性解读',
        url: 'https://example.com/react19?utm_source=wechat&utm_medium=social&id=7',
        source: 'web',
      });

      await harness.engine.push();

      const month = created.createdAt.slice(0, 7);
      const parsed = JSON.parse(fake.files.get(shardPath(CFG, month)) ?? '{"items":[]}');
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0].title).toBe('React 19 新特性解读');
      expect(parsed.items[0].url).toBe('https://example.com/react19?id=7');

      expect(await harness.db.outbox.count()).toBe(0);
      expect(harness.engine.getState().status).toBe('synced');
    } finally {
      await harness.dispose();
    }
  });

  it('没有待推送内容时不产生提交', async () => {
    const harness = await createHarness();
    try {
      await harness.engine.initializeRepo();
      const before = fake.commitCount();
      await harness.engine.push();
      expect(fake.commitCount()).toBe(before);
    } finally {
      await harness.dispose();
    }
  });

  it('多次编辑同一实体在 outbox 中被压缩为一次提交', async () => {
    const harness = await createHarness();
    try {
      await harness.engine.initializeRepo();
      const created = await harness.repo.createItem({ title: '初稿', source: 'web' });
      await harness.repo.updateItem(created.id, { title: '第二稿' });
      await harness.repo.updateItem(created.id, { title: '终稿' });

      expect(await harness.db.outbox.count()).toBe(1);

      const before = fake.commitCount();
      await harness.engine.push();
      expect(fake.commitCount()).toBe(before + 1);

      const month = created.createdAt.slice(0, 7);
      const parsed = JSON.parse(fake.files.get(shardPath(CFG, month)) ?? '{"items":[]}');
      expect(parsed.items[0].title).toBe('终稿');
    } finally {
      await harness.dispose();
    }
  });

  it('删除写入墓碑而不是移除记录（多端能正确传播删除）', async () => {
    const harness = await createHarness();
    try {
      await harness.engine.initializeRepo();
      const created = await harness.repo.createItem({ title: '待删除', source: 'web' });
      await harness.engine.push();

      await harness.repo.deleteItem(created.id);
      await harness.engine.push();

      const month = created.createdAt.slice(0, 7);
      const parsed = JSON.parse(fake.files.get(shardPath(CFG, month)) ?? '{"items":[]}');
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0].deletedAt).not.toBeNull();
    } finally {
      await harness.dispose();
    }
  });
});

describe('SyncEngine · 拉取', () => {
  it('另一台设备能拉取到同样的数据', async () => {
    const deviceA = await createHarness();
    try {
      await deviceA.engine.initializeRepo();
      await deviceA.repo.createItem({
        title: '共享条目',
        content: '正文内容',
        url: 'https://example.com/a',
        tagIds: [],
        source: 'web',
      });
      await deviceA.engine.push();
    } finally {
      await deviceA.dispose();
    }

    const deviceB = await createHarness();
    try {
      await deviceB.engine.pull();
      const items = await deviceB.db.items.toArray();
      expect(items.map((item) => item.title)).toEqual(['共享条目']);
      expect(items[0]?.content).toBe('正文内容');
      expect(deviceB.engine.getState().initialized).toBe(true);
    } finally {
      await deviceB.dispose();
    }
  });

  it('坏数据只跳过不污染本地，并在告警中提示', async () => {
    const deviceA = await createHarness();
    let shard: string;
    try {
      await deviceA.engine.initializeRepo();
      const created = await deviceA.repo.createItem({ title: '正常条目', source: 'web' });
      await deviceA.engine.push();
      shard = shardPath(CFG, created.createdAt.slice(0, 7));

      // 手工塞入一条结构非法（缺 updatedAt）的数据
      const parsed = JSON.parse(fake.files.get(shard) ?? '{"items":[]}');
      parsed.items.push({ id: 'broken', type: 'note', title: '坏的' });
      fake.forceWrite(shard, JSON.stringify(parsed, null, 2));
    } finally {
      await deviceA.dispose();
    }

    const deviceB = await createHarness();
    try {
      await deviceB.engine.pull();
      const items = await deviceB.db.items.toArray();
      expect(items.map((item) => item.title)).toEqual(['正常条目']);
      expect(deviceB.engine.getState().warnings.join('')).toContain('异常');
    } finally {
      await deviceB.dispose();
    }
  });
});

describe('SyncEngine · 并发冲突', () => {
  it('推送遇到非快进：自动拉取合并后重试，两边的数据都保留', async () => {
    const harness = await createHarness();
    try {
      await harness.engine.initializeRepo();
      const ours = await harness.repo.createItem({ title: '我这边的记录', source: 'web' });
      const month = ours.createdAt.slice(0, 7);
      const shard = shardPath(CFG, month);

      // 模拟另一台设备在同一个分片里抢先提交（它的版本里只有它自己的条目）
      const theirs = foreignItem('foreign0001', ours.createdAt, '另一台设备的记录');
      let injected = false;
      fake.onBeforeRefUpdate(() => {
        if (injected) return;
        injected = true;
        fake.forceWrite(shard, renderItemsFile(month, [theirs]));
      });

      await harness.engine.push();

      expect(injected).toBe(true);
      expect(harness.engine.getState().status).toBe('synced');
      expect(await harness.db.outbox.count()).toBe(0);

      const parsed = JSON.parse(fake.files.get(shard) ?? '{"items":[]}');
      const titles = parsed.items.map((item: Item) => item.title).sort();
      expect(titles).toEqual(['另一台设备的记录', '我这边的记录'].sort());

      // 本地也应合并出两条
      const localItems = await harness.db.items.toArray();
      expect(localItems).toHaveLength(2);
    } finally {
      await harness.dispose();
    }
  });

  it('远端更新覆盖本地已过期的待推送操作时，丢弃过期操作而不是覆盖远端', async () => {
    const harness = await createHarness();
    try {
      await harness.engine.initializeRepo();
      const ours = await harness.repo.createItem({ title: '本地初值', source: 'web' });
      const month = ours.createdAt.slice(0, 7);
      const shard = shardPath(CFG, month);

      // 另一台设备把同一条改成更新的版本
      const remote: Item = {
        ...ours,
        title: '远端更新后的值',
        updatedAt: new Date(Date.parse(ours.updatedAt) + 60_000).toISOString(),
      };
      fake.forceWrite(shard, renderItemsFile(month, [remote]));

      // 本地也做了一次修改，但时间戳比远端更早（模拟时钟/顺序差异）
      await harness.db.items.put({
        ...ours,
        title: '本地过期的修改',
        updatedAt: new Date(Date.parse(ours.updatedAt) + 30_000).toISOString(),
      });
      await harness.db.outbox.clear();
      await harness.db.outbox.add({ entity: 'item', entityId: ours.id, action: 'upsert', at: ours.updatedAt });

      await harness.engine.pull();

      const merged = await harness.db.items.get(ours.id);
      expect(merged?.title).toBe('远端更新后的值');
      expect(await harness.db.outbox.count()).toBe(0);
    } finally {
      await harness.dispose();
    }
  });
});

describe('SyncEngine · 网络异常', () => {
  it('断网推送失败 → 离线状态且本地数据完好；恢复后自动补齐', async () => {
    const harness = await createHarness();
    try {
      await harness.engine.initializeRepo();
      await harness.repo.createItem({ title: '离线记录', source: 'web' });

      const realFetch = globalThis.fetch;
      globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
      try {
        await harness.engine.push();
      } finally {
        globalThis.fetch = realFetch;
      }

      expect(harness.engine.getState().status).toBe('offline');
      expect(await harness.db.outbox.count()).toBe(1);
      expect((await harness.db.items.toArray()).map((item) => item.title)).toEqual(['离线记录']);

      await harness.engine.push();
      expect(harness.engine.getState().status).toBe('synced');
      expect(await harness.db.outbox.count()).toBe(0);
    } finally {
      await harness.dispose();
    }
  });

  it('令牌未配置时同步只标记状态，不抛错', async () => {
    counter += 1;
    const db = new CollectorDb(`test-db-noauth-${counter}`);
    const localStore = new DexieSettingsStore(db);
    const auth = new PatAuthProvider(localStore, new MemoryStore());
    const settings = new SettingsService(localStore, { ...DEFAULT_REPO_CONFIG, repo: FAKE_REPO });
    await settings.load();
    const engine = new SyncEngine({
      db,
      github: new GithubService(new GhHttp(auth, () => settings.repoConfig)),
      auth,
      getConfig: () => settings.repoConfig,
      getDevice: () => settings.device,
      getMergePolicy: () => settings.mergePolicy,
    });

    try {
      await engine.syncNow();
      expect(engine.getState().status).toBe('unconfigured');
    } finally {
      engine.resetErrors();
      await db.delete();
    }
  });
});
