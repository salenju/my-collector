<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import {
  FolderOpen,
  LoaderCircle,
  Menu,
  MonitorSmartphone,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Tag,
  TriangleAlert,
  X,
} from "@lucide/vue";
import type { UiSettings } from "@my-collector/core";
import { APP_TITLE } from "@/collector";
import { useAppStore } from "@/stores/app";
import { useItemsStore } from "@/stores/items";
import { useSettingsStore } from "@/stores/settings";
import AppSidebar from "@/components/AppSidebar.vue";
import BannerBar from "@/components/BannerBar.vue";
import SyncStatusBadge from "@/components/SyncStatusBadge.vue";
import ToastHost from "@/components/ui/ToastHost.vue";

const app = useAppStore();
const items = useItemsStore();
const settings = useSettingsStore();
const route = useRoute();
const router = useRouter();

const searchRef = ref<HTMLInputElement | null>(null);

const showSidebar = computed(() => app.sidebarOpen);

/**
 * 顶栏搜索：输入只写本地草稿，**点右侧放大镜或回车**才写入筛选并回到列表页。
 * 草稿与 store 保持同步，这样侧栏「清空筛选条件」、详情页等外部改动会反映到输入框。
 */
const keywordDraft = ref(items.filter.keyword);

watch(
  () => items.filter.keyword,
  (value) => {
    keywordDraft.value = value;
  },
);

function submitSearch(): void {
  items.setKeyword(keywordDraft.value);
  if (route.path !== "/") void router.push("/");
}

/**
 * 回车提交。Vue 的 `@keydown.enter` 不带输入法守卫，中文候选词未上屏时按回车
 * 会连带触发搜索，因此这里显式跳过组合态（229 是部分输入法的 keyCode）。
 */
function onSearchEnter(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  submitSearch();
}

/** 移动端底部导航：新建是动作入口，设置固定在最右侧 */
const mobileTabs = [
  { to: "/", label: "列表", icon: FolderOpen },
  { to: "/tags", label: "标签", icon: Tag },
  { to: "/new", label: "新建", icon: Plus },
  { to: "/settings", label: "设置", icon: Settings },
];

function isTabActive(path: string): boolean {
  if (path === "/") return route.path === "/" || route.name === "item";
  return route.path.startsWith(path);
}

// ── 主题：顶栏图标按钮循环切换 跟随系统 → 浅色 → 深色 ──
type ThemeMode = UiSettings["theme"];

const THEME_ORDER: ThemeMode[] = ["system", "light", "dark"];

const THEME_META: Record<
  ThemeMode,
  { icon: unknown; label: string; nextLabel: string }
> = {
  system: { icon: MonitorSmartphone, label: "跟随系统", nextLabel: "浅色" },
  light: { icon: Sun, label: "浅色", nextLabel: "深色" },
  dark: { icon: Moon, label: "深色", nextLabel: "跟随系统" },
};

const themeMeta = computed(() => THEME_META[settings.ui.theme]);

/** 与设置页「外观与设备」的主题下拉写同一份配置，两处始终同步 */
async function cycleTheme(): Promise<void> {
  const index = THEME_ORDER.indexOf(settings.ui.theme);
  const next = THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? "system";
  await settings.setUi({ theme: next });
}

function onKeydown(event: KeyboardEvent): void {
  const meta = event.metaKey || event.ctrlKey;

  if (meta && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (route.path !== "/") void router.push("/");
    requestAnimationFrame(() => searchRef.value?.focus());
    return;
  }

  if (meta && event.key.toLowerCase() === "n") {
    event.preventDefault();
    void router.push("/new");
    return;
  }

  if (event.key === "Escape") {
    app.sidebarOpen = false;
    if (document.activeElement === searchRef.value) searchRef.value?.blur();
  }
}

function reloadPage(): void {
  globalThis.location.reload();
}

onMounted(() => {
  globalThis.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  globalThis.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <ToastHost />

  <!-- 启动失败（例如隐私模式禁用了 IndexedDB） -->
  <div
    v-if="app.bootStatus === 'failed'"
    class="flex min-h-dvh items-center justify-center p-6"
  >
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
  <div
    v-else-if="!app.ready"
    class="flex min-h-dvh items-center justify-center gap-2 text-muted"
  >
    <LoaderCircle class="h-4 w-4 animate-spin" />
    <span class="text-sm">正在读取本地数据…</span>
  </div>

  <div v-else class="flex min-h-dvh flex-col">
    <!-- 顶栏 -->
    <header
      class="sticky top-0 z-30 border-b border-line bg-page/90 backdrop-blur"
    >
      <div class="flex items-center gap-2 px-3 py-2 sm:px-4">
        <button
          class="rounded-lg p-2 text-muted transition hover:text-ink lg:hidden"
          aria-label="打开侧栏"
          @click="app.sidebarOpen = !app.sidebarOpen"
        >
          <Menu class="h-5 w-5" />
        </button>

        <!-- 移动端不显示 logo，把宽度让给搜索框；「列表」Tab 已承担回首页的职责 -->
        <RouterLink
          to="/"
          class="hidden shrink-0 items-center gap-1.5 text-sm font-semibold tracking-wide sm:flex"
        >
          {{ APP_TITLE }}
        </RouterLink>

        <div class="relative min-w-0 flex-1">
          <input
            ref="searchRef"
            v-model="keywordDraft"
            class="field pr-11"
            type="search"
            placeholder="标题、内容、标签或网址"
            autocomplete="off"
            spellcheck="false"
            @keydown.enter="onSearchEnter"
          />
          <!-- 输入过程不改动列表，点这里或回车才触发搜索 -->
          <button
            type="button"
            class="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition hover:bg-elevated hover:text-ink"
            title="搜索（回车）"
            aria-label="搜索"
            @click="submitSearch"
          >
            <Search class="h-4 w-4" />
          </button>
        </div>

        <SyncStatusBadge />

        <!-- 主题切换：不隐藏在断点后，桌面与移动端都能一键切换 -->
        <button
          class="shrink-0 rounded-lg p-2 text-muted transition hover:text-ink"
          :title="`当前主题：${themeMeta.label}（点击切换为${themeMeta.nextLabel}）`"
          :aria-label="`切换主题，当前为${themeMeta.label}`"
          @click="void cycleTheme()"
        >
          <component :is="themeMeta.icon" class="h-5 w-5" />
        </button>

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
        <div
          class="absolute inset-0 bg-black/40"
          @click="app.sidebarOpen = false"
        />
        <div
          class="absolute inset-y-0 left-0 w-72 border-r border-line bg-page"
        >
          <div
            class="flex items-center justify-between border-b border-line px-3 py-2"
          >
            <span class="text-sm font-medium">导航</span>
            <button
              class="rounded p-1 text-muted"
              @click="app.sidebarOpen = false"
            >
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

    <!-- 移动端底部导航：选中态用底色块标记，仅靠文字变色不够醒目 -->
    <nav
      class="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-page/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <RouterLink
        v-for="tab in mobileTabs"
        :key="tab.to"
        :to="tab.to"
        class="flex min-w-0 flex-1 px-1 py-1.5"
        :aria-current="isTabActive(tab.to) ? 'page' : undefined"
      >
        <span
          class="flex w-full flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[11px] transition-colors"
          :class="
            isTabActive(tab.to)
              ? 'bg-brand/10 font-medium text-brand'
              : 'text-muted hover:bg-elevated'
          "
        >
          <component :is="tab.icon" class="h-5 w-5" />
          {{ tab.label }}
        </span>
      </RouterLink>
    </nav>
  </div>
</template>
