<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CircleAlert, CircleCheck, ExternalLink, Key, LoaderCircle, Save } from '@lucide/vue';
import type { ConnectionReport, RepoConfig } from '@my-collector/core';
import { DEFAULT_REPO_CONFIG } from '@my-collector/core';
import { auth, createGithub, defaultConfig, loadConfig, saveConfig, type ExtensionConfig } from '../shared/config';

interface Toast {
  tone: 'ok' | 'danger' | 'muted';
  text: string;
}

const repo = ref<RepoConfig>({ ...DEFAULT_REPO_CONFIG });
const deviceName = ref(defaultConfig().deviceName);
const tokenInput = ref('');
const maskedToken = ref<string | null>(null);
const tokenExpiry = ref('');

const testing = ref(false);
const saving = ref(false);
const report = ref<ConnectionReport | null>(null);
const toast = ref<Toast | null>(null);

const webAppUrl = computed(
  () => 'https://salenju.github.io/my-collector/',
);
const tokenGuideUrl = 'https://github.com/settings/tokens?type=beta';

function flash(tone: Toast['tone'], text: string): void {
  toast.value = { tone, text };
  setTimeout(() => {
    toast.value = null;
  }, 5000);
}

async function load(): Promise<void> {
  const config: ExtensionConfig = await loadConfig();
  repo.value = { ...config.repo };
  deviceName.value = config.deviceName;
  maskedToken.value = await auth.getMasked();
  tokenExpiry.value = (await auth.getExpiresAt())?.slice(0, 10) ?? '';

  if (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
  }
}

async function saveAll(): Promise<void> {
  saving.value = true;
  try {
    const token = tokenInput.value.trim();
    if (token) {
      const expiry = tokenExpiry.value ? `${tokenExpiry.value}T00:00:00.000Z` : null;
      await auth.save({ token, expiresAt: expiry, persist: 'local' });
      tokenInput.value = '';
      maskedToken.value = await auth.getMasked();
      flash('ok', '令牌已保存到本扩展的本地存储');
    }
    await saveConfig({ repo: { ...repo.value }, deviceName: deviceName.value });
    flash('ok', '设置已保存');
  } catch (error) {
    flash('danger', error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}

async function test(): Promise<void> {
  testing.value = true;
  report.value = null;
  try {
    report.value = await createGithub({ ...repo.value }).testConnection();
    report.value.ok ? flash('ok', report.value.message) : flash('danger', report.value.message);
  } catch (error) {
    flash('danger', error instanceof Error ? error.message : String(error));
  } finally {
    testing.value = false;
  }
}

async function clearToken(): Promise<void> {
  await auth.clear();
  maskedToken.value = null;
  flash('muted', '已清除本扩展保存的令牌');
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4 p-6">
    <div>
      <h1 class="text-base font-semibold">满天星 · 扩展设置</h1>
      <p class="hint mt-1">
        扩展与
        <a :href="webAppUrl" target="_blank" rel="noopener noreferrer" class="text-brand hover:underline">
          网页版
        </a>
        连接同一个数据仓库。<b class="text-ink">令牌需要在这里单独配置一次</b>——扩展读不到网页版浏览器里的令牌。
      </p>
    </div>

    <p
      v-if="toast"
      class="flex items-start gap-1.5 rounded-lg border px-3 py-2 text-[12px] leading-relaxed"
      :class="{
        'border-ok/40 bg-ok/10 text-ink': toast.tone === 'ok',
        'border-danger/40 bg-danger/10 text-ink': toast.tone === 'danger',
        'border-line bg-elevated text-muted': toast.tone === 'muted',
      }"
    >
      <CircleCheck v-if="toast.tone === 'ok'" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
      <CircleAlert v-else class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span class="flex-1">{{ toast.text }}</span>
    </p>

    <!-- 数据仓库 -->
    <section class="card p-4">
      <h2 class="text-[13px] font-semibold">数据仓库</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label" for="owner">仓库所有者</label>
          <input id="owner" v-model="repo.owner" class="field" type="text" />
        </div>
        <div>
          <label class="label" for="repo">仓库名</label>
          <input id="repo" v-model="repo.repo" class="field" type="text" />
        </div>
        <div>
          <label class="label" for="branch">分支</label>
          <input id="branch" v-model="repo.branch" class="field" type="text" />
        </div>
        <div>
          <label class="label" for="dataDir">数据目录</label>
          <input id="dataDir" v-model="repo.dataDir" class="field" type="text" />
        </div>
      </div>
    </section>

    <!-- 令牌 -->
    <section class="card p-4">
      <h2 class="text-[13px] font-semibold">访问令牌</h2>
      <p v-if="maskedToken" class="hint mt-1">
        当前令牌：<span class="font-mono">{{ maskedToken }}</span>
      </p>
      <p class="hint mt-1">
        需要 Fine-grained PAT，仓库仅勾选数据仓库，权限仅
        <b class="text-ink">Contents: Read and write</b>。
        <a :href="tokenGuideUrl" target="_blank" rel="noopener noreferrer" class="text-brand hover:underline">
          去生成 <ExternalLink class="inline h-3 w-3" />
        </a>
      </p>

      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label class="label" for="token">令牌</label>
          <input
            id="token"
            v-model="tokenInput"
            class="field font-mono"
            type="password"
            placeholder="github_pat_..."
            autocomplete="off"
          />
        </div>
        <div>
          <label class="label" for="expiry">过期日期（用于提醒）</label>
          <input id="expiry" v-model="tokenExpiry" class="field" type="date" />
        </div>
        <div>
          <span class="label">设备名</span>
          <input v-model="deviceName" class="field" type="text" />
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button
          class="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-brand-fg disabled:opacity-50"
          :disabled="saving"
          @click="saveAll"
        >
          <LoaderCircle v-if="saving" class="h-3.5 w-3.5 animate-spin" />
          <Save v-else class="h-3.5 w-3.5" />
          保存设置
        </button>
        <button
          class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] disabled:opacity-50"
          :disabled="testing"
          @click="test"
        >
          <LoaderCircle v-if="testing" class="h-3.5 w-3.5 animate-spin" />
          <Key v-else class="h-3.5 w-3.5" />
          测试连接
        </button>
        <button
          v-if="maskedToken"
          class="min-h-9 rounded-lg px-3 text-[13px] text-muted hover:text-danger"
          @click="clearToken"
        >
          清除令牌
        </button>
      </div>

      <p
        v-if="report"
        class="mt-3 rounded-lg border px-3 py-2 text-[12px] leading-relaxed"
        :class="report.ok ? 'border-ok/40 bg-ok/10' : 'border-danger/40 bg-danger/10'"
      >
        {{ report.message }}
        <template v-if="report.repo">
          <br />{{ report.repo.fullName }} · {{ report.repo.isPrivate ? 'Private' : 'Public' }}
        </template>
      </p>
    </section>

    <!-- 用法 -->
    <section class="card p-4 text-[12px] leading-relaxed text-muted">
      <h2 class="text-[13px] font-semibold text-ink">怎么用</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>点浏览器工具栏的满天星图标 → 收藏当前页面</li>
        <li>页面任意处右键 → 「收藏到满天星」</li>
        <li>快捷键 <kbd class="rounded border border-line px-1">Alt+Shift+S</kbd></li>
      </ul>
      <p class="mt-2">
        扩展只申请 <span class="font-mono">activeTab</span> 权限，即仅在你主动点击时才读取当前页面，
        不会读取其他标签页或浏览历史。
      </p>
      <p class="mt-1">
        数据仍保存在你自己的 GitHub 私有仓库里；扩展不接入任何统计或上报。
      </p>
    </section>
  </div>
</template>
