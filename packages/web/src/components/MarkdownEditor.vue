<script setup lang="ts">
import { computed, nextTick, ref, type Component } from 'vue';
import {
  Bold,
  Code,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pencil,
  Quote,
  SquareCode,
  Strikethrough,
} from '@lucide/vue';
import MarkdownView from './MarkdownView.vue';

/**
 * Markdown 编辑器 —— 写作 / 预览双态，值仍然是纯字符串（直接落 item.content）。
 *
 * 设计取舍：
 * - 不做富文本 contenteditable：Markdown 的价值在于「原始文本可读、可同步、可 diff」，
 *   contenteditable 会引入 HTML 污渍与跨端渲染不一致；
 * - 工具栏只做「在光标处插标记」这一件事，不改写已有文本，避免用户在不知情的情况下被重排；
 * - 所有插入都走 textarea 的 selectionStart/End，因此撤销（⌘Z）依然有效。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    id?: string;
    placeholder?: string;
    rows?: number;
    disabled?: boolean;
    /** 底部提示文案，默认给出常用语法速查 */
    hint?: string;
  }>(),
  {
    id: undefined,
    placeholder: '支持 Markdown：用 # 起标题、- 起列表、**加粗**、`代码`…',
    rows: 10,
    disabled: false,
    hint: 'Markdown：标题 #、列表 -、待办 - [ ]、代码 ```、引用 >、表格 | |',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);
const mode = ref<'write' | 'preview'>('write');

const charCount = computed(() => props.modelValue.trim().length);
const hasContent = computed(() => props.modelValue.trim().length > 0);

function update(value: string): void {
  emit('update:modelValue', value);
}

function focusRange(start: number, end: number): void {
  void nextTick(() => {
    const el = textarea.value;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
  });
}

function replaceRange(start: number, end: number, insert: string): number {
  const value = props.modelValue;
  update(value.slice(0, start) + insert + value.slice(end));
  return start + insert.length;
}

/** 用一对标记包住选区；没有选区时插入占位文字并选中它，方便直接改写 */
function wrap(prefix: string, suffix: string, placeholder: string): void {
  const el = textarea.value;
  if (!el || props.disabled) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = props.modelValue.slice(start, end);
  const body = selected || placeholder;
  replaceRange(start, end, `${prefix}${body}${suffix}`);
  if (selected) {
    focusRange(start + prefix.length + body.length + suffix.length, start + prefix.length + body.length + suffix.length);
  } else {
    focusRange(start + prefix.length, start + prefix.length + body.length);
  }
}

function insertLink(): void {
  const el = textarea.value;
  if (!el || props.disabled) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = props.modelValue.slice(start, end) || '链接文字';
  const url = 'https://';
  replaceRange(start, end, `[${selected}](${url})`);
  const urlStart = start + selected.length + 3;
  focusRange(urlStart, urlStart + url.length);
}

function insertCodeBlock(): void {
  const el = textarea.value;
  if (!el || props.disabled) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = props.modelValue.slice(start, end) || '代码';
  replaceRange(start, end, `\`\`\`\n${selected}\n\`\`\``);
  if (selected === '代码') {
    const bodyStart = start + 4;
    focusRange(bodyStart, bodyStart + selected.length);
  } else {
    focusRange(start + selected.length + 8, start + selected.length + 8);
  }
}

function insertRule(): void {
  const el = textarea.value;
  if (!el || props.disabled) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const value = props.modelValue;
  const needsLeading = start > 0 && value[start - 1] !== '\n';
  const caret = replaceRange(start, end, `${needsLeading ? '\n\n' : ''}---\n\n`);
  focusRange(caret, caret);
}

type PrefixKind = 'heading' | 'ul' | 'ol' | 'task' | 'quote';

interface PrefixSpec {
  test: RegExp;
  apply: (line: string, index: number) => string;
  remove: (line: string) => string;
}

const PREFIX_SPECS: Record<PrefixKind, PrefixSpec> = {
  heading: {
    test: /^ {0,3}#{1,6}\s+/,
    apply: (line) => `## ${line.replace(/^ {0,3}#{1,6}\s+/, '')}`,
    remove: (line) => line.replace(/^ {0,3}#{1,6}\s+/, ''),
  },
  ul: {
    test: /^\s*[-*+]\s+(?!\[[ xX]\])/,
    apply: (line) => `- ${line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')}`,
    remove: (line) => line.replace(/^\s*[-*+]\s+/, ''),
  },
  task: {
    test: /^\s*[-*+]\s+\[[ xX]\]\s+/,
    apply: (line) => `- [ ] ${line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')}`,
    remove: (line) => line.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, ''),
  },
  ol: {
    test: /^\s*\d+[.)]\s+/,
    apply: (line, index) => `${index + 1}. ${line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')}`,
    remove: (line) => line.replace(/^\s*\d+[.)]\s+/, ''),
  },
  quote: {
    test: /^\s*>\s?/,
    apply: (line) => `> ${line.replace(/^\s*>\s?/, '')}`,
    remove: (line) => line.replace(/^\s*>\s?/, ''),
  },
};

/** 对光标所在的每一行加/去行首标记（已全部带标记则视为「再来一次 = 取消」） */
function togglePrefix(kind: PrefixKind): void {
  const el = textarea.value;
  if (!el || props.disabled) return;
  const value = props.modelValue;
  const spec = PREFIX_SPECS[kind];

  const start = el.selectionStart;
  const end = el.selectionEnd;
  const blockStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const foundEnd = value.indexOf('\n', end);
  const blockEnd = foundEnd === -1 ? value.length : foundEnd;

  const lines = value.slice(blockStart, blockEnd).split('\n');
  const filled = lines.filter((line) => line.trim().length > 0);
  const allPrefixed = filled.length > 0 && filled.every((line) => spec.test.test(line));

  let filledIndex = 0;
  const nextLines = lines.map((line) => {
    if (!line.trim()) return line;
    const result = allPrefixed ? spec.remove(line) : spec.apply(line, filledIndex);
    filledIndex += 1;
    return result;
  });

  const block = nextLines.join('\n');
  replaceRange(blockStart, blockEnd, block);
  focusRange(blockStart, blockStart + block.length);
}

const TOOLS: ReadonlyArray<{ key: string; label: string; icon: Component; run: () => void }> = [
  { key: 'bold', label: '加粗 ⌘B', icon: Bold, run: () => wrap('**', '**', '加粗文字') },
  { key: 'italic', label: '斜体 ⌘I', icon: Italic, run: () => wrap('*', '*', '斜体文字') },
  { key: 'strike', label: '删除线', icon: Strikethrough, run: () => wrap('~~', '~~', '删除线文字') },
  { key: 'code', label: '行内代码 ⌘E', icon: Code, run: () => wrap('`', '`', '代码') },
  { key: 'heading', label: '标题', icon: Heading2, run: () => togglePrefix('heading') },
  { key: 'ul', label: '无序列表', icon: List, run: () => togglePrefix('ul') },
  { key: 'ol', label: '有序列表', icon: ListOrdered, run: () => togglePrefix('ol') },
  { key: 'task', label: '待办清单', icon: ListChecks, run: () => togglePrefix('task') },
  { key: 'quote', label: '引用', icon: Quote, run: () => togglePrefix('quote') },
  { key: 'codeblock', label: '代码块', icon: SquareCode, run: insertCodeBlock },
  { key: 'link', label: '链接 ⌘K', icon: Link2, run: insertLink },
  { key: 'rule', label: '分割线', icon: Minus, run: insertRule },
];

/** Enter 自动续列表 / 引用；空条目再回车则退出该结构 */
function continueBlock(): boolean {
  const el = textarea.value;
  if (!el) return false;

  const start = el.selectionStart;
  if (start !== el.selectionEnd) return false;

  const value = props.modelValue;
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const line = value.slice(lineStart, start);

  const ordered = /^(\s*)(\d{1,9})([.)])\s+(.*)$/.exec(line);
  const bullet = /^(\s*)([-*+])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
  const quote = /^(\s*)>\s?(.*)$/.exec(line);

  const exitLine = (prefixLength: number): void => {
    update(value.slice(0, lineStart) + value.slice(lineStart + prefixLength));
    focusRange(lineStart, lineStart);
  };

  if (ordered) {
    const content = (ordered[4] ?? '').trim();
    if (!content) {
      exitLine(line.length - content.length);
      return true;
    }
    replaceRange(start, start, `\n${ordered[1] ?? ''}${Number(ordered[2]) + 1}${ordered[3] ?? '.'} `);
    return true;
  }

  if (bullet) {
    const content = (bullet[4] ?? '').trim();
    if (!content) {
      exitLine(line.length - content.length);
      return true;
    }
    replaceRange(start, start, `\n${bullet[1] ?? ''}${bullet[2] ?? '-'} ${bullet[3] ?? ''}`);
    return true;
  }

  if (quote) {
    const content = (quote[2] ?? '').trim();
    if (!content) {
      exitLine(line.length - content.length);
      return true;
    }
    replaceRange(start, start, `\n${quote[1] ?? ''}> `);
    return true;
  }

  return false;
}

function onKeydown(event: KeyboardEvent): void {
  const el = textarea.value;
  if (!el || props.disabled) return;

  const mod = event.metaKey || event.ctrlKey;
  if (mod && !event.shiftKey && !event.altKey) {
    const key = event.key.toLowerCase();
    const shortcut = { b: 'bold', i: 'italic', k: 'link', e: 'code' } as const;
    const target = shortcut[key as keyof typeof shortcut];
    if (target) {
      event.preventDefault();
      TOOLS.find((tool) => tool.key === target)?.run();
      return;
    }
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (event.shiftKey) {
      // 减少缩进：只处理光标所在行开头的空格
      const lineStart = props.modelValue.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const head = props.modelValue.slice(lineStart, start);
      const strip = /^ {1,2}/.exec(head);
      if (!strip) return;
      const removed = strip[0].length;
      update(props.modelValue.slice(0, lineStart) + head.slice(removed) + props.modelValue.slice(start));
      focusRange(Math.max(lineStart, start - removed), Math.max(lineStart, end - removed));
      return;
    }
    // 增加缩进：两个空格（列表嵌套也靠它）
    update(props.modelValue.slice(0, start) + '  ' + props.modelValue.slice(end));
    focusRange(start + 2, start + 2);
    return;
  }

  if (event.key === 'Enter' && !event.shiftKey && !mod) {
    if (continueBlock()) event.preventDefault();
  }
}
</script>

<template>
  <div
    class="overflow-hidden rounded-lg border border-line bg-surface transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/25"
    :class="disabled ? 'opacity-60' : ''"
  >
    <div class="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
      <template v-if="mode === 'write'">
        <button
          v-for="tool in TOOLS"
          :key="tool.key"
          type="button"
          class="rounded p-1.5 text-muted transition hover:bg-elevated hover:text-ink disabled:cursor-not-allowed"
          :title="tool.label"
          :aria-label="tool.label"
          :disabled="disabled"
          @click="tool.run()"
        >
          <component :is="tool.icon" class="h-4 w-4" />
        </button>
      </template>
      <span v-else class="px-1 text-xs text-muted">预览渲染结果</span>

      <span class="flex-1" />

      <div class="inline-flex rounded-md bg-elevated p-0.5 text-xs">
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded px-2 py-1 transition"
          :class="mode === 'write' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'"
          @click="mode = 'write'"
        >
          <Pencil class="h-3.5 w-3.5" />编辑
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded px-2 py-1 transition"
          :class="mode === 'preview' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'"
          @click="mode = 'preview'"
        >
          <Eye class="h-3.5 w-3.5" />预览
        </button>
      </div>
    </div>

    <textarea
      v-if="mode === 'write'"
      :id="id"
      ref="textarea"
      class="block w-full resize-y border-0 bg-transparent px-3 py-2.5 font-mono text-sm leading-relaxed text-ink placeholder:text-muted focus:outline-none"
      :rows="rows"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      spellcheck="false"
      @input="update(($event.target as HTMLTextAreaElement).value)"
      @keydown="onKeydown"
    />
    <div v-else class="max-h-[32rem] overflow-auto px-3 py-2.5">
      <MarkdownView v-if="hasContent" :source="modelValue" />
      <p v-else class="text-sm text-muted">还没有内容，切回「编辑」写点什么。</p>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-2.5 py-1.5 text-[11px] text-muted">
      <span>{{ hint }}</span>
      <span class="shrink-0 tabular-nums">{{ charCount }} 字</span>
    </div>
  </div>
</template>
