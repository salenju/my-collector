<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { extractFirstUrl, normalizeUrl, stripUrlFromText } from '@my-collector/core';

/**
 * PWA share_target 落地点（/share?title=&text=&url=）。
 * 见 docs/tec/06-多端入口设计.md §3.2：把分享参数规范化后转交 /new 预填。
 */
const route = useRoute();
const router = useRouter();

function param(key: string): string {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
}

onMounted(() => {
  const sharedText = param('text');
  const rawUrl = param('url') || extractFirstUrl(sharedText) || '';

  const query: Record<string, string> = {
    source: 'share',
    url: rawUrl ? normalizeUrl(rawUrl) : '',
    title: param('title'),
    content: stripUrlFromText(sharedText, rawUrl),
  };

  void router.replace({ path: '/new', query });
});
</script>

<template>
  <div class="p-6 text-sm text-muted">正在解析分享内容…</div>
</template>
