import { describe, expect, it } from 'vitest';
import { buildBookmarklet, buildBookmarkletSource } from './bookmarklet';

const BASE = 'https://example.github.io/my-collector/';

describe('书签小工具代码生成', () => {
  it('源码能被 JS 解析（语法错误在这一层是不可见的）', () => {
    const source = buildBookmarkletSource(BASE);
    expect(() => new Function(source)).not.toThrow();
  });

  it('href 以 javascript: 开头且可解码回源码', () => {
    const { href, source } = buildBookmarklet(BASE);
    expect(href.startsWith('javascript:')).toBe(true);
    expect(decodeURIComponent(href.slice('javascript:'.length))).toBe(source);
  });

  it('把目标应用地址原样嵌入，并指向 /new', () => {
    const source = buildBookmarkletSource(BASE);
    expect(source).toContain(JSON.stringify(BASE));
    expect(source).toContain("+ 'new?'");
  });

  it('来源标记为 bookmarklet，供条目 source 字段使用', () => {
    expect(buildBookmarkletSource(BASE)).toContain('source=bookmarklet');
  });

  it('对每个参数做 encodeURIComponent，避免参数内容破坏 query', () => {
    const source = buildBookmarkletSource(BASE);
    for (const key of ['url', 'title', 'excerpt', 'content']) {
      expect(source).toContain(`${key}=' + encodeURIComponent(`);
    }
  });

  it('对超长内容做截断（避免 URL 过长）', () => {
    const source = buildBookmarkletSource(BASE);
    expect(source).toContain('t.slice(0, 500)');
    expect(source).toContain('d.slice(0, 500)');
    expect(source).toContain('s.slice(0, 2000)');
  });

  it('弹出窗口被拦截时降级为当前页跳转', () => {
    const source = buildBookmarkletSource(BASE);
    expect(source).toContain('if (!w) location.href = target;');
  });

  it('异常兜底：至少带上 source=bookmarklet 跳过去', () => {
    const source = buildBookmarkletSource(BASE);
    expect(source).toContain("+ 'new?source=bookmarklet'");
  });

  it('base 用 JSON.stringify 包裹，含特殊字符也不会破坏语法', () => {
    const weird = "https://example.com/a'b\"c/";
    const source = buildBookmarkletSource(weird);
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain(JSON.stringify(weird));
  });
});
