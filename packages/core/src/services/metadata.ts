/**
 * 网页元信息抓取 —— 见 docs/tec/06-多端入口设计.md §4
 *
 * 分层策略：来源自带 → 自建代理 → 公共代理链 → 失败降级为手动填写。
 * 抓取失败永远不阻塞保存，且请求不携带任何身份信息。
 */
import type { MetadataSettings, MetadataSnippet } from '../model/types';
import { faviconFor, resolveUrl } from '../utils/url';

export interface MetadataFetchOutcome {
  ok: boolean;
  metadata: MetadataSnippet;
  /** 实际使用的提供方，便于 UI 说明「URL 已发送给谁」 */
  provider: MetadataSettings['provider'] | 'none';
  message?: string;
}

const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_EXCERPT = 500;
const MAX_BODY_BYTES = 512 * 1024;

class MetadataError extends Error {}

function metaContent(doc: Document, selector: string): string {
  const node = doc.querySelector(selector);
  const value = node?.getAttribute('content');
  return value ? value.trim() : '';
}

/** 解析 HTML 为元信息（用 DOMParser，不用正则匹配 HTML） */
export function parseHtmlMetadata(html: string, baseUrl: string): MetadataSnippet {
  if (typeof DOMParser === 'undefined') return {};
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const title =
    metaContent(doc, 'meta[property="og:title"]') ||
    metaContent(doc, 'meta[name="twitter:title"]') ||
    (doc.querySelector('title')?.textContent ?? '').trim();

  const excerpt = (
    metaContent(doc, 'meta[property="og:description"]') ||
    metaContent(doc, 'meta[name="description"]') ||
    metaContent(doc, 'meta[name="twitter:description"]')
  ).slice(0, MAX_EXCERPT);

  const siteName = metaContent(doc, 'meta[property="og:site_name"]');

  const iconHref = doc.querySelector('link[rel~="icon"], link[rel~="shortcut icon"]')?.getAttribute('href');
  const favicon = (iconHref ? resolveUrl(baseUrl, iconHref) : undefined) ?? faviconFor(baseUrl);

  const result: MetadataSnippet = {};
  if (title) result.title = title;
  if (excerpt) result.excerpt = excerpt;
  if (siteName) result.siteName = siteName;
  if (favicon) result.favicon = favicon;
  return result;
}

/** 解析 r.jina.ai 返回的文本（首部形如 "Title: xxx" 的头部行） */
export function parseJinaText(text: string): MetadataSnippet {
  const result: MetadataSnippet = {};
  const lines = text.split('\n').slice(0, 40);
  for (const line of lines) {
    const titleMatch = /^Title:\s*(.+)$/i.exec(line);
    if (titleMatch?.[1]) result.title = titleMatch[1].trim();
    const descMatch = /^Description:\s*(.+)$/i.exec(line);
    if (descMatch?.[1]) result.excerpt = descMatch[1].trim().slice(0, MAX_EXCERPT);
  }
  if (!result.title) {
    const heading = /^#\s+(.+)$/m.exec(text);
    if (heading?.[1]) result.title = heading[1].trim();
  }
  // 站点名从 URL 推断（r.jina.ai 不返回）
  return result;
}

async function readBody(response: Response): Promise<string> {
  const text = await response.text();
  return text.length > MAX_BODY_BYTES ? text.slice(0, MAX_BODY_BYTES) : text;
}

async function fetchWithTimeout(url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow', cache: 'no-store' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function viaJina(url: string, signal?: AbortSignal): Promise<MetadataSnippet> {
  const response = await fetchWithTimeout(`https://r.jina.ai/${url}`, signal, DEFAULT_TIMEOUT_MS);
  if (!response.ok) throw new MetadataError(`r.jina.ai 返回 ${response.status}`);
  const metadata = parseJinaText(await readBody(response));
  if (!metadata.favicon) {
    const favicon = faviconFor(url);
    if (favicon) metadata.favicon = favicon;
  }
  return metadata;
}

async function viaAllOrigins(url: string, signal?: AbortSignal): Promise<MetadataSnippet> {
  const endpoint = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const response = await fetchWithTimeout(endpoint, signal, DEFAULT_TIMEOUT_MS);
  if (!response.ok) throw new MetadataError(`allorigins 返回 ${response.status}`);
  return parseHtmlMetadata(await readBody(response), url);
}

async function viaCustom(
  customUrl: string,
  url: string,
  signal?: AbortSignal,
): Promise<MetadataSnippet> {
  const separator = customUrl.includes('?') ? '&' : '?';
  const response = await fetchWithTimeout(
    `${customUrl}${separator}url=${encodeURIComponent(url)}`,
    signal,
    DEFAULT_TIMEOUT_MS,
  );
  if (!response.ok) throw new MetadataError(`自建代理返回 ${response.status}`);
  const payload = (await response.json()) as Partial<MetadataSnippet>;
  const metadata: MetadataSnippet = {};
  if (payload.title) metadata.title = String(payload.title).trim();
  if (payload.excerpt) metadata.excerpt = String(payload.excerpt).trim().slice(0, MAX_EXCERPT);
  if (payload.siteName) metadata.siteName = String(payload.siteName).trim();
  if (payload.favicon) metadata.favicon = payload.favicon;
  if (!metadata.favicon) {
    const favicon = faviconFor(url);
    if (favicon) metadata.favicon = favicon;
  }
  return metadata;
}

/**
 * 按分层策略抓取元信息。任何异常都会被吞掉并返回 ok: false，
 * 调用方只需在失败时提示「请手动填写」。
 */
export async function fetchMetadata(
  url: string,
  settings: MetadataSettings,
  signal?: AbortSignal,
): Promise<MetadataFetchOutcome> {
  if (!settings.enabled) {
    const favicon = faviconFor(url);
    return {
      ok: false,
      metadata: favicon ? { favicon } : {},
      provider: 'none',
      message: '已关闭自动抓取',
    };
  }

  const attempts: Array<{ provider: MetadataSettings['provider']; run: () => Promise<MetadataSnippet> }> = [];

  if (settings.provider === 'custom' && settings.customUrl) {
    const customUrl = settings.customUrl;
    attempts.push({ provider: 'custom', run: () => viaCustom(customUrl, url, signal) });
  } else if (settings.provider === 'jina') {
    attempts.push({ provider: 'jina', run: () => viaJina(url, signal) });
    attempts.push({ provider: 'allorigins', run: () => viaAllOrigins(url, signal) });
  } else {
    attempts.push({ provider: 'allorigins', run: () => viaAllOrigins(url, signal) });
    attempts.push({ provider: 'jina', run: () => viaJina(url, signal) });
  }

  let lastError = '';
  for (const attempt of attempts) {
    try {
      const metadata = await attempt.run();
      if (metadata.title || metadata.excerpt || metadata.favicon) {
        return { ok: true, metadata, provider: attempt.provider };
      }
      lastError = '抓取结果为空';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const favicon = faviconFor(url);
  return {
    ok: false,
    metadata: favicon ? { favicon } : {},
    provider: attempts[0]?.provider ?? 'none',
    message: lastError || '抓取失败',
  };
}
