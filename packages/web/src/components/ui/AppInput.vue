<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: string;
    type?: string;
    placeholder?: string;
    autocomplete?: string;
    spellcheck?: boolean;
    disabled?: boolean;
    inputmode?: 'text' | 'url' | 'search' | 'email';
  }>(),
  {
    type: 'text',
    placeholder: '',
    autocomplete: 'off',
    spellcheck: false,
    disabled: false,
    inputmode: 'text',
  },
);

defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'enter'): void;
}>();
</script>

<template>
  <input
    class="field"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :spellcheck="spellcheck"
    :disabled="disabled"
    :inputmode="inputmode"
    autocapitalize="off"
    autocorrect="off"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    @keydown.enter="$emit('enter')"
  />
</template>
