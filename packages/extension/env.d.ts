/// <reference types="vite/client" />

/**
 * @lucide/vue 1.x 没有 types 字段（见 packages/web/src/types/lucide.d.ts 的说明），
 * 这里同样补一份只包含扩展实际用到图标的最小声明。
 */
declare module '@lucide/vue' {
  import type { Component } from 'vue';

  export const Check: Component;
  export const CircleAlert: Component;
  export const CircleCheck: Component;
  export const Copy: Component;
  export const ExternalLink: Component;
  export const Key: Component;
  export const Link2: Component;
  export const LoaderCircle: Component;
  export const RefreshCw: Component;
  export const Save: Component;
  export const Settings: Component;
  export const StickyNote: Component;
  export const Tag: Component;
  export const X: Component;
}
