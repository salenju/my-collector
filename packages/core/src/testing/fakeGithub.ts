/**
 * 测试用的假 GitHub 服务（拦截 globalThis.fetch）。
 *
 * 只实现本方案用到的端点，但**保留关键的并发语义**：
 *  - updateRef 是非快进检查（force=false）
 *  - base_tree 只覆盖列出的路径，其他文件保持不变
 *  - 空仓库返回 409
 *  - 文件内容按**字节**存储，因此 JSON 文本与图片二进制都能真实往返
 *    （图片链路需要它：`/git/blobs` 与 `application/vnd.github.raw` 都必须保真）
 */
import { decodeBase64Bytes, encodeBase64Bytes } from '../utils/base64';
import { toBytes, type Bytes } from '../utils/bytes';

export interface FakeGithub {
  /** 文本视图（既有测试用它读 JSON；二进制文件在这里是 latin1 呈现） */
  files: Map<string, string>;
  /** 规范存储：路径 → 原始字节 */
  contents: Map<string, Bytes>;
  /** 模拟「另一台设备抢先提交」，让下一次 ref 更新返回 422 */
  forceWrite(path: string, text: string): void;
  /** 直接写入二进制（模拟"另一台设备上传了图片"） */
  forceWriteBytes(path: string, bytes: Uint8Array): void;
  /** 在 ref 更新前触发一次钩子（用于注入并发写） */
  onBeforeRefUpdate(hook: (() => void) | null): void;
  requests: string[];
  /** 每次提交的 message（断言提交信息用） */
  commitMessages: string[];
  /** 按路径读取原始字节（断言图片保真用） */
  fileBytes(path: string): Bytes | undefined;
  headSha(): string | null;
  commitCount(): number;
  restore(): void;
}

export const FAKE_OWNER = 'salenju';
export const FAKE_REPO = 'my-collector-data';

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h * 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

/** 与 GitHub 一致：相同内容 → 相同 sha */
function hashBytes(bytes: Uint8Array): string {
  let h = 5381;
  for (const byte of bytes) {
    h = ((h * 33) ^ byte) >>> 0;
  }
  return `${h.toString(16)}-${bytes.byteLength}`;
}

export function installFakeGithub(): FakeGithub {
  const files = new Map<string, string>();
  const contents = new Map<string, Bytes>();
  const blobs = new Map<string, Bytes>();
  const trees = new Map<string, Array<{ path: string; sha: string }>>();
  const commits = new Map<string, { tree: string; parents: string[] }>();
  const requests: string[] = [];
  const commitMessages: string[] = [];

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let head: string | null = null;
  let treeSha = '';
  let counter = 0;
  let beforeRefUpdate: (() => void) | null = null;

  const setFileBytes = (path: string, input: Uint8Array): void => {
    const bytes = toBytes(input);
    contents.set(path, bytes);
    files.set(path, decoder.decode(bytes));
  };

  const blobShaOfBytes = (input: Uint8Array): string => {
    const bytes = toBytes(input);
    const sha = `blob-${hashBytes(bytes)}`;
    blobs.set(sha, bytes);
    return sha;
  };

  const applyCommit = (commitSha: string): void => {
    const commit = commits.get(commitSha);
    if (!commit) return;
    for (const entry of trees.get(commit.tree) ?? []) {
      const content = blobs.get(entry.sha);
      if (content !== undefined) setFileBytes(entry.path, content);
    }
  };

  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = decodeURIComponent(url.pathname).replace(`/repos/${FAKE_OWNER}/${FAKE_REPO}`, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const accept = headers.get('accept') ?? '';

    requests.push(`${method} ${path}`);

    if (path === '' && method === 'GET') {
      return json({
        full_name: `${FAKE_OWNER}/${FAKE_REPO}`,
        private: true,
        default_branch: 'main',
        permissions: { push: true },
      });
    }

    if (path === '/git/ref/heads/main' && method === 'GET') {
      if (!head) return json({ message: 'Git Repository is empty.' }, 409);
      return json({ object: { sha: head } });
    }

    if (path.startsWith('/git/commits/') && method === 'GET') {
      const sha = path.slice('/git/commits/'.length);
      const commit = commits.get(sha);
      if (!commit) return json({ message: 'Not Found' }, 404);
      return json({ sha, tree: { sha: commit.tree } });
    }

    if (path === '/git/trees/main' && method === 'GET') {
      if (!head) return json({ message: 'Git Repository is empty.' }, 409);
      return json({
        sha: treeSha,
        tree: [...contents.entries()].map(([filePath, bytes]) => ({
          path: filePath,
          type: 'blob',
          sha: blobShaOfBytes(bytes),
          size: bytes.byteLength,
        })),
      });
    }

    if (path.startsWith('/contents/') && method === 'GET') {
      const filePath = path.slice('/contents/'.length);
      const bytes = contents.get(filePath);
      if (bytes === undefined) return json({ message: 'Not Found' }, 404);

      // 图片读取：application/vnd.github.raw 直接返回原始字节
      if (accept.includes('vnd.github.raw')) {
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }

      return json({
        type: 'file',
        sha: blobShaOfBytes(bytes),
        size: bytes.byteLength,
        content: encodeBase64Bytes(bytes),
        encoding: 'base64',
      });
    }

    if (path.startsWith('/contents/') && method === 'PUT') {
      const filePath = path.slice('/contents/'.length);
      const content = String(body?.content ?? '');
      setFileBytes(filePath, decodeBase64Bytes(content));
      return json({ content: { sha: blobShaOfBytes(contents.get(filePath) ?? new Uint8Array()) } });
    }

    if (path === '/git/blobs' && method === 'POST') {
      const bytes = decodeBase64Bytes(String(body?.content ?? ''));
      return json({ sha: blobShaOfBytes(bytes) });
    }

    if (path === '/git/trees' && method === 'POST') {
      const tree = (body?.tree ?? []) as Array<{ path: string; sha: string }>;
      treeSha = `tree-${hash(JSON.stringify(body))}`;
      trees.set(treeSha, tree);
      return json({ sha: treeSha, tree: [] });
    }

    if (path === '/git/commits' && method === 'POST') {
      counter += 1;
      const sha = `commit-${counter}`;
      commits.set(sha, {
        tree: String(body?.tree ?? ''),
        parents: (body?.parents as string[] | undefined) ?? [],
      });
      commitMessages.push(String(body?.message ?? ''));
      return json({ sha, tree: { sha: String(body?.tree ?? '') } });
    }

    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      beforeRefUpdate?.();
      const sha = String(body?.sha ?? '');
      const commit = commits.get(sha);
      if (!commit) return json({ message: 'Not Found' }, 404);
      // 非快进检查：父提交必须等于当前 HEAD
      if ((commit.parents[0] ?? null) !== head) {
        return json({ message: 'Update is not a fast forward' }, 422);
      }
      head = sha;
      applyCommit(sha);
      return json({ object: { sha } });
    }

    if (path === '/git/refs' && method === 'POST') {
      const sha = String(body?.sha ?? '');
      head = sha;
      applyCommit(sha);
      return json({ ref: String(body?.ref ?? ''), object: { sha } });
    }

    return json({ message: `unhandled ${method} ${path}` }, 404);
  }) as typeof fetch;

  return {
    files,
    contents,
    requests,
    commitMessages,
    forceWrite(path: string, text: string) {
      counter += 1;
      const sha = `commit-${counter}`;
      const tree = `tree-forced-${counter}`;
      const bytes = encoder.encode(text);
      setFileBytes(path, bytes);
      trees.set(tree, [{ path, sha: blobShaOfBytes(bytes) }]);
      commits.set(sha, { tree, parents: head ? [head] : [] });
      head = sha;
      treeSha = tree;
    },
    forceWriteBytes(path: string, bytes: Uint8Array) {
      counter += 1;
      const sha = `commit-${counter}`;
      const tree = `tree-forced-${counter}`;
      setFileBytes(path, bytes);
      trees.set(tree, [{ path, sha: blobShaOfBytes(bytes) }]);
      commits.set(sha, { tree, parents: head ? [head] : [] });
      head = sha;
      treeSha = tree;
    },
    onBeforeRefUpdate(hook) {
      beforeRefUpdate = hook;
    },
    fileBytes: (path: string) => contents.get(path),
    headSha: () => head,
    commitCount: () => counter,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}
