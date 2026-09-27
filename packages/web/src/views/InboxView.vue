<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Archive, Check, Plus, Trash, X } from '@lucide/vue';
import type { SortField } from '@my-collector/core';
import { useItemsStore } from '@/stores/items';
import { useToast } from '@/composables/useToast';
import ItemList from '@/components/ItemList.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';

const items = useItemsStore();
const router = useRouter();
const toast = useToast();

const selectedIds = ref<string[]>([]);
const selecting = ref(false);
const confirmDelete = ref(false);

const visible = computed(() => items.visible);

const summary = computed(() => {
  const parts: string[] = [];
  parts.push(`${visible.value.length} 条记录`);
  if (items.filter.keyword.trim()) parts.push(`关键词「${items.filter.keyword.trim()}」`);
  if (items.filter.tagIds.length > 0) parts.push(`${items.filter.tagIds.length} 个标签`);
  if (items.filter.archived) parts.push('归档视图');
  return parts.join(' · ');
});

const sortValue = computed({
  get: () => `${items.filter.sortBy ?? 'createdAt'}:${items.filter.sortDir ?? 'desc'}`,
  set: (value: string) => {
    const [field, dir] = value.split(':');
    items.setSort((field ?? 'createdAt') as SortField, dir === 'asc' ? 'asc' : 'desc');
  },
});

watch(visible, () => {
  // 列表变化后清理已经不可见的选中项
  const ids = new Set(visible.value.map((item) => item.id));
  selectedIds.value = selectedIds.value.filter((id) => ids.has(id));
});

function open(id: string): void {
  void router.push(`/item/${id}`);
}

function toggleSelect(id: string): void {
  selecting.value = true;
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((value) => value !== id)
    : [...selectedIds.value, id];
}

function clearSelection(): void {
  selectedIds.value = [];
  selecting.value = false;
}

async function bulkArchive(archived: boolean): Promise<void> {
  const ids = [...selectedIds.value];
  for (const id of ids) {
    await items.setArchivedItem(id, archived);
  }
  toast.success(`已${archived ? '归档' : '取消归档'} ${ids.length} 条记录`);
  clearSelection();
}

async function bulkDelete(): Promise<void> {
  const ids = [...selectedIds.value];
  for (const id of ids) {
    await items.removeItem(id);
  }
  confirmDelete.value = false;
  toast.success(`已删除 ${ids.length} 条记录（可在 GitHub 历史中找回）`);
  clearSelection();
}
</script>

<template>
  <div class="p-3 sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="text-base font-semibold">{{ items.filter.archived ? '已归档' : '我的收藏' }}</h1>
        <p class="mt-0.5 text-xs text-muted">{{ summary }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <label class="sr-only" for="sort">排序</label>
        <select id="sort" v-model="sortValue" class="field w-auto py-1.5 text-xs">
          <option value="createdAt:desc">最新创建</option>
          <option value="createdAt:asc">最早创建</option>
          <option value="updatedAt:desc">最近修改</option>
          <option value="title:asc">标题 A→Z</option>
        </select>

        <AppButton
          v-if="items.items.length > 0"
          size="sm"
          :variant="selecting ? 'primary' : 'secondary'"
          @click="selecting ? clearSelection() : (selecting = true)"
        >
          <Check class="h-4 w-4" />
          {{ selecting ? '退出多选' : '多选' }}
        </AppButton>

        <RouterLink to="/new">
          <AppButton size="sm" variant="primary">
            <Plus class="h-4 w-4" />新建
          </AppButton>
        </RouterLink>
      </div>
    </div>

    <!-- 批量操作条 -->
    <div
      v-if="selectedIds.length > 0"
      class="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-brand/40 bg-brand/5 p-2.5 text-sm"
    >
      <span class="text-xs">已选 {{ selectedIds.length }} 条</span>
      <AppButton size="sm" @click="bulkArchive(true)">
        <Archive class="h-4 w-4" />归档
      </AppButton>
      <AppButton size="sm" variant="danger" @click="confirmDelete = true">
        <Trash class="h-4 w-4" />删除
      </AppButton>
      <AppButton size="sm" variant="ghost" @click="clearSelection">
        <X class="h-4 w-4" />取消
      </AppButton>
    </div>

    <ItemList
      :items="visible"
      :keyword="items.filter.keyword"
      :selected-ids="selecting ? selectedIds : []"
      :pending-ids="items.pendingSet"
      :loading="items.loading && !items.loaded"
      @open="open"
      @toggle-select="toggleSelect"
    >
      <template #empty-actions>
        <RouterLink to="/new">
          <AppButton size="sm" variant="primary">新建一条记录</AppButton>
        </RouterLink>
        <RouterLink to="/settings">
          <AppButton size="sm">连接数据仓库</AppButton>
        </RouterLink>
      </template>
    </ItemList>

    <AppConfirmDialog
      v-model:open="confirmDelete"
      tone="danger"
      title="删除所选记录？"
      :description="`将把 ${selectedIds.length} 条记录标记为已删除。删除会同步到所有设备，内容仍可在 GitHub 提交历史中找到。`"
      confirm-text="删除"
      @confirm="bulkDelete"
    />
  </div>
</template>
