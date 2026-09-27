import { ref } from 'vue';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const toasts = ref<Toast[]>([]);
let nextId = 1;

function remove(id: number): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

function push(kind: ToastKind, message: string, durationMs = 4_000): number {
  const id = nextId;
  nextId += 1;
  toasts.value = [...toasts.value, { id, kind, message }];
  if (durationMs > 0) {
    setTimeout(() => remove(id), durationMs);
  }
  return id;
}

export function useToast() {
  return {
    toasts,
    dismiss: remove,
    info: (message: string) => push('info', message),
    success: (message: string) => push('success', message),
    warning: (message: string) => push('warning', message, 6_000),
    error: (message: string) => push('error', message, 8_000),
    /** 把异常转成用户可读的提示 */
    fromError: (error: unknown, fallback = '操作失败') => {
      const message = error instanceof Error ? error.message : String(error);
      return push('error', message || fallback);
    },
  };
}
