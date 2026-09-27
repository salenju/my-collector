<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { Plus } from '@lucide/vue';
import { useTagsStore } from '@/stores/tags';
import TagChip from './TagChip.vue';

const props = defineProps<{
  modelValue: string[];
  placeholder?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void;
}>();

const tags = useTagsStore();
const query = ref('');
const focused = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

const selectedTags = computed(() =>
  props.modelValue
    .map((id) => tags.byId(id))
    .filter((tag): tag is NonNullable<typeof tag> => tag !== null),
);

const suggestions = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  const selected = new Set(props.modelValue);
  return tags.active
    .filter((tag) => !selected.has(tag.id))
    .filter((tag) => (keyword ? tag.name.toLowerCase().includes(keyword) : true))
    .slice(0, 8);
});

const canCreate = computed(() => {
  const keyword = query.value.trim();
  if (!keyword) return false;
  const lowered = keyword.toLowerCase();
  return !tags.active.some((tag) => tag.name.toLowerCase() === lowered);
});

function add(tagId: string): void {
  if (!props.modelValue.includes(tagId)) {
    emit('update:modelValue', [...props.modelValue, tagId]);
  }
  query.value = '';
}

function remove(tagId: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((id) => id !== tagId),
  );
}

async function createFromQuery(): Promise<void> {
  const name = query.value.trim();
  if (!name) return;
  const [id] = await tags.ensureByName([name]);
  if (id) {
    add(id);
    await nextTick();
    inputRef.value?.focus();
  }
}
</script>

<template>
  <div>
    <div class="mb-2 flex flex-wrap gap-1.5" v-if="selectedTags.length > 0">
      <TagChip
        v-for="tag in selectedTags"
        :key="tag.id"
        :tag="tag"
        removable
        @select="remove(tag.id)"
      />
    </div>

    <div class="relative">
      <div class="flex items-center gap-2">
        <input
          ref="inputRef"
          v-model="query"
          class="field"
          type="text"
          :placeholder="placeholder ?? '输入标签名，回车创建'"
          autocomplete="off"
          spellcheck="false"
          @focus="focused = true"
          @blur="focused = false"
          @keydown.enter.prevent="canCreate ? createFromQuery() : add(suggestions[0]?.id ?? '')"
        />
      </div>

      <div
        v-if="focused && (suggestions.length > 0 || canCreate)"
        class="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-elevated p-1 shadow-lg"
      >
        <button
          v-if="canCreate"
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface"
          @mousedown.prevent="createFromQuery"
        >
          <Plus class="h-3.5 w-3.5 text-brand" />
          <span>创建标签「{{ query.trim() }}」</span>
        </button>
        <button
          v-for="tag in suggestions"
          :key="tag.id"
          type="button"
          class="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface"
          @mousedown.prevent="add(tag.id)"
        >
          <span class="truncate">{{ tag.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
