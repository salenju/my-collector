<script setup lang="ts">
import { computed, ref } from 'vue';
import { Merge, Pencil, Scissors, Tag as TagIcon, Trash } from '@lucide/vue';
import { TAG_COLORS, type Tag, type TagColor } from '@my-collector/core';
import { useTagsStore } from '@/stores/tags';
import { useItemsStore } from '@/stores/items';
import { tagSolidClass } from '@/utils/color';
import { useToast } from '@/composables/useToast';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import TagChip from '@/components/TagChip.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import EmptyState from '@/components/EmptyState.vue';

const tags = useTagsStore();
const items = useItemsStore();
const toast = useToast();

const editingId = ref<string | null>(null);
const editingName = ref('');
const paletteFor = ref<string | null>(null);
const mergingId = ref<string | null>(null);
const mergeTargetId = ref('');
const pendingDelete = ref<Tag | null>(null);

const rows = computed(() =>
  [...tags.active]
    .map((tag) => ({ tag, count: items.tagCounts[tag.id] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name, 'zh-Hans-CN')),
);

const mergeTargets = computed(() =>
  tags.active.filter((tag) => tag.id !== mergingId.value),
);

function startRename(tag: Tag): void {
  editingId.value = tag.id;
  editingName.value = tag.name;
}

async function commitRename(): Promise<void> {
  const id = editingId.value;
  const name = editingName.value.trim();
  editingId.value = null;
  if (!id || !name) return;
  const duplicate = tags.active.find((tag) => tag.id !== id && tag.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    toast.warning('已存在同名标签，请改用「合并」功能。');
    return;
  }
  try {
    await tags.rename(id, name);
    toast.success('标签已重命名');
  } catch (error) {
    toast.fromError(error, '重命名失败');
  }
}

async function setColor(tag: Tag, color: TagColor): Promise<void> {
  paletteFor.value = null;
  await tags.setColor(tag.id, color);
}

async function confirmRemove(): Promise<void> {
  const tag = pendingDelete.value;
  pendingDelete.value = null;
  if (!tag) return;
  try {
    const affected = await tags.remove(tag.id);
    toast.success(`已删除标签「${tag.name}」，同时从 ${affected} 条记录中移除`);
  } catch (error) {
    toast.fromError(error, '删除标签失败');
  }
}

async function commitMerge(): Promise<void> {
  const sourceId = mergingId.value;
  const targetId = mergeTargetId.value;
  mergingId.value = null;
  mergeTargetId.value = '';
  if (!sourceId || !targetId) return;
  try {
    const affected = await tags.merge(sourceId, targetId);
    toast.success(`已合并 ${affected} 条记录`);
  } catch (error) {
    toast.fromError(error, '合并失败');
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl p-3 sm:p-4">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="text-base font-semibold">标签管理</h1>
        <p class="mt-0.5 text-xs text-muted">
          共 {{ rows.length }} 个标签。重命名只改标签本身，条目引用的是 ID，不会产生额外写入。
        </p>
      </div>
      <AppButton
        size="sm"
        :disabled="tags.unused.length === 0"
        @click="tags.cleanupUnused()"
      >
        <Scissors class="h-4 w-4" />
        清理未使用（{{ tags.unused.length }}）
      </AppButton>
    </div>

    <div v-if="rows.length === 0" class="card">
      <EmptyState
        :icon="TagIcon"
        title="还没有标签"
        description="新建或编辑记录时，在「标签」输入框里输入名字并回车即可创建。"
      />
    </div>

    <ul v-else class="card divide-y divide-line">
      <li v-for="{ tag, count } in rows" :key="tag.id" class="p-3">
        <div class="flex flex-wrap items-center gap-2">
          <button
            class="h-6 w-6 shrink-0 rounded-full border border-line"
            :class="tagSolidClass(tag.color)"
            :title="'修改颜色'"
            @click="paletteFor = paletteFor === tag.id ? null : tag.id"
          />

          <template v-if="editingId === tag.id">
            <AppInput v-model="editingName" class="max-w-xs" @enter="commitRename" />
            <AppButton size="sm" variant="primary" @click="commitRename">保存</AppButton>
            <AppButton size="sm" variant="ghost" @click="editingId = null">取消</AppButton>
          </template>

          <template v-else>
            <TagChip :tag="tag" :interactive="false" />
            <span class="text-xs text-muted tabular-nums">{{ count }} 条</span>
            <span class="flex-1" />
            <AppButton size="sm" variant="ghost" @click="startRename(tag)">
              <Pencil class="h-3.5 w-3.5" />重命名
            </AppButton>
            <AppButton
              size="sm"
              variant="ghost"
              @click="mergingId = mergingId === tag.id ? null : tag.id"
            >
              <Merge class="h-3.5 w-3.5" />合并
            </AppButton>
            <AppButton size="sm" variant="ghost" @click="pendingDelete = tag">
              <Trash class="h-3.5 w-3.5" />删除
            </AppButton>
          </template>
        </div>

        <!-- 调色板 -->
        <div v-if="paletteFor === tag.id" class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="color in TAG_COLORS"
            :key="color"
            class="h-6 w-6 rounded-full border border-line transition hover:scale-110"
            :class="tagSolidClass(color)"
            :title="color"
            @click="setColor(tag, color)"
          />
        </div>

        <!-- 合并目标 -->
        <div v-if="mergingId === tag.id" class="mt-2 flex flex-wrap items-center gap-2">
          <span class="text-xs text-muted">把「{{ tag.name }}」合并到：</span>
          <select v-model="mergeTargetId" class="field w-auto py-1.5 text-xs">
            <option value="">选择目标标签…</option>
            <option v-for="target in mergeTargets" :key="target.id" :value="target.id">
              {{ target.name }}
            </option>
          </select>
          <AppButton size="sm" variant="primary" :disabled="!mergeTargetId" @click="commitMerge">
            确认合并
          </AppButton>
          <AppButton size="sm" variant="ghost" @click="mergingId = null">取消</AppButton>
        </div>
      </li>
    </ul>

    <AppConfirmDialog
      :open="pendingDelete !== null"
      tone="danger"
      title="删除标签？"
      :description="`「${pendingDelete?.name ?? ''}」会从所有记录中移除。记录本身不会被删除。`"
      confirm-text="删除标签"
      @update:open="(value: boolean) => !value && (pendingDelete = null)"
      @confirm="confirmRemove"
    />
  </div>
</template>
