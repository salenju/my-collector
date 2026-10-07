<script setup lang="ts">
/**
 * 图片灯箱（详情页用）。
 *
 * 只加载**当前这一张**的原图：未翻到的图片不产生任何请求（10 文档 §9.3、§2.2 的限流预算）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Download, LoaderCircle, X } from '@lucide/vue';
import { formatBytes, type ItemAsset } from '@my-collector/core';
import { collector } from '@/collector';

const props = defineProps<{
  assets: ItemAsset[];
  index: number;
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:index', value: number): void;
  (e: 'update:open', value: boolean): void;
}>();

const url = ref('');
const state = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle');

let owned: string | null = null;

const current = computed<ItemAsset | null>(() => props.assets[props.index] ?? null);

function release(): void {
  if (owned) {
    collector.assets.release(owned);
    owned = null;
  }
  url.value = '';
  state.value = 'idle';
}

async function load(): Promise<void> {
  const asset = current.value;
  if (!asset) {
    release();
    return;
  }
  release();
  state.value = 'loading';
  try {
    const resolved = await collector.assets.resolve(asset, 'original');
    // 加载期间用户可能已经翻页 → 丢弃过期结果，否则会把上一张的 URL 显示出来
    if (current.value?.id !== asset.id) {
      collector.assets.release(resolved);
      return;
    }
    owned = resolved;
    url.value = resolved;
    state.value = 'ready';
  } catch {
    state.value = 'failed';
  }
}

function step(delta: number): void {
  const total = props.assets.length;
  if (total === 0) return;
  emit('update:index', (props.index + delta + total) % total);
}

function close(): void {
  emit('update:open', false);
}

function download(): void {
  const asset = current.value;
  if (!url.value || !asset) return;
  const anchor = document.createElement('a');
  anchor.href = url.value;
  anchor.download = asset.name || 'image';
  anchor.click();
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
  } else if (event.key === 'ArrowLeft') {
    step(-1);
  } else if (event.key === 'ArrowRight') {
    step(1);
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  release();
});

watch(
  () => [props.open, props.index, props.assets.length] as const,
  ([open]) => {
    if (open) void load();
    else release();
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex flex-col bg-black/85 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      :aria-label="`图片查看：${current?.name ?? ''}`"
      @click.self="close"
    >
      <div class="flex items-center justify-between gap-3 text-white">
        <p class="min-w-0 truncate text-sm">
          {{ current?.name }}
          <span v-if="current" class="ml-2 text-xs opacity-70">
            {{ formatBytes(current.size) }} · {{ current.width }}×{{ current.height }} ·
            {{ index + 1 }} / {{ assets.length }}
          </span>
        </p>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/15"
            title="下载原图"
            :disabled="state !== 'ready'"
            @click="download"
          >
            <Download class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/15"
            title="关闭（Esc）"
            @click="close"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>

      <div class="relative flex min-h-0 flex-1 items-center justify-center" @click.self="close">
        <button
          v-if="assets.length > 1"
          type="button"
          class="absolute left-0 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
          title="上一张（←）"
          @click="step(-1)"
        >
          <ChevronLeft class="h-5 w-5" />
        </button>

        <LoaderCircle
          v-if="state === 'loading'"
          class="h-6 w-6 animate-spin text-white"
          aria-hidden="true"
        />
        <p v-else-if="state === 'failed'" class="px-6 text-center text-sm text-white/80">
          这张图片暂时无法加载，请检查网络后重试。
        </p>
        <img
          v-else-if="state === 'ready'"
          :src="url"
          :alt="current?.name ?? ''"
          class="max-h-full max-w-full object-contain"
        />

        <button
          v-if="assets.length > 1"
          type="button"
          class="absolute right-0 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
          title="下一张（→）"
          @click="step(1)"
        >
          <ChevronRight class="h-5 w-5" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
