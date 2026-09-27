/**
 * GitHub 错误语义化 —— 对应 docs/tec/03-GitHub数据层与认证.md §2
 *
 * 把 HTTP 细节翻译成「同步引擎能据此决策」的语义，避免上层散落 status 判断。
 */

export type GhErrorKind =
  | 'auth' // 401：Token 无效/已撤销 → 停止自动重试，引导重配
  | 'forbidden' // 403 非限流：权限不足
  | 'rate-limit' // 403/429 限流 → 按 retryAfterMs 等待
  | 'not-found' // 404：仓库或文件不存在
  | 'conflict' // 422 且发生在 ref 更新：分支已前进 → pull + merge + 重试
  | 'validation' // 422 其他：请求体非法
  | 'network' // 断网/DNS/超时 → 离线模式
  | 'server' // 5xx → 退避重试
  | 'unknown';

export interface GhErrorOptions {
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

export class GhError extends Error {
  readonly kind: GhErrorKind;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(kind: GhErrorKind, message: string, options: GhErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'GhError';
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function isGhError(value: unknown): value is GhError {
  return value instanceof GhError;
}

/** 是否值得自动重试 */
export function isRetryable(kind: GhErrorKind): boolean {
  return kind === 'conflict' || kind === 'network' || kind === 'server' || kind === 'rate-limit';
}

/** 面向用户的中文提示（03 文档 §1.3 的表格落到代码里） */
export function humanMessage(error: GhError): string {
  switch (error.kind) {
    case 'auth':
      return '访问令牌无效或已被撤销，请到设置页重新生成并粘贴。';
    case 'forbidden':
      return '令牌权限不足，请确认已勾选 Contents 读写权限并授权了数据仓库。';
    case 'rate-limit':
      return '已触发 GitHub 限流，稍后会自动重试；本地记录不受影响。';
    case 'not-found':
      return '找不到数据仓库或文件，请确认仓库名正确，且令牌已勾选该仓库。';
    case 'conflict':
      return '远端数据已被其他设备更新，正在自动合并。';
    case 'validation':
      return '提交的数据未通过 GitHub 校验。';
    case 'network':
      return '网络不可用，已进入离线模式，本地记录不受影响。';
    case 'server':
      return 'GitHub 服务暂时异常，稍后会自动重试。';
    default:
      return error.message || '发生未知错误。';
  }
}
