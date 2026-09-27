<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  CircleAlert,
  CircleCheck,
  CloudOff,
  Download,
  TriangleAlert,
  WifiOff,
  X,
} from '@lucide/vue';
import { RouterLink } from 'vue-router';
import { useSyncStore } from '@/stores/sync';
import { useSettingsStore } from '@/stores/settings';
import { useAppStore } from '@/stores/app';
import { usePwa } from '@/composables/usePwa';

type Tone = 'brand' | 'ok' | 'warn' | 'danger' | 'muted';

interface Banner {
  key: string;
  tone: Tone;
  icon: unknown;
  text: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
  /** 显示右侧关闭按钮 */
  dismissible?: boolean;
}

const app = useAppStore();
const sync = useSyncStore();
const settings = useSettingsStore();
const pwa = usePwa();

const installDismissed = ref(false);

const TONES: Record<Tone, string> = {
  brand: 'border-brand/30 bg-brand/10 text-ink',
  ok: 'border-ok/30 bg-ok/10 text-ink',
  warn: 'border-warn/30 bg-warn/10 text-ink',
  danger: 'border-danger/30 bg-danger/10 text-ink',
  muted: 'border-line bg-elevated text-muted',
};

const banners = computed<Banner[]>(() => {
  const list: Banner[] = [];

  // ── PWA：新版本就绪（不自动刷新，由用户决定）──
  if (pwa.needRefresh.value) {
    list.push({
      key: 'pwa-update',
      tone: 'brand',
      icon: CircleAlert,
      text: '满天星有新版本可用。刷新即会更新，当前未保存的输入会丢失。',
      actionLabel: '立即更新',
      onAction: () => void pwa.applyUpdate(),
      dismissible: true,
    });
  }

  // ── PWA：已可离线使用 ──
  if (pwa.offlineReady.value) {
    list.push({
      key: 'pwa-offline-ready',
      tone: 'ok',
      icon: CircleCheck,
      text: '已缓存应用外壳，现在断网也能打开并记录。',
      dismissible: true,
    });
  }

  // ── PWA：可安装到主屏 ──
  if (pwa.canInstall.value && !installDismissed.value) {
    list.push({
      key: 'pwa-install',
      tone: 'brand',
      icon: Download,
      text: '把满天星安装到主屏幕，打开更快，手机上还能从分享菜单直接收藏。',
      actionLabel: '安装',
      onAction: () => void pwa.promptInstall(),
      dismissible: true,
    });
  }

  // ── 未配置令牌 ──
  if (!settings.hasToken) {
    list.push({
      key: 'no-token',
      tone: 'brand',
      icon: CloudOff,
      text: '尚未连接数据仓库，本地记录会保留在本设备，配置令牌后会自动同步。',
      actionLabel: '去设置',
      actionTo: '/settings',
    });
  }

  // ── 令牌到期 ──
  const daysLeft = settings.tokenDaysLeft;
  if (settings.hasToken && daysLeft !== null && daysLeft < 0) {
    list.push({
      key: 'token-expired',
      tone: 'danger',
      icon: CircleAlert,
      text: '访问令牌已过期，本地记录不受影响，更新令牌后会一次性推送。',
      actionLabel: '更新令牌',
      actionTo: '/settings',
    });
  } else if (settings.hasToken && daysLeft !== null && daysLeft <= 7) {
    list.push({
      key: 'token-soon',
      tone: 'warn',
      icon: TriangleAlert,
      text: `访问令牌将在 ${daysLeft} 天后过期，建议提前续期。`,
      actionLabel: '去设置',
      actionTo: '/settings',
    });
  }

  // ── 离线 ──
  if (!app.online) {
    list.push({
      key: 'offline',
      tone: 'muted',
      icon: WifiOff,
      text: '当前处于离线模式，记录会保存在本地并在网络恢复后自动同步。',
    });
  }

  // ── 只读（远端 schema 更高）──
  if (sync.readOnly) {
    list.push({
      key: 'read-only',
      tone: 'warn',
      icon: TriangleAlert,
      text: '远端数据由更新版本的应用写入，当前为只读模式以避免覆盖。',
    });
  }

  // ── 冲突待处理 ──
  if (sync.status === 'conflict') {
    list.push({
      key: 'conflict',
      tone: 'danger',
      icon: CircleAlert,
      text: sync.lastError?.message ?? '存在冲突需要人工处理，本地数据已完整保留。',
    });
  }

  return list;
});

function dismiss(key: string): void {
  switch (key) {
    case 'pwa-update':
      pwa.dismissUpdate();
      break;
    case 'pwa-offline-ready':
      pwa.dismissOfflineReady();
      break;
    case 'pwa-install':
      installDismissed.value = true;
      break;
    default:
      break;
  }
}
</script>

<template>
  <div v-if="banners.length > 0" class="space-y-1 px-3 py-2 sm:px-4">
    <div
      v-for="banner in banners"
      :key="banner.key"
      class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs leading-relaxed"
      :class="TONES[banner.tone]"
      role="status"
    >
      <component :is="banner.icon" class="h-3.5 w-3.5 shrink-0" />
      <span class="flex-1">{{ banner.text }}</span>

      <RouterLink
        v-if="banner.actionTo"
        :to="banner.actionTo"
        class="rounded border border-current px-2 py-0.5 text-xs font-medium hover:opacity-80"
      >
        {{ banner.actionLabel }}
      </RouterLink>
      <button
        v-else-if="banner.onAction"
        class="rounded border border-current px-2 py-0.5 text-xs font-medium hover:opacity-80"
        @click="banner.onAction()"
      >
        {{ banner.actionLabel }}
      </button>

      <button
        v-if="banner.dismissible"
        class="rounded p-0.5 hover:opacity-70"
        :aria-label="`关闭提示：${banner.key}`"
        @click="dismiss(banner.key)"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>
