/** 文本处理小工具（纯函数，UI 与 core 共用） */

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** 取首行作为「无标题笔记」的展示标题 */
export function firstLineOf(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0) ?? '';
  return line.trim();
}

/** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 2 天前 / 2026-08-01 */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '';
  const diff = now - timestamp;

  if (diff < 0) return '刚刚';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;

  const date = new Date(timestamp);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 关键词高亮分段：不返回 HTML，避免 v-html（08 文档 §3.1） */
export interface HighlightSegment {
  text: string;
  hit: boolean;
}

export function highlightSegments(text: string, keywords: readonly string[]): HighlightSegment[] {
  const terms = keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0);
  if (terms.length === 0 || !text) return [{ text, hit: false }];

  const lower = text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const index = lower.indexOf(term, from);
      if (index < 0) break;
      for (let i = index; i < index + term.length; i += 1) marks[i] = true;
      from = index + term.length;
    }
  }

  const segments: HighlightSegment[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || marks[i] !== marks[start]) {
      segments.push({ text: text.slice(start, i), hit: marks[start] === true });
      start = i;
    }
  }
  return segments.filter((segment) => segment.text.length > 0);
}

/** 把关键词串拆成词（空格分隔，AND 语义） */
export function splitKeywords(input: string): string[] {
  return input
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}
