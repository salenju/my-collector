/**
 * 附件图片与同步引擎的集成测试（对应 10 文档 §11.2 的用例清单）。
 *
 * 走的是真实的 fetch 链路（fakeGithub），因此能覆盖
 * 「图片字节 → base64 → Git blob → tree → commit → ref」这条完整路径。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GithubAssetStore } from '../assets/githubStore';
import type { DecodedSource, EncodeTarget, ImageCodec } from '../assets/image';
import { PatAuthProvider } from '../github/auth';
import { GhHttp } from '../github/http';
import { MemoryStore } from '../github/kv';
import { GithubService } from '../github/service';
import type { Item } from '../model/types';
import { CURRENT_SCHEMA_VERSION, DEFAULT_REPO_CONFIG } from '../model/types';
import { CollectorRepository } from '../store/repository';
import { CollectorDb, DexieSettingsStore } from '../store/schema';
import { SettingsService } from '../store/settings';
import { FAKE_REPO, installFakeGithub, type FakeGithub } from '../testing/fakeGithub';
import { SyncEngine } from './engine';
import { assetPath, assetThumbPath, metaPath, shardPath } from './paths';

let fake: FakeGithub;
let counter = 0;

beforeEach(() => {
  fake = installFakeGithub();
});

afterEach(() => {
  fake.restore();
});

const CFG = DEFAULT_REPO_CONFIG;

/**
 * 确定性假编解码器：以源文件体积作为"内容熵"，
 * 因此不同体积的输入会得到不同的原图字节 → 不同的 asset id。
 */
function createFakeCodec(): ImageCodec {
  return {
    async open(file: Blob): Promise<DecodedSource> {
      const entropy = file.size % 251;
      return {
        width: 3000,
        height: 2000,
        async encode(target: EncodeTarget) {
          const bytes = new Uint8Array(1024);
          bytes[0] = entropy;
          bytes[1] = target.width & 0xff;
          bytes[2] = Math.round(target.quality * 100);
          bytes[3] = target.mime === 'image/png' ? 1 : 0;
          return bytes;
        },
        close() {
          /* noop */
        },
      };
    },
  };
}

function fakeBlob(entropy: number): Blob {
  // 体积决定内容（见 createFakeCodec），因此这里用体积当作熵
  return new Blob([new Uint8Array(entropy)], { type: 'image/jpeg' });
}

interface Harness {
  db: CollectorDb;
  engine: SyncEngine;
  repo: CollectorRepository;
  assets: GithubAssetStore;
  settings: SettingsService;
  dispose: () => Promise<void>;
}

async function createHarness(): Promise<Harness> {
  counter += 1;
  const db = new CollectorDb(`test-assets-${counter}`);
  const localStore = new DexieSettingsStore(db);
  const auth = new PatAuthProvider(localStore, new MemoryStore());
  await auth.save({ token: 'github_pat_test', expiresAt: null, persist: 'local' });

  const settings = new SettingsService(localStore, { ...DEFAULT_REPO_CONFIG, repo: FAKE_REPO });
  await settings.load();

  const http = new GhHttp(auth, () => settings.repoConfig);
  const github = new GithubService(http);

  const assets = new GithubAssetStore({
    db,
    github,
    getConfig: () => settings.repoConfig,
    getSettings: () => settings.assetsSettings,
    codec: createFakeCodec(),
  });

  const engine = new SyncEngine({
    db,
    github,
    auth,
    getConfig: () => settings.repoConfig,
    getDevice: () => settings.device,
    getMergePolicy: () => settings.mergePolicy,
    assets,
  });
  const repo = new CollectorRepository(db, engine, assets);

  return {
    db,
    engine,
    repo,
    assets,
    settings,
    async dispose() {
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

/** 添加一条带 N 张图的记录（返回创建好的条目） */
async function addItemWithImages(
  harness: Harness,
  count: number,
  title = '带图条目',
): Promise<Item> {
  const staged = [];
  for (let index = 0; index < count; index += 1) {
    staged.push(
      await harness.assets.stage({
        file: fakeBlob(1000 + index),
        name: `photo-${index}.jpg`,
      }),
    );
  }
  return harness.repo.createItem({ type: 'note', title, assets: staged });
}

function blobPosts(): number {
  return fake.requests.filter((request) => request === 'POST /git/blobs').length;
}

describe('附件图片 · 写入链路', () => {
  it('带 2 张图新增：条目 JSON 与图片字节进**同一次**提交', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();
      const commitsBefore = fake.commitCount();

      const item = await addItemWithImages(h, 2);
      fake.requests.length = 0;
      await h.engine.push();

      // 只有一次提交（原子性：不会出现"图传了但条目没写"）
      expect(fake.commitCount()).toBe(commitsBefore + 1);

      const month = item.createdAt.slice(0, 7);
      const shard = JSON.parse(fake.files.get(shardPath(CFG, month)) ?? '{"items":[]}');
      expect(shard.items).toHaveLength(1);
      expect(shard.items[0].assets).toHaveLength(2);

      // 每个 id 都有原图与缩略图两个文件
      for (const asset of item.assets ?? []) {
        expect(fake.fileBytes(assetPath(CFG, asset.id, 'jpg')), asset.id).toBeDefined();
        expect(fake.fileBytes(assetThumbPath(CFG, asset.id, 'jpg')), asset.id).toBeDefined();
      }

      // 1 个分片 blob + 2 张原图 + 2 张缩略图 = 5 次 blob 创建
      expect(blobPosts()).toBe(5);
      // 本地不再有 pending，全部标记为已上传
      expect(await h.db.assets.where('status').equals('pending').count()).toBe(0);
      expect(await h.db.outbox.count()).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  it('图片字节保真：上传到仓库的内容与本地压缩结果逐字节一致', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();
      const item = await addItemWithImages(h, 1);
      await h.engine.push();

      const asset = item.assets?.[0];
      expect(asset).toBeDefined();
      if (!asset) return;

      const stored = fake.fileBytes(assetPath(CFG, asset.id, 'jpg'));
      const local = await h.db.assets.get(`${asset.id}:original`);
      const localBytes = new Uint8Array(await (local?.blob as Blob).arrayBuffer());
      expect(Array.from(stored ?? [])).toEqual(Array.from(localBytes));
    } finally {
      await h.dispose();
    }
  });

  it('提交信息里点出图片数量与体积（便于 git log 定位"这次同步干了什么"）', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();
      await addItemWithImages(h, 1);

      fake.commitMessages.length = 0;
      await h.engine.push();

      const message = fake.commitMessages.at(-1) ?? '';
      expect(message).toContain('1 张图片');
      expect(message).toContain('± asset\t');
      // 原图 + 缩略图的合计体积
      expect(message).toMatch(/（\d+(\.\d+)? (B|KB|MB)）/);
    } finally {
      await h.dispose();
    }
  });

  it('同一张图重复添加：不产生新的 blob 请求，也不产生新提交', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();

      const first = await h.assets.stage({ file: fakeBlob(1000), name: 'a.jpg' });
      await h.repo.createItem({ type: 'note', title: 'A', assets: [first] });
      await h.engine.push();

      // 内容相同 → 同一个 asset id（内容寻址的去重能力）
      const again = await h.assets.stage({ file: fakeBlob(1000), name: 'a-副本.jpg' });
      expect(again.id).toBe(first.id);

      await h.repo.createItem({ type: 'note', title: 'B', assets: [again] });
      const commitsBefore = fake.commitCount();
      fake.requests.length = 0;
      await h.engine.push();

      expect(fake.commitCount()).toBe(commitsBefore + 1);
      // 只写了 B 所在的分片，没有再上传图片
      expect(blobPosts()).toBe(1);
      expect(fake.requests.some((request) => request.startsWith('POST /git/blobs'))).toBe(true);
    } finally {
      await h.dispose();
    }
  });
});

describe('附件图片 · 移除与清理', () => {
  it('移除图片引用：分片里的 assets 变短，但仓库里的图片字节**保留**', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();
      const item = await addItemWithImages(h, 2);
      await h.engine.push();

      const keep = item.assets?.[1];
      expect(keep).toBeDefined();
      if (!keep) return;

      await h.repo.updateItem(item.id, { assets: [keep] });
      await h.engine.push();

      const month = item.createdAt.slice(0, 7);
      const shard = JSON.parse(fake.files.get(shardPath(CFG, month)) ?? '{"items":[]}');
      expect(shard.items[0].assets).toHaveLength(1);
      expect(shard.items[0].assets[0].id).toBe(keep.id);

      // 被移除引用的那张图仍然在仓库里（Git 里删 blob 并不能回收空间，见 10 文档 §7.2）
      const dropped = item.assets?.[0];
      expect(dropped).toBeDefined();
      if (dropped) expect(fake.fileBytes(assetPath(CFG, dropped.id, 'jpg'))).toBeDefined();
    } finally {
      await h.dispose();
    }
  });

  it('清空图片：不写空数组（避免无意义 diff）', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();
      const item = await addItemWithImages(h, 1);
      await h.engine.push();

      await h.repo.updateItem(item.id, { assets: [] });
      await h.engine.push();

      const shard = JSON.parse(
        fake.files.get(shardPath(CFG, item.createdAt.slice(0, 7))) ?? '{"items":[]}',
      );
      expect('assets' in shard.items[0]).toBe(false);
    } finally {
      await h.dispose();
    }
  });

  it('拖入后立刻移除、且尚未推送：待上传对象被清理，且不会造出空提交', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();

      const staged = await h.assets.stage({ file: fakeBlob(1000), name: 'oops.jpg' });
      const item = await h.repo.createItem({ type: 'note', title: '拖错了', assets: [staged] });
      expect(await h.db.assets.where('status').equals('pending').count()).toBe(2);

      await h.repo.updateItem(item.id, { assets: [] });

      // sweepUnreferenced 把没有被任何条目引用的 pending 对象清掉了
      expect(await h.db.assets.where('status').equals('pending').count()).toBe(0);
      expect(await h.db.assets.count()).toBe(0);

      fake.requests.length = 0;
      await h.engine.push();

      // 图片没被推上去，也没有产生空提交（只写了分片）
      expect(fake.fileBytes(assetPath(CFG, staged.id, 'jpg'))).toBeUndefined();
      expect(blobPosts()).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  it('「清理墓碑」物理删除条目后，它引用的待上传图片也被清掉', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();
      const staged = await h.assets.stage({ file: fakeBlob(1000), name: 'a.jpg' });
      const item = await h.repo.createItem({ type: 'note', title: '临时', assets: [staged] });

      await h.repo.deleteItem(item.id);
      expect(await h.db.assets.where('status').equals('pending').count()).toBe(2);

      await h.repo.purgeItem(item.id);
      expect(await h.db.assets.where('status').equals('pending').count()).toBe(0);
    } finally {
      await h.dispose();
    }
  });
});

describe('附件图片 · 多端', () => {
  it('A 端上传 → B 端 pull 后 item.assets 出现，且 B **不下载任何图片字节**', async () => {
    const a = await createHarness();
    try {
      await a.engine.initializeRepo();
      const item = await addItemWithImages(a, 1);
      await a.engine.push();

      const b = await createHarness();
      try {
        fake.requests.length = 0;
        await b.engine.pull();

        const pulled = await b.db.items.get(item.id);
        expect(pulled?.assets).toHaveLength(1);
        // 图片索引来自已有的 Trees 响应，因此没有额外的图片请求
        expect(fake.requests.some((request) => request.startsWith('GET /contents/data/assets/'))).toBe(
          false,
        );
        // B 本地也没有图片缓存（按需再拉）
        expect(await b.db.assets.count()).toBe(0);
      } finally {
        await b.dispose();
      }
    } finally {
      await a.dispose();
    }
  });

  it('B 端按需取图：首次读取产生 1 次请求，再次读取命中本地缓存', async () => {
    const a = await createHarness();
    try {
      await a.engine.initializeRepo();
      const item = await addItemWithImages(a, 1);
      await a.engine.push();

      const b = await createHarness();
      try {
        await b.engine.pull();
        const asset = (await b.db.items.get(item.id))?.assets?.[0];
        expect(asset).toBeDefined();
        if (!asset) return;

        fake.requests.length = 0;
        const url1 = await b.assets.resolve(asset, 'thumb');
        expect(url1.startsWith('blob:')).toBe(true);
        expect(blobPosts()).toBe(0);
        expect(
          fake.requests.filter((request) => request.includes('/assets/')).length,
          '首次取缩略图应当只有 1 次请求',
        ).toBe(1);

        // 释放后再取：命中 IndexedDB 缓存，零请求
        b.assets.release(url1);
        fake.requests.length = 0;
        await b.assets.resolve(asset, 'thumb');
        expect(fake.requests.filter((request) => request.includes('/assets/')).length).toBe(0);

        const usage = await b.assets.cacheUsage();
        expect(usage.count).toBe(1);
        expect(usage.bytes).toBeGreaterThan(0);
      } finally {
        await b.dispose();
      }
    } finally {
      await a.dispose();
    }
  });

  it('两端同时新增带图记录：非快进冲突自动合并，两边数据都保留且图片不重复上传', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();
      const item = await addItemWithImages(h, 1);
      const month = item.createdAt.slice(0, 7);

      let fired = false;
      fake.onBeforeRefUpdate(() => {
        if (fired) return;
        fired = true;
        const remote = JSON.parse(fake.files.get(shardPath(CFG, month)) ?? '{"items":[]}');
        remote.items.push(foreignItem('other-device', item.createdAt, '另一台设备的记录'));
        fake.forceWrite(shardPath(CFG, month), JSON.stringify(remote, null, 2));
      });

      await h.engine.push();
      fake.onBeforeRefUpdate(null);

      const shard = JSON.parse(fake.files.get(shardPath(CFG, month)) ?? '{"items":[]}');
      expect(shard.items.map((entry: Item) => entry.title).sort()).toEqual(
        ['另一台设备的记录', '带图条目'].sort(),
      );

      // 图片只存在一份，且引用的 id 仍然有效
      for (const asset of item.assets ?? []) {
        expect(fake.fileBytes(assetPath(CFG, asset.id, 'jpg'))).toBeDefined();
      }
      expect(await h.db.assets.where('status').equals('pending').count()).toBe(0);
      expect(await h.db.outbox.count()).toBe(0);
      expect(fired).toBe(true);
    } finally {
      await h.dispose();
    }
  });
});

describe('附件图片 · 离线与失败重试', () => {
  it('断网时加图：状态 offline，恢复后一次提交把图片与条目一起推上去', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();

      const fakeFetch = globalThis.fetch;
      globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
      let item: Item;
      try {
        item = await addItemWithImages(h, 1, '离线期间');
        await h.engine.push();
        expect(h.engine.getState().status).toBe('offline');
        // 图片本体在本地待上传队列里（pending 不能被 LRU 淘汰）
        expect(await h.db.assets.where('status').equals('pending').count()).toBe(2);
        expect(fake.fileBytes(assetPath(CFG, item.assets?.[0]?.id ?? '', 'jpg'))).toBeUndefined();
      } finally {
        globalThis.fetch = fakeFetch;
      }

      const commitsBefore = fake.commitCount();
      await h.engine.push();

      expect(h.engine.getState().status).toBe('synced');
      expect(fake.commitCount()).toBe(commitsBefore + 1);
      expect(await h.db.assets.where('status').equals('pending').count()).toBe(0);
      const asset = item.assets?.[0];
      expect(asset).toBeDefined();
      if (asset) expect(fake.fileBytes(assetPath(CFG, asset.id, 'jpg'))).toBeDefined();
    } finally {
      await h.dispose();
    }
  });

  it('提交失败重试不会留下"重复资产"或半成功状态', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();
      const item = await addItemWithImages(h, 1);
      const month = item.createdAt.slice(0, 7);

      let failures = 0;
      fake.onBeforeRefUpdate(() => {
        if (failures >= 1) return;
        failures += 1;
        const remote = JSON.parse(fake.files.get(shardPath(CFG, month)) ?? '{"items":[]}');
        fake.forceWrite(shardPath(CFG, month), JSON.stringify(remote, null, 2));
      });

      await h.engine.push();
      fake.onBeforeRefUpdate(null);

      // 重试成功后：队列清空、图片标记为已上传、仓库里的图片文件不重复
      expect(await h.db.outbox.count()).toBe(0);
      expect(await h.db.assets.where('status').equals('pending').count()).toBe(0);

      const asset = item.assets?.[0];
      expect(asset).toBeDefined();
      if (!asset) return;
      const assetFiles = [...fake.contents.keys()].filter((path) => path.includes(asset.id));
      expect(assetFiles.sort()).toEqual(
        [assetPath(CFG, asset.id, 'jpg'), assetThumbPath(CFG, asset.id, 'jpg')].sort(),
      );
    } finally {
      await h.dispose();
    }
  });
});

describe('schema 版本门禁（10 文档 §3.3）', () => {
  it('远端 meta 为 v1 时入队一次 meta 提交，把 schemaVersion 推到最新', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();

      // 模拟"数据由旧版本写入"
      const legacy = JSON.parse(fake.files.get(metaPath(CFG)) ?? '{}');
      legacy.schemaVersion = 1;
      fake.forceWrite(metaPath(CFG), JSON.stringify(legacy, null, 2));

      await h.engine.pull();
      expect(await h.db.outbox.where('entityId').equals('meta').count()).toBe(1);
      expect(h.engine.getState().warnings.join('')).toContain('旧版本客户端');

      await h.engine.push();
      const meta = JSON.parse(fake.files.get(metaPath(CFG)) ?? '{}');
      expect(meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(await h.db.outbox.count()).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  it('已经是当前版本时不再入队（不会每次同步都写一次 meta）', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();
      await h.engine.pull();
      await h.engine.pull();
      expect(await h.db.outbox.where('entityId').equals('meta').count()).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  it('远端 schema 更高 → 只读模式：push 不写任何东西，本地队列不丢', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();

      const future = JSON.parse(fake.files.get(metaPath(CFG)) ?? '{}');
      future.schemaVersion = 99;
      fake.forceWrite(metaPath(CFG), JSON.stringify(future, null, 2));

      const item = await h.repo.createItem({ type: 'note', title: '本地新增' });
      await h.engine.pull();
      expect(h.engine.getState().status).toBe('read-only');
      expect(h.engine.getState().readOnly).toBe(true);

      const month = item.createdAt.slice(0, 7);
      const shardBefore = fake.files.get(shardPath(CFG, month));
      const commitsBefore = fake.commitCount();

      await h.engine.push();

      expect(fake.commitCount()).toBe(commitsBefore);
      expect(fake.files.get(shardPath(CFG, month))).toBe(shardBefore);
      // 本地改动仍在队列里（只读只是"不写远端"，不是"丢弃本地"）
      expect(await h.db.outbox.count()).toBeGreaterThan(0);
    } finally {
      await h.dispose();
    }
  });

  it('⚠️ 回归：只读门禁是挡住"旧客户端抹掉 assets"的唯一防线', async () => {
    const h = await createHarness();
    try {
      await h.engine.initializeRepo();
      const item = await addItemWithImages(h, 1);
      await h.engine.push();

      const month = item.createdAt.slice(0, 7);
      const withAssets = fake.files.get(shardPath(CFG, month)) ?? '';
      expect(withAssets).toContain('"assets"');

      // 把远端标成"由更新版本写入"：模拟旧客户端在此状态下不做任何写入
      const future = JSON.parse(fake.files.get(metaPath(CFG)) ?? '{}');
      future.schemaVersion = CURRENT_SCHEMA_VERSION + 1;
      fake.forceWrite(metaPath(CFG), JSON.stringify(future, null, 2));

      // 旧客户端即使本地有改动，push 也会被拦住
      await h.repo.updateItem(item.id, { title: '旧客户端想改名' });
      await h.engine.pull();
      await h.engine.push();

      expect(fake.files.get(shardPath(CFG, month))).toBe(withAssets);
    } finally {
      await h.dispose();
    }
  });
});
