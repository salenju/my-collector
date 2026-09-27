<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Archive,
  ArrowLeft,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Pencil,
  RotateCcw,
  Trash,
} from '@lucide/vue';
import {
  fileHistoryUrl,
  formatRelativeTime,
  hostOf,
  isSafeUrl,
  type ItemDraft,
} from '@my-collector/core';
import { useItemsStore } from '@/stores/items';
import { useTagsStore } from '@/stores/tags';
import { useSyncStore } from '@/stores/sync';
import { useSettingsStore } from '@/stores/settings';
import { copyText } from '@/utils/clipboard';
import { useToast } from '@/composables/useToast';
import ItemEditor from '@/components/ItemEditor.vue';
import ItemList from '@/components/ItemList.vue';
import TagPicker from '@/components/TagPicker.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import EmptyState from '@/components/EmptyState.vue';

const props = defineProps<{ id: string }>();

const router = useRouter();
const items = useItemsStore();
const tags = useTagsStore();
const sync = useSyncStore();
const settings = useSettingsStore();
const toast = useToast();

const editing = ref(false);
const confirmDelete = ref(false);
const tagDraft = ref<string[]>([]);
let tagSaveTimer: number | undefined;

const item = computed(() => items.byId(props.id));
const itemTags = computed(() =>
  (item.value?.tagIds ?? [])
    .map((id) => tags.byId(id))
    .filter((tag): tag is NonNullable<typeof tag> => tag !== null),
);
const pending = computed(() => items.pendingSet.has(props.id));
const host = computed(() => hostOf(item.value?.url));
const linkSafe = computed(() => isSafeUrl(item.value?.url));

watch(
  item,
  (value) => {
    tagDraft.value = [...(value?.tagIds ?? [])];
  },
  { immediate: true },
);

/** 标签即时保存（打标签是最高频操作，不做「进入编辑态」的前置步骤） */
function onTagsChange(value: string[]): void {
  tagDraft.value = value;
  if (tagSaveTimer !== undefined) window.clearTimeout(tagSaveTimer);
  tagSaveTimer = window.setTimeout(async () => {
    tagSaveTimer = undefined;
    try {
      await items.updateItem(props.id, { tagIds: value });
    } catch (error) {
      toast.fromError(error, '标签保存失败');
    }
  }, 400);
}

async function save(draft: ItemDraft): Promise<void> {
  try {
    await items.updateItem(props.id, draft);
    editing.value = false;
    toast.success('已保存，正在同步…');
  } catch (error) {
    toast.fromError(error, '保存失败');
  }
}

async function toggleArchive(): Promise<void> {
  if (!item.value) return;
  await items.setArchivedItem(props.id, !item.value.archived);
  toast.success(item.value.archived ? '已取消归档' : '已归档');
  if (item.value.archived) void router.push('/');
}

async function remove(): Promise<void> {
  await items.removeItem(props.id);
  confirmDelete.value = false;
  toast.success('已删除（内容仍可在 GitHub 历史中找回）');
  void router.push('/');
}

async function restore(): Promise<void> {
  await items.restoreItem(props.id);
  toast.success('已恢复');
}

async function copyLink(): Promise<void> {
  if (!item.value?.url) return;
  const ok = await copyText(item.value.url);
  ok ? toast.success('链接已复制') : toast.error('复制失败，请手动选择复制');
}

function historyUrl(): string {
  const month = item.value?.createdAt.slice(0, 7) ?? '';
  return fileHistoryUrl(settings.repo, `${settings.repo.dataDir}/items/${month}.json`);
}
</script>

<template>
  <div class="p-3 sm:p-4">
    <div v-if="!item" class="card">
      <EmptyState title="找不到这条记录" description="它可能已被删除，或尚未从远端同步下来。">
        <AppButton size="sm" @click="router.push('/')">返回列表</AppButton>
        <AppButton size="sm" variant="ghost" @click="sync.pullNow()">重新拉取</AppButton>
      </EmptyState>
    </div>

    <div v-else class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
      <!-- 桌面端保留列表，便于连续浏览 -->
      <div class="hidden min-w-0 lg:block">
        <ItemList
          :items="items.visible"
          :keyword="items.filter.keyword"
          :active-id="props.id"
          :pending-ids="items.pendingSet"
          @open="(id) => router.push(`/item/${id}`)"
        />
      </div>

      <aside class="min-w-0">
        <div class="mb-2 flex items-center justify-between gap-2 lg:hidden">
          <AppButton size="sm" variant="ghost" @click="router.back()">
            <ArrowLeft class="h-4 w-4" />返回
          </AppButton>
          <AppBadge v-if="pending" tone="warn">待同步</AppBadge>
        </div>

        <div class="card p-4">
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <AppBadge :tone="item.archived ? 'neutral' : 'brand'">
              {{ item.type === 'link' ? '链接' : '笔记' }}
            </AppBadge>
            <AppBadge v-if="item.archived">已归档</AppBadge>
            <span v-if="pending" class="flex items-center gap-1 text-xs text-warn">
              <Clock class="h-3.5 w-3.5" />本地有改动待推送
            </span>
            <span class="flex-1" />
            <AppButton v-if="!editing" size="sm" variant="ghost" @click="editing = true">
              <Pencil class="h-4 w-4" />编辑
            </AppButton>
          </div>

          <!-- 只读视图 -->
          <template v-if="!editing">
            <h1 class="text-base font-semibold leading-snug">
              {{ item.title || (item.content ? item.content.split('\n')[0] : '（无标题）') }}
            </h1>

            <a
              v-if="linkSafe"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-brand hover:underline"
            >
              <Globe class="h-3.5 w-3.5 shrink-0" />
              <span class="truncate">{{ host }}</span>
              <ExternalLink class="h-3.5 w-3.5 shrink-0" />
            </a>

            <p v-if="item.excerpt" class="mt-3 text-xs leading-relaxed text-muted">
              {{ item.excerpt }}
            </p>

            <p
              v-if="item.content"
              class="mt-3 whitespace-pre-wrap break-words rounded-lg border border-line bg-page p-3 text-sm leading-relaxed"
            >
              {{ item.content }}
            </p>

            <div class="mt-4">
              <span class="label">标签</span>
              <TagPicker :model-value="tagDraft" @update:model-value="onTagsChange" />
              <p v-if="itemTags.length === 0" class="hint">还没有标签，输入名字回车即可创建。</p>
            </div>

            <dl class="mt-4 space-y-1.5 text-xs">
              <div class="flex justify-between gap-3">
                <dt class="text-muted">创建时间</dt>
                <dd>{{ formatRelativeTime(item.createdAt) }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted">修改时间</dt>
                <dd>{{ formatRelativeTime(item.updatedAt) }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted">来源</dt>
                <dd>{{ item.source }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted">所属分片</dt>
                <dd class="font-mono">{{ item.createdAt.slice(0, 7) }}.json</dd>
              </div>
            </dl>

            <div class="mt-4 flex flex-wrap gap-2">
              <AppButton v-if="linkSafe" size="sm" @click="copyLink">
                <Copy class="h-4 w-4" />复制链接
              </AppButton>
              <AppButton size="sm" @click="toggleArchive">
                <component :is="item.archived ? RotateCcw : Archive" class="h-4 w-4" />
                {{ item.archived ? '取消归档' : '归档' }}
              </AppButton>
              <a :href="historyUrl()" target="_blank" rel="noopener noreferrer">
                <AppButton size="sm" variant="ghost">
                  <ExternalLink class="h-4 w-4" />Git 历史
                </AppButton>
              </a>
              <AppButton
                v-if="item.deletedAt"
                size="sm"
                variant="ghost"
                @click="restore"
              >
                <RotateCcw class="h-4 w-4" />恢复
              </AppButton>
              <AppButton size="sm" variant="danger" @click="confirmDelete = true">
                <Trash class="h-4 w-4" />删除
              </AppButton>
            </div>
          </template>

          <!-- 编辑视图 -->
          <ItemEditor
            v-else
            mode="edit"
            :initial="item"
            submit-label="保存修改"
            @submit="save"
            @cancel="editing = false"
          />
        </div>
      </aside>
    </div>

    <AppConfirmDialog
      v-model:open="confirmDelete"
      tone="danger"
      title="删除这条记录？"
      description="删除会同步到所有设备。内容仍保留在 GitHub 的提交历史里，需要时可以手动找回。"
      confirm-text="删除"
      @confirm="remove"
    />
  </div>
</template>
