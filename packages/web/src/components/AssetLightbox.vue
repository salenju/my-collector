<script setup lang="ts">
/**
 * 图片灯箱（详情页用）。
 *
 * 只加载**当前这一张**的原图：未翻到的图片不产生任何请求（10 文档 §9.3、§2.2 的限流预算）。
 *
 * 缩放（长图必需）：
 *  - 打开时按图片比例选默认适应方式——长图「适应宽度」铺满，否则「适应窗口」压进一屏；
 *  - 工具栏 -/+、百分比（点击回到 1:1）、适应窗口、适应宽度；
 *  - 键盘 `+` / `-` / `0`（适应）/ `1`（1:1），`Ctrl|⌘ + 滚轮` 以指针为锚点缩放；
 *  - 触屏双指捏合缩放，单指照常滚动；
 *  - 放大后鼠标可拖拽平移（触屏用原生滚动），双击在「适应」与「1:1」间切换。
 *
 * 为什么不直接用 transform: scale —— 缩放必须影响**布局尺寸**，滚动条才会跟着变长，
 * 长图才有得滚。所以这里按 `原图尺寸 × 比例` 直接给 <img> 定宽高。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  Maximize2,
  MoveHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from '@lucide/vue';
import { formatBytes, type ItemAsset } from '@my-collector/core';
import { collector } from '@/collector';
import {
  clampZoom,
  defaultFitMode,
  fitZoom,
  scrollAfterZoom,
  zoomBy,
  zoomPercent,
  type FitMode,
  type Size,
} from '@/utils/zoom';

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

const viewportEl = ref<HTMLElement | null>(null);
/** 滚动视口的可用尺寸，缩放「适应」模式要用它算比例 */
const viewport = ref<Size>({ width: 0, height: 0 });
/** 原图像素尺寸：先用条目元信息占位，图片 load 后用真实值校准 */
const natural = ref<Size>({ width: 0, height: 0 });
const zoom = ref(1);
const fitMode = ref<FitMode>('contain');
const panning = ref(false);

let owned: string | null = null;
let observer: ResizeObserver | null = null;
/** 鼠标拖拽平移的起始状态（触屏走原生滚动，不参与） */
let pan: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;
/** 本次按下是否发生过拖动：拖动结束后浏览器仍会补一个 click，不能让它误触关闭 */
let panMoved = false;
/** 双指捏合的起始距离与比例 */
let pinch: { distance: number; zoom: number } | null = null;

const current = computed<ItemAsset | null>(() => props.assets[props.index] ?? null);
const percent = computed(() => zoomPercent(zoom.value));
const displaySize = computed<Size>(() => ({
  width: natural.value.width * zoom.value,
  height: natural.value.height * zoom.value,
}));
/** 内容是否超出视口（决定要不要显示抓手光标 / 允许拖拽） */
const overflowing = computed(
  () =>
    viewport.value.width > 0 &&
    (displaySize.value.width > viewport.value.width + 1 ||
      displaySize.value.height > viewport.value.height + 1),
);
const imgStyle = computed(() => {
  const { width, height } = displaySize.value;
  if (!(width >= 1) || !(height >= 1)) {
    // 元信息缺失且图片还没 load：先按容器宽度占位
    return { width: '100%', height: 'auto' };
  }
  return { width: `${Math.round(width)}px`, height: `${Math.round(height)}px` };
});

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

/* ---------- 缩放 ---------- */

function measure(): void {
  const el = viewportEl.value;
  if (!el) return;
  viewport.value = { width: el.clientWidth, height: el.clientHeight };
}

/** 当前是「适应」模式才跟着视口/图片变化重算；手动缩放过就别动它 */
function applyFit(): void {
  if (fitMode.value === 'custom') return;
  zoom.value = fitZoom(fitMode.value, natural.value, viewport.value);
}

/** 换图 / 打开时回到该图的默认视图 */
function resetView(): void {
  const asset = current.value;
  // 元信息可能缺失（旧数据），此时先按 0 处理，等 <img> load 后用真实尺寸校准
  natural.value = { width: asset?.width ?? 0, height: asset?.height ?? 0 };
  fitMode.value = defaultFitMode(natural.value);
  zoom.value = 1;
  void nextTick(() => {
    measure();
    applyFit();
  });
}

function setFit(mode: Exclude<FitMode, 'custom'>): void {
  fitMode.value = mode;
  measure();
  applyFit();
}

function viewportCenter(): { x: number; y: number } | undefined {
  const el = viewportEl.value;
  return el ? { x: el.clientWidth / 2, y: el.clientHeight / 2 } : undefined;
}

/**
 * 缩放到指定比例。给了 anchor（视口内坐标）就以它为锚点，
 * 缩放后补偿滚动位置，让指针下的那一点不动。
 */
function zoomTo(value: number, anchor?: { x: number; y: number }): void {
  if (state.value !== 'ready') return;
  const from = zoom.value;
  const to = clampZoom(value);
  if (Math.abs(to - from) < 1e-4) return;
  fitMode.value = 'custom';

  const el = viewportEl.value;
  if (!el || !anchor) {
    zoom.value = to;
    return;
  }
  const scrollLeft = el.scrollLeft;
  const scrollTop = el.scrollTop;
  zoom.value = to;
  // 图片尺寸在本帧渲染后才变 → 下一帧再校正滚动位置
  void nextTick(() => {
    el.scrollLeft = scrollAfterZoom({ pointer: anchor.x, scroll: scrollLeft, from, to });
    el.scrollTop = scrollAfterZoom({ pointer: anchor.y, scroll: scrollTop, from, to });
  });
}

function zoomStep(direction: 1 | -1): void {
  zoomTo(zoomBy(zoom.value, direction), viewportCenter());
}

/** 双击：在「适应」和 1:1 之间来回 */
function toggleZoom(): void {
  if (state.value !== 'ready') return;
  if (fitMode.value === 'custom') setFit(defaultFitMode(natural.value));
  else zoomTo(1, viewportCenter());
}

function onWheel(event: WheelEvent): void {
  // 普通滚轮留给滚动（长图必须能滚）；Ctrl / ⌘ + 滚轮（含触控板捏合）才是缩放
  if (!event.ctrlKey && !event.metaKey) return;
  const el = viewportEl.value;
  if (!el || state.value !== 'ready') return;
  event.preventDefault();
  const rect = el.getBoundingClientRect();
  const factor = Math.exp(-event.deltaY * 0.0015);
  zoomTo(zoom.value * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
}

function touchDistance(touches: TouchList): number {
  const a = touches[0];
  const b = touches[1];
  if (!a || !b) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function onTouchStart(event: TouchEvent): void {
  pinch =
    event.touches.length === 2
      ? { distance: touchDistance(event.touches), zoom: zoom.value }
      : null;
}

function onTouchMove(event: TouchEvent): void {
  if (!pinch || event.touches.length !== 2 || pinch.distance <= 0) return;
  if (state.value !== 'ready') return;
  event.preventDefault();
  fitMode.value = 'custom';
  zoom.value = clampZoom(pinch.zoom * (touchDistance(event.touches) / pinch.distance));
}

function onTouchEnd(event: TouchEvent): void {
  if (event.touches.length < 2) pinch = null;
}

/* ---------- 拖拽平移（鼠标） ---------- */

function onPointerDown(event: PointerEvent): void {
  panMoved = false;
  if (event.pointerType !== 'mouse' || event.button !== 0) return;
  const el = viewportEl.value;
  if (!el || !overflowing.value) return;
  pan = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: el.scrollLeft,
    top: el.scrollTop,
  };
  panning.value = true;
  el.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  const el = viewportEl.value;
  if (!pan || !el || event.pointerId !== pan.pointerId) return;
  const dx = event.clientX - pan.x;
  const dy = event.clientY - pan.y;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panMoved = true;
  el.scrollLeft = pan.left - dx;
  el.scrollTop = pan.top - dy;
}

function onPointerUp(event: PointerEvent): void {
  const el = viewportEl.value;
  if (el?.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  pan = null;
  panning.value = false;
}

/** 点空白处关闭；点图片 / 刚拖动完不关 */
function onViewportClick(event: MouseEvent): void {
  if (panMoved) {
    panMoved = false;
    return;
  }
  if ((event.target as HTMLElement | null)?.tagName === 'IMG') return;
  close();
}

/* ---------- 其它 ---------- */

function attachViewport(): void {
  const el = viewportEl.value;
  if (!el) return;
  // wheel / touchmove 要能 preventDefault，必须显式声明非 passive
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  el.addEventListener('touchend', onTouchEnd);
  el.addEventListener('touchcancel', onTouchEnd);
  if (typeof ResizeObserver !== 'undefined') {
    observer?.disconnect();
    observer = new ResizeObserver(() => {
      measure();
      applyFit();
    });
    observer.observe(el);
  }
}

function detachViewport(): void {
  const el = viewportEl.value;
  if (el) {
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchEnd);
  }
  observer?.disconnect();
  observer = null;
  pinch = null;
  pan = null;
  panning.value = false;
}

async function syncView(): Promise<void> {
  if (!props.open) {
    detachViewport();
    release();
    return;
  }
  resetView();
  void load();
  await nextTick();
  measure();
  attachViewport();
  applyFit();
}

function onImageLoad(event: Event): void {
  const el = event.target as HTMLImageElement | null;
  // 元信息里的宽高可能与实际解码结果有出入，以图片自身为准
  if (el && el.naturalWidth > 0 && el.naturalHeight > 0) {
    natural.value = { width: el.naturalWidth, height: el.naturalHeight };
  }
  measure();
  applyFit();
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
  } else if (event.key === '+' || event.key === '=') {
    zoomStep(1);
  } else if (event.key === '-' || event.key === '_') {
    zoomStep(-1);
  } else if (event.key === '0') {
    setFit(defaultFitMode(natural.value));
  } else if (event.key === '1') {
    zoomTo(1, viewportCenter());
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  detachViewport();
  release();
});

watch(() => [props.open, props.index, props.assets.length] as const, syncView, { immediate: true });
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
        <p class="min-w-0 flex-1 truncate text-sm">
          {{ current?.name }}
          <span v-if="current" class="ml-2 text-xs opacity-70">
            {{ formatBytes(current.size) }} · {{ current.width }}×{{ current.height }} ·
            {{ index + 1 }} / {{ assets.length }}
          </span>
        </p>
        <div class="flex shrink-0 items-center gap-1">
          <!-- 缩放：长图查看不便的解法 -->
          <div class="flex items-center gap-0.5 rounded-lg bg-white/10 p-0.5">
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-transparent sm:h-9 sm:w-9"
              title="缩小（-）"
              :disabled="state !== 'ready'"
              @click="zoomStep(-1)"
            >
              <ZoomOut class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="min-w-[2.75rem] rounded-md px-1 text-center text-xs tabular-nums hover:bg-white/20 disabled:hover:bg-transparent"
              title="当前比例，点击回到原始大小（1）"
              :disabled="state !== 'ready'"
              @click="zoomTo(1, viewportCenter())"
            >
              {{ percent }}%
            </button>
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-transparent sm:h-9 sm:w-9"
              title="放大（+）"
              :disabled="state !== 'ready'"
              @click="zoomStep(1)"
            >
              <ZoomIn class="h-4 w-4" />
            </button>
          </div>
          <!-- 两种适应方式：长图用「宽度」，普通图用「窗口」 -->
          <div class="flex items-center gap-0.5 rounded-lg bg-white/10 p-0.5">
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-40 sm:h-9 sm:w-9"
              :class="fitMode === 'contain' ? 'bg-white/25' : 'hover:bg-white/20'"
              title="把整张图压进窗口（0）"
              :disabled="state !== 'ready'"
              @click="setFit('contain')"
            >
              <Maximize2 class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-40 sm:h-9 sm:w-9"
              :class="fitMode === 'width' ? 'bg-white/25' : 'hover:bg-white/20'"
              title="宽度铺满、上下滚动（长图推荐）"
              :disabled="state !== 'ready'"
              @click="setFit('width')"
            >
              <MoveHorizontal class="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-transparent sm:h-9 sm:w-9"
            title="下载原图"
            :disabled="state !== 'ready'"
            @click="download"
          >
            <Download class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/15 sm:h-9 sm:w-9"
            title="关闭（Esc）"
            @click="close"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>

      <div class="relative mt-2 flex min-h-0 flex-1">
        <button
          v-if="assets.length > 1"
          type="button"
          class="absolute left-0 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
          title="上一张（←）"
          @click="step(-1)"
        >
          <ChevronLeft class="h-5 w-5" />
        </button>

        <!-- 滚动视口：缩放改变的是 <img> 的布局尺寸，所以放大后能直接滚 -->
        <div
          ref="viewportEl"
          class="flex min-h-0 flex-1 overflow-auto overscroll-contain"
          :class="panning ? 'cursor-grabbing' : overflowing ? 'cursor-grab' : ''"
          style="touch-action: pan-x pan-y"
          @click="onViewportClick"
          @dblclick="toggleZoom"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <div class="flex min-h-full w-max min-w-full items-center justify-center">
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
              :style="imgStyle"
              class="max-h-none max-w-none shrink-0 select-none"
              draggable="false"
              @load="onImageLoad"
              @dragstart.prevent
            />
          </div>
        </div>

        <button
          v-if="assets.length > 1"
          type="button"
          class="absolute right-0 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
          title="下一张（→）"
          @click="step(1)"
        >
          <ChevronRight class="h-5 w-5" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
