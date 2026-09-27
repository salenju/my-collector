<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import AppButton from './AppButton.vue';

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    tone?: 'primary' | 'danger';
    loading?: boolean;
  }>(),
  {
    description: '',
    confirmText: '确认',
    cancelText: '取消',
    tone: 'primary',
    loading: false,
  },
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'confirm'): void;
}>();
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/40" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-elevated p-5 shadow-xl"
      >
        <DialogTitle class="text-base font-semibold text-ink">{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="mt-2 text-sm leading-relaxed text-muted">
          {{ description }}
        </DialogDescription>
        <div class="mt-5 flex justify-end gap-2">
          <AppButton variant="ghost" @click="emit('update:open', false)">{{ cancelText }}</AppButton>
          <AppButton
            :variant="tone === 'danger' ? 'danger' : 'primary'"
            :loading="loading"
            @click="emit('confirm')"
          >
            {{ confirmText }}
          </AppButton>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
