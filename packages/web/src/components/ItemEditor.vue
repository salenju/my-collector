<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Link2,
  LoaderCircle,
  Sparkles,
  StickyNote,
} from '@lucide/vue';
import {
  findDuplicateByUrl,
  formatRelativeTime,
  isSafeUrl,
  normalizeUrl,
  type ItemDraft,
  type ItemSource,
  type ItemType,
} from '@my-collector/core';
import { collector } from '@/collector';
import { useItemsStore } from '@/stores/items';
import { useMetadata } from '@/composables/useMetadata';
import { useToast } from '@/composables/useToast';
import TagPicker from './TagPicker.vue';
import AppButton from './ui/AppButton.vue';
import AppInput from './ui/AppInput.vue';
import AppTextarea from './ui/AppTextarea.vue';

const props = withDefaults(
  defineProps<{
    mode?: 'create' | 'edit';
    initial?: Partial<ItemDraft> & { id?: string };
    submitLabel?: string;
    source?: ItemSource;
  }>(),
  {
    mode: 'create',
    initial: () => ({}),
    submitLabel: '保存',
    source: 'web',
  },
);

const emit = defineEmits<{
  (e: 'submit', draft: ItemDraft & { id?: string }): void;
  (e: 'cancel'): void;
}>();

const DRAFT_KEY = 'new-item';

const items = useItemsStore();
const toast = useToast();
const { lookup } = useMetadata();

const type = ref<ItemType>(props.initial.type ?? 'link');
const url = ref(props.initial.url ?? '');
const title = ref(props.initial.title ?? '');
const content = ref(props.initial.content ?? '');
const excerpt = ref(props.initial.excerpt ?? '');
const favicon = ref(props.initial.favicon ?? '');
const tagIds = ref<string[]>([...(props.initial.tagIds ?? [])]);

const touched = ref({ title: false, excerpt: false, content: false });
const fetchState = ref<'idle' | 'loading' | 'ok' | 'failed'>('idle');
const fetchMessage = ref('');
const draftAvailable = ref(false);

let fetchTimer: number | undefined;

const urlError = computed(() => {
  const raw = url.value.trim();
  if (!raw) return '';
  return isSafeUrl(normalizeUrl(raw)) ? '' : '只支持 http / https 链接';
});

const duplicate = computed(() => {
  const target = normalizeUrl(url.value);
  if (!isSafeUrl(target)) return null;
  const found = findDuplicateByUrl(items.items, target);
  if (!found) return null;
  if (props.initial.id && found.id === props.initial.id) return null;
  return found;
});

const canSubmit = computed(
  () =>
    !urlError.value &&
    (url.value.trim().length > 0 || title.value.trim().length > 0 || content.value.trim().length > 0),
);

const metaEnabled = computed(() => collector.settings.metadataSettings.enabled);

function scheduleFetch(delayMs = 400): void {
  if (fetchTimer !== undefined) window.clearTimeout(fetchTimer);
  fetchTimer = window.setTimeout(() => {
    fetchTimer = undefined;
    void runFetch();
  }, delayMs);
}

async function runFetch(): Promise<void> {
  const target = normalizeUrl(url.value);
  if (!isSafeUrl(target)) return;

  if (!metaEnabled.value) {
    fetchState.value = 'failed';
    fetchMessage.value = '自动抓取已关闭，请手动填写标题';
    return;
  }

  fetchState.value = 'loading';
  fetchMessage.value = '正在抓取网页信息…';
  try {
    const result = await lookup(target);
    if (!result.ok) {
      fetchState.value = 'failed';
      fetchMessage.value = result.message ?? '抓取失败，请手动填写';
      return;
    }
    const metadata = result.metadata;
    // 只填充用户尚未编辑过的字段，避免覆盖手写内容
    if (metadata.title && !touched.value.title) title.value = metadata.title;
    if (metadata.excerpt && !touched.value.excerpt) excerpt.value = metadata.excerpt;
    if (metadata.favicon) favicon.value = metadata.favicon;
    fetchState.value = 'ok';
    fetchMessage.value = result.cached ? '已从本地缓存补齐（24 小时内不重复请求）' : '已抓取网页标题';
  } catch (error) {
    fetchState.value = 'failed';
    fetchMessage.value = error instanceof Error ? error.message : '抓取失败';
  }
}

function onUrlInput(value: string): void {
  url.value = value;
  fetchState.value = 'idle';
  fetchMessage.value = '';
  scheduleFetch();
}

function useDuplicateInstead(): void {
  if (!duplicate.value) return;
  emit('cancel');
  void toast.info(`已收藏过：${duplicate.value.title || duplicate.value.url}`);
}

function submit(): void {
  if (!canSubmit.value) return;
  const normalized = url.value.trim() ? normalizeUrl(url.value) : '';
  const safeUrl = isSafeUrl(normalized) ? normalized : '';

  const draft: ItemDraft & { id?: string } = {
    type: safeUrl ? type.value : 'note',
    title: title.value.trim(),
    content: content.value,
    tagIds: [...tagIds.value],
    source: props.source,
  };
  if (props.initial.id) draft.id = props.initial.id;
  if (safeUrl) {
    draft.url = safeUrl;
    if (excerpt.value) draft.excerpt = excerpt.value;
    if (favicon.value) draft.favicon = favicon.value;
  }
  emit('submit', draft);
}

async function saveDraft(): Promise<void> {
  if (props.mode !== 'create') return;
  if (!url.value && !title.value && !content.value) return;
  await collector.repo.saveDraft(DRAFT_KEY, {
    type: type.value,
    url: url.value,
    title: title.value,
    content: content.value,
    excerpt: excerpt.value,
    tagIds: tagIds.value,
  });
}

async function restoreDraft(): Promise<void> {
  const draft = await collector.repo.loadDraft<{
    type: ItemType;
    url: string;
    title: string;
    content: string;
    excerpt: string;
    tagIds: string[];
  }>(DRAFT_KEY);
  if (!draft) return;
  type.value = draft.type ?? 'link';
  url.value = draft.url ?? '';
  title.value = draft.title ?? '';
  content.value = draft.content ?? '';
  excerpt.value = draft.excerpt ?? '';
  tagIds.value = draft.tagIds ?? [];
  draftAvailable.value = false;
  touched.value = { title: true, excerpt: true, content: true };
}

async function discardDraft(): Promise<void> {
  await collector.repo.clearDraft(DRAFT_KEY);
  draftAvailable.value = false;
}

onMounted(async () => {
  if (props.mode !== 'create') return;
  // 外部入口（书签工具/分享目标）已有预填，不打扰用户
  if (props.initial.url || props.initial.title || props.initial.content) {
    await collector.repo.clearDraft(DRAFT_KEY);
    return;
  }
  const draft = await collector.repo.loadDraft<{ title?: string; url?: string; content?: string }>(DRAFT_KEY);
  draftAvailable.value = Boolean(draft && (draft.title || draft.url || draft.content));
});

onBeforeUnmount(() => {
  if (fetchTimer !== undefined) window.clearTimeout(fetchTimer);
  void saveDraft();
});

defineExpose({ submit });
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <div
      v-if="draftAvailable"
      class="flex flex-wrap items-center justify-between gap-2 rounded-card border border-warn/40 bg-warn/10 p-3 text-xs"
    >
      <span>检测到上次未保存的草稿</span>
      <span class="flex gap-2">
        <AppButton size="sm" @click="restoreDraft">恢复</AppButton>
        <AppButton size="sm" variant="ghost" @click="discardDraft">丢弃</AppButton>
      </span>
    </div>

    <!-- 类型切换 -->
    <div class="inline-flex rounded-lg border border-line bg-surface p-0.5">
      <button
        type="button"
        class="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm transition"
        :class="type === 'link' ? 'bg-brand text-brand-fg' : 'text-muted hover:text-ink'"
        @click="type = 'link'"
      >
        <Link2 class="h-4 w-4" />
        链接
      </button>
      <button
        type="button"
        class="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm transition"
        :class="type === 'note' ? 'bg-brand text-brand-fg' : 'text-muted hover:text-ink'"
        @click="type = 'note'"
      >
        <StickyNote class="h-4 w-4" />
        笔记
      </button>
    </div>

    <!-- URL -->
    <div v-if="type === 'link'">
      <label class="label" for="item-url">网址</label>
      <div class="flex gap-2">
        <AppInput
          id="item-url"
          :model-value="url"
          inputmode="url"
          placeholder="https://example.com/article"
          @update:model-value="onUrlInput"
        />
        <!-- 固定最小宽度：抓取中会多出一个 spinner，避免按钮宽度抖动挤压输入框 -->
        <AppButton
          class="min-w-36 shrink-0 whitespace-nowrap"
          :disabled="!isSafeUrl(normalizeUrl(url)) || fetchState === 'loading'"
          @click="runFetch"
        >
          <Sparkles class="h-4 w-4" />
          抓取标题
        </AppButton>
      </div>

      <p v-if="urlError" class="mt-1.5 flex items-center gap-1 text-xs text-danger">
        <CircleAlert class="h-3.5 w-3.5" />{{ urlError }}
      </p>
      <p v-else-if="fetchState === 'loading'" class="mt-1.5 flex items-center gap-1 text-xs text-muted">
        <LoaderCircle class="h-3.5 w-3.5 animate-spin" />{{ fetchMessage }}
      </p>
      <p v-else-if="fetchState === 'ok'" class="mt-1.5 flex items-center gap-1 text-xs text-ok">
        <CircleCheck class="h-3.5 w-3.5" />{{ fetchMessage }}
      </p>
      <p v-else-if="fetchState === 'failed'" class="mt-1.5 text-xs text-warn">{{ fetchMessage }}</p>
      <p v-else class="mt-1.5 hint">
        粘贴网址后会自动获取标题；抓取失败也可以手动填写。
      </p>
    </div>

    <!-- 重复提示 -->
    <div
      v-if="duplicate"
      class="flex flex-wrap items-center justify-between gap-2 rounded-card border border-warn/40 bg-warn/10 p-3 text-xs"
    >
      <span>
        这个链接已经收藏过（{{ formatRelativeTime(duplicate.createdAt) }}）：{{ duplicate.title || duplicate.url }}
      </span>
      <AppButton size="sm" variant="ghost" @click="useDuplicateInstead">
        <ExternalLink class="h-3.5 w-3.5" />放弃新增
      </AppButton>
    </div>

    <!-- 标题 -->
    <div>
      <label class="label" for="item-title">标题</label>
      <AppInput
        id="item-title"
        v-model="title"
        placeholder="给这条收藏起个名字（笔记可以留空）"
        @update:model-value="touched.title = true"
      />
    </div>

    <!-- 正文 -->
    <div>
      <label class="label" for="item-content">
        {{ type === 'note' ? '内容' : '备注 / 收藏理由' }}
      </label>
      <AppTextarea
        id="item-content"
        v-model="content"
        :rows="type === 'note' ? 8 : 4"
        placeholder="写点什么…"
        @update:model-value="touched.content = true"
      />
    </div>

    <!-- 标签 -->
    <div>
      <span class="label">标签</span>
      <TagPicker v-model="tagIds" />
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
      <AppButton variant="ghost" @click="emit('cancel')">取消</AppButton>
      <AppButton type="submit" variant="primary" :disabled="!canSubmit">{{ submitLabel }}</AppButton>
    </div>
  </form>
</template>
