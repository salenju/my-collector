<script setup lang="ts">
import { computed } from 'vue';
import { CircleAlert, CloudOff, TriangleAlert, WifiOff } from '@lucide/vue';
import { RouterLink } from 'vue-router';
import { useSyncStore } from '@/stores/sync';
import { useSettingsStore } from '@/stores/settings';
import { useAppStore } from '@/stores/app';

type Tone = 'brand' | 'warn' | 'danger' | 'muted';

interface Banner {
  key: string;
  tone: Tone;
  icon: unknown;
  text: string;
  actionLabel?: string;
  actionTo?: string;
}

const app = useAppStore();
const sync = useSyncStore();
const settings = useSettingsStore();

const TONES: Record<Tone, string> = {
  brand: 'border-brand/30 bg-brand/10 text-ink',
  warn: 'border-warn/30 bg-warn/10 text-ink',
  danger: 'border-danger/30 bg-danger/10 text-ink',
  muted: 'border-line bg-elevated text-muted',
};

const banners = computed<Banner[]>(() => {
  const list: Banner[] = [];

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

  if (!app.online) {
    list.push({
      key: 'offline',
      tone: 'muted',
      icon: WifiOff,
      text: '当前处于离线模式，记录会保存在本地并在网络恢复后自动同步。',
    });
  }

  if (sync.readOnly) {
    list.push({
      key: 'read-only',
      tone: 'warn',
      icon: TriangleAlert,
      text: '远端数据由更新版本的应用写入，当前为只读模式以避免覆盖。',
    });
  }

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
    </div>
  </div>
</template>
