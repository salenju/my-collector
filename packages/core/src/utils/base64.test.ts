import { describe, expect, it } from 'vitest';
import { decodeBase64Bytes, decodeBase64Utf8, encodeBase64Bytes, encodeBase64Utf8 } from './base64';

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

describe('base64 二进制编解码（附件图片）', () => {
  it('覆盖全部 256 种字节值的往返完全一致', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    const roundTrip = decodeBase64Bytes(encodeBase64Bytes(bytes));
    expect(Array.from(roundTrip)).toEqual(Array.from(bytes));
  });

  it('1MB 随机字节往返完全一致（分块编码不丢数据）', () => {
    const bytes = new Uint8Array(1024 * 1024);
    // 用确定性伪随机，失败时可复现
    let seed = 123456789;
    for (let i = 0; i < bytes.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      bytes[i] = seed & 0xff;
    }
    const roundTrip = decodeBase64Bytes(encodeBase64Bytes(bytes));
    expect(roundTrip.byteLength).toBe(bytes.byteLength);
    expect(roundTrip).toEqual(bytes);
  });

  it('带换行的 base64 也能解码（GitHub 会在长 base64 里插换行）', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const encoded = encodeBase64Bytes(bytes);
    const wrapped = `${encoded.slice(0, 4)}\n${encoded.slice(4)}\r\n`;
    expect(Array.from(decodeBase64Bytes(wrapped))).toEqual(Array.from(bytes));
  });

  it('⚠️ 回归：二进制**不能**用 UTF-8 编码器（≥0x80 的字节会被篡改）', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x80, 0x81, 0xc3, 0xa9]);
    const binarySafe = decodeBase64Bytes(encodeBase64Bytes(bytes));
    expect(Array.from(binarySafe)).toEqual(Array.from(bytes));

    // 这条断言用来固化"两种编码器不可互换"这个事实：
    // UTF-8 路径会把 latin1 字符串重新编码，字节总数都变了
    const utf8Path = decodeBase64Bytes(encodeBase64Utf8(String.fromCharCode(...bytes)));
    expect(Array.from(utf8Path)).not.toEqual(Array.from(bytes));
  });
});
