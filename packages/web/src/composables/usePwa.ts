import { ref } from 'vue';
import { useRegisterSW } from 'virtual:pwa-register/vue';

/**
 * PWA 注册、更新提示与「安装到主屏」—— 见 docs/tec/06-多端入口设计.md §3。
 *
 * registerType 为 'prompt'：新版本就绪后**不自动刷新**，而是提示用户；
 * 用户确认时才 skipWaiting + 刷新，避免冲掉正在填的表单（07 文档 S13）。
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let registration: ReturnType<typeof useRegisterSW> | null = null;

const installEvent = ref<BeforeInstallPromptEvent | null>(null);
const canInstall = ref(false);

if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('beforeinstallprompt', (event) => {
    // 拦截浏览器自带的迷你提示条，改为我们自己可控的入口
    event.preventDefault();
    installEvent.value = event as BeforeInstallPromptEvent;
    canInstall.value = true;
  });
  globalThis.addEventListener('appinstalled', () => {
    canInstall.value = false;
    installEvent.value = null;
  });
}

export function usePwa() {
  registration ??= useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, r) {
      // 桌面端长期挂着标签页时，每小时检查一次更新
      if (r) {
        setInterval(() => {
          void r.update();
        }, 60 * 60 * 1000);
      }
    },
  });

  const { offlineReady, needRefresh, updateServiceWorker } = registration;

  return {
    offlineReady,
    needRefresh,
    canInstall,
    /** 用户确认更新：激活新 SW 并刷新页面 */
    applyUpdate: () => updateServiceWorker(true),
    /** 稍后再说：仅关闭提示，新 SW 会在下次打开时自然生效 */
    dismissUpdate: () => {
      needRefresh.value = false;
    },
    dismissOfflineReady: () => {
      offlineReady.value = false;
    },
    /** 触发浏览器原生的安装确认弹窗（必须由用户手势调用） */
    async promptInstall(): Promise<void> {
      const event = installEvent.value;
      if (!event) return;
      await event.prompt();
      await event.userChoice;
      canInstall.value = false;
      installEvent.value = null;
    },
  };
}

/** 当前是否以「已安装的独立应用」形态运行 */
export function detectStandalone(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia('(display-mode: standalone)').matches;
}
