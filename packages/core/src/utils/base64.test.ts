import { describe, expect, it } from 'vitest';
import { decodeBase64Utf8, encodeBase64Utf8 } from './base64';

describe('base64 UTF-8 编解码', () => {
  it('中文往返一致（btoa 直接编码中文会抛错，这里必须走 TextEncoder）', () => {
    const text = '满天星：收集碎片信息、链接与想法';
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
  });

  it('emoji 与混合内容往返一致', () => {
    const text = '✅ 已同步 🚀 #技术 #待读\n第二行\t制表符';
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
  });

  it('空字符串往返一致', () => {
    expect(decodeBase64Utf8(encodeBase64Utf8(''))).toBe('');
  });

  it('能解码 GitHub 返回的带换行 base64', () => {
    const encoded = encodeBase64Utf8('{"items":[]}');
    const withNewlines = `${encoded.slice(0, 6)}\n${encoded.slice(6)}\n`;
    expect(decodeBase64Utf8(withNewlines)).toBe('{"items":[]}');
  });

  it('超长文本不触发调用栈溢出', () => {
    const text = '满天星'.repeat(40_000);
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
  });
});
