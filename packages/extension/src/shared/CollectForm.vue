<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  CircleAlert,
  CircleCheck,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  RefreshCw,
  Save,
  Settings,
  StickyNote,
  X,
} from '@lucide/vue';
import { isSafeUrl, normalizeUrl } from '@my-collector/core';
import { createGithub, isConfigured, loadConfig, localStore, type ExtensionConfig } from './config';
import { collect, findRecentDuplicate, type RecentEntry } from './collect';
import {
  PANEL_CONTEXT_MESSAGE,
  PANEL_REREAD_MESSAGE,
  readPanelContext,
  type PanelContext,
  type RereadReply,
} from './panelContext';
import { readActiveTab, titleFromUrl, type PageInfo } from './pageInfo';

/**
 * 收藏表单 —— popup 与 sidepanel 共用，见 docs/tec/06-多端入口设计.md §5.6。
 *
 * 两套外壳的差异只有三处：① 初始页面信息从哪来；② 底部按钮；③ 保存成功后是否自动关闭。
 * 表单本身（字段、草稿、查重、提交）只有这一份，避免两端行为漂移。
 */
const props = defineProps<{ mode: 'popup' | 'panel' }>();

type Status = 'idle' | 'saving' | 'saved' | 'error';

const DRAFT_KEY = 'collector:draft';

interface Draft {
  /** 草稿归属的页面 URL——面板会长时间开着，别页的草稿不能套到当前页上 */
  url: string;
  title: string;
  note: string;
  tags: string[];
}

const isPanel = computed(() => props.mode === 'panel');

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

/** 面板已打开时又被触发了一次、且表单已被编辑：先挂着，等用户点「应用到表单」 */
const pendingInfo = ref<PageInfo | null>(null);

/** 表单最近一次被页面信息/草稿填充后的基线，用来判断用户是否动过它 */
const baseline = ref({ title: '', note: '', tags: [] as string[] });
const touched = computed(
  () =>
    title.value !== baseline.value.title ||
    note.value !== baseline.value.note ||
    tags.value.join('\u0000') !== baseline.value.tags.join('\u0000'),
);

/** 面板被手动打开（Chrome 侧边栏菜单）且读不到标签页时的空状态 */
const noContext = computed(() => info.value === null);

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
const saveDisabled = computed(
  () => !canSubmit.value || status.value === 'saving' || status.value === 'saved',
);

function markBaseline(): void {
  baseline.value = { title: title.value, note: note.value, tags: [...tags.value] };
}

/** 把一份页面信息铺到表单上（标题、选区作为初始备注），并重置基线 */
async function applyInfo(next: PageInfo): Promise<void> {
  info.value = next;
  pendingInfo.value = null;
  title.value = next.title || titleFromUrl(next.url);
  note.value = next.selection || '';
  tags.value = [];
  markBaseline();

  duplicate.value = configured.value ? await findRecentDuplicate(next.url) : null;
  if (status.value === 'saved') status.value = 'idle';
}

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
  // 面板不关：改完设置可以直接回来继续收藏
  if (!isPanel.value) window.close();
}

/** 模板里不能直接访问 window，包一层 */
function closeWindow(): void {
  window.close();
}

async function applyPending(): Promise<void> {
  const next = pendingInfo.value;
  if (next) await applyInfo(next);
}

/**
 * 再次触发扩展（面板已打开）时的处理：表单没动过就直接换成新页面，
 * 动过就只挂一个提示条，绝不覆盖用户已经写下的内容。
 */
async function onNewContext(next: PageInfo): Promise<void> {
  if (noContext.value || !touched.value || next.url === info.value?.url) {
    await applyInfo(next);
    return;
  }
  pendingInfo.value = next;
  status.value = 'idle';
  message.value = '当前页已变化，可点「应用到表单」换成新页面。';
}

function onRuntimeMessage(payload: unknown): void {
  const data = payload as { type?: string; context?: PanelContext } | null;
  if (data?.type !== PANEL_CONTEXT_MESSAGE || !data.context) return;
  void onNewContext(data.context.info);
}

/** 重新读取当前标签页：只在 activeTab 授权仍有效时能拿到（见 06 文档 §5.6） */
async function reread(): Promise<void> {
  status.value = 'idle';
  message.value = '正在读取当前标签页…';

  let reply: RereadReply | undefined;
  try {
    reply = (await chrome.runtime.sendMessage({ type: PANEL_REREAD_MESSAGE })) as
      | RereadReply
      | undefined;
  } catch {
    // SW 可能正好被回收、或消息端口提前关闭——按"读不到"处理，不要抛给用户
    reply = undefined;
  }

  if (!reply?.ok || !reply.info) {
    status.value = 'error';
    message.value = reply?.message ?? '读取失败，请用右键菜单或 Alt+Shift+S 重新打开面板。';
    return;
  }
  await applyInfo(reply.info);
  message.value = '已读取当前页';
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

    if (isPanel.value) {
      // 侧边栏不会自动关闭：清空表单、保留来源行，等用户下一次收藏
      title.value = '';
      note.value = '';
      tags.value = [];
      markBaseline();
      return;
    }

    setTimeout(() => window.close(), 900);
    return;
  }

  status.value = 'error';
  message.value = result.message;
}

async function bootstrap(): Promise<void> {
  config.value = await loadConfig();
  configured.value = await isConfigured();

  // popup：现场读当前标签页；面板：优先后台捕获的上下文，读不到再退化为现场读
  const pageInfo = isPanel.value
    ? ((await readPanelContext())?.info ?? (await readActiveTab()))
    : await readActiveTab();

  if (pageInfo) await applyInfo(pageInfo);

  const draft = await localStore.get<Draft>(DRAFT_KEY);
  if (draft && pageInfo && draft.url === pageInfo.url) {
    if (draft.title) title.value = draft.title;
    if (draft.note) note.value = draft.note;
    if (draft.tags?.length) tags.value = draft.tags;
    message.value = '已恢复上次未保存的内容';
    status.value = 'idle';
    markBaseline();
  }

  if (!configured.value) {
    status.value = 'error';
    message.value = '还没有配置访问令牌，请先完成扩展设置。';
  }
}

let draftTimer: number | undefined;
watch(
  [title, note, tags],
  () => {
    // 保存成功后表单被清空：此时不要再把空内容写成草稿
    if (status.value === 'saved') {
      if (touched.value) {
        status.value = 'idle';
        message.value = '';
      } else {
        return;
      }
    }
    if (!info.value) return;

    const url = info.value.url;
    if (draftTimer !== undefined) window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      const draft: Draft = { url, title: title.value, note: note.value, tags: tags.value };
      void localStore.set(DRAFT_KEY, draft);
    }, 500);
  },
  { deep: true },
);

onMounted(() => {
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  void bootstrap();
});

onBeforeUnmount(() => {
  chrome.runtime.onMessage.removeListener(onRuntimeMessage);
});
</script>

<template>
  <div class="flex flex-col p-3" :class="isPanel ? 'min-h-dvh' : 'min-h-[420px]'">
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

    <!-- 面板没拿到页面信息（例如用户从 Chrome 侧边栏菜单手动打开） -->
    <div v-else-if="noContext" class="card p-3">
      <p class="flex items-start gap-1.5 text-[12px] leading-relaxed">
        <CircleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
        <span>
          还没拿到页面信息。请在要收藏的页面上用<b>右键菜单 →「收藏到满天星」</b>，
          或按 <b>Alt+Shift+S</b>，面板就会带着该页面的标题与摘要。
        </span>
      </p>
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

      <!-- 面板已打开期间又在别的页面触发了扩展 -->
      <div
        v-if="pendingInfo"
        class="mb-2 flex items-center gap-2 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-[11px] leading-relaxed"
      >
        <span class="min-w-0 flex-1 truncate">
          当前页已变为「{{ pendingInfo.title || pendingInfo.url }}」
        </span>
        <button
          class="shrink-0 rounded border border-current px-1.5 py-0.5 font-medium"
          @click="applyPending"
        >
          应用到表单
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
        <!-- popup 可以关；侧边栏没有 close API，改成"重新读取当前页" -->
        <button
          v-if="!isPanel"
          class="min-h-9 flex-1 rounded-lg border border-line text-[13px] text-muted hover:text-ink"
          @click="closeWindow"
        >
          取消
        </button>
        <button
          v-else
          class="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-line text-[13px] text-muted hover:text-ink"
          @click="reread"
        >
          <RefreshCw class="h-3.5 w-3.5" />重新读取当前页
        </button>
        <button
          class="min-h-9 flex-[2] rounded-lg bg-brand text-[13px] font-medium text-brand-fg disabled:opacity-50"
          :disabled="saveDisabled"
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
