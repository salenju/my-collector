/** 全项目时间统一为 ISO 8601 UTC 字符串（可比较、可排序、时区无关） */

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/** 分片键：取 createdAt 的 YYYY-MM（UTC） */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** 当前 UTC 月份，如 2026-09 */
export function currentMonth(): string {
  return nowIso().slice(0, 7);
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return null;
  const diff = target - Date.now();
  return Math.floor(diff / 86_400_000);
}

/** 兼容纯日期（2026-12-26）与完整 ISO 的解析 */
export function parseLooseDate(value: string): string | null {
  if (!value) return null;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();
  const withTime = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(withTime) ? null : new Date(withTime).toISOString();
}
