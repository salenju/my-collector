<script setup lang="ts">
import { computed } from 'vue';

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';

const props = withDefaults(defineProps<{ tone?: Tone }>(), { tone: 'neutral' });

const TONES: Record<Tone, string> = {
  neutral: 'border-line bg-elevated text-muted',
  brand: 'border-brand/30 bg-brand/10 text-brand',
  ok: 'border-ok/30 bg-ok/10 text-ok',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  danger: 'border-danger/30 bg-danger/10 text-danger',
};

const classes = computed(
  () => `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${TONES[props.tone]}`,
);
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
