/**
 * 标签颜色映射 —— 见 docs/tec/05-前端应用设计.md §5.1
 *
 * Tailwind 无法扫描动态拼接的类名，因此这里必须写完整的字面量类名。
 */
import type { TagColor } from '@my-collector/core';

/** 软色 chip 样式 */
const CHIP: Record<TagColor, string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-400/10 dark:text-blue-300 dark:border-blue-400/30',
  amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:border-amber-400/30',
  violet: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-400/10 dark:text-violet-300 dark:border-violet-400/30',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-300 dark:border-emerald-400/30',
  rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-400/10 dark:text-rose-300 dark:border-rose-400/30',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-400/10 dark:text-cyan-300 dark:border-cyan-400/30',
  orange: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-400/10 dark:text-orange-300 dark:border-orange-400/30',
  teal: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-400/10 dark:text-teal-300 dark:border-teal-400/30',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-400/10 dark:text-indigo-300 dark:border-indigo-400/30',
  pink: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-400/10 dark:text-pink-300 dark:border-pink-400/30',
  lime: 'bg-lime-50 text-lime-700 border-lime-200 dark:bg-lime-400/10 dark:text-lime-300 dark:border-lime-400/30',
  slate: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-400/10 dark:text-slate-300 dark:border-slate-400/30',
};

/** 实心色块（调色板选择器用） */
const SOLID: Record<TagColor, string> = {
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  emerald: 'bg-emerald-500',
  rose: 'bg-rose-500',
  cyan: 'bg-cyan-500',
  orange: 'bg-orange-500',
  teal: 'bg-teal-500',
  indigo: 'bg-indigo-500',
  pink: 'bg-pink-500',
  lime: 'bg-lime-500',
  slate: 'bg-slate-500',
};

export function tagChipClass(color: TagColor): string {
  return CHIP[color] ?? CHIP.slate;
}

export function tagSolidClass(color: TagColor): string {
  return SOLID[color] ?? SOLID.slate;
}

/** 无 favicon 时的占位色（按域名 hash 稳定分配） */
const AVATAR: string[] = [
  'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
];

export function avatarClass(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100_000;
  return AVATAR[hash % AVATAR.length] ?? AVATAR[0]!;
}
