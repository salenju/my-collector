import { sanitizeJson } from '../model/guards';

/**
 * 解析外部 JSON 文本：失败返回 null，并递归剔除原型污染键。
 * 远端文件一律走这里，绝不直接 JSON.parse 后使用。
 */
export function parseJsonSafe(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return sanitizeJson(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
