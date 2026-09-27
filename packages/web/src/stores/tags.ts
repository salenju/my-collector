import { defineStore } from 'pinia';
import { findUnusedTags, type Tag, type TagColor } from '@my-collector/core';
import { collector } from '@/collector';
import { useItemsStore } from './items';
import { refreshData } from './refresh';
import { useToast } from '@/composables/useToast';

export const useTagsStore = defineStore('tags', {
  state: () => ({
    tags: [] as Tag[],
    loading: false,
  }),

  getters: {
    /** 未删除的标签，按名称排序 */
    active(state): Tag[] {
      return state.tags
        .filter((tag) => tag.deletedAt === null)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    },
    byId(state) {
      return (id: string): Tag | null => state.tags.find((tag) => tag.id === id) ?? null;
    },
    unused(): Tag[] {
      return findUnusedTags(this.tags, useItemsStore().items);
    },
  },

  actions: {
    async reload() {
      this.loading = true;
      try {
        this.tags = await collector.db.tags.toArray();
      } finally {
        this.loading = false;
      }
    },

    /** 输入标签名即创建（重名自动复用），返回标签 id */
    async ensureByName(names: string[]): Promise<string[]> {
      const ids = await collector.repo.ensureTags(names);
      await refreshData();
      return ids;
    },

    async rename(id: string, name: string) {
      await collector.repo.updateTag(id, { name });
      await refreshData();
    },

    async setColor(id: string, color: TagColor) {
      await collector.repo.updateTag(id, { color });
      await refreshData();
    },

    async remove(id: string): Promise<number> {
      const affected = await collector.repo.deleteTag(id);
      // 被删除的标签要从当前筛选条件里摘掉
      const items = useItemsStore();
      items.filter = {
        ...items.filter,
        tagIds: items.filter.tagIds.filter((tagId) => tagId !== id),
      };
      await refreshData();
      return affected;
    },

    async merge(sourceId: string, targetId: string): Promise<number> {
      const affected = await collector.repo.mergeTag(sourceId, targetId);
      await refreshData();
      return affected;
    },

    async cleanupUnused(): Promise<number> {
      const unused = this.unused;
      const toast = useToast();
      let removed = 0;
      for (const tag of unused) {
        await collector.repo.deleteTag(tag.id);
        removed += 1;
      }
      await refreshData();
      toast.success(`已清理 ${removed} 个未使用的标签`);
      return removed;
    },
  },
});
