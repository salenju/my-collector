# 03 · GitHub 数据层与认证

本文件描述：如何认证、如何读、如何**原子地**写、并发如何控制、以及限流预算。

## 1. 认证方案（D5：手填 Fine-grained PAT）

### 1.1 用户在 GitHub 侧的操作（设置页给出逐步指引）

1. 访问 `https://github.com/settings/personal-access-tokens/new`
2. Token name：`my-collector`
3. Expiration：**90 days**（到期应用会提醒续期，见 §1.4）
4. Repository access：**Only select repositories** → 勾选 `salenju/my-collector-data`
5. Permissions → Repository permissions：
   - **Contents: Read and write**（唯一必需权限）
   - Metadata: Read-only（GitHub 自动附带，无法取消）
   - 其余全部保持 **No access**
6. 生成后**只显示一次**，复制粘贴到应用设置页

> 绝对不要授予 `Administration`、`Workflows`、`Secrets` 等权限；也不要用 Classic Token（权限过宽、以用户为粒度）。

### 1.2 Token 在客户端的存储

| 项 | 设计 |
| --- | --- |
| 存储位置 | IndexedDB（Dexie `settings` 表 `key='github'`） |
| 明文与否 | **明文**（IndexedDB 无内置加密；这是静态站点方案无法回避的取舍） |
| 是否上云 | 否。请求只发给 `api.github.com`，本项目**无任何遥测/错误上报** |
| 展示 | 设置页默认掩码显示（`github_pat_11ABC****XYZ`），提供"显示/隐藏"与"清除" |
| 备选 | 提供「仅本次会话保存」（sessionStorage），关闭标签页即失效 |
| 隔离 | Web 与 Chrome 扩展各自持有（Q/D14）。扩展后续可通过 `externally_connectable` 一键同步 |

**风险与缓解（详见 08 文档）**：同源下的任意脚本（包括被 XSS 注入的、或恶意第三方依赖）
都能读到该 Token。缓解措施：
1. 前端不引任何第三方运行时脚本（无 CDN、无统计、无广告）；
2. `package.json` 依赖锁定 + 依赖数量克制，由 Dependabot 提醒升级；
3. 严格 CSP（`script-src 'self'`），杜绝内联脚本与远程脚本；
4. 条目内容渲染全程 `{{ }}` 文本插值，**禁止 `v-html`**（见 08 文档 §3）。

### 1.3 权限校验与错误提示

「测试连接」按钮执行：`GET /repos/{owner}/{repo}`，再 `GET /repos/{owner}/{repo}/contents/data/meta.json`。
根据响应给出精确、可操作的中文提示（不要只抛 HTTP 码）：

| 状态 | 判定 | 给用户的提示 |
| --- | --- | --- |
| 200 | 一切正常 | "连接成功，已读取 N 条记录" |
| 401 | Token 无效/已撤销 | "Token 无效或已撤销，请重新生成并粘贴" |
| 403 + `x-ratelimit-remaining: 0` | 触发限流 | "已触发 GitHub 限流，请 X 分钟后再试" |
| 403 + 其他 | 权限不足 | "Token 缺少 Contents 读写权限，请检查 Token 配置" |
| 404 | 仓库不存在 / **未授权该仓库** | "找不到仓库，请确认仓库名，且 Token 已勾选该仓库" |
| 404（仓库存在但 meta.json 不存在） | 未初始化 | 引导点击「初始化数据仓库」 |
| 网络错误 | 离线/被墙 | "网络不可用，已进入离线模式，本地记录不受影响" |

> 404 的歧义（仓库不存在 vs 未授权）是 Fine-grained PAT 的常见坑，UI 文案需同时覆盖两种情况。

### 1.4 Token 生命周期管理

- 保存 Token 时，在 `data/meta.json` 写入 `tokenExpiresAt`（用户填写，或从 Token 创建时间 + 自选时长推算；两者都拿不到则可留空）。
- 应用启动时检查：剩余 ≤ 7 天 → 顶部黄色横幅提醒续期；已过期 → 顶部红色横幅 + 禁用推送（**本地记录仍正常**，恢复后一次性推送）。

### 1.5 认证抽象（为 a3 的 Device Flow 预留）

```ts
interface AuthProvider {
  readonly kind: 'pat' | 'device-flow';
  isConfigured(): Promise<boolean>;
  /** 返回可用的 access token；PAT 直接返回本地值，Device Flow 内部处理刷新 */
  getToken(): Promise<string>;
  /** 提供给 Octokit 的 auth 回调或请求头 */
  applyTo(headers: Headers): Promise<void>;
  clear(): Promise<void>;
}
```
v1 只实现 `PatAuthProvider`；`DeviceFlowAuthProvider` 留空实现 + TODO，接口不变、业务代码无感。

## 2. 客户端封装

```ts
// core/src/github/client.ts
import { Octokit } from '@octokit/core';
import { retry } from '@octokit/plugin-retry';

export const createClient = (auth: AuthProvider, cfg: RepoConfig) =>
  new Octokit({ auth: () => auth.getToken(), request: { retries: 0 } }) // 重试由我们自己的同步引擎控制
    .plugin(retry);
```

**为什么不直接用 `@octokit/rest`**：本方案只用 4 类端点（`contents.get`、`contents.put`、`git.*`、`repos.get`），
`@octokit/rest` 会把上百个端点的类型与插件打包进来，gzip 后差约 5 倍。用 `@octokit/core` + 少量手写封装更划算。

**统一错误模型**（把 HTTP 细节翻译成同步引擎能决策的语义）：

```ts
type GhErrorKind =
  | 'auth'          // 401：Token 无效 → 停止重试，引导重配
  | 'forbidden'     // 403 非限流：权限不足 → 停止重试
  | 'rate-limit'    // 403/429 限流 → 按 x-ratelimit-reset 等待
  | 'not-found'     // 404：仓库/文件不存在 → 区分"未初始化"
  | 'conflict'      // 409 / 422：ref 已前进 → 触发 pull + merge + 重试
  | 'network'       // 断网/DNS/超时 → 离线模式，退避重试
  | 'server'        // 5xx → 退避重试（最多 5 次）
  | 'unknown';

class GhError extends Error {
  constructor(readonly kind: GhErrorKind, readonly status?: number, readonly retryAfterMs?: number, cause?: unknown) { /* ... */ }
}
```

## 3. 读取（GET）

采用 **Contents API** 而非 Git Data API 读取，因为 Contents API 直接返回 base64 内容 + `sha`，并支持 `If-None-Match` 条件请求。

```
GET /repos/{owner}/{repo}/contents/{path}?ref=main
Header: If-None-Match: <etag from local fileCache>
→ 200 { content: "<base64>", sha: "<blob sha>", size }
→ 304 未变更（不计限流额度，直接使用本地缓存）
```

本地 `fileCache` 表记录每个文件的 `{ path, sha, etag, updatedAt }`。

**读取流程**

> **实现期修正（见 [09-实现记录.md](./09-实现记录.md) D-01）**：变更检测的主手段改为
> **Git Trees API**——一次请求拿到全仓库文件的 `path + sha`，因此不需要 `meta.json` 携带分片清单
> （那会形成循环依赖，详见 02 文档 §2.3）。Contents 的条件请求作为兜底保留。

```ts
// 1. HEAD（空仓库返回 null，需要与「仓库不存在」区分）
const head = await git.getHead();       // GET /git/ref/heads/{branch} + GET /git/commits/{sha}
if (!head) return markEmptyRepo();

// 2. 一次拿到全仓库文件 sha 与根 tree sha
const listing = await git.listFiles();  // GET /git/trees/{branch}?recursive=1

// 3. 与本地 fileCache.sha 比对，挑出真正变化的文件
const staleShards = listing.entries.filter(
  (e) => monthFromShardPath(cfg, e.path) !== null && cache.sha(e.path) !== e.sha,
);
const tagsStale = listing.entries.find((e) => e.path === tagsPath(cfg))?.sha !== cache.sha(tagsPath(cfg));

// 4. 并发拉取变化文件（限并发 6，带 If-None-Match 兜底）
// 5. 校验 → 按分片与「本地 + outbox」做 LWW 合并 → 单事务落库
// 6. 保存 RemoteSnapshot（commitSha / treeSha / files）供推送时做 CAS 与 base_tree
```

**为什么不用 meta.json 存 blobSha**：`meta.json` 与分片文件属于**同一次提交**，
提交前无法知道本次提交后各分片的新 sha，写进 meta 只能是上一轮的旧值，
每次同步都会因此多发一轮请求。Trees API 反而更省：1 个请求覆盖全仓库，且不依赖任何自指字段。

**根 tree sha 的来源**：`GET /git/trees/{branch}` 响应中的 `sha` 就是根 tree sha，可直接作为
`base_tree`；`commitSha` 从 ref 读取，用作提交的 `parents`。

**大文件规避**：Contents API 对 > 1MB 的文件不返回 `content`（返回 `content: ""` + `encoding: none`）。
按 02 文档的分片设计单文件不会到 1MB；若检测到该情况，降级用 `GET /repos/.../git/blobs/{sha}` 读取（该接口上限 100MB）。

**附件图片的读取（v2）**：图片用 `Accept: application/vnd.github.raw`，让 Contents API 直接返回原始字节：

```
GET /repos/{owner}/{repo}/contents/data/assets/3f/3f8a….jpg?ref=main
Header: Accept: application/vnd.github.raw        ← 关键
→ 200 <原始字节>（不带 base64 包装）
```

- 没有 base64 的 33% 膨胀；
- **不受上面那条 >1MB 的限制**，因此不需要回落 Blobs API（且支持 `Range`，将来可做渐进加载）；
- 数据仓库是 Private，`raw.githubusercontent.com` 的裸 `<img>` 请求不带授权必然 401/404，
  所以带鉴权走这条路径是唯一可行的展示方式（见 10 文档 §5.3）。

对应实现：`ContentsApi.getBytes()`；`GhRequestInit` 增加 `accept` 与 `responseType: 'bytes'`。

## 4. 写入（原子提交）

### 4.1 为什么不用 Contents API 写多文件

`POST/PUT /contents/{path}` 每次调用 = 一次 commit。
如果一次操作同时改动 `items/2026-09.json` 与 `tags.json`，会产生 **2 个 commit**，
且**中途失败会留下半成功状态**（标签建好了但条目没写进去），下次 pull 时数据语义就错了。

### 4.2 采用 Git Data API 做单次原子提交（D11）

```
① POST /repos/{owner}/{repo}/git/blobs            （每个待写文件 1 次）
      body: { content: "<base64 utf8>", encoding: "base64" }
      → { sha: "<blob sha>" }

② POST /repos/{owner}/{repo}/git/trees            （1 次）
      body: {
        base_tree: "<当前分支 HEAD 的 tree sha>",     ← 保留未变更文件
        tree: [
          { path: "data/meta.json",              mode: "100644", type: "blob", sha: "<blob1>" },
          { path: "data/items/2026-09.json",     mode: "100644", type: "blob", sha: "<blob2>" },
          { path: "data/tags.json",              mode: "100644", type: "blob", sha: "<blob3>" }
        ]
      }
      → { sha: "<tree sha>" }

③ POST /repos/{owner}/{repo}/git/commits          （1 次）
      body: { message, tree: "<tree sha>", parents: ["<head sha>"] }
      → { sha: "<commit sha>" }

④ PATCH /repos/{owner}/{repo}/git/refs/heads/main （1 次，CAS）
      body: { sha: "<commit sha>", force: false }    ← 非快进会被拒绝
      → 200 成功 / 422 冲突（分支已前进）→ 走 merge 重试
```

> ⚠️ **易错点（已被集成测试抓到过一次，见 [09-实现记录.md](./09-实现记录.md) §4.1）**：
> 读单个 ref 是 `GET /git/ref/{ref}`（**单数**），而更新 ref 是 `PATCH /git/refs/{ref}`（**复数**）。
> 两者共用同一个路径构造函数会导致**所有推送静默 404**，且类型检查与构建阶段完全看不出来。

**请求数**：写入 1 个分片（含 meta）= 2 blob + 1 tree + 1 commit + 1 ref = **5 次请求**；
一般场景 3 个文件 = 3 + 3 = **6 次请求**。完全在 5000/小时限额内。

**附件图片走同一个 blob 流程（v2）**：编码器换成二进制安全的 base64
（`encodeBase64Bytes`；**不能**用 `encodeBase64Utf8`——后者按 UTF-8 重编码，会把 ≥0x80 的字节改写）。
图片字节与条目 JSON 在**同一次提交**里落地，因此不会出现"图没上去但条目引用了它"；
且每个 blob 是独立请求，单次请求体始终只有几百 KB。1 张图 = 2 个 blob（原图 + 缩略图）。

**一致性保障**

| 保障点 | 机制 |
| --- | --- |
| 原子性 | 只有第 ④ 步会真正改变分支；①②③ 只是创建游离对象，失败无副作用（垃圾对象由 GitHub 自动 GC） |
| 并发（乐观锁） | 第 ④ 步 `force: false`，若 `main` 已被其他设备推进则返回 422，天然 CAS |
| 不丢文件 | 第 ② 步用 `base_tree` 基于当前 HEAD 增量修改，只覆盖列出的 path |
| 可追溯 | commit message 结构化，便于 `git log` 回溯（见 §4.3） |
| 可回滚 | 出错时用 `PATCH refs` 指回上一个 commit sha 即可（预留"撤销上一次同步"功能，a2） |

### 4.3 commit message 规范

```
collect: add 2, update 1, delete 1 [device:device_7f3a91]

add    a1b2c3d4  https://example.com/react19
update e5f6g7h8  (title, tagIds)
delete 9i8h7g6f  tombstone
```
首行给人看（快速定位"这次同步干了什么"），正文给排查用。多行 message 通过 **Git Data API 的 commit 对象**支持
（Contents API 也支持 `\n`，但我们已统一走 Git Data API）。

### 4.4 初始化流程

`初始化数据仓库` = 一次原子提交，写 4 个文件（见 02 文档 §6）：
```
data/meta.json
data/tags.json
data/items/YYYY-MM.json
README.md
```
若 `data/meta.json` 已存在则提示"仓库已初始化，无需重复"。

## 5. 并发控制

| 层级 | 场景 | 机制 |
| --- | --- | --- |
| 单设备多标签页 | 两个标签页同时保存 | **Web Locks API**：`navigator.locks.request('my-collector:sync', ...)`，保证同一时刻只有一个推送者；未拿到锁的标签页只写本地 outbox，由持锁者统一推送 |
| 多设备 | 手机与电脑同时改 | `updateRef` 的 CAS：422 → pull → LWW merge → 重试（见 04 文档） |
| 本地库 | 同一浏览器多标签页读写 Dexie | Dexie 原生基于 IndexedDB 事务，跨标签页安全；本应用所有写操作包在 `db.transaction('rw', ...)` 中 |

> 单设备内不要用 `localStorage` 做锁（非原子）；`navigator.locks` 在现代浏览器（含 iOS Safari 15.4+）已可用，
> 不可用时降级为**进程内互斥**，跨标签页并发交给 GitHub 的 CAS + 自动合并兜底，见 04 文档 §7。

## 6. 限流预算与优化

| 优化项 | 效果 |
| --- | --- |
| 条件请求 `If-None-Match` | 未变更文件返回 304，**不计入限额**，且省流量 |
| Git Trees 一次性列文件 | 1 个请求拿到全仓库 sha；未变更的分片**根本不发请求** |
| 不做定时轮询 | 只在：启动、窗口重新获得焦点（间隔 ≥ 60s）、手动刷新、写后处理时拉取 |
| 写去抖 | 连续操作合并为一次 commit（2s debounce + 最多 5s 强制 flush） |
| 单次原子提交 | 多文件改动合并为 1 次 commit，省掉 N-1 个 commit |
| 并发限流 | 拉取并发上限 6，避免瞬时打满（也防浏览器连接数瓶颈） |
| 图片索引不额外请求 | 远端图片索引直接来自已有的 Trees 响应（asset 文件名即其内容 id） |
| 图片查看按需 + 本地缓存 | 列表只加载缩略图且懒加载；已看过的图片命中 IndexedDB 后为 0 请求 |

**日常估算**：打开应用 1~3 请求（多数是 304 不计费）+ 每次保存 1 次推送（6 请求）→
每天几十次操作 ≈ 200~400 请求，相对 5000/小时 的上限余量充足。

**带图片时的估算（v2）**：新增 1 条带 3 张图 = 6 个 blob + tree/commit/ref = **9 请求**；
首次浏览一屏 30 张缩略图 = 30 请求，再次浏览为 0。个人使用下仍远低于限额，
但这也是"缩略图 + 懒加载 + 本地缓存"是必需而非优化的原因（10 文档 §2.2）。

**触发限流时的行为**：读 `x-ratelimit-reset` 头计算出等待时间 →
同步引擎进入 `backoff` 状态（倒计时展示在同步状态栏）→ **本地读写完全不受影响**。

## 7. 仓库配置模型

```ts
interface RepoConfig {
  owner: string;      // 默认 'salenju'
  repo: string;       // 默认 'my-collector-data'
  branch: string;     // 默认 'main'
  dataDir: string;    // 默认 'data'
}
```
全部可在设置页修改（便于将来换仓库/换账号），默认值已按你的实际情况预填。
配置文件结构一律由 `dataDir` 拼接生成，不硬编码路径字符串。
