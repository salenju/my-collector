/**
 * URL 归一化与安全校验 —— 对应 docs/tec/02-数据模型与存储.md §2.5 与 08 文档 §3.1
 */

/** 需剥离的追踪参数（前缀匹配） */
const TRACKING_PREFIXES = ['utm_', 'hmsr', 'hmpl', 'hmcu', 'hmkw', 'hmci'];

/** 需剥离的追踪参数（精确匹配，全小写比较） */
const TRACKING_KEYS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'igshid',
  'spm',
  'scm',
  'ref',
  'from',
  'ref_src',
  'share_token',
  'share_from',
  'mkt_tok',
  'trk',
  'trkcampaign',
  '_f',
  'si',
]);

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>()[\]{}，。；：！？、）】》]+/i;

/** 只允许 http/https，明确拒绝 javascript:、data:、file: 等（08 文档 §3.1） */
export function isSafeUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 用于 <img> 的地址校验：额外拒绝 data: 之外的危险协议 */
export function isSafeImageUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * 归一化 URL：补协议、去 fragment、剥离追踪参数。
 * 解析失败时原样返回（不做破坏性修改）。
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const candidate = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return trimmed;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return trimmed;

  url.hash = '';
  for (const key of Array.from(url.searchParams.keys())) {
    const lower = key.toLowerCase();
    if (TRACKING_KEYS.has(lower) || TRACKING_PREFIXES.some((p) => lower.startsWith(p))) {
      url.searchParams.delete(key);
    }
  }

  let out = url.toString();
  if (out.endsWith('?')) out = out.slice(0, -1);
  return out;
}

/** 展示用域名：去 www 前缀 */
export function hostOf(raw: string | undefined | null): string {
  if (!raw) return '';
  try {
    return new URL(raw).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** 站点图标地址：优先同源 /favicon.ico（不请求任何第三方服务） */
export function faviconFor(raw: string | undefined | null): string | undefined {
  if (!isSafeUrl(raw)) return undefined;
  try {
    const url = new URL(raw as string);
    return `${url.origin}/favicon.ico`;
  } catch {
    return undefined;
  }
}

/** 从分享文本中提取第一个 URL（微信/微博分享常常只给文本） */
export function extractFirstUrl(text: string): string | undefined {
  const match = text.match(URL_IN_TEXT_RE);
  return match?.[0];
}

/** 去掉文本中已提取的 URL，剩下作为用户内容 */
export function stripUrlFromText(text: string, url?: string): string {
  if (!url) return text.trim();
  return text.split(url).join(' ').replace(/\s{2,}/g, ' ').trim();
}

/** 相对地址补全（用于解析 favicon 的 href） */
export function resolveUrl(base: string, href: string): string | undefined {
  try {
    const resolved = new URL(href, base).toString();
    return isSafeImageUrl(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}
