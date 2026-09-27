/**
 * UTF-8 安全的 base64 编解码。
 *
 * 常见坑：直接 `btoa(中文字符串)` 会抛 InvalidCharacterError；
 * 直接 `atob(...)` 得到的 latin1 字符串再显示中文会乱码。
 * 全项目只允许通过这里编解码，并有专门的回归测试。
 */

/** 分块大小：避免 String.fromCharCode(...bytes) 参数过多导致栈溢出 */
const CHUNK = 0x80_00;

export function encodeBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const slice = bytes.subarray(offset, offset + CHUNK);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

export function decodeBase64Utf8(input: string): string {
  // GitHub Contents API 会在 base64 中插入换行
  const normalized = input.replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
