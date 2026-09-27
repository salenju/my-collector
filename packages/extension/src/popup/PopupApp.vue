<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  CircleAlert,
  CircleCheck,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  Save,
  Settings,
  StickyNote,
  X,
} from '@lucide/vue';
import { isSafeUrl, normalizeUrl } from '@my-collector/core';
import { createGithub, isConfigured, loadConfig, localStore, type ExtensionConfig } from '../shared/config';
import { collect, findRecentDuplicate, type RecentEntry } from '../shared/collect';
import { isQuickWindow, pageInfoFromParams } from '../shared/params';
import { readActiveTab, titleFromUrl, type PageInfo } from '../shared/pageInfo';

type Status = 'idle' | 'saving' | 'saved' | 'error';

const DRAFT_KEY = 'collector:draft';

const quick = isQuickWindow(location.search);
const info = ref<PageInfo | null>(null);
const config = ref<ExtensionConfig | null>(null);
const configured = ref(true);
const duplicate = ref<RecentEntry | null>(null);

const title = ref('');
const note = ref('');
const tagInput = ref('');
const tags = ref<string[]>([]);
const status = ref<Status>('idle');
const message = ref('');
const copied = ref(false);

const host = computed(() => {
  try {
    return info.value?.url ? new URL(info.value.url).host : '';
  } catch {
    return '';
  }
});

const excerpt = computed(() => info.value?.description ?? '');
const isLink = computed(() => Boolean(info.value?.url && isSafeUrl(normalizeUrl(info.value.url))));
const canSubmit = computed(
  () => isLink.value || title.value.trim().length > 0 || note.value.trim().length > 0,
);

function addTag(raw: string): void {
  const name = raw.trim().replace(/[,，]$/, '');
  if (!name || tags.value.includes(name)) {
    tagInput.value = '';
    return;
  }
  tags.value = [...tags.value, name];
  tagInput.value = '';
}

function removeTag(name: string): void {
  tags.value = tags.value.filter((tag) => tag !== name);
}

function onTagKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
    event.preventDefault();
    addTag(tagInput.value);
    return;
  }
  if (event.key === 'Backspace' && tagInput.value === '' && tags.value.length > 0) {
    removeTag(tags.value[tags.value.length - 1] as string);
  }
}

async function copyUrl(): Promise<void> {
  if (!info.value?.url) return;
  await navigator.clipboard.writeText(info.value.url);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1500);
}

async function openOptions(): Promise<void> {
  await chrome.runtime.openOptionsPage();
  if (quick) window.close();
}

/** 模板里不能直接访问 window，包一层 */
function closeWindow(): void {
  window.close();
}

async function save(): Promise<void> {
  if (!canSubmit.value || !config.value) return;
  status.value = 'saving';
  message.value = '正在提交到 GitHub…';

  const result = await collect(createGithub(config.value.repo), config.value.repo, {
    url: isLink.value ? info.value?.url : undefined,
    title: title.value,
    excerpt: excerpt.value,
    favicon: info.value?.favicon,
    content: note.value,
    tagNames: tags.value,
  });

  if (result.ok) {
    status.value = 'saved';
    message.value = result.message;
    await localStore.remove(DRAFT_KEY);
    if (quick) setTimeout(() => window.close(), 900);
    return;
  }

  status.value = 'error';
  message.value = result.message;
}

async function bootstrap(): Promise<void> {
  config.value = await loadConfig();
  configured.value = await isConfigured();

  // 快捷窗口的信息由 query 带入；工具栏弹窗则现场读取当前标签页
  const fromParams = pageInfoFromParams(location.search);
  const pageInfo = fromParams ?? (await readActiveTab());
  info.value = pageInfo;

  if (pageInfo) {
    if (pageInfo.selection) {
      note.value = pageInfo.selection;
    }
    const fallbackTitle = pageInfo.title || titleFromUrl(pageInfo.url);
    title.value = fallbackTitle;
    if (configured.value) duplicate.value = await findRecentDuplicate(pageInfo.url);
  }

  const draft = await localStore.get<{ title: string; note: string; tags: string[] }>(DRAFT_KEY);
  if (draft) {
    if (draft.title) title.value = draft.title;
    if (draft.note) note.value = draft.note;
    if (draft.tags?.length) tags.value = draft.tags;
    message.value = '已恢复上次未保存的内容';
    status.value = 'idle';
  }

  if (!configured.value) {
    status.value = 'error';
    message.value = '还没有配置访问令牌，请先完成扩展设置。';
  }

  if (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
  }
}

let draftTimer: number | undefined;
watch([title, note, tags], () => {
  if (status.value === 'saved') return;
  if (draftTimer !== undefined) window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    void localStore.set(DRAFT_KEY, { title: title.value, note: note.value, tags: tags.value });
  }, 500);
}, { deep: true });

onMounted(() => {
  void bootstrap();
});
</script>

<template>
  <div class="flex min-h-[420px] flex-col p-3">
    <!-- 顶栏 -->
    <header class="mb-2 flex items-center justify-between">
      <div class="flex items-center gap-1.5">
        <component :is="isLink ? Link2 : StickyNote" class="h-4 w-4 text-brand" />
        <span class="text-[13px] font-semibold">收藏到满天星</span>
      </div>
      <button class="rounded p-1 text-muted hover:text-ink" title="扩展设置" @click="openOptions">
        <Settings class="h-4 w-4" />
      </button>
    </header>

    <!-- 未配置 -->
    <div v-if="!configured" class="card p-3">
      <p class="flex items-start gap-1.5 text-[12px] leading-relaxed">
        <CircleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
        <span>
          扩展需要单独配置一次访问令牌（它读不到网页版保存在浏览器里的令牌）。
          令牌只存在本扩展的本地存储中，只会发往 api.github.com。
        </span>
      </p>
      <button
        class="mt-3 min-h-9 w-full rounded-lg bg-brand text-[13px] font-medium text-brand-fg"
        @click="openOptions"
      >
        去配置
      </button>
    </div>

    <template v-else>
      <!-- 来源 -->
      <div class="mb-2 flex items-center gap-2 text-[11px] text-muted">
        <span class="truncate">{{ host || '本地笔记' }}</span>
        <span class="flex-1" />
        <a
          v-if="isLink"
          :href="info?.url"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-1 hover:text-brand"
        >
          <ExternalLink class="h-3 w-3" />打开
        </a>
        <button v-if="isLink" class="flex items-center gap-1 hover:text-brand" @click="copyUrl">
          <Copy class="h-3 w-3" />{{ copied ? '已复制' : '复制' }}
        </button>
      </div>

      <!-- 重复提示 -->
      <div
        v-if="duplicate"
        class="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[11px] leading-relaxed"
      >
        这个链接 2 周内已经收藏过：{{ duplicate.title || duplicate.url }}
      </div>

      <!-- 表单 -->
      <label class="label" for="title">标题</label>
      <input id="title" v-model="title" class="field" type="text" placeholder="给这条收藏起个名字" />

      <p v-if="excerpt" class="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted">
        {{ excerpt }}
      </p>

      <div class="mt-2.5">
        <label class="label" for="note">备注 / 笔记</label>
        <textarea
          id="note"
          v-model="note"
          class="field resize-none leading-relaxed"
          rows="4"
          placeholder="写点什么…"
        />
      </div>

      <div class="mt-2.5">
        <span class="label">标签</span>
        <div class="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1.5">
          <span
            v-for="tag in tags"
            :key="tag"
            class="inline-flex items-center gap-1 rounded-full border border-line bg-elevated px-2 py-0.5 text-[11px]"
          >
            {{ tag }}
            <button class="text-muted hover:text-danger" @click="removeTag(tag)">
              <X class="h-3 w-3" />
            </button>
          </span>
          <input
            v-model="tagInput"
            class="min-w-[6rem] flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted"
            type="text"
            placeholder="回车添加标签"
            @keydown="onTagKeydown"
            @blur="addTag(tagInput)"
          />
        </div>
      </div>

      <!-- 状态 -->
      <p
        v-if="message"
        class="mt-2.5 flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-relaxed"
        :class="{
          'border-line bg-elevated text-muted': status === 'idle',
          'border-brand/40 bg-brand/10 text-ink': status === 'saving',
          'border-ok/40 bg-ok/10 text-ink': status === 'saved',
          'border-danger/40 bg-danger/10 text-ink': status === 'error',
        }"
      >
        <LoaderCircle v-if="status === 'saving'" class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
        <CircleCheck v-else-if="status === 'saved'" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
        <CircleAlert v-else-if="status === 'error'" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
        <span class="flex-1">{{ message }}</span>
      </p>

      <div class="flex-1" />

      <div class="mt-3 flex gap-2">
        <button
          v-if="!quick"
          class="min-h-9 flex-1 rounded-lg border border-line text-[13px] text-muted hover:text-ink"
          @click="closeWindow"
        >
          取消
        </button>
        <button
          class="min-h-9 flex-[2] rounded-lg bg-brand text-[13px] font-medium text-brand-fg disabled:opacity-50"
          :disabled="!canSubmit || status === 'saving' || status === 'saved'"
          @click="save"
        >
          <span class="inline-flex items-center justify-center gap-1.5">
            <LoaderCircle v-if="status === 'saving'" class="h-3.5 w-3.5 animate-spin" />
            <Save v-else class="h-3.5 w-3.5" />
            {{ status === 'saving' ? '保存中…' : '保存' }}
          </span>
        </button>
      </div>
    </template>
  </div>
</template>
