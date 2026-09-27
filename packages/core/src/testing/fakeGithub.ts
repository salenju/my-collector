/**
 * 测试用的假 GitHub 服务（拦截 globalThis.fetch）。
 *
 * 只实现本方案用到的 10 个端点，但**保留关键的并发语义**：
 *  - updateRef 是非快进检查（force=false）
 *  - base_tree 只覆盖列出的路径，其他文件保持不变
 *  - 空仓库返回 409
 * 这样 engine 的 pull / 原子提交 / 冲突重试都能被真实地验证。
 */
import { decodeBase64Utf8, encodeBase64Utf8 } from '../utils/base64';

export interface FakeGithub {
  files: Map<string, string>;
  /** 模拟「另一台设备抢先提交」，让下一次 ref 更新返回 422 */
  forceWrite(path: string, text: string): void;
  /** 在 ref 更新前触发一次钩子（用于注入并发写） */
  onBeforeRefUpdate(hook: (() => void) | null): void;
  requests: string[];
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

export function installFakeGithub(): FakeGithub {
  const files = new Map<string, string>();
  const blobs = new Map<string, string>();
  const trees = new Map<string, Array<{ path: string; sha: string }>>();
  const commits = new Map<string, { tree: string; parents: string[] }>();
  const requests: string[] = [];

  let head: string | null = null;
  let treeSha = '';
  let counter = 0;
  let beforeRefUpdate: (() => void) | null = null;

  const blobShaOf = (text: string): string => {
    const sha = `blob-${hash(text)}`;
    blobs.set(sha, text);
    return sha;
  };

  const applyCommit = (commitSha: string): void => {
    const commit = commits.get(commitSha);
    if (!commit) return;
    for (const entry of trees.get(commit.tree) ?? []) {
      const content = blobs.get(entry.sha);
      if (content !== undefined) files.set(entry.path, content);
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
        tree: [...files.entries()].map(([filePath, text]) => ({
          path: filePath,
          type: 'blob',
          sha: blobShaOf(text),
          size: text.length,
        })),
      });
    }

    if (path.startsWith('/contents/') && method === 'GET') {
      const filePath = path.slice('/contents/'.length);
      const text = files.get(filePath);
      if (text === undefined) return json({ message: 'Not Found' }, 404);
      return json({
        type: 'file',
        sha: blobShaOf(text),
        size: text.length,
        content: encodeBase64Utf8(text),
        encoding: 'base64',
      });
    }

    if (path === '/git/blobs' && method === 'POST') {
      const content = decodeBase64Utf8(String(body?.content ?? ''));
      return json({ sha: blobShaOf(content) });
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
    requests,
    forceWrite(path: string, text: string) {
      counter += 1;
      const sha = `commit-${counter}`;
      const tree = `tree-forced-${counter}`;
      files.set(path, text);
      trees.set(tree, [{ path, sha: blobShaOf(text) }]);
      commits.set(sha, { tree, parents: head ? [head] : [] });
      head = sha;
      treeSha = tree;
    },
    onBeforeRefUpdate(hook) {
      beforeRefUpdate = hook;
    },
    headSha: () => head,
    commitCount: () => counter,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}
