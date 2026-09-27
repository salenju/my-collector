<script setup lang="ts">
import { computed } from 'vue';
import { Link2, StickyNote } from '@lucide/vue';
import {
  firstLineOf,
  formatRelativeTime,
  highlightSegments,
  hostOf,
  splitKeywords,
  type Item,
  type Tag,
} from '@my-collector/core';
import { avatarClass } from '@/utils/color';
import TagChip from './TagChip.vue';

const props = withDefaults(
  defineProps<{
    item: Item;
    tags: Tag[];
    keyword?: string;
    pending?: boolean;
    active?: boolean;
    selected?: boolean;
  }>(),
  { keyword: '', pending: false, active: false, selected: false },
);

const emit = defineEmits<{
  (e: 'open'): void;
  (e: 'toggle-select'): void;
}>();

const displayTitle = computed(() => props.item.title || firstLineOf(props.item.content) || '（无标题）');
const isUntitled = computed(() => !props.item.title);
const segments = computed(() => highlightSegments(displayTitle.value, splitKeywords(props.keyword)));
const host = computed(() => hostOf(props.item.url));
const relative = computed(() => formatRelativeTime(props.item.updatedAt));
const visibleTags = computed(() => props.tags.slice(0, 3));
const extraTagCount = computed(() => Math.max(0, props.tags.length - visibleTags.value.length));
const avatarSeed = computed(() => host.value || props.item.id);
</script>

<template>
  <article
    class="group relative flex cursor-pointer gap-3 rounded-card border p-3 transition-colors"
    :class="[
      active ? 'border-brand/60 bg-brand/5' : 'border-line bg-surface hover:bg-elevated',
      selected ? 'ring-2 ring-brand/40' : '',
    ]"
    @click="emit('open')"
  >
    <!-- 类型 / 站点图标 -->
    <div class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md">
      <img
        v-if="item.type === 'link' && item.favicon"
        :src="item.favicon"
        alt=""
        referrerpolicy="no-referrer"
        class="h-5 w-5"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <div
        v-else
        class="flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold"
        :class="avatarClass(avatarSeed)"
      >
        <Link2 v-if="item.type === 'link'" class="h-4 w-4" />
        <StickyNote v-else class="h-4 w-4" />
      </div>
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex items-start gap-2">
        <h3
          class="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug"
          :class="isUntitled ? 'text-muted italic' : 'text-ink'"
        >
          <template v-for="(segment, index) in segments" :key="index">
            <mark
              v-if="segment.hit"
              class="rounded bg-warn/25 px-0.5 text-ink"
            >{{ segment.text }}</mark>
            <span v-else>{{ segment.text }}</span>
          </template>
        </h3>
        <span
          v-if="pending"
          class="mt-1 h-2 w-2 shrink-0 rounded-full bg-warn"
          title="有本地改动尚未同步"
        />
      </div>

      <p v-if="item.type === 'note' && item.content" class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
        {{ item.content }}
      </p>
      <p v-else-if="item.excerpt" class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
        {{ item.excerpt }}
      </p>

      <div class="mt-2 flex flex-wrap items-center gap-2">
        <span class="text-xs text-muted">
          <template v-if="host">{{ host }} · </template>{{ relative }}
        </span>
        <TagChip
          v-for="tag in visibleTags"
          :key="tag.id"
          :tag="tag"
          :interactive="false"
        />
        <span v-if="extraTagCount > 0" class="text-xs text-muted">+{{ extraTagCount }}</span>
      </div>
    </div>

    <button
      class="absolute right-2 top-2 hidden rounded p-1 text-muted hover:text-ink group-hover:block focus-visible:block"
      :title="selected ? '取消选择' : '选择'"
      @click.stop="emit('toggle-select')"
    >
      <span
        class="block h-4 w-4 rounded border"
        :class="selected ? 'border-brand bg-brand' : 'border-line bg-surface'"
      />
    </button>
  </article>
</template>
