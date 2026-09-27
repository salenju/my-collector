import { defineStore } from 'pinia';
import {
  DEFAULT_ITEM_FILTER,
  collectListCounts,
  collectTagCounts,
  filterItems,
  type Item,
  type ItemDraft,
  type ItemFilter,
  type ItemType,
  type ListCounts,
  type SortField,
} from '@my-collector/core';
import { collector } from '@/collector';
import { useTagsStore } from './tags';
import { refreshData } from './refresh';

function defaultFilter(): ItemFilter {
  return { ...DEFAULT_ITEM_FILTER, tagIds: [] };
}

export const useItemsStore = defineStore('items', {
  state: () => ({
    items: [] as Item[],
    pendingIds: [] as string[],
    loading: false,
    loaded: false,
    filter: defaultFilter(),
  }),

  getters: {
    /** 列表可见条目（关键词 + 标签 + 类型 + 归档，v1 的筛选全在这里） */
    visible(state): Item[] {
      return filterItems(state.items, useTagsStore().tags, state.filter);
    },
    counts(state): ListCounts {
      return collectListCounts(state.items);
    },
    tagCounts(state): Record<string, number> {
      return collectTagCounts(state.items);
    },
    pendingSet(state): Set<string> {
      return new Set(state.pendingIds);
    },
    hasKeyword(state): boolean {
      return state.filter.keyword.trim().length > 0;
    },
    byId(state) {
      return (id: string): Item | null => state.items.find((item) => item.id === id) ?? null;
    },
  },

  actions: {
    async reload() {
      this.loading = true;
      try {
        const [items, pendingIds] = await Promise.all([
          collector.db.items.toArray(),
          collector.sync.pendingIds(),
        ]);
        this.items = items;
        this.pendingIds = [...pendingIds];
        this.loaded = true;
      } finally {
        this.loading = false;
      }
    },

    // ── 筛选 ──

    setKeyword(keyword: string) {
      this.filter = { ...this.filter, keyword };
    },

    setType(type: 'all' | ItemType) {
      this.filter = { ...this.filter, type };
    },

    setArchived(archived: boolean) {
      this.filter = { ...this.filter, archived };
    },

    toggleTag(tagId: string) {
      const tagIds = this.filter.tagIds.includes(tagId)
        ? this.filter.tagIds.filter((id) => id !== tagId)
        : [...this.filter.tagIds, tagId];
      this.filter = { ...this.filter, tagIds };
    },

    clearTags() {
      this.filter = { ...this.filter, tagIds: [] };
    },

    setSort(sortBy: SortField, sortDir: 'asc' | 'desc') {
      this.filter = { ...this.filter, sortBy, sortDir };
    },

    resetFilter() {
      this.filter = defaultFilter();
    },

    // ── 写入（全部走 core 的 repository，UI 不直接操作网络或 Dexie）──

    async createItem(draft: ItemDraft): Promise<Item> {
      const item = await collector.repo.createItem(draft);
      await refreshData();
      return item;
    },

    async updateItem(id: string, patch: Partial<ItemDraft>) {
      await collector.repo.updateItem(id, patch);
      await refreshData();
    },

    async removeItem(id: string) {
      await collector.repo.deleteItem(id);
      await refreshData();
    },

    async restoreItem(id: string) {
      await collector.repo.restoreItem(id);
      await refreshData();
    },

    async setArchivedItem(id: string, archived: boolean) {
      await collector.repo.setArchived(id, archived);
      await refreshData();
    },

    async addTagsToItems(itemIds: string[], tagIds: string[]) {
      await collector.repo.addTagsToItems(itemIds, tagIds);
      await refreshData();
    },

    async removeTagsFromItems(itemIds: string[], tagIds: string[]) {
      await collector.repo.removeTagsFromItems(itemIds, tagIds);
      await refreshData();
    },

    async purgeTombstones(days = 90) {
      const count = await collector.repo.purgeTombstones(days);
      await refreshData();
      return count;
    },

    async countTombstones() {
      return collector.repo.countTombstones();
    },
  },
});
