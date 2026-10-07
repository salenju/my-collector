/**
 * 字节边界的统一类型。
 *
 * TypeScript 5.7 起 `Uint8Array` 带上了 buffer 类型参数，而
 * `Uint8Array<ArrayBufferLike>` **不能**直接当作 `BlobPart` / `BufferSource`
 * （因为 `SharedArrayBuffer` 不被这些 API 接受）。
 *
 * 图片字节会在「canvas 编码 → Blob → IndexedDB → Git blob base64 → fetch 响应」
 * 之间来回传递，处处都是这个边界，因此统一用 `Bytes` 表示
 * 「底层一定是普通 ArrayBuffer」，避免在每个调用点写类型断言。
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/** 规整为 `Bytes`；必要时复制一次（图片在 1MB 量级，成本可忽略） */
export function toBytes(input: Uint8Array): Bytes {
  if (
    input.buffer instanceof ArrayBuffer &&
    input.byteOffset === 0 &&
    input.byteLength === input.buffer.byteLength
  ) {
    return input as Bytes;
  }
  const out = new Uint8Array(input.byteLength);
  out.set(input);
  return out;
}
