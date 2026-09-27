import { describe, expect, it } from 'vitest';
import type { Item } from '../model/types';
import { DEFAULT_REPO_CONFIG } from '../model/types';
import { monthFromShardPath, shardPath, tagsPath, metaPath } from './paths';
import { groupByShard, renderItemsFile, renderTagsFile, shardMonthOf } from './shard';

function item(id: string, createdAt: string): Item {
  return {
    id,
    type: 'note',
    title: id,
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

describe('分片路由', () => {
  it('分片键取 createdAt 的 YYYY-MM（UTC）', () => {
    expect(shardMonthOf(item('a', '2026-09-30T23:59:59.000Z'))).toBe('2026-09');
    expect(shardMonthOf(item('b', '2026-10-01T00:00:01.000Z'))).toBe('2026-10');
  });

  it('groupByShard 按月份分组', () => {
    const groups = groupByShard([
      item('a', '2026-09-01T00:00:00.000Z'),
      item('b', '2026-10-01T00:00:00.000Z'),
      item('c', '2026-09-20T00:00:00.000Z'),
    ]);
    expect([...groups.keys()].sort()).toEqual(['2026-09', '2026-10']);
    expect(groups.get('2026-09')?.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('分组内按 createdAt 升序、id 升序（输出稳定，diff 干净）', () => {
    const groups = groupByShard([
      item('z', '2026-09-05T00:00:00.000Z'),
      item('b', '2026-09-05T00:00:00.000Z'),
      item('a', '2026-09-05T00:00:00.000Z'),
    ]);
    expect(groups.get('2026-09')?.map((i) => i.id)).toEqual(['a', 'b', 'z']);
  });

  it('路径派生自 dataDir，不硬编码', () => {
    expect(shardPath(DEFAULT_REPO_CONFIG, '2026-09')).toBe('data/items/2026-09.json');
    expect(tagsPath(DEFAULT_REPO_CONFIG)).toBe('data/tags.json');
    expect(metaPath(DEFAULT_REPO_CONFIG)).toBe('data/meta.json');
    expect(shardPath({ ...DEFAULT_REPO_CONFIG, dataDir: 'store' }, '2026-09')).toBe(
      'store/items/2026-09.json',
    );
  });

  it('monthFromShardPath 只识别分片文件', () => {
    expect(monthFromShardPath(DEFAULT_REPO_CONFIG, 'data/items/2026-09.json')).toBe('2026-09');
    expect(monthFromShardPath(DEFAULT_REPO_CONFIG, 'data/items/notes.json')).toBeNull();
    expect(monthFromShardPath(DEFAULT_REPO_CONFIG, 'data/tags.json')).toBeNull();
    expect(monthFromShardPath(DEFAULT_REPO_CONFIG, 'README.md')).toBeNull();
  });
});

describe('文件渲染', () => {
  it('JSON 使用 2 空格缩进并以换行结尾', () => {
    const text = renderItemsFile('2026-09', []);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "version": 1');
  });

  it('相同输入产生完全相同的文本（避免无意义 diff）', () => {
    const items = [item('b', '2026-09-02T00:00:00.000Z'), item('a', '2026-09-01T00:00:00.000Z')];
    expect(renderItemsFile('2026-09', items)).toBe(renderItemsFile('2026-09', [...items].reverse()));
  });

  it('写入的分片结构符合 schema', () => {
    const parsed = JSON.parse(renderItemsFile('2026-09', [item('a', '2026-09-01T00:00:00.000Z')]));
    expect(parsed.version).toBe(1);
    expect(parsed.month).toBe('2026-09');
    expect(parsed.items).toHaveLength(1);
  });

  it('标签文件按名称排序，且与输入顺序无关（输出稳定）', () => {
    const list = [
      { id: 't1', name: '想法', color: 'violet' as const, parentId: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', deletedAt: null },
      { id: 't2', name: '技术', color: 'blue' as const, parentId: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', deletedAt: null },
    ];
    const parsed = JSON.parse(renderTagsFile(list));
    expect(new Set(parsed.tags.map((t: { name: string }) => t.name))).toEqual(
      new Set(['技术', '想法']),
    );
    // 排序的目的是让 diff 干净，而不是某种特定的语言顺序
    expect(renderTagsFile(list)).toBe(renderTagsFile([...list].reverse()));
  });
});
