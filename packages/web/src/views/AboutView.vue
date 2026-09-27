<script setup lang="ts">
import { ExternalLink, Globe, Lock, WifiOff } from '@lucide/vue';
import { APP_TITLE, APP_VERSION } from '@/collector';
import BookmarkletCard from '@/components/BookmarkletCard.vue';

interface Shortcut {
  keys: string;
  action: string;
}

const shortcuts: Shortcut[] = [
  { keys: '⌘ / Ctrl + K', action: '聚焦搜索框' },
  { keys: '⌘ / Ctrl + N', action: '新建记录' },
  { keys: '⌘ / Ctrl + Enter', action: '在编辑表单中保存' },
  { keys: 'Esc', action: '关闭抽屉 / 取消输入' },
];

const dataFlows = [
  { target: 'api.github.com', content: '收藏的全部内容 + 访问令牌', canDisable: false },
  { target: 'r.jina.ai 等抓取服务（可选）', content: '你粘贴的网址', canDisable: true },
  { target: '收藏站点自身的域（favicon）', content: '常规图标请求，已加 no-referrer', canDisable: true },
];
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4 p-3 sm:p-4">
    <div>
      <h1 class="text-base font-semibold">{{ APP_TITLE }} · 使用说明</h1>
      <p class="mt-0.5 text-xs text-muted">v{{ APP_VERSION }} · 数据自持的碎片信息收集工具</p>
    </div>

    <section class="card p-4">
      <h2 class="text-sm font-semibold">它是怎么工作的</h2>
      <ul class="mt-2 space-y-2 text-xs leading-relaxed text-muted">
        <li class="flex gap-2">
          <Lock class="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
          <span>
            没有服务器。你的收藏保存在<b>你自己的 GitHub 私有仓库</b>里，浏览器用你提供的访问令牌直接读写。
          </span>
        </li>
        <li class="flex gap-2">
          <WifiOff class="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
          <span>
            离线优先。记录先写入本地（IndexedDB）并立即成功，联网后再自动推送；每台设备的改动会自动合并。
          </span>
        </li>
        <li class="flex gap-2">
          <Globe class="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
          <span>
            每次写入都是一次 Git 提交，所以误删、误改都能在仓库的提交历史里找回。
          </span>
        </li>
      </ul>
    </section>

    <BookmarkletCard />

    <section class="card p-4">
      <h2 class="text-sm font-semibold">快捷键</h2>
      <ul class="mt-2 divide-y divide-line text-xs">
        <li v-for="item in shortcuts" :key="item.keys" class="flex items-center justify-between gap-3 py-2">
          <span class="text-muted">{{ item.action }}</span>
          <kbd class="rounded border border-line bg-page px-1.5 py-0.5 font-mono text-[11px]">
            {{ item.keys }}
          </kbd>
        </li>
      </ul>
    </section>

    <section class="card p-4">
      <h2 class="text-sm font-semibold">数据流向（透明说明）</h2>
      <ul class="mt-2 space-y-2 text-xs">
        <li
          v-for="flow in dataFlows"
          :key="flow.target"
          class="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line p-2.5"
        >
          <span class="min-w-0 flex-1">
            <b class="font-medium text-ink">{{ flow.target }}</b><br />
            <span class="text-muted">{{ flow.content }}</span>
          </span>
          <span class="shrink-0 text-muted">{{ flow.canDisable ? '可在设置中关闭' : '必需，不可关闭' }}</span>
        </li>
      </ul>
      <p class="mt-2 hint">
        本应用不接入任何统计或错误上报服务，也不会向其他域名发送数据。
      </p>
    </section>

    <section class="card p-4">
      <h2 class="text-sm font-semibold">技术文档</h2>
      <p class="mt-1 text-xs leading-relaxed text-muted">
        完整设计（架构、数据模型、同步引擎、冲突合并、多端入口、安全与风险）见仓库
        <span class="font-mono">docs/tec/</span> 目录。
      </p>
      <a
        class="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline"
        href="https://github.com/salenju/my-collector"
        target="_blank"
        rel="noopener noreferrer"
      >
        github.com/salenju/my-collector
        <ExternalLink class="h-3.5 w-3.5" />
      </a>
    </section>
  </div>
</template>
