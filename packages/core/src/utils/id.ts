import { nanoid } from 'nanoid';

/** 条目 ID：10 位，离线可生成，碰撞概率可忽略 */
export function newItemId(): string {
  return nanoid(10);
}

/** 标签 ID：带语义前缀，便于在 JSON 中一眼看出类型 */
export function newTagId(): string {
  return `tag_${nanoid(8)}`;
}

/** 设备 ID：首次运行生成并持久化 */
export function newDeviceId(): string {
  return `device_${nanoid(8)}`;
}
