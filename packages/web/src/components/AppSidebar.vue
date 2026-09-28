<script setup lang="ts">
import { computed } from 'vue';
import { Archive, FolderOpen, Link2, ListFilter, Settings, StickyNote, Tag } from '@lucide/vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import type { ItemType } from '@my-collector/core';
import { useAppStore } from '@/stores/app';
import { useItemsStore } from '@/stores/items';
import { useTagsStore } from '@/stores/tags';
import TagChip from './TagChip.vue';

const app = useAppStore();
const items = useItemsStore();
const tags = useTagsStore();
const route = useRoute();
const router = useRouter();

interface NavEntry {
  key: string;
  label: string;
  icon: unknown;
  type: 'all' | ItemType;
  archived: boolean;
  count: number;
}

const nav = computed<NavEntry[]>(() => [
  { key: 'all', label: '全部', icon: FolderOpen, type: 'all', archived: false, count: items.counts.active },
  { key: 'link', label: '链接', icon: Link2, type: 'link', archived: false, count: items.counts.links },
  { key: 'note', label: '笔记', icon: StickyNote, type: 'note', archived: false, count: items.counts.notes },
  { key: 'archived', label: '已归档', icon: Archive, type: 'all', archived: true, count: items.counts.archived },
]);

function isActive(entry: NavEntry): boolean {
  return (
    items.filter.archived === entry.archived &&
    items.filter.type === entry.type &&
    items.filter.tagIds.length === 0
  );
}

/**
 * 侧栏只负责筛选：若当前不在列表页（如设置/标签/详情页），点击后必须回到列表页，
 * 否则筛选状态虽然变了，页面却没有任何反应；移动端抽屉同时关闭。
 */
function goToList(): void {
  app.sidebarOpen = false;
  if (route.path !== '/') void router.push('/');
}

function select(entry: NavEntry): void {
  items.setArchived(entry.archived);
  items.setType(entry.type);
  items.clearTags();
  goToList();
}

function selectTag(tagId: string): void {
  items.toggleTag(tagId);
  goToList();
}

function clearFilters(): void {
  items.resetFilter();
  goToList();
}

const sortedTags = computed(() =>
  [...tags.active]
    .map((tag) => ({ tag, count: items.tagCounts[tag.id] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name, 'zh-Hans-CN')),
);

const filterActive = computed(
  () => items.filter.keyword.trim().length > 0 || items.filter.tagIds.length > 0 || items.filter.archived,
);
</script>

<template>
  <nav class="flex h-full flex-col gap-4 overflow-y-auto p-3">
    <ul class="space-y-0.5">
      <li v-for="entry in nav" :key="entry.key">
        <button
          class="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-sm transition"
          :class="isActive(entry) ? 'bg-brand/10 font-medium text-brand' : 'text-muted hover:bg-elevated hover:text-ink'"
          @click="select(entry)"
        >
          <component :is="entry.icon" class="h-4 w-4 shrink-0" />
          <span class="flex-1 text-left">{{ entry.label }}</span>
          <span class="text-xs tabular-nums opacity-70">{{ entry.count }}</span>
        </button>
      </li>
    </ul>

    <div class="divider" />

    <div class="min-h-0 flex-1">
      <div class="mb-2 flex items-center justify-between px-1">
        <span class="flex items-center gap-1.5 text-xs font-medium text-muted">
          <Tag class="h-3.5 w-3.5" />标签
        </span>
        <RouterLink
          to="/tags"
          class="rounded p-1 text-muted transition hover:text-ink"
          title="管理标签"
        >
          <Settings class="h-3.5 w-3.5" />
        </RouterLink>
      </div>

      <p v-if="sortedTags.length === 0" class="px-2 text-xs leading-relaxed text-muted">
        还没有标签。新建记录时输入标签名即可创建。
      </p>

      <ul v-else class="space-y-0.5">
        <li v-for="{ tag, count } in sortedTags" :key="tag.id">
          <button
            class="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm transition"
            :class="
              items.filter.tagIds.includes(tag.id)
                ? 'bg-brand/10 font-medium text-ink'
                : 'text-muted hover:bg-elevated hover:text-ink'
            "
            @click="selectTag(tag.id)"
          >
            <span class="min-w-0 flex-1 text-left">
              <TagChip :tag="tag" :interactive="false" />
            </span>
            <span class="text-xs tabular-nums opacity-70">{{ count }}</span>
          </button>
        </li>
      </ul>
    </div>

    <div v-if="filterActive" class="divider pt-3">
      <button
        class="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-muted transition hover:bg-elevated hover:text-ink"
        @click="clearFilters"
      >
        <ListFilter class="h-4 w-4" />
        清空筛选条件
      </button>
    </div>
  </nav>
</template>
