import { describe, expect, it } from 'vitest';
import { DEFAULT_REPO_CONFIG, type RepoConfig } from '../model/types';
import { assetBucket, assetIdFromPath, assetPath, assetThumbPath, assetsPrefix, parseAssetPath } from './paths';

const CFG: RepoConfig = DEFAULT_REPO_CONFIG;
const ID = 'ab'.padEnd(32, '1');

describe('附件图片的仓库路径', () => {
  it('按 id 前两位分桶，两级目录（避免单目录堆几千个文件）', () => {
    expect(assetsPrefix(CFG)).toBe('data/assets/');
    expect(assetBucket(ID)).toBe('ab');
    expect(assetPath(CFG, ID, 'jpg')).toBe(`data/assets/ab/${ID}.jpg`);
    expect(assetThumbPath(CFG, ID, 'png')).toBe(`data/assets/ab/${ID}.thumb.png`);
  });

  it('路径随 dataDir 派生，不硬编码', () => {
    const custom: RepoConfig = { ...CFG, dataDir: 'my-data' };
    expect(assetPath(custom, ID, 'jpg')).toBe(`my-data/assets/ab/${ID}.jpg`);
    expect(parseAssetPath(custom, assetPath(custom, ID, 'jpg'))?.id).toBe(ID);
    // 旧 dataDir 下的路径在换配置后不再被识别
    expect(assetIdFromPath(custom, assetPath(CFG, ID, 'jpg'))).toBeNull();
  });

  it('assetPath ↔ parseAssetPath 往返一致（原图与缩略图可区分）', () => {
    expect(parseAssetPath(CFG, assetPath(CFG, ID, 'jpg'))).toEqual({ id: ID, thumb: false, ext: 'jpg' });
    expect(parseAssetPath(CFG, assetThumbPath(CFG, ID, 'png'))).toEqual({ id: ID, thumb: true, ext: 'png' });
  });

  it('缩略图与原图反解出同一个 id（索引合并时不会出现两条记录）', () => {
    expect(assetIdFromPath(CFG, assetPath(CFG, ID, 'jpg'))).toBe(ID);
    expect(assetIdFromPath(CFG, assetThumbPath(CFG, ID, 'jpg'))).toBe(ID);
  });

  it('非法路径返回 null（不抛错，避免一条手工文件破坏整次同步）', () => {
    const cases = [
      'data/meta.json',
      'data/items/2026-10.json',
      'data/assets/readme.txt',
      'data/assets/ab/not-a-hash.jpg',
      // 分桶与 id 不一致（手工放错目录）
      `data/assets/zz/${ID}.jpg`,
      // 目录名缺失（没有分桶）
      `data/assets/${ID}.jpg`,
      // 多了一层目录
      `data/assets/ab/extra/${ID}.jpg`,
      // id 含大写（我们的 id 恒为小写十六进制）
      `data/assets/ab/${ID.toUpperCase()}.jpg`,
      // 扩展名缺失 / 过长
      `data/assets/ab/${ID}`,
      `data/assets/ab/${ID}.something`,
      // 31 位（截断过的 id）
      `data/assets/ab/${ID.slice(0, 31)}.jpg`,
    ];
    for (const path of cases) {
      expect(assetIdFromPath(CFG, path), path).toBeNull();
    }
  });

  it('`.thumb` 后缀必须紧跟 id，不能出现在扩展名之后', () => {
    expect(assetIdFromPath(CFG, `data/assets/ab/${ID}.jpg.thumb`)).toBeNull();
    expect(assetIdFromPath(CFG, `data/assets/ab/${ID}.thumb`)).toBeNull();
  });

  it('只有 assets/ 前缀下的文件才会被认作图片', () => {
    expect(assetIdFromPath(CFG, `data/assetsx/ab/${ID}.jpg`)).toBeNull();
    expect(assetIdFromPath(CFG, `other/assets/ab/${ID}.jpg`)).toBeNull();
  });
});
