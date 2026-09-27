/**
 * 冲突合并 —— 见 docs/tec/04-同步引擎与冲突处理.md §5
 *
 * 纯函数、无副作用，便于单测覆盖 14 条冲突矩阵。
 * 规则：按 id 取并集 → 逐条裁决 → 本地未推送的操作不能被吞掉。
 */
import type { Item, MergePolicy, Tag } from '../model/types';

export type ConflictReason = 'lww' | 'delete-policy' | 'same-timestamp-differs';

export interface MergeConflict {
  entity: 'item' | 'tag';
  id: string;
  /** 便于 UI 展示的短标签（标题或标签名） */
  label: string;
  kept: 'local' | 'remote';
  reason: ConflictReason;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  at: string;
}

export interface MergeOptions {
  /** 删除优先 / 编辑优先（04 文档 §5.2 #8） */
  policy: MergePolicy;
  /** 时间戳，注入以便测试 */
  now: string;
  /** 本地存在未推送操作的实体 id 集合 */
  pending: ReadonlySet<string>;
}

export interface MergeOutcome<T> {
  values: T[];
  conflicts: MergeConflict[];
}

interface Mergeable {
  id: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** 稳定的序列化（递归排序 key），用于判断两侧内容是否真的相同 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

interface Decision<T> {
  value: T;
  source: 'local' | 'remote';
  reason: ConflictReason;
}

/**
 * 裁决同一条记录在两侧的版本。
 * 返回 null 表示两侧完全一致（无需记录冲突）。
 */
function resolve<T extends Mergeable>(
  local: T,
  remote: T,
  policy: MergePolicy,
): Decision<T> | null {
  const localDeleted = local.deletedAt !== null;
  const remoteDeleted = remote.deletedAt !== null;

  // delete-wins：只要一侧是墓碑就删除生效，不看时间戳
  if (policy === 'delete-wins' && localDeleted !== remoteDeleted) {
    return localDeleted
      ? { value: local, source: 'local', reason: 'delete-policy' }
      : { value: remote, source: 'remote', reason: 'delete-policy' };
  }

  if (local.updatedAt === remote.updatedAt) {
    if (stableStringify(local) === stableStringify(remote)) return null;
    // 时间戳相同但内容不同：正常情况不该发生（可能被手工改过）
    return { value: remote, source: 'remote', reason: 'same-timestamp-differs' };
  }

  return local.updatedAt > remote.updatedAt
    ? { value: local, source: 'local', reason: 'lww' }
    : { value: remote, source: 'remote', reason: 'lww' };
}

function mergeCollection<T extends Mergeable>(
  entity: 'item' | 'tag',
  localValues: readonly T[],
  remoteValues: readonly T[],
  options: MergeOptions,
  labelOf: (value: T) => string,
): MergeOutcome<T> {
  const localMap = new Map(localValues.map((value) => [value.id, value]));
  const remoteMap = new Map(remoteValues.map((value) => [value.id, value]));
  const conflicts: MergeConflict[] = [];
  const values: T[] = [];

  const ids = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);
  for (const id of ids) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (local && !remote) {
      values.push(local);
      continue;
    }
    if (!local && remote) {
      values.push(remote);
      continue;
    }
    if (!local || !remote) continue;

    // 本地有未推送操作时，时间戳相同但内容不同 → 以本地为准（用户刚点的操作不能被吞掉）
    if (
      local.updatedAt === remote.updatedAt &&
      options.pending.has(id) &&
      stableStringify(local) !== stableStringify(remote)
    ) {
      values.push(local);
      conflicts.push({
        entity,
        id,
        label: labelOf(local),
        kept: 'local',
        reason: 'same-timestamp-differs',
        localUpdatedAt: local.updatedAt,
        remoteUpdatedAt: remote.updatedAt,
        at: options.now,
      });
      continue;
    }

    const decision = resolve(local, remote, options.policy);
    if (!decision) {
      values.push(local);
      continue;
    }
    values.push(decision.value);
    // 仅当两侧都真的被修改过（时间戳不同）时才算"冲突"，避免日志噪声
    if (decision.reason !== 'lww' || local.updatedAt !== remote.updatedAt) {
      conflicts.push({
        entity,
        id,
        label: labelOf(decision.value),
        kept: decision.source,
        reason: decision.reason,
        localUpdatedAt: local.updatedAt,
        remoteUpdatedAt: remote.updatedAt,
        at: options.now,
      });
    }
  }

  return { values, conflicts };
}

export function mergeItems(
  localValues: readonly Item[],
  remoteValues: readonly Item[],
  options: MergeOptions,
): MergeOutcome<Item> {
  return mergeCollection('item', localValues, remoteValues, options, (item) => item.title || item.url || item.id);
}

export function mergeTags(
  localValues: readonly Tag[],
  remoteValues: readonly Tag[],
  options: MergeOptions,
): MergeOutcome<Tag> {
  return mergeCollection('tag', localValues, remoteValues, options, (tag) => tag.name);
}

/**
 * 合并后哪些待推送操作已经过期（远端版本胜出）。
 * 过期操作应被丢弃，否则会把已经过时的本地内容重新写回远端。
 */
export function findStaleOutboxIds<T extends Mergeable>(
  merged: readonly T[],
  local: readonly T[],
): string[] {
  const mergedMap = new Map(merged.map((value) => [value.id, value]));
  const stale: string[] = [];
  for (const localValue of local) {
    const winner = mergedMap.get(localValue.id);
    if (!winner) {
      stale.push(localValue.id);
      continue;
    }
    if (winner.updatedAt !== localValue.updatedAt || winner.deletedAt !== localValue.deletedAt) {
      stale.push(localValue.id);
    }
  }
  return stale;
}
