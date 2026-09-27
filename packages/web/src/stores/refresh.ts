import { useItemsStore } from './items';
import { useTagsStore } from './tags';

let inFlight: Promise<void> | null = null;

/**
 * 从本地 Dexie 重新读取条目与标签。
 * Pinia 就绪后会被注入到同步引擎的 onDataChanged（拉取到新数据时自动刷新 UI）。
 * 合并并发调用，避免一次同步触发多次重复读取。
 */
export function refreshData(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      await Promise.all([useItemsStore().reload(), useTagsStore().reload()]);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
