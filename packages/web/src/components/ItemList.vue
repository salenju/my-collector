<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Bookmark, Search } from '@lucide/vue';
import type { Item } from '@my-collector/core';
import { useTagsStore } from '@/stores/tags';
import ItemCard from './ItemCard.vue';
import EmptyState from './EmptyState.vue';

const props = withDefaults(
  defineProps<{
    items: Item[];
    keyword?: string;
    activeId?: string | null;
    selectedIds?: string[];
    pendingIds?: Set<string>;
    loading?: boolean;
  }>(),
  { keyword: '', activeId: null, selectedIds: () => [], loading: false },
);

const emit = defineEmits<{
  (e: 'open', id: string): void;
  (e: 'toggle-select', id: string): void;
}>();

const tags = useTagsStore();

/** 一次性渲染上限：超过后分页显示，避免条目上千时 DOM 过大 */
const PAGE_SIZE = 100;
const limit = ref(PAGE_SIZE);
watch(
  () => props.items,
  () => {
    limit.value = PAGE_SIZE;
  },
);

const shown = computed(() => props.items.slice(0, limit.value));

function tagsOf(item: Item) {
  return item.tagIds
    .map((id) => tags.byId(id))
    .filter((tag): tag is NonNullable<typeof tag> => tag !== null);
}
</script>

<template>
  <div>
    <EmptyState
      v-if="items.length === 0 && !loading"
      :icon="keyword ? Search : Bookmark"
      :title="keyword ? '没有匹配的记录' : '还没有任何记录'"
      :description="
        keyword
          ? '换个关键词，或清空标签筛选再试试。'
          : '粘贴一个链接开始收集吧，数据会保存到你的 GitHub 私有仓库。'
      "
    >
      <slot name="empty-actions" />
    </EmptyState>

    <div v-else class="space-y-2">
      <ItemCard
        v-for="item in shown"
        :key="item.id"
        :item="item"
        :tags="tagsOf(item)"
        :keyword="keyword"
        :active="item.id === activeId"
        :selected="selectedIds.includes(item.id)"
        :pending="pendingIds?.has(item.id) ?? false"
        @open="emit('open', item.id)"
        @toggle-select="emit('toggle-select', item.id)"
      />

      <button
        v-if="items.length > limit"
        class="min-h-11 w-full rounded-card border border-dashed border-line py-3 text-sm text-muted hover:bg-elevated hover:text-ink"
        @click="limit += PAGE_SIZE"
      >
        还有 {{ items.length - limit }} 条，显示更多
      </button>
    </div>
  </div>
</template>
