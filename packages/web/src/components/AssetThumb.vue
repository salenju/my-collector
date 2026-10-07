<script setup lang="ts">
/**
 * 单张附件图片的缩略图 —— 负责「解析 URL + 懒加载 + 释放引用」。
 *
 * 两个约束都来自 10 文档 §7.1：
 *  1. 图片要经 `collector.assets.resolve()` 拿 objectURL（私有仓库需要带鉴权取字节），
 *     因此必须成对调用 `release()`，否则内存里的 blob 永远不会回收；
 *  2. 列表必须**懒加载**——首次浏览一屏 30 张图就是 30 次 API 请求，
 *     这是限流预算能成立的前提。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ImageOff, LoaderCircle, X } from '@lucide/vue';
import type { ItemAsset } from '@my-collector/core';
import { collector } from '@/collector';

const props = withDefaults(
  defineProps<{
    asset: ItemAsset;
    variant?: 'thumb' | 'original';
    /** 是否显示右上角的移除按钮 */
    removable?: boolean;
    /** 本地有改动尚未同步 */
    pending?: boolean;
    /** 只在进入视口时加载（列表用；编辑器里的新图可关掉） */
    lazy?: boolean;
    rounded?: string;
  }>(),
  {
    variant: 'thumb',
    removable: false,
    pending: false,
    lazy: true,
    rounded: 'rounded-lg',
  },
);

const emit = defineEmits<{ (e: 'remove'): void; (e: 'open'): void }>();

const host = ref<HTMLElement | null>(null);
const url = ref('');
const state = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle');

/** 当前持有的 objectURL（必须与 release 成对） */
let owned: string | null = null;
let observer: IntersectionObserver | null = null;

/** 用元信息占位，避免图片加载完成后把列表"顶下去"（CLS） */
const ratio = computed(() => {
  const width = props.asset.width || 4;
  const height = props.asset.height || 3;
  return `${width} / ${height}`;
});

async function load(): Promise<void> {
  if (state.value === 'loading' || state.value === 'ready') return;
  state.value = 'loading';
  try {
    const resolved = await collector.assets.resolve(props.asset, props.variant);
    owned = resolved;
    url.value = resolved;
    state.value = 'ready';
  } catch {
    state.value = 'failed';
  }
}

function release(): void {
  if (owned) {
    collector.assets.release(owned);
    owned = null;
  }
  url.value = '';
  state.value = 'idle';
}

onMounted(() => {
  if (!props.lazy || typeof IntersectionObserver !== 'function' || !host.value) {
    void load();
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer?.disconnect();
        observer = null;
        void load();
      }
    },
    // 提前 200px 预取，滚动时几乎看不到占位
    { rootMargin: '200px' },
  );
  observer.observe(host.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  release();
});

// 条目里的图片可能被替换（换图/同步下来新版本）→ 重新解析
watch(
  () => [props.asset.id, props.variant],
  () => {
    release();
    void load();
  },
);
</script>

<template>
  <div
    ref="host"
    class="group/thumb relative overflow-hidden border border-line bg-page"
    :class="rounded"
    :style="{ aspectRatio: ratio }"
  >
    <img
      v-if="state === 'ready'"
      :src="url"
      :alt="asset.name"
      class="h-full w-full cursor-zoom-in object-cover"
      @click="emit('open')"
    />

    <div
      v-else-if="state === 'failed'"
      class="flex h-full w-full flex-col items-center justify-center gap-1 text-muted"
      :title="`图片暂时无法加载：${asset.name}`"
    >
      <ImageOff class="h-4 w-4" />
    </div>

    <div
      v-else
      class="flex h-full w-full items-center justify-center text-muted"
      aria-hidden="true"
    >
      <LoaderCircle v-if="state === 'loading'" class="h-4 w-4 animate-spin" />
    </div>

    <span
      v-if="pending"
      class="absolute bottom-1 left-1 h-2 w-2 rounded-full bg-warn"
      title="有本地改动尚未同步"
    />

    <button
      v-if="removable"
      type="button"
      class="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover/thumb:opacity-100"
      :title="`移除 ${asset.name}`"
      :aria-label="`移除 ${asset.name}`"
      @click.stop="emit('remove')"
    >
      <X class="h-3.5 w-3.5" />
    </button>
  </div>
</template>
