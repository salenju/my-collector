<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  CircleCheck,
  CircleAlert,
  Download,
  ExternalLink,
  Key,
  RefreshCw,
  Save,
  Scissors,
  TriangleAlert,
  Trash,
} from '@lucide/vue';
import {
  DEFAULT_METADATA_SETTINGS,
  type AuthPersist,
  type MetadataProvider,
  type MergePolicy,
} from '@my-collector/core';
import { APP_VERSION, collector } from '@/collector';
import { useSettingsStore, applyTheme } from '@/stores/settings';
import { useSyncStore } from '@/stores/sync';
import { useItemsStore } from '@/stores/items';
import { useToast } from '@/composables/useToast';
import { useMetadata } from '@/composables/useMetadata';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';

const settings = useSettingsStore();
const sync = useSyncStore();
const items = useItemsStore();
const toast = useToast();
const metadataService = useMetadata();

// ── 仓库配置 ──
const repoForm = ref({ ...settings.repo });
const repoDirty = computed(
  () =>
    repoForm.value.owner !== settings.repo.owner ||
    repoForm.value.repo !== settings.repo.repo ||
    repoForm.value.branch !== settings.repo.branch ||
    repoForm.value.dataDir !== settings.repo.dataDir,
);

async function saveRepo(): Promise<void> {
  try {
    await settings.updateRepo({ ...repoForm.value });
    toast.success('仓库配置已保存');
  } catch (error) {
    toast.fromError(error, '保存失败');
  }
}

async function testConnection(): Promise<void> {
  toast.info('正在测试连接…');
  try {
    const report = await settings.testConnection();
    report.ok ? toast.success(report.message) : toast.error(report.message);
    for (const warning of report.warnings) toast.warning(warning);
  } catch (error) {
    toast.fromError(error, '测试连接失败');
  }
}

const confirmInit = ref(false);

async function initializeRepo(): Promise<void> {
  confirmInit.value = false;
  toast.info('正在初始化数据仓库…');
  try {
    await settings.initializeRepo();
    toast.success('数据仓库初始化完成（一次提交创建了 4 个文件）');
    await sync.pullNow();
  } catch (error) {
    toast.fromError(error, '初始化失败');
  }
}

// ── 令牌 ──
const tokenInput = ref('');
const tokenPersist = ref<AuthPersist>(settings.persist);
const tokenExpiry = ref(settings.expiresAt ? settings.expiresAt.slice(0, 10) : '');
const showToken = ref(false);

async function saveToken(): Promise<void> {
  const token = tokenInput.value.trim();
  if (!token) {
    toast.warning('请先粘贴访问令牌');
    return;
  }
  try {
    const expiry = tokenExpiry.value ? `${tokenExpiry.value}T00:00:00.000Z` : null;
    await settings.saveToken(token, expiry, tokenPersist.value);
    tokenInput.value = '';
    toast.success('令牌已保存到本设备（未上传到任何服务器）');
    await sync.syncNow();
  } catch (error) {
    toast.fromError(error, '保存令牌失败');
  }
}

async function clearToken(): Promise<void> {
  await settings.clearToken();
  toast.info('已清除本机令牌');
}

const guideUrl = 'https://github.com/settings/personal-access-tokens/new';

// ── 元信息抓取 ──
const metadataEnabled = computed({
  get: () => settings.metadata.enabled,
  set: (value: boolean) => void settings.setMetadata({ enabled: value }),
});
const metadataProvider = computed({
  get: () => settings.metadata.provider,
  set: (value: MetadataProvider) => void settings.setMetadata({ provider: value }),
});
const customUrl = ref(settings.metadata.customUrl);

async function saveCustomUrl(): Promise<void> {
  await settings.setMetadata({ customUrl: customUrl.value.trim(), provider: 'custom', enabled: true });
  toast.success('已切换为自建代理');
}

async function clearMetadataCache(): Promise<void> {
  const count = await metadataService.clearCache();
  toast.success(`已清空 ${count} 条抓取缓存`);
}

// ── 同步策略 ──
async function setMergePolicy(policy: MergePolicy): Promise<void> {
  await settings.setMergePolicy(policy);
  toast.success(policy === 'delete-wins' ? '冲突时删除优先' : '冲突时编辑优先');
}

// ── 外观 ──
function onThemeChange(value: string): void {
  void settings.setUi({ theme: value as 'light' | 'dark' | 'system' }).then(() => applyTheme(settings.ui));
}

// ── 设备 ──
const deviceName = ref(settings.device.name);
async function saveDeviceName(): Promise<void> {
  await settings.setDeviceName(deviceName.value);
  toast.success('设备名已保存');
}

// ── 数据管理 ──
const tombstoneCount = ref(0);
const confirmWipe = ref(false);

async function refreshTombstones(): Promise<void> {
  tombstoneCount.value = await items.countTombstones();
}

async function exportJson(): Promise<void> {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    items: await collector.db.items.toArray(),
    tags: await collector.db.tags.toArray(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `my-collector-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast.success('已导出本地数据备份');
}

async function purgeTombstones(): Promise<void> {
  const count = await items.purgeTombstones(0);
  await refreshTombstones();
  toast.success(`已清理 ${count} 条墓碑记录（本条变更也会推送）`);
}

async function wipeLocal(): Promise<void> {
  confirmWipe.value = false;
  await settings.wipeLocalData();
  await items.reload();
  await sync.pullNow();
  toast.info('已清空本地数据，正在从远端重新拉取');
}

onMounted(() => {
  repoForm.value = { ...settings.repo };
  tokenExpiry.value = settings.expiresAt ? settings.expiresAt.slice(0, 10) : '';
  customUrl.value = settings.metadata.customUrl;
  deviceName.value = settings.device.name;
  void refreshTombstones();
});
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 p-3 sm:p-4">
    <div>
      <h1 class="text-base font-semibold">设置</h1>
      <p class="mt-0.5 text-xs text-muted">
        数据存在你自己的 GitHub 私有仓库里；本应用没有服务器，令牌只保存在本设备。
      </p>
    </div>

    <!-- 数据仓库 -->
    <section class="card p-4">
      <h2 class="text-sm font-semibold">数据仓库</h2>
      <p class="mt-1 hint">
        所有收藏保存在这个仓库的 JSON 文件里，每次写入都是一次 Git 提交。
        <b class="text-ink">仓库不需要你手动准备任何文件</b>——
        点下面的「初始化」即可创建 <span class="font-mono">data/</span> 目录结构；
        仓库可以是空的，也可以已经有一个（建仓时生成的）README。
      </p>

      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label" for="owner">仓库所有者</label>
          <AppInput id="owner" v-model="repoForm.owner" placeholder="salenju" />
        </div>
        <div>
          <label class="label" for="repo">仓库名</label>
          <AppInput id="repo" v-model="repoForm.repo" placeholder="my-collector-data" />
        </div>
        <div>
          <label class="label" for="branch">分支</label>
          <AppInput id="branch" v-model="repoForm.branch" placeholder="main" />
        </div>
        <div>
          <label class="label" for="dataDir">数据目录</label>
          <AppInput id="dataDir" v-model="repoForm.dataDir" placeholder="data" />
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <AppButton variant="primary" :disabled="!repoDirty" @click="saveRepo">
          <Save class="h-4 w-4" />保存配置
        </AppButton>
        <AppButton :loading="settings.testing" @click="testConnection">
          <RefreshCw class="h-4 w-4" />测试连接
        </AppButton>
        <a :href="`https://github.com/${settings.repo.owner}/${settings.repo.repo}`" target="_blank" rel="noopener noreferrer">
          <AppButton variant="ghost">
            <ExternalLink class="h-4 w-4" />打开仓库
          </AppButton>
        </a>
      </div>

      <div
        v-if="settings.connection"
        class="mt-3 rounded-lg border p-3 text-xs leading-relaxed"
        :class="settings.connection.ok ? 'border-ok/40 bg-ok/10' : 'border-danger/40 bg-danger/10'"
      >
        <p class="flex items-center gap-1.5">
          <CircleCheck v-if="settings.connection.ok" class="h-3.5 w-3.5 text-ok" />
          <CircleAlert v-else class="h-3.5 w-3.5 text-danger" />
          {{ settings.connection.message }}
        </p>
        <p v-if="settings.connection.repo" class="mt-1 text-muted">
          {{ settings.connection.repo.fullName }} ·
          {{ settings.connection.repo.isPrivate ? 'Private' : 'Public' }} ·
          默认分支 {{ settings.connection.repo.defaultBranch }}
        </p>
      </div>

      <div
        v-if="settings.connection?.ok && !settings.connection.initialized"
        class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs"
      >
        <span>仓库尚未初始化，需要先创建 data/meta.json 等文件。</span>
        <AppButton size="sm" variant="primary" @click="confirmInit = true">初始化数据仓库</AppButton>
      </div>
    </section>

    <!-- 访问令牌 -->
    <section class="card p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold">访问令牌</h2>
        <AppBadge :tone="settings.hasToken ? 'ok' : 'warn'">
          {{ settings.hasToken ? '已配置' : '未配置' }}
        </AppBadge>
      </div>

      <p v-if="settings.hasToken" class="mt-2 text-xs text-muted">
        当前令牌：<span class="font-mono">{{ settings.maskedToken }}</span>
        <template v-if="settings.tokenDaysLeft !== null">
          · 剩余 {{ settings.tokenDaysLeft }} 天
        </template>
      </p>

      <details class="mt-3 rounded-lg border border-line bg-page p-3">
        <summary class="cursor-pointer text-xs font-medium text-ink">
          如何生成 Fine-grained PAT（只需 Contents 读写权限）
        </summary>
        <ol class="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-muted">
          <li>
            打开
            <a :href="guideUrl" target="_blank" rel="noopener noreferrer" class="text-brand hover:underline">
              github.com/settings/personal-access-tokens/new
            </a>
          </li>
          <li>Token name 填 my-collector，Expiration 建议 90 days</li>
          <li>Repository access 选 Only select repositories，只勾选 {{ settings.repo.repo }}</li>
          <li>Permissions → Repository permissions → <b>Contents: Read and write</b>，其余保持 No access</li>
          <li>生成后复制，粘贴到下面的输入框</li>
        </ol>
      </details>

      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label class="label" for="token">令牌</label>
          <div class="flex gap-2">
            <AppInput
              id="token"
              v-model="tokenInput"
              :type="showToken ? 'text' : 'password'"
              placeholder="github_pat_..."
              autocomplete="off"
            />
            <AppButton @click="showToken = !showToken">{{ showToken ? '隐藏' : '显示' }}</AppButton>
          </div>
        </div>
        <div>
          <label class="label" for="expiry">令牌过期日期（用于提醒）</label>
          <AppInput id="expiry" v-model="tokenExpiry" type="date" />
        </div>
        <div>
          <span class="label">保存方式</span>
          <div class="flex flex-wrap gap-2">
            <label class="flex items-center gap-1.5 text-xs">
              <input v-model="tokenPersist" type="radio" value="local" />
              保存在本机（长期使用）
            </label>
            <label class="flex items-center gap-1.5 text-xs">
              <input v-model="tokenPersist" type="radio" value="session" />
              仅本次会话（公共电脑）
            </label>
          </div>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <AppButton variant="primary" :disabled="!tokenInput.trim()" @click="saveToken">
          <Key class="h-4 w-4" />保存令牌
        </AppButton>
        <AppButton v-if="settings.hasToken" variant="ghost" @click="clearToken">清除令牌</AppButton>
      </div>

      <p class="mt-2 hint">
        令牌以明文保存在浏览器的本地数据库中（IndexedDB），这是纯静态站点方案无法回避的取舍。
        它只会发往 api.github.com，本应用没有任何数据上报。
      </p>
    </section>

    <!-- 元信息抓取 -->
    <section class="card p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold">网页元信息抓取</h2>
        <label class="flex items-center gap-2 text-xs">
          <input v-model="metadataEnabled" type="checkbox" />
          启用自动抓取
        </label>
      </div>

      <p class="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-warn">
        <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          开启后，粘贴的网址会发送给第三方抓取服务以获取网页标题。若你介意，可关闭此开关，
          或填入自建代理地址。抓取请求不携带任何身份信息。
        </span>
      </p>

      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label" for="provider">抓取服务</label>
          <select id="provider" v-model="metadataProvider" class="field">
            <option value="jina">r.jina.ai（默认，公共）</option>
            <option value="allorigins">api.allorigins.win（公共备用）</option>
            <option value="custom">自建代理</option>
          </select>
        </div>
        <div>
          <label class="label" for="custom-url">自建代理地址（可选）</label>
          <div class="flex gap-2">
            <AppInput id="custom-url" v-model="customUrl" placeholder="https://your-worker.workers.dev/" />
            <AppButton :disabled="!customUrl.trim()" @click="saveCustomUrl">启用</AppButton>
          </div>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <AppButton size="sm" variant="ghost" @click="clearMetadataCache">清空抓取缓存</AppButton>
      </div>
    </section>

    <!-- 同步 -->
    <section class="card p-4">
      <h2 class="text-sm font-semibold">同步</h2>
      <dl class="mt-2 space-y-1 text-xs">
        <div class="flex justify-between gap-3">
          <dt class="text-muted">状态</dt>
          <dd>{{ sync.meta.label }} · {{ sync.meta.hint }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-muted">待推送</dt>
          <dd class="tabular-nums">{{ sync.pendingCount }} 条</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-muted">远端分片</dt>
          <dd class="tabular-nums">{{ sync.shardCount }} 个</dd>
        </div>
      </dl>

      <div class="mt-3 flex flex-wrap gap-2">
        <AppButton size="sm" variant="primary" :loading="sync.status === 'syncing'" @click="sync.syncNow()">
          <RefreshCw class="h-4 w-4" />立即同步
        </AppButton>
        <AppButton size="sm" :disabled="sync.status === 'syncing'" @click="sync.pullNow()">从远端拉取</AppButton>
        <AppButton
          size="sm"
          :disabled="sync.status === 'syncing' || sync.pendingCount === 0"
          @click="sync.pushNow()"
        >
          推送到远端
        </AppButton>
      </div>

      <div class="mt-4">
        <span class="label">多设备冲突策略</span>
        <div class="space-y-1.5">
          <label class="flex items-start gap-2 text-xs">
            <input
              type="radio"
              :checked="settings.mergePolicy === 'delete-wins'"
              @change="setMergePolicy('delete-wins')"
            />
            <span>
              删除优先（推荐）<br />
              <span class="text-muted">一台设备删除、另一台编辑同一条时，以删除为准；误删可在 Git 历史找回。</span>
            </span>
          </label>
          <label class="flex items-start gap-2 text-xs">
            <input
              type="radio"
              :checked="settings.mergePolicy === 'edit-wins'"
              :disabled="false"
              @change="setMergePolicy('edit-wins')"
            />
            <span>
              编辑优先<br />
              <span class="text-muted">以最后修改时间为准，删除可能被编辑覆盖回来。</span>
            </span>
          </label>
        </div>
        <p class="mt-2 hint">
          说明：两种策略的差别只在墓碑（删除）上——「删除优先」只要一侧是墓碑就按删除生效，
          不再比较时间戳；「编辑优先」不特判墓碑，纯按 updatedAt 裁决。
          其余情况（两侧都是正常记录）始终按 updatedAt 取较新的一方。
        </p>
      </div>

      <div v-if="sync.conflicts.length > 0" class="mt-4">
        <span class="label">最近自动解决的冲突（{{ sync.conflicts.length }}）</span>
        <ul class="max-h-48 space-y-1 overflow-auto rounded-lg border border-line p-2 text-xs">
          <li v-for="(conflict, index) in sync.conflicts" :key="index" class="flex gap-2">
            <AppBadge :tone="conflict.kept === 'local' ? 'brand' : 'neutral'">
              {{ conflict.kept === 'local' ? '保留本地' : '保留远端' }}
            </AppBadge>
            <span class="min-w-0 flex-1 truncate">{{ conflict.label || conflict.id }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- 外观 & 设备 -->
    <section class="card p-4">
      <h2 class="text-sm font-semibold">外观与设备</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label" for="theme">主题</label>
          <select id="theme" class="field" :value="settings.ui.theme" @change="onThemeChange(($event.target as HTMLSelectElement).value)">
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>
        <div>
          <label class="label" for="device">这台设备的名称</label>
          <div class="flex gap-2">
            <AppInput id="device" v-model="deviceName" />
            <AppButton @click="saveDeviceName">保存</AppButton>
          </div>
        </div>
      </div>
      <p class="mt-2 hint">设备名会写入远端 meta.json，用于在冲突追溯时辨认是哪台设备写入的。</p>
    </section>

    <!-- 数据管理 -->
    <section class="card p-4">
      <h2 class="text-sm font-semibold">数据管理</h2>
      <p class="mt-1 hint">
        本地共 {{ items.items.length }} 条记录（含 {{ tombstoneCount }} 条墓碑）。
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <AppButton size="sm" @click="exportJson">
          <Download class="h-4 w-4" />导出本地备份
        </AppButton>
        <AppButton size="sm" :disabled="tombstoneCount === 0" @click="purgeTombstones">
          <Scissors class="h-4 w-4" />清理墓碑
        </AppButton>
        <AppButton size="sm" variant="danger" @click="confirmWipe = true">
          <Trash class="h-4 w-4" />清空本地数据
        </AppButton>
      </div>
      <p class="mt-2 hint">
        「清理墓碑」会把已删除的记录从文件中物理移除，并在 Git 中留下一次提交（仍可找回）。
      </p>
    </section>

    <!-- 关于 -->
    <section class="card p-4 text-xs leading-relaxed text-muted">
      <h2 class="text-sm font-semibold text-ink">关于</h2>
      <p class="mt-2">
        满天星 v{{ APP_VERSION }} · 数据仓库
        <a
          :href="`https://github.com/${settings.repo.owner}/${settings.repo.repo}`"
          target="_blank"
          rel="noopener noreferrer"
          class="text-brand hover:underline"
        >{{ settings.repoSlug }}</a>
      </p>
      <p class="mt-1">
        默认元信息抓取服务：{{ DEFAULT_METADATA_SETTINGS.provider }}。技术方案见仓库 docs/tec 目录。
      </p>
    </section>

    <AppConfirmDialog
      v-model:open="confirmInit"
      title="初始化数据仓库？"
      description="将在仓库中创建 data/meta.json、data/tags.json、data/items/当前月.json，并写入一份 README.md 说明。整个过程是一次原子提交。仓库里已存在的文件（例如建仓时自动生成的 README）会被原样保留，不会被覆盖。"
      confirm-text="初始化"
      :loading="settings.initializing"
      @confirm="initializeRepo"
    />

    <AppConfirmDialog
      v-model:open="confirmWipe"
      tone="danger"
      title="清空本地数据？"
      description="这会删除本机缓存与未推送的本地改动（远端仓库不受影响）。如果本地还有待同步内容，请先导出备份。"
      confirm-text="清空"
      @confirm="wipeLocal"
    />
  </div>
</template>
