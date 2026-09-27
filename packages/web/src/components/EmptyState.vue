<script setup lang="ts">
import type { Component } from 'vue';

withDefaults(
  defineProps<{
    icon?: Component;
    title: string;
    description?: string;
  }>(),
  { description: '' },
);
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <component :is="icon" v-if="icon" class="h-8 w-8 text-muted" />
    <p class="text-sm font-medium text-ink">{{ title }}</p>
    <p v-if="description" class="max-w-sm text-xs leading-relaxed text-muted">{{ description }}</p>
    <div class="mt-1 flex flex-wrap items-center justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
