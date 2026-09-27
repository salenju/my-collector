<script setup lang="ts">
import { computed, ref } from 'vue';
import { Copy, ExternalLink, TriangleAlert } from '@lucide/vue';
import { buildBookmarklet } from '@/services/bookmarklet';
import { copyText } from '@/utils/clipboard';
import { useToast } from '@/composables/useToast';
import AppButton from './ui/AppButton.vue';

const toast = useToast();
const bookmarklet = computed(() => buildBookmarklet());
const showSource = ref(false);
const copied = ref(false);

async function copyCode(): Promise<void> {
  const ok = await copyText(bookmarklet.value.href);
  if (!ok) {
    toast.error('复制失败，请手动选中代码复制');
    return;
  }
  copied.value = true;
  toast.success('已复制，请到书签管理器里新建书签并粘贴到「网址」一栏');
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}

function warnNotToClick(): void {
  toast.warning('请把它拖到书签栏，不要在本页点击——直接点击会把「满天星」这个页面本身收藏起来。');
}
</script>

<template>
  <section class="card p-4">
    <h2 class="text-sm font-semibold">书签小工具（一键收藏当前页面）</h2>
    <p class="mt-1 text-xs leading-relaxed text-muted">
      把下面的按钮拖到浏览器的书签栏。以后在任意网页点它，就会带着当前网址、标题、摘要和你选中的文字
      打开满天星的「新建」页面，选好标签保存即可。
    </p>

    <!-- 拖拽目标 -->
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <a
        :href="bookmarklet.href"
        class="inline-flex min-h-10 cursor-grab items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-3 text-sm font-medium text-brand active:cursor-grabbing"
        draggable="true"
        title="拖我到书签栏"
        @click.prevent="warnNotToClick"
      >
        <ExternalLink class="h-4 w-4" />
        收藏到满天星
      </a>
      <span class="hint">← 拖到书签栏</span>
    </div>

    <div class="mt-3 flex flex-wrap gap-2">
      <AppButton size="sm" @click="copyCode">
        <Copy class="h-4 w-4" />{{ copied ? '已复制' : '复制代码' }}
      </AppButton>
      <AppButton size="sm" variant="ghost" @click="showSource = !showSource">
        {{ showSource ? '隐藏代码' : '查看代码' }}
      </AppButton>
      <AppButton size="sm" variant="ghost" @click="toast.info(bookmarklet.appBaseUrl)">
        目标地址
      </AppButton>
    </div>

    <pre
      v-if="showSource"
      class="mt-3 max-h-56 overflow-auto rounded-lg border border-line bg-page p-3 text-[11px] leading-relaxed"
    >{{ bookmarklet.source }}</pre>

    <ul class="mt-3 space-y-1 text-xs leading-relaxed text-muted">
      <li>· 在浏览器设置页（chrome://、扩展商店等）无法运行，这是浏览器的限制。</li>
      <li>· 少数站点 CSP 较严时，可能只能带过去网址和标题，属正常降级。</li>
      <li>· iOS Safari 不易拖拽书签，建议改用「添加到主屏幕」后的分享菜单。</li>
    </ul>

    <p class="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-warn">
      <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>它不向网页注入代码，只读取标题、摘要与你手动选中的文字，然后把参数带进满天星。</span>
    </p>
  </section>
</template>
