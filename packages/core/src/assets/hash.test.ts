import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assetIdFromSha256, assetIdOfBytes, sha256Bytes, sha256Hex, sha256HexSync, toHex } from './hash';

function nodeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function sample(length: number, seed = 7): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let value = seed;
  for (let i = 0; i < length; i += 1) {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = value & 0xff;
  }
  return bytes;
}

describe('附件图片的内容寻址', () => {
  it('纯 JS 实现与 Node crypto 的 sha256 一致（覆盖 padding 边界）', () => {
    // 0 / 55 / 56 / 63 / 64 / 65 是 SHA-256 补位规则的临界长度
    for (const length of [0, 1, 55, 56, 63, 64, 65, 200, 1000]) {
      const bytes = sample(length);
      expect(sha256HexSync(bytes)).toBe(nodeSha256(bytes));
    }
  });

  it('异步 sha256Hex 与同步实现一致（crypto.subtle 路径与降级路径必须等价）', async () => {
    const bytes = sample(4096, 42);
    expect(await sha256Hex(bytes)).toBe(sha256HexSync(bytes));
  });

  it('摘要为 32 字节 / 64 位十六进制', () => {
    const digest = sha256Bytes(sample(10));
    expect(digest.byteLength).toBe(32);
    expect(toHex(digest)).toHaveLength(64);
  });

  it('asset id 取 sha256 前 32 位（128 bit）且全为小写十六进制', async () => {
    const id = await assetIdOfBytes(sample(2048));
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(assetIdFromSha256(nodeSha256(sample(2048)))).toBe(id);
  });

  it('相同内容得到相同 id（去重的前提），内容不同则 id 不同', async () => {
    const a = sample(512, 1);
    const b = sample(512, 1);
    const c = sample(512, 2);
    expect(await assetIdOfBytes(a)).toBe(await assetIdOfBytes(b));
    expect(await assetIdOfBytes(a)).not.toBe(await assetIdOfBytes(c));
  });

  it('crypto.subtle 不可用时降级到纯 JS（非安全上下文的调试场景）', async () => {
    const original = globalThis.crypto;
    const bytes = sample(777, 5);
    // 用不可配置的替身模拟"没有 crypto"
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(await sha256Hex(bytes)).toBe(nodeSha256(bytes));
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});
