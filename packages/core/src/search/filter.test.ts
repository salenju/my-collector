import { describe, expect, it } from 'vitest';
import type { Item, Tag } from '../model/types';
import { collectListCounts, collectTagCounts, filterItems, findDuplicateByUrl, findUnusedTags } from './filter';

function item(overrides: Partial<Item> & { id: string }): Item {
  return {
    type: 'note',
    title: '',
    content: '',
    tagIds: [],
    source: 'web',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    archived: false,
    deletedAt: null,
    metadata: {},
    ...overrides,
  };
}

const tags: Tag[] = [
  { id: 'tag_tech', name: '技术', color: 'blue', parentId: null, createdAt: '', updatedAt: '', deletedAt: null },
  { id: 'tag_idea', name: '想法', color: 'amber', parentId: null, createdAt: '', updatedAt: '', deletedAt: null },
];

const base = { tagIds: [], type: 'all' as const, archived: false };

describe('filterItems', () => {
  const items = [
    item({ id: 'a', title: 'React 19 新特性解读', tagIds: ['tag_tech'] }),
    item({ id: 'b', content: '标签系统可以扁平 + 命名空间前缀', tagIds: ['tag_idea'] }),
    item({ id: 'c', title: '归档的旧笔记', archived: true }),
    item({ id: 'd', title: '已删除', deletedAt: '2026-09-02T00:00:00.000Z' }),
    item({ id: 'e', type: 'link', title: 'Vue 3.5 发布', url: 'https://blog.vuejs.org/posts/v35' }),
  ];

  it('墓碑在任何视图都不显示', () => {
    const result = filterItems(items, tags, { ...base, keyword: '' });
    expect(result.map((i) => i.id)).not.toContain('d');
  });

  it('归档条目只在归档视图出现', () => {
    expect(filterItems(items, tags, { ...base, keyword: '' }).map((i) => i.id)).not.toContain('c');
    expect(
      filterItems(items, tags, { ...base, keyword: '', archived: true }).map((i) => i.id),
    ).toContain('c');
  });

  it('中文关键词命中标题', () => {
    const result = filterItems(items, tags, { ...base, keyword: '新特性' });
    expect(result.map((i) => i.id)).toEqual(['a']);
  });

  it('关键词命中正文', () => {
    const result = filterItems(items, tags, { ...base, keyword: '命名空间' });
    expect(result.map((i) => i.id)).toEqual(['b']);
  });

  it('关键词命中标签名', () => {
    const result = filterItems(items, tags, { ...base, keyword: '技术' });
    expect(result.map((i) => i.id)).toEqual(['a']);
  });

  it('关键词命中 URL', () => {
    const result = filterItems(items, tags, { ...base, keyword: 'vuejs.org' });
    expect(result.map((i) => i.id)).toEqual(['e']);
  });

  it('多词为 AND 语义', () => {
    expect(filterItems(items, tags, { ...base, keyword: 'React 新特性' }).map((i) => i.id)).toEqual(['a']);
    expect(filterItems(items, tags, { ...base, keyword: 'React 不存在' })).toHaveLength(0);
  });

  it('关键词大小写不敏感', () => {
    expect(filterItems(items, tags, { ...base, keyword: 'react' }).map((i) => i.id)).toEqual(['a']);
  });

  it('标签筛选为 OR 语义', () => {
    const result = filterItems(items, tags, { ...base, keyword: '', tagIds: ['tag_tech', 'tag_idea'] });
    expect(result.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('类型筛选', () => {
    expect(filterItems(items, tags, { ...base, keyword: '', type: 'link' }).map((i) => i.id)).toEqual(['e']);
    expect(filterItems(items, tags, { ...base, keyword: '', type: 'note' }).map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('默认按创建时间倒序', () => {
    const list = [
      item({ id: 'old', createdAt: '2026-09-01T00:00:00.000Z' }),
      item({ id: 'new', createdAt: '2026-09-10T00:00:00.000Z' }),
    ];
    expect(filterItems(list, tags, { ...base, keyword: '' }).map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('关键词搜索时标题命中排在正文命中前', () => {
    const list = [
      item({ id: 'content-hit', content: 'vue', createdAt: '2026-09-10T00:00:00.000Z' }),
      item({ id: 'title-hit', title: 'vue', createdAt: '2026-09-01T00:00:00.000Z' }),
    ];
    expect(filterItems(list, tags, { ...base, keyword: 'vue' }).map((i) => i.id)).toEqual([
      'title-hit',
      'content-hit',
    ]);
  });

  it('按标题排序支持中文', () => {
    const list = [item({ id: 'x', title: '想法' }), item({ id: 'y', title: '技术' })];
    const result = filterItems(list, tags, { ...base, keyword: '', sortBy: 'title', sortDir: 'asc' });
    expect(result).toHaveLength(2);
  });
});

describe('统计', () => {
  const items = [
    item({ id: 'a', type: 'link', tagIds: ['tag_tech'] }),
    item({ id: 'b', type: 'note', tagIds: ['tag_tech', 'tag_idea'] }),
    item({ id: 'c', archived: true, tagIds: ['tag_idea'] }),
    item({ id: 'd', deletedAt: '2026-09-02T00:00:00.000Z', tagIds: ['tag_idea'] }),
  ];

  it('collectListCounts 区分有效/链接/笔记/归档', () => {
    expect(collectListCounts(items)).toEqual({ active: 2, links: 1, notes: 1, archived: 1 });
  });

  it('collectTagCounts 只统计未归档未删除的条目', () => {
    expect(collectTagCounts(items)).toEqual({ tag_tech: 2, tag_idea: 1 });
  });
});

describe('辅助查询', () => {
  it('findDuplicateByUrl 命中未删除的同 URL 条目', () => {
    const list = [
      item({ id: 'a', type: 'link', url: 'https://example.com/x' }),
      item({ id: 'b', type: 'link', url: 'https://example.com/y', deletedAt: '2026-09-02T00:00:00.000Z' }),
    ];
    expect(findDuplicateByUrl(list, 'https://example.com/x')?.id).toBe('a');
    expect(findDuplicateByUrl(list, 'https://example.com/y')).toBeNull();
    expect(findDuplicateByUrl(list, 'https://example.com/z')).toBeNull();
  });

  it('findUnusedTags 找出没有引用的标签', () => {
    const list = [item({ id: 'a', tagIds: ['tag_tech'] })];
    expect(findUnusedTags(tags, list).map((t) => t.id)).toEqual(['tag_idea']);
  });
});
