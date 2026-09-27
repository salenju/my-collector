<script setup lang="ts">
import { computed } from 'vue';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CloudOff,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  WifiOff,
} from '@lucide/vue';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { formatRelativeTime } from '@my-collector/core';
import { useSyncStore, type Tone } from '@/stores/sync';
import { useSettingsStore } from '@/stores/settings';
import AppButton from './ui/AppButton.vue';

const sync = useSyncStore();
const settings = useSettingsStore();

const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-ok border-ok/30 bg-ok/10',
  warn: 'text-warn border-warn/30 bg-warn/10',
  danger: 'text-danger border-danger/30 bg-danger/10',
  muted: 'text-muted border-line bg-elevated',
  brand: 'text-brand border-brand/30 bg-brand/10',
};

const lastSyncLabel = computed(() =>
  sync.lastSyncAt ? formatRelativeTime(sync.lastSyncAt) : '尚未同步',
);

const icon = computed(() => {
  switch (sync.status) {
    case 'syncing':
      return LoaderCircle;
    case 'synced':
      return CircleCheck;
    case 'offline':
      return WifiOff;
    case 'unconfigured':
      return CloudOff;
    case 'auth-error':
    case 'error':
    case 'conflict':
      return CircleAlert;
    case 'backoff':
      return TriangleAlert;
    default:
      return CircleDashed;
  }
});

const busy = computed(() => sync.status === 'syncing');
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger
      class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition hover:opacity-90"
      :class="TONE_CLASS[sync.meta.tone]"
    >
      <component :is="icon" class="h-3.5 w-3.5" :class="busy ? 'animate-spin' : ''" />
      <span>{{ sync.meta.label }}</span>
      <span v-if="sync.pendingCount > 0" class="tabular-nums opacity-80">
        ({{ sync.pendingCount }})
      </span>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="end"
        :side-offset="8"
        class="z-50 w-[min(92vw,22rem)] rounded-card border border-line bg-elevated p-3 shadow-xl"
      >
        <p class="text-sm font-medium text-ink">{{ sync.meta.label }}</p>
        <p class="mt-1 text-xs leading-relaxed text-muted">{{ sync.meta.hint }}</p>

        <dl class="mt-3 space-y-1 text-xs">
          <div class="flex justify-between gap-3">
            <dt class="text-muted">最近同步</dt>
            <dd class="text-ink">{{ lastSyncLabel }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">待推送</dt>
            <dd class="text-ink tabular-nums">{{ sync.pendingCount }} 条</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">远端分片</dt>
            <dd class="text-ink tabular-nums">{{ sync.shardCount }} 个</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">数据仓库</dt>
            <dd class="truncate text-ink">{{ settings.repoSlug }}@{{ settings.repo.branch }}</dd>
          </div>
        </dl>

        <p
          v-if="sync.lastError"
          class="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs leading-relaxed text-ink"
        >
          {{ sync.lastError.message }}
        </p>

        <ul v-if="sync.warnings.length > 0" class="mt-3 space-y-1">
          <li
            v-for="warning in sync.warnings"
            :key="warning"
            class="rounded-lg border border-warn/30 bg-warn/10 p-2 text-xs leading-relaxed text-ink"
          >
            {{ warning }}
          </li>
        </ul>

        <div class="mt-3 flex flex-wrap gap-2">
          <AppButton size="sm" variant="primary" :loading="busy" @click="sync.syncNow()">
            <RefreshCw class="h-3.5 w-3.5" />
            立即同步
          </AppButton>
          <AppButton size="sm" variant="ghost" :disabled="busy" @click="sync.pullNow()">
            仅拉取
          </AppButton>
          <AppButton
            v-if="sync.pendingCount > 0"
            size="sm"
            variant="ghost"
            :disabled="busy"
            @click="sync.pushNow()"
          >
            仅推送
          </AppButton>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
