<script setup lang="ts">
import { computed } from 'vue';
import { X } from '@lucide/vue';
import type { Tag } from '@my-collector/core';
import { tagChipClass } from '@/utils/color';

const props = withDefaults(
  defineProps<{
    tag: Tag;
    active?: boolean;
    /** 显示删除叉号（用于编辑器内的已选标签） */
    removable?: boolean;
    count?: number | null;
    interactive?: boolean;
  }>(),
  { active: false, removable: false, count: null, interactive: true },
);

const emit = defineEmits<{
  (e: 'select'): void;
}>();

const classes = computed(() => [
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition',
  tagChipClass(props.tag.color),
  props.active ? 'ring-2 ring-brand/40' : '',
  props.interactive ? 'cursor-pointer hover:opacity-85' : 'cursor-default',
]);

function onActivate(): void {
  if (props.interactive) emit('select');
}
</script>

<template>
  <span
    :class="classes"
    :role="interactive ? 'button' : undefined"
    :tabindex="interactive ? 0 : undefined"
    @click="onActivate"
    @keydown.enter.prevent="onActivate"
    @keydown.space.prevent="onActivate"
  >
    <span class="max-w-[12rem] truncate">{{ tag.name }}</span>
    <span v-if="count !== null" class="opacity-60 tabular-nums">{{ count }}</span>
    <X v-if="removable" class="h-3 w-3 shrink-0 opacity-70" />
  </span>
</template>
