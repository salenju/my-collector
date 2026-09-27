import { describe, expect, it } from 'vitest';
import { firstLineOf, formatRelativeTime, highlightSegments, splitKeywords, truncate } from './text';

describe('文本工具', () => {
  it('truncate 截断并追加省略号', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('firstLineOf 取第一个非空行', () => {
    expect(firstLineOf('\n\n第一行\n第二行')).toBe('第一行');
    expect(firstLineOf('')).toBe('');
  });

  it('splitKeywords 按空白拆分，支持中文', () => {
    expect(splitKeywords('  技术   React  ')).toEqual(['技术', 'React']);
    expect(splitKeywords('')).toEqual([]);
  });

  it('formatRelativeTime 输出中文相对时间', () => {
    const now = Date.parse('2026-09-27T12:00:00Z');
    expect(formatRelativeTime('2026-09-27T11:59:30Z', now)).toBe('刚刚');
    expect(formatRelativeTime('2026-09-27T11:30:00Z', now)).toBe('30 分钟前');
    expect(formatRelativeTime('2026-09-27T09:00:00Z', now)).toBe('3 小时前');
    expect(formatRelativeTime('2026-09-25T12:00:00Z', now)).toBe('2 天前');
    expect(formatRelativeTime('2026-01-02T12:00:00Z', now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('highlightSegments 分段命中关键词（不产生 HTML）', () => {
    const segments = highlightSegments('React 19 新特性', ['react']);
    expect(segments).toEqual([
      { text: 'React', hit: true },
      { text: ' 19 新特性', hit: false },
    ]);
  });

  it('highlightSegments 无关键词时原样返回', () => {
    expect(highlightSegments('abc', [])).toEqual([{ text: 'abc', hit: false }]);
  });
});
