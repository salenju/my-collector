<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { FolderOpen, LoaderCircle, Menu, Plus, Search, Settings, Tag, TriangleAlert, X } from '@lucide/vue';
import { APP_TITLE } from '@/collector';
import { useAppStore } from '@/stores/app';
import { useItemsStore } from '@/stores/items';
import AppSidebar from '@/components/AppSidebar.vue';
import BannerBar from '@/components/BannerBar.vue';
import SyncStatusBadge from '@/components/SyncStatusBadge.vue';
import ToastHost from '@/components/ui/ToastHost.vue';

const app = useAppStore();
const items = useItemsStore();
const route = useRoute();
const router = useRouter();

const searchRef = ref<HTMLInputElement | null>(null);

const showSidebar = computed(() => app.sidebarOpen);
const keyword = computed({
  get: () => items.filter.keyword,
  set: (value: string) => items.setKeyword(value),
});

const mobileTabs = [
  { to: '/', label: '列表', icon: FolderOpen },
  { to: '/tags', label: '标签', icon: Tag },
  { to: '/settings', label: '设置', icon: Settings },
];

function isTabActive(path: string): boolean {
  if (path === '/') return route.path === '/' || route.name === 'item';
  return route.path.startsWith(path);
}

function onKeydown(event: KeyboardEvent): void {
  const meta = event.metaKey || event.ctrlKey;

  if (meta && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (route.path !== '/') void router.push('/');
    requestAnimationFrame(() => searchRef.value?.focus());
    return;
  }

  if (meta && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    void router.push('/new');
    return;
  }

  if (event.key === 'Escape') {
    app.sidebarOpen = false;
    if (document.activeElement === searchRef.value) searchRef.value?.blur();
  }
}

function reloadPage(): void {
  globalThis.location.reload();
}

onMounted(() => {
  globalThis.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  globalThis.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <ToastHost />

  <!-- 启动失败（例如隐私模式禁用了 IndexedDB） -->
  <div v-if="app.bootStatus === 'failed'" class="flex min-h-dvh items-center justify-center p-6">
    <div class="card max-w-md p-6">
      <TriangleAlert class="h-6 w-6 text-danger" />
      <h1 class="mt-3 text-base font-semibold">无法初始化本地存储</h1>
      <p class="mt-2 text-sm leading-relaxed text-muted">{{ app.bootError }}</p>
      <p class="mt-3 hint">
        建议退出浏览器的隐私/无痕模式，或允许本站使用本地数据后重试。
      </p>
      <button
        class="mt-4 min-h-10 rounded-lg bg-brand px-4 text-sm font-medium text-brand-fg"
        @click="reloadPage"
      >
        重新加载
      </button>
    </div>
  </div>

  <!-- 启动中 -->
  <div v-else-if="!app.ready" class="flex min-h-dvh items-center justify-center gap-2 text-muted">
    <LoaderCircle class="h-4 w-4 animate-spin" />
    <span class="text-sm">正在读取本地数据…</span>
  </div>

  <div v-else class="flex min-h-dvh flex-col">
    <!-- 顶栏 -->
    <header class="sticky top-0 z-30 border-b border-line bg-page/90 backdrop-blur">
      <div class="flex items-center gap-2 px-3 py-2 sm:px-4">
        <button
          class="rounded-lg p-2 text-muted transition hover:text-ink lg:hidden"
          aria-label="打开侧栏"
          @click="app.sidebarOpen = !app.sidebarOpen"
        >
          <Menu class="h-5 w-5" />
        </button>

        <RouterLink to="/" class="flex shrink-0 items-center gap-1.5 text-sm font-semibold tracking-wide">
          <span class="hidden sm:inline">{{ APP_TITLE }}</span>
          <span class="sm:hidden">星</span>
        </RouterLink>

        <div class="relative min-w-0 flex-1">
          <Search class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            ref="searchRef"
            v-model="keyword"
            class="field pl-8 pr-16"
            type="search"
            placeholder="搜索标题、内容、标签或网址"
            autocomplete="off"
            spellcheck="false"
            @keydown.enter="router.push('/')"
          />
          <kbd
            class="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted sm:block"
          >
            ⌘K
          </kbd>
        </div>

        <SyncStatusBadge />

        <RouterLink to="/new" class="hidden sm:block">
          <span
            class="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-brand-fg hover:opacity-90"
          >
            <Plus class="h-4 w-4" />新建
          </span>
        </RouterLink>

        <RouterLink
          to="/settings"
          class="hidden rounded-lg p-2 text-muted transition hover:text-ink sm:block"
          aria-label="设置"
        >
          <Settings class="h-5 w-5" />
        </RouterLink>
      </div>

      <BannerBar />
    </header>

    <!-- 主体：桌面三栏（侧栏 + 路由内容），移动端单列 -->
    <div class="flex min-h-0 flex-1">
      <aside class="hidden w-60 shrink-0 border-r border-line lg:block">
        <div class="sticky top-[57px] h-[calc(100dvh-57px)]">
          <AppSidebar />
        </div>
      </aside>

      <!-- 移动端抽屉 -->
      <div v-if="showSidebar" class="fixed inset-0 z-40 lg:hidden">
        <div class="absolute inset-0 bg-black/40" @click="app.sidebarOpen = false" />
        <div class="absolute inset-y-0 left-0 w-72 border-r border-line bg-page">
          <div class="flex items-center justify-between border-b border-line px-3 py-2">
            <span class="text-sm font-medium">导航</span>
            <button class="rounded p-1 text-muted" @click="app.sidebarOpen = false">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="h-[calc(100dvh-45px)]">
            <AppSidebar />
          </div>
        </div>
      </div>

      <main class="min-w-0 flex-1 pb-20 lg:pb-4">
        <RouterView />
      </main>
    </div>

    <!-- 移动端底部导航 -->
    <nav
      class="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-page/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <RouterLink
        v-for="tab in mobileTabs"
        :key="tab.to"
        :to="tab.to"
        class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]"
        :class="isTabActive(tab.to) ? 'text-brand' : 'text-muted'"
      >
        <component :is="tab.icon" class="h-5 w-5" />
        {{ tab.label }}
      </RouterLink>
      <RouterLink to="/new" class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted">
        <Plus class="h-5 w-5" />
        新建
      </RouterLink>
    </nav>
  </div>
</template>
