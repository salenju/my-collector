import { describe, expect, it } from 'vitest';
import type { Item, MergePolicy, Tag } from '../model/types';
import { findStaleOutboxIds, mergeItems, mergeTags, stableStringify, type MergeOptions } from './merge';

const T1 = '2026-09-01T00:00:00.000Z';
const T2 = '2026-09-02T00:00:00.000Z';
const T3 = '2026-09-03T00:00:00.000Z';
const T4 = '2026-09-04T00:00:00.000Z';
const T5 = '2026-09-05T00:00:00.000Z';

function item(overrides: Partial<Item> & { id: string }): Item {
  return {
    type: 'note',
    title: '',
    content: '',
    tagIds: [],
    source: 'web',
    createdAt: T1,
    updatedAt: T1,
    archived: false,
    deletedAt: null,
    metadata: {},
    ...overrides,
  };
}

function tag(overrides: Partial<Tag> & { id: string }): Tag {
  return {
    name: '技术',
    color: 'blue',
    parentId: null,
    createdAt: T1,
    updatedAt: T1,
    deletedAt: null,
    ...overrides,
  };
}

function options(overrides: Partial<MergeOptions> = {}): MergeOptions {
  return { policy: 'delete-wins' as MergePolicy, now: T5, pending: new Set<string>(), ...overrides };
}

/** 对应 docs/tec/04-同步引擎与冲突处理.md §5.2 的冲突矩阵 */
describe('mergeItems 冲突矩阵', () => {
  it('#1 只在本地存在 → 保留本地', () => {
    const local = item({ id: 'a', title: '只有本地' });
    const result = mergeItems([local], [], options());
    expect(result.values.map((v) => v.id)).toEqual(['a']);
  });

  it('#2 只在远端存在 → 保留远端', () => {
    const remote = item({ id: 'b', title: '只有远端' });
    const result = mergeItems([], [remote], options());
    expect(result.values.map((v) => v.id)).toEqual(['b']);
  });

  it('#3 两侧完全相同 → 无冲突', () => {
    const local = item({ id: 'a', title: '同一版本' });
    const remote = item({ id: 'a', title: '同一版本' });
    const result = mergeItems([local], [remote], options());
    expect(result.conflicts).toHaveLength(0);
    expect(result.values).toHaveLength(1);
  });

  it('#4 本地更新 → 取本地', () => {
    const local = item({ id: 'a', title: '本地改过', updatedAt: T2 });
    const remote = item({ id: 'a', title: '远端旧值', updatedAt: T1 });
    const result = mergeItems([local], [remote], options());
    expect(result.values[0]?.title).toBe('本地改过');
    expect(result.conflicts[0]?.kept).toBe('local');
  });

  it('#5 远端更新 → 取远端', () => {
    const local = item({ id: 'a', tagIds: ['tag_old'], updatedAt: T1 });
    const remote = item({ id: 'a', tagIds: ['tag_new'], updatedAt: T3 });
    const result = mergeItems([local], [remote], options());
    expect(result.values[0]?.tagIds).toEqual(['tag_new']);
    expect(result.conflicts[0]?.kept).toBe('remote');
  });

  it('#6 本地删除 vs 远端未变 → 删除生效', () => {
    const local = item({ id: 'a', deletedAt: T2, updatedAt: T2 });
    const remote = item({ id: 'a', updatedAt: T1 });
    const result = mergeItems([local], [remote], options());
    expect(result.values[0]?.deletedAt).toBe(T2);
  });

  it('#7 远端删除 → 删除生效', () => {
    const local = item({ id: 'a', updatedAt: T1 });
    const remote = item({ id: 'a', deletedAt: T2, updatedAt: T2 });
    const result = mergeItems([local], [remote], options());
    expect(result.values[0]?.deletedAt).toBe(T2);
  });

  it('#8 本地编辑 t2 vs 远端删除 t3 → 删除优先', () => {
    const local = item({ id: 'a', title: '本地编辑', updatedAt: T2 });
    const remote = item({ id: 'a', deletedAt: T3, updatedAt: T3 });
    const result = mergeItems([local], [remote], options({ policy: 'delete-wins' }));
    expect(result.values[0]?.deletedAt).toBe(T3);
    expect(result.conflicts[0]?.reason).toBe('delete-policy');
  });

  it('#8b 编辑优先策略下，删除可能被编辑覆盖回来', () => {
    const local = item({ id: 'a', title: '本地编辑', updatedAt: T3 });
    const remote = item({ id: 'a', deletedAt: T2, updatedAt: T2 });
    const result = mergeItems([local], [remote], options({ policy: 'edit-wins' }));
    // edit-wins 下不特殊处理墓碑，按 updatedAt 裁决 → 本地 T3 更晚，编辑生效
    expect(result.values[0]?.deletedAt).toBeNull();
  });

  it('#9 本地未推送的更新比远端新 → 本地胜出', () => {
    const local = item({ id: 'a', title: '刚改的', updatedAt: T5 });
    const remote = item({ id: 'a', title: '远端', updatedAt: T4 });
    const result = mergeItems([local], [remote], options({ pending: new Set(['a']) }));
    expect(result.values[0]?.title).toBe('刚改的');
  });

  it('#10 本地未推送的操作比远端旧 → 远端胜出', () => {
    const local = item({ id: 'a', title: '过时的本地操作', updatedAt: T3 });
    const remote = item({ id: 'a', title: '远端更新', updatedAt: T4 });
    const result = mergeItems([local], [remote], options({ pending: new Set(['a']) }));
    expect(result.values[0]?.title).toBe('远端更新');
  });

  it('#10b 同一时间戳但本地有未推送操作 → 以本地为准（不能吞掉用户刚点的操作）', () => {
    const local = item({ id: 'a', title: '本地', updatedAt: T2 });
    const remote = item({ id: 'a', title: '远端', updatedAt: T2 });
    const withoutPending = mergeItems([local], [remote], options());
    expect(withoutPending.values[0]?.title).toBe('远端');

    const withPending = mergeItems([local], [remote], options({ pending: new Set(['a']) }));
    expect(withPending.values[0]?.title).toBe('本地');
  });

  it('#11 本地新增与远端同 id 撞车 → 取较新者', () => {
    const local = item({ id: 'x', title: '本地新增', updatedAt: T3 });
    const remote = item({ id: 'x', title: '远端已有', updatedAt: T1 });
    const result = mergeItems([local], [remote], options({ pending: new Set(['x']) }));
    expect(result.values[0]?.title).toBe('本地新增');
  });

  it('#12 archived 也是普通字段，参与 LWW', () => {
    const local = item({ id: 'a', archived: true, updatedAt: T2 });
    const remote = item({ id: 'a', archived: false, updatedAt: T1 });
    const result = mergeItems([local], [remote], options());
    expect(result.values[0]?.archived).toBe(true);
  });

  it('#14 时间戳相同但内容不同 → 取远端并记录冲突', () => {
    const local = item({ id: 'a', title: '手工改过的本地', updatedAt: T2 });
    const remote = item({ id: 'a', title: '手工改过的远端', updatedAt: T2 });
    const result = mergeItems([local], [remote], options());
    expect(result.values[0]?.title).toBe('手工改过的远端');
    expect(result.conflicts[0]?.reason).toBe('same-timestamp-differs');
  });

  it('不做无意义冲突记录：仅一侧存在的条目不算冲突', () => {
    const result = mergeItems([item({ id: 'a' })], [item({ id: 'b' })], options());
    expect(result.conflicts).toHaveLength(0);
    expect(result.values.map((v) => v.id).sort()).toEqual(['a', 'b']);
  });
});

describe('mergeTags', () => {
  it('#13 标签缺失不影响条目合并：远端多出的标签被并入', () => {
    const local = tag({ id: 'tag_a', name: '技术' });
    const remote = tag({ id: 'tag_b', name: '想法' });
    const result = mergeTags([local], [remote], options());
    expect(result.values.map((v) => v.id).sort()).toEqual(['tag_a', 'tag_b']);
  });

  it('本地改名 vs 远端改色 → 取时间较新的一侧（整体覆盖）', () => {
    const local = tag({ id: 'tag_a', name: '新技术', updatedAt: T2 });
    const remote = tag({ id: 'tag_a', name: '技术', color: 'rose', updatedAt: T3 });
    const result = mergeTags([local], [remote], options());
    expect(result.values[0]?.color).toBe('rose');
    expect(result.values[0]?.name).toBe('技术');
  });

  it('标签墓碑同样参与合并', () => {
    const local = tag({ id: 'tag_a', deletedAt: T2, updatedAt: T2 });
    const remote = tag({ id: 'tag_a', updatedAt: T1 });
    const result = mergeTags([local], [remote], options());
    expect(result.values[0]?.deletedAt).toBe(T2);
  });
});

describe('findStaleOutboxIds', () => {
  it('远端胜出的条目上的待推送操作应被判为过期', () => {
    const local = [item({ id: 'a', title: '本地', updatedAt: T1 }), item({ id: 'b', updatedAt: T1 })];
    const merged = [item({ id: 'a', title: '远端', updatedAt: T3 }), item({ id: 'b', updatedAt: T1 })];
    expect(findStaleOutboxIds(merged, local)).toEqual(['a']);
  });

  it('合并结果中不存在的条目其操作也过期', () => {
    const local = [item({ id: 'gone', updatedAt: T1 })];
    expect(findStaleOutboxIds([], local)).toEqual(['gone']);
  });

  it('墓碑差异同样算过期', () => {
    const local = [item({ id: 'a', updatedAt: T1 })];
    const merged = [item({ id: 'a', deletedAt: T2, updatedAt: T1 })];
    expect(findStaleOutboxIds(merged, local)).toEqual(['a']);
  });
});

describe('stableStringify', () => {
  it('键顺序不同但内容相同 → 序列化结果一致', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('忽略 undefined 字段', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it('数组顺序敏感', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});
