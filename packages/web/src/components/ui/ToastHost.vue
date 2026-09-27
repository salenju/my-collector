<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from '@lucide/vue';
import { useToast, type ToastKind } from '@/composables/useToast';

const { toasts, dismiss } = useToast();

const TONES: Record<ToastKind, string> = {
  info: 'border-line bg-elevated text-ink',
  success: 'border-ok/40 bg-ok/10 text-ink',
  warning: 'border-warn/40 bg-warn/10 text-ink',
  error: 'border-danger/40 bg-danger/10 text-ink',
};
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:top-0 sm:items-end"
    aria-live="polite"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="pointer-events-auto flex w-[min(92vw,26rem)] items-start gap-2 rounded-card border p-3 shadow-lg"
      :class="TONES[toast.kind]"
    >
      <CircleCheck v-if="toast.kind === 'success'" class="mt-0.5 h-4 w-4 shrink-0 text-ok" />
      <CircleAlert v-else-if="toast.kind === 'error'" class="mt-0.5 h-4 w-4 shrink-0 text-danger" />
      <TriangleAlert v-else-if="toast.kind === 'warning'" class="mt-0.5 h-4 w-4 shrink-0 text-warn" />
      <Info v-else class="mt-0.5 h-4 w-4 shrink-0 text-brand" />
      <p class="flex-1 text-sm leading-relaxed">{{ toast.message }}</p>
      <button class="rounded p-0.5 text-muted hover:text-ink" @click="dismiss(toast.id)">
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
