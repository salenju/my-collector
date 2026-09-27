/**
 * 同步锁 —— 见 docs/tec/04-同步引擎与冲突处理.md §7
 *
 * 优先使用 Web Locks API（同源跨标签页互斥，ifAvailable 让"别的标签页正在同步"
 * 变成正常跳过而非排队等待）。不支持时退化为进程内互斥：
 * 跨标签页并发由 GitHub 的 CAS + 自动合并兜底，最多多一次往返，不会丢数据。
 */

export interface LockHandle {
  release: () => void;
}

interface LocksLike {
  request: (
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void>,
  ) => Promise<void>;
}

const inProcessHeld = new Set<string>();

function acquireInProcessLock(name: string): LockHandle | null {
  if (inProcessHeld.has(name)) return null;
  inProcessHeld.add(name);
  return {
    release: () => {
      inProcessHeld.delete(name);
    },
  };
}

export async function acquireLock(name: string): Promise<LockHandle | null> {
  const locks = (globalThis.navigator as { locks?: LocksLike } | undefined)?.locks;
  if (!locks) return acquireInProcessLock(name);

  let releaseFn: (() => void) | null = null;
  const acquired = await new Promise<boolean>((resolve) => {
    void locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        resolve(false);
        return;
      }
      let releaseResolve: () => void = () => undefined;
      const released = new Promise<void>((r) => {
        releaseResolve = r;
      });
      releaseFn = releaseResolve;
      resolve(true);
      await released;
    });
  });

  if (!acquired) return null;
  return {
    release: () => {
      releaseFn?.();
    },
  };
}
