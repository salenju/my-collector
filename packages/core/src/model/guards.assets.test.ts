import { describe, expect, it } from 'vitest';
import { isItem, isItemAsset, normalizeAssets, normalizeItem } from './guards';
import { ASSET_LIMITS, type Item, type ItemAsset } from './types';

const ID_A = 'aa'.padEnd(32, '1');
const ID_B = 'bb'.padEnd(32, '2');
const ID_C = 'cc'.padEnd(32, '3');

function asset(id: string, patch: Partial<ItemAsset> = {}): ItemAsset {
  return {
    id,
    name: 'photo.jpg',
    size: 400_000,
    width: 2048,
    height: 1536,
    mime: 'image/jpeg',
    ...patch,
  };
}

function item(patch: Partial<Item> = {}): Item {
  return {
    id: 'item1',
    type: 'note',
    title: '标题',
    content: '',
    tagIds: [],
    source: 'web',
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
    archived: false,
    deletedAt: null,
    metadata: {},
    ...patch,
  };
}

describe('isItemAsset', () => {
  it('接受合法条目', () => {
    expect(isItemAsset(asset(ID_A))).toBe(true);
    expect(isItemAsset(asset(ID_A, { mime: 'image/png', name: '截图.png' }))).toBe(true);
  });

  it('id 必须是 32 位小写十六进制（内容 sha 的形态）', () => {
    expect(isItemAsset(asset('short'))).toBe(false);
    expect(isItemAsset(asset(ID_A.toUpperCase()))).toBe(false);
    expect(isItemAsset(asset('zz'.padEnd(32, '1')))).toBe(false);
    expect(isItemAsset(asset('a'.repeat(33)))).toBe(false);
  });

  it('拒绝非法尺寸 / mime / 体积', () => {
    expect(isItemAsset(asset(ID_A, { width: 0 }))).toBe(false);
    expect(isItemAsset(asset(ID_A, { height: -1 }))).toBe(false);
    expect(isItemAsset(asset(ID_A, { width: 10.5 }))).toBe(false);
    expect(isItemAsset(asset(ID_A, { mime: 'image/webp' as never }))).toBe(false);
    expect(isItemAsset(asset(ID_A, { size: 0 }))).toBe(false);
    expect(isItemAsset(asset(ID_A, { size: ASSET_LIMITS.maxStoredBytes + 1 }))).toBe(false);
    expect(isItemAsset(asset(ID_A, { name: undefined as never }))).toBe(false);
  });

  it('url 可选，但给了就必须是字符串（图床预留字段）', () => {
    expect(isItemAsset(asset(ID_A, { url: 'https://img.example.com/a.jpg' }))).toBe(true);
    expect(isItemAsset({ ...asset(ID_A), url: 42 })).toBe(false);
  });

  it('拒绝非对象', () => {
    expect(isItemAsset(null)).toBe(false);
    expect(isItemAsset('abc')).toBe(false);
    expect(isItemAsset([])).toBe(false);
  });
});

describe('normalizeAssets', () => {
  it('剔除非法项、按 id 去重、按 id 升序（保证输出稳定、diff 干净）', () => {
    const result = normalizeAssets([asset(ID_C), asset(ID_A), asset(ID_B), asset(ID_A), { bad: true }]);
    expect(result?.map((entry) => entry.id)).toEqual([ID_A, ID_B, ID_C]);
  });

  it('空数组与非法输入都返回 undefined → 调用方不写该字段（避免无意义 diff）', () => {
    expect(normalizeAssets([])).toBeUndefined();
    expect(normalizeAssets([{ bad: true }])).toBeUndefined();
    expect(normalizeAssets(undefined)).toBeUndefined();
    expect(normalizeAssets('nope')).toBeUndefined();
  });

  it('截断到每张条目上限并截断超长文件名', () => {
    const many = Array.from({ length: ASSET_LIMITS.maxPerItem + 5 }, (_, index) =>
      asset(index.toString(16).padStart(32, '0'), { name: 'x'.repeat(500) }),
    );
    const result = normalizeAssets(many);
    expect(result).toHaveLength(ASSET_LIMITS.maxPerItem);
    expect(result?.[0]?.name).toHaveLength(ASSET_LIMITS.nameLength);
  });
});

describe('isItem 对 assets 的校验', () => {
  it('没有 assets 字段的旧数据依然合法（向后兼容）', () => {
    const legacy = item();
    expect(legacy.assets).toBeUndefined();
    expect(isItem(legacy)).toBe(true);
  });

  it('assets 必须是数组，且每一项都要通过 isItemAsset', () => {
    expect(isItem(item({ assets: [asset(ID_A)] }))).toBe(true);
    expect(isItem({ ...item(), assets: 'nope' })).toBe(false);
    expect(isItem({ ...item(), assets: [asset(ID_A), { id: 'bad' }] })).toBe(false);
  });
});

describe('normalizeItem 保留 assets（⚠️ 这是旧版本会静默丢字段的地方）', () => {
  it('assets 被完整搬运到归一化结果里', () => {
    const normalized = normalizeItem(item({ assets: [asset(ID_A), asset(ID_B)] }));
    expect(normalized.assets?.map((entry) => entry.id)).toEqual([ID_A, ID_B]);
    expect(normalized.assets?.[0]).toEqual(asset(ID_A));
  });

  it('非法项被剔除、id 去重、顺序稳定', () => {
    const normalized = normalizeItem(
      item({ assets: [asset(ID_B), asset(ID_A), asset(ID_B), { id: 'bad' } as ItemAsset] }),
    );
    expect(normalized.assets?.map((entry) => entry.id)).toEqual([ID_A, ID_B]);
  });

  it('全部非法时不写 assets 字段', () => {
    const normalized = normalizeItem(item({ assets: [{ id: 'bad' } as ItemAsset] }));
    expect('assets' in normalized).toBe(false);
  });

  it('没有 assets 时不凭空造一个空数组', () => {
    expect('assets' in normalizeItem(item())).toBe(false);
  });

  it('url 字段（图床预留）也会被保留', () => {
    const withUrl = asset(ID_A, { url: 'https://img.example.com/a.jpg' });
    expect(normalizeItem(item({ assets: [withUrl] })).assets?.[0]?.url).toBe(withUrl.url);
  });
});
