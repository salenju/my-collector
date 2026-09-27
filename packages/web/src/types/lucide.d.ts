/**
 * @lucide/vue 1.x 的 package.json 没有 types 字段，也没有 exports/typesVersions 映射，
 * 其 .d.ts 位于 dist/ 下无法被 moduleResolution: bundler 直接命中。
 * 这里补一份最小声明，只列出本项目实际用到的图标；
 * 待上游补齐类型后可删除本文件。
 */
declare module '@lucide/vue' {
  import type { Component } from 'vue';

  export const Plus: Component;
  export const Search: Component;
  export const Settings: Component;
  export const Tag: Component;
  export const X: Component;
  export const Check: Component;
  export const Archive: Component;
  export const Trash: Component;
  export const ExternalLink: Component;
  export const Link2: Component;
  export const StickyNote: Component;
  export const RefreshCw: Component;
  export const LoaderCircle: Component;
  export const FolderOpen: Component;
  export const TriangleAlert: Component;
  export const ChevronDown: Component;
  export const ChevronRight: Component;
  export const Info: Component;
  export const Clock: Component;
  export const Pencil: Component;
  export const RotateCcw: Component;
  export const Save: Component;
  export const Download: Component;
  export const Upload: Component;
  export const Copy: Component;
  export const LogOut: Component;
  export const Sun: Component;
  export const Moon: Component;
  export const Menu: Component;
  export const EllipsisVertical: Component;
  export const ArrowLeft: Component;
  export const CircleCheck: Component;
  export const CircleAlert: Component;
  export const Bookmark: Component;
  export const CloudOff: Component;
  export const WifiOff: Component;
  export const CircleDashed: Component;
  export const ListFilter: Component;
  export const Scissors: Component;
  export const Merge: Component;
  export const Trash: Component;
  export const Globe: Component;
  export const Lock: Component;
  export const Key: Component;
  export const Wifi: Component;
  export const Sparkles: Component;
  export const WandSparkles: Component;
}
