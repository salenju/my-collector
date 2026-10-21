<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '@/utils/markdown';

/**
 * Markdown 只读渲染。渲染结果由 utils/markdown.ts 自行拼装并转义，
 * 不含任何用户可控的标签/属性，因此这里用 v-html 是安全的（08 文档 §3.1）。
 */
const props = withDefaults(defineProps<{ source: string; empty?: string }>(), {
  empty: '',
});

const html = computed(() => renderMarkdown(props.source));
</script>

<template>
  <div v-if="html" class="md-body" v-html="html" />
  <p v-else-if="empty" class="text-sm text-muted">{{ empty }}</p>
</template>
