<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ItemDraft, ItemSource } from '@my-collector/core';
import { useItemsStore } from '@/stores/items';
import { useTagsStore } from '@/stores/tags';
import { useToast } from '@/composables/useToast';
import ItemEditor from '@/components/ItemEditor.vue';

const route = useRoute();
const router = useRouter();
const items = useItemsStore();
const tags = useTagsStore();
const toast = useToast();

const VALID_SOURCES: ItemSource[] = ['web', 'bookmarklet', 'extension', 'share', 'import'];

function queryString(key: string): string {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
}

/** 支持 /new?url=&title=&excerpt=&content=&tags=a,b&source=share 的预填 */
const initial = computed(() => {
  const source = VALID_SOURCES.includes(queryString('source') as ItemSource)
    ? (queryString('source') as ItemSource)
    : 'web';

  // 默认按「链接」进入（显示网址输入框）；只有显式 ?type=note 或保存时无有效网址才落为笔记
  const draft: Partial<ItemDraft> = {
    source,
    url: queryString('url'),
    title: queryString('title').slice(0, 500),
    content: queryString('content'),
    excerpt: queryString('excerpt').slice(0, 500),
    type: queryString('type') === 'note' ? 'note' : 'link',
  };
  return draft;
});

const presetTagNames = computed(() =>
  queryString('tags')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0),
);

async function resolvePresetTags(): Promise<string[]> {
  if (presetTagNames.value.length === 0) return [];
  return tags.ensureByName(presetTagNames.value);
}

const editorKey = computed(() => `new-${route.fullPath}`);

async function onSubmit(draft: ItemDraft): Promise<void> {
  try {
    const preset = await resolvePresetTags();
    const tagIds = Array.from(new Set([...(draft.tagIds ?? []), ...preset]));
    const created = await items.createItem({ ...draft, tagIds });
    toast.success('已保存，正在同步到 GitHub…');
    void router.replace(`/item/${created.id}`);
  } catch (error) {
    toast.fromError(error, '保存失败');
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl p-3 sm:p-4">
    <div class="mb-4">
      <h1 class="text-base font-semibold">新建记录</h1>
      <p class="mt-0.5 text-xs text-muted">
        保存后立即写入本地，随后自动推送到 GitHub；断网也不会丢。
      </p>
    </div>

    <div class="card p-4">
      <ItemEditor
        :key="editorKey"
        mode="create"
        :initial="initial"
        :source="initial.source"
        submit-label="保存"
        @submit="onSubmit"
        @cancel="router.back()"
      />
    </div>
  </div>
</template>
