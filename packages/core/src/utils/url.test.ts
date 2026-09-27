import { describe, expect, it } from 'vitest';
import {
  extractFirstUrl,
  faviconFor,
  hostOf,
  isSafeImageUrl,
  isSafeUrl,
  normalizeUrl,
  resolveUrl,
  stripUrlFromText,
} from './url';

describe('isSafeUrl', () => {
  it('只允许 http/https', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('chrome://settings')).toBe(false);
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
  });

  it('isSafeImageUrl 同样拒绝危险协议', () => {
    expect(isSafeImageUrl('https://a.com/i.png')).toBe(true);
    expect(isSafeImageUrl('data:image/svg+xml,<svg/>')).toBe(false);
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('缺少协议时补 https', () => {
    expect(normalizeUrl('example.com/a')).toBe('https://example.com/a');
  });

  it('去掉 fragment', () => {
    expect(normalizeUrl('https://example.com/a#section')).toBe('https://example.com/a');
  });

  it('剥离追踪参数但保留业务参数', () => {
    const result = normalizeUrl(
      'https://example.com/p?id=123&utm_source=wechat&utm_medium=social&fbclid=xyz&spm=a1.b2&from=timeline',
    );
    expect(result).toBe('https://example.com/p?id=123');
  });

  it('单参数被删净后不留问号', () => {
    expect(normalizeUrl('https://example.com/p?utm_source=x')).toBe('https://example.com/p');
  });

  it('非法协议原样返回（不做破坏性修改）', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe('javascript:alert(1)');
  });
});

describe('hostOf', () => {
  it('去掉 www 前缀', () => {
    expect(hostOf('https://www.example.com/a/b')).toBe('example.com');
    expect(hostOf('https://blog.example.com/a')).toBe('blog.example.com');
    expect(hostOf('not a url')).toBe('');
  });
});

describe('faviconFor', () => {
  it('用站点自身 origin，不请求第三方服务', () => {
    expect(faviconFor('https://example.com/a/b?c=1')).toBe('https://example.com/favicon.ico');
  });

  it('危险协议返回 undefined', () => {
    expect(faviconFor('javascript:alert(1)')).toBeUndefined();
  });
});

describe('分享文本解析', () => {
  it('从文本中提取第一个 URL', () => {
    expect(extractFirstUrl('看看这个 https://example.com/a 很有意思')).toBe('https://example.com/a');
    expect(extractFirstUrl('没有链接')).toBeUndefined();
  });

  it('剥离已提取的 URL 后留下正文', () => {
    const text = '看看这个 https://example.com/a 很有意思';
    const url = extractFirstUrl(text);
    expect(stripUrlFromText(text, url)).toBe('看看这个 很有意思');
  });
});

describe('resolveUrl', () => {
  it('相对 favicon 路径补全为绝对地址', () => {
    expect(resolveUrl('https://example.com/a/b', '/static/icon.png')).toBe(
      'https://example.com/static/icon.png',
    );
  });

  it('拒绝 javascript: scheme', () => {
    expect(resolveUrl('https://example.com', 'javascript:alert(1)')).toBeUndefined();
  });
});
