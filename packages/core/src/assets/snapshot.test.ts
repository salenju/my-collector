import { describe, expect, it } from 'vitest';
import { DEFAULT_REPO_CONFIG, type RemoteSnapshot } from '../model/types';
import { assetPath, assetThumbPath } from '../sync/paths';
import { ASSET_USAGE_WARN_BYTES, formatBytes, remoteAssetIds, remoteAssetPaths, remoteAssetUsage } from './snapshot';

const CFG = DEFAULT_REPO_CONFIG;
const ID_A = 'ab'.padEnd(32, '1');
const ID_B = 'cd'.padEnd(32, '2');

function snapshotOf(paths: Array<{ path: string; size: number }>): RemoteSnapshot {
  return {
    commitSha: 'commit-1',
    treeSha: 'tree-1',
    files: Object.fromEntries(paths.map((entry) => [entry.path, `blob-${entry.path}`])),
    sizes: Object.fromEntries(paths.map((entry) => [entry.path, entry.size])),
    fetchedAt: '2026-10-07T00:00:00.000Z',
  };
}

describe('远端图片索引（零额外请求）', () => {
  it('从快照路径反解出远端已有的 asset id', () => {
    const snapshot = snapshotOf([
      { path: assetPath(CFG, ID_A, 'jpg'), size: 400_000 },
      { path: assetThumbPath(CFG, ID_A, 'jpg'), size: 25_000 },
      { path: assetPath(CFG, ID_B, 'png'), size: 300_000 },
    ]);
    expect(remoteAssetIds(snapshot, CFG)).toEqual(new Set([ID_A, ID_B]));
  });

  it('只有缩略图不算「原图已存在」（避免跳过本该上传的原图）', () => {
    const snapshot = snapshotOf([{ path: assetThumbPath(CFG, ID_A, 'jpg'), size: 25_000 }]);
    expect(remoteAssetIds(snapshot, CFG).size).toBe(0);
  });

  it('忽略手工放进 assets/ 的、不符合命名规则的文件', () => {
    const snapshot = snapshotOf([
      { path: `${CFG.dataDir}/assets/readme.txt`, size: 10 },
      { path: `${CFG.dataDir}/assets/ab/not-a-hash.jpg`, size: 10 },
      { path: `${CFG.dataDir}/assets/zz/${ID_A}.jpg`, size: 10 }, // 分桶与 id 不一致
      { path: assetPath(CFG, ID_A, 'jpg'), size: 10 },
    ]);
    expect(remoteAssetIds(snapshot, CFG)).toEqual(new Set([ID_A]));
  });

  it('分片 / 标签 / meta 文件不会被误认为图片', () => {
    const snapshot = snapshotOf([
      { path: `${CFG.dataDir}/meta.json`, size: 100 },
      { path: `${CFG.dataDir}/tags.json`, size: 100 },
      { path: `${CFG.dataDir}/items/2026-10.json`, size: 100 },
    ]);
    expect(remoteAssetIds(snapshot, CFG).size).toBe(0);
    expect(remoteAssetUsage(snapshot, CFG)).toEqual({ count: 0, bytes: 0 });
  });

  it('remoteAssetPaths 返回全部文件路径（collectPending 用它按路径去重）', () => {
    const snapshot = snapshotOf([
      { path: assetPath(CFG, ID_A, 'jpg'), size: 1 },
      { path: `${CFG.dataDir}/meta.json`, size: 1 },
    ]);
    expect(remoteAssetPaths(snapshot).size).toBe(2);
    expect(remoteAssetPaths(null).size).toBe(0);
  });

  it('占用统计：张数按原图计，字节数原图 + 缩略图都算', () => {
    const snapshot = snapshotOf([
      { path: assetPath(CFG, ID_A, 'jpg'), size: 400_000 },
      { path: assetThumbPath(CFG, ID_A, 'jpg'), size: 25_000 },
      { path: assetPath(CFG, ID_B, 'jpg'), size: 300_000 },
      { path: assetThumbPath(CFG, ID_B, 'jpg'), size: 20_000 },
    ]);
    expect(remoteAssetUsage(snapshot, CFG)).toEqual({ count: 2, bytes: 745_000 });
  });

  it('快照缺失时报 0，不抛错', () => {
    expect(remoteAssetUsage(null, CFG)).toEqual({ count: 0, bytes: 0 });
    expect(remoteAssetIds(null, CFG).size).toBe(0);
  });

  it('体积格式化与告警阈值', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
    expect(ASSET_USAGE_WARN_BYTES).toBe(800 * 1024 * 1024);
  });
});
