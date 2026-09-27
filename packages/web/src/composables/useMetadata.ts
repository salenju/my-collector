import { ref } from 'vue';
import { fetchMetadata, type MetadataSnippet } from '@my-collector/core';
import { collector } from '@/collector';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEDUPE_WINDOW_MS = 5_000;
const MAX_CONCURRENT = 2;

/** 同一 URL 的并发请求合并为一个 */
const inFlight = new Map<string, Promise<MetadataSnippet>>();
let running = 0;
let lastUrl = '';
let lastAt = 0;

async function acquireSlot(): Promise<void> {
  while (running >= MAX_CONCURRENT) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  running += 1;
}

function releaseSlot(): void {
  running = Math.max(0, running - 1);
}

export interface MetadataLookupResult {
  metadata: MetadataSnippet;
  provider: string;
  ok: boolean;
  message?: string;
  cached: boolean;
}

export function useMetadata() {
  const loading = ref(false);
  const error = ref('');
  const provider = ref('');

  /**
   * 抓取网页元信息（分层策略见 docs/tec/06-多端入口设计.md §4）。
   * 失败不抛异常，返回 ok:false，由调用方提示「请手动填写」。
   */
  async function lookup(rawUrl: string): Promise<MetadataLookupResult> {
    const url = rawUrl.trim();
    if (!url) {
      return { metadata: {}, provider: 'none', ok: false, message: 'URl 为空', cached: false };
    }

    // 5 秒内同一 URL 不重复抓取
    if (url === lastUrl && Date.now() - lastAt < DEDUPE_WINDOW_MS) {
      return { metadata: {}, provider: 'dedupe', ok: false, message: '刚刚已抓取', cached: false };
    }
    lastUrl = url;
    lastAt = Date.now();

    const cached = await collector.db.metadataCache.get(url);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      provider.value = 'cache';
      return { metadata: cached.value, provider: 'cache', ok: true, cached: true };
    }

    const existing = inFlight.get(url);
    if (existing) {
      const metadata = await existing;
      return { metadata, provider: 'inflight', ok: true, cached: false };
    }

    loading.value = true;
    error.value = '';

    const task = (async (): Promise<MetadataSnippet> => {
      await acquireSlot();
      try {
        const outcome = await fetchMetadata(url, collector.settings.metadataSettings);
        provider.value = outcome.provider;
        if (!outcome.ok) error.value = outcome.message ?? '抓取失败';
        if (outcome.ok) {
          await collector.db.metadataCache.put({ url, value: outcome.metadata, at: Date.now() });
        }
        return outcome.metadata;
      } finally {
        releaseSlot();
      }
    })();

    inFlight.set(url, task);
    try {
      const metadata = await task;
      return {
        metadata,
        provider: provider.value,
        ok: Object.keys(metadata).length > 0,
        message: error.value || undefined,
        cached: false,
      };
    } finally {
      inFlight.delete(url);
      loading.value = false;
    }
  }

  async function clearCache(): Promise<number> {
    const count = await collector.db.metadataCache.count();
    await collector.db.metadataCache.clear();
    return count;
  }

  return { loading, error, provider, lookup, clearCache };
}
