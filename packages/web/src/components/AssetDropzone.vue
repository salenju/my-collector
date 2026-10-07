<script setup lang="ts">
/**
 * 附件图片的编辑区 —— PRD-1007 的两条硬要求（拖动/点击上传、删除）+ 粘贴上传（C6）。
 *
 * 见 docs/tec/10-图片功能设计.md §9.1 / §9.1.1。
 * 上传动作只调用 `collector.assets.stage()`（压缩 + 内容寻址 + 落待上传表），
 * 真正的推送由同步引擎在提交时统一处理，因此这里不碰网络。
 */
import { computed, ref } from 'vue';
import { ImagePlus, LoaderCircle } from '@lucide/vue';
import {
  ASSET_LIMITS,
  formatBytes,
  type ItemAsset,
} from '@my-collector/core';
import { collector } from '@/collector';
import { useToast } from '@/composables/useToast';
import { imagesFromClipboard, imagesFromDataTransfer, shouldTakeOverPaste, type PastedImage } from '@/utils/paste';
import AssetThumb from './AssetThumb.vue';

const props = withDefaults(
  defineProps<{
    modelValue: ItemAsset[];
    /** 远端 schema 更高（只读模式）时整块禁用 */
    readonly?: boolean;
  }>(),
  { readonly: false },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: ItemAsset[]): void }>();

const toast = useToast();

const fileInput = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const dragging = ref(false);
let dragDepth = 0;

const count = computed(() => props.modelValue.length);
const totalBytes = computed(() => props.modelValue.reduce((sum, asset) => sum + asset.size, 0));
const full = computed(() => count.value >= ASSET_LIMITS.maxPerItem);

function pickFiles(): void {
  if (props.readonly || full.value) return;
  fileInput.value?.click();
}

async function addImages(candidates: PastedImage[]): Promise<void> {
  if (props.readonly || candidates.length === 0) return;

  const remaining = ASSET_LIMITS.maxPerItem - count.value;
  if (remaining <= 0) {
    toast.warning(`每条记录最多 ${ASSET_LIMITS.maxPerItem} 张图片`);
    return;
  }
  if (candidates.length > remaining) {
    toast.warning(
      `每条记录最多 ${ASSET_LIMITS.maxPerItem} 张图片，已忽略多余的 ${candidates.length - remaining} 张`,
    );
  }

  busy.value = true;
  const next = [...props.modelValue];
  try {
    for (const candidate of candidates.slice(0, remaining)) {
      try {
        const asset = await collector.assets.stage({
          file: candidate.blob,
          name: candidate.name,
          // 剪贴板来源通常没有文件名，交给 stage 合成「粘贴-…」
          fromClipboard: candidate.name === undefined,
        });
        // 同一张图重复添加：内容寻址下 id 相同，直接复用（不重复占位）
        if (!next.some((entry) => entry.id === asset.id)) next.push(asset);
      } catch (error) {
        toast.fromError(error, '添加图片失败');
      }
    }
    emit('update:modelValue', next);
  } finally {
    busy.value = false;
  }
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []).map((file) => ({
    blob: file,
    name: file.name || undefined,
  }));
  input.value = ''; // 允许连续选择同一个文件
  void addImages(files);
}

function removeAsset(id: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((asset) => asset.id !== id),
  );
}

function hasFiles(data: DataTransfer | null): boolean {
  return Boolean(data?.types?.includes('Files'));
}

function onDragEnter(event: DragEvent): void {
  if (props.readonly || !hasFiles(event.dataTransfer)) return;
  dragDepth += 1;
  dragging.value = true;
}

function onDragOver(event: DragEvent): void {
  // 必须 preventDefault 才允许 drop；只在确实拖的是文件时才拦
  if (!dragging.value || props.readonly) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragging.value = false;
}

function onDrop(event: DragEvent): void {
  dragDepth = 0;
  dragging.value = false;
  if (props.readonly) return;
  event.preventDefault();
  const images = imagesFromDataTransfer(event.dataTransfer);
  if (images.length === 0) {
    toast.warning('只能添加图片文件');
    return;
  }
  void addImages(images);
}

/**
 * 供编辑器容器转发 `paste` 事件（见 ItemEditor.vue）。
 * **拦截规则在 shouldTakeOverPaste 里**：目标是输入控件时一律放行，
 * 否则用户在「正文」里粘贴文字会失效。
 */
function handlePaste(event: ClipboardEvent): void {
  if (props.readonly) return;
  if (!shouldTakeOverPaste({ target: event.target, clipboardData: event.clipboardData })) return;
  event.preventDefault();
  void addImages(imagesFromClipboard(event.clipboardData));
}

defineExpose({ handlePaste });
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="label mb-0">图片</span>
      <span class="text-xs text-muted">
        <template v-if="count > 0">
          {{ count }} / {{ ASSET_LIMITS.maxPerItem }} 张 · 合计 {{ formatBytes(totalBytes) }}
        </template>
      </span>
    </div>

    <div
      class="mt-1.5 rounded-card border border-dashed p-2 transition-colors"
      :class="[
        dragging ? 'border-brand bg-brand/5' : 'border-line',
        readonly ? 'opacity-60' : '',
      ]"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div v-if="count > 0" class="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <AssetThumb
          v-for="asset in modelValue"
          :key="asset.id"
          :asset="asset"
          :removable="!readonly"
          :lazy="false"
          @remove="removeAsset(asset.id)"
        />
      </div>

      <button
        v-if="!readonly && !full"
        type="button"
        class="mt-2 flex w-full min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line bg-page px-3 py-3 text-xs text-muted transition-colors hover:border-brand hover:text-ink focus-visible:border-brand"
        :disabled="busy"
        @click="pickFiles"
      >
        <LoaderCircle v-if="busy" class="h-5 w-5 animate-spin" />
        <ImagePlus v-else class="h-5 w-5" />
        <span>{{ busy ? '正在压缩…' : count > 0 ? '继续添加' : '拖动图片到此处、点击选择，或直接粘贴截图' }}</span>
        <span class="text-[11px] text-muted">
          单张 ≤ {{ Math.round(ASSET_LIMITS.maxSourceBytes / 1024 / 1024) }}MB，会自动压缩并生成缩略图
        </span>
      </button>

      <p v-else-if="readonly" class="hint">只读模式下不能修改图片。</p>
      <p v-else class="hint">已达上限（{{ ASSET_LIMITS.maxPerItem }} 张）。</p>
    </div>

    <p v-if="count > 0" class="mt-1.5 hint">
      「移除」只是解除引用，图片本体仍保留在数据仓库里（Git 历史可找回）。
    </p>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="onFileChange"
    />
  </div>
</template>
