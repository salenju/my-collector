基于“GitHub 仓库作为数据库”的方案，核心思路是**纯客户端架构**：前端应用直接通过 GitHub API 读写一个私有仓库中的 JSON 文件，没有自建服务器，数据同步由 Git 本身承担。以下是完整技术方案。

---

## 一、整体架构

```
┌─────────────────────────────────────────────┐
│              用户设备（多端）                  │
│  ┌───────────┐  ┌───────────┐  ┌──────────┐ │
│  │ 浏览器 PWA │  │ 手机 PWA  │  │ 桌面浏览器│ │
│  └─────┬─────┘  └─────┬─────┘  └────┬─────┘ │
│        │              │              │       │
│        └──────────────┼──────────────┘       │
│                       │                      │
│              GitHub REST API                 │
│         (Contents API + PAT 认证)            │
└───────────────────────┼─────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────┐
│           GitHub 私有仓库（数据仓库）          │
│  data/                                       │
│  ├── items.json        # 条目主数据           │
│  ├── tags.json         # 标签定义             │
│  └── meta.json         # 元信息/版本          │
│                                             │
│  每次写入 = 一次 Git commit                   │
│  自带版本历史、diff、回滚能力                  │
└─────────────────────────────────────────────┘
```

前端部署在 GitHub Pages 上，运行时从数据仓库拉取 JSON，用户操作时通过 GitHub Contents API 将更新后的 JSON 提交回去。

**与“飞书多维表格方案”的核心区别**：飞书方案中，数据存在飞书的服务器上，你需要一个代理去访问它；本方案中，**数据完全存在于你自己的 GitHub 私有仓库里**，前端直接与 GitHub API 通信，不经过任何第三方中间层。代价是需要处理 CORS 和 token 安全性问题，后文会给出具体方案。

## 二、数据存储设计

### 2.1 仓库结构

建议创建**两个仓库**，职责分离：

| 仓库                | 用途                    | 可见性                      |
| ------------------- | ----------------------- | --------------------------- |
| `my-collector`      | 前端代码（HTML/JS/CSS） | Public（GitHub Pages 需要） |
| `my-collector-data` | 数据存储（JSON 文件）   | **Private**                 |

数据仓库独立且私有，即使前端代码公开，你的收藏数据也不会暴露。

### 2.2 JSON 数据模型

**`data/items.json`** — 条目主数据：

```json
{
  "version": 1,
  "items": [
    {
      "id": "a1b2c3d4",
      "type": "link",
      "title": "React 19 新特性解读",
      "url": "https://example.com/react19",
      "content": "收藏原因：并发渲染的改进值得关注",
      "tagIds": ["tag_tech", "tag_react"],
      "createdAt": "2026-09-27T10:30:00Z",
      "updatedAt": "2026-09-27T10:30:00Z",
      "archived": false,
      "metadata": {}
    },
    {
      "id": "e5f6g7h8",
      "type": "note",
      "title": "",
      "content": "突然想到：标签系统可以用扁平结构 + 命名空间前缀来兼顾灵活性和层次感",
      "tagIds": ["tag_idea"],
      "createdAt": "2026-09-27T11:00:00Z",
      "updatedAt": "2026-09-27T11:00:00Z",
      "archived": false,
      "metadata": {}
    }
  ]
}
```

**`data/tags.json`** — 标签定义：

```json
{
  "version": 1,
  "tags": [
    { "id": "tag_tech", "name": "技术", "color": "#3b82f6", "parentId": null },
    {
      "id": "tag_react",
      "name": "React",
      "color": "#61dafb",
      "parentId": "tag_tech"
    },
    { "id": "tag_idea", "name": "想法", "color": "#f59e0b", "parentId": null }
  ]
}
```

**`data/meta.json`** — 同步元信息：

```json
{
  "lastSyncAt": "2026-09-27T11:05:00Z",
  "deviceId": "device_abc123",
  "schemaVersion": 1
}
```

### 2.3 数据量与性能边界

GitHub Contents API 单文件建议不超过 **1MB**（超过会触发 base64 编码大小限制）。对于个人收藏场景：

- 每条 item 平均约 0.5KB
- 1MB ≈ **2000 条**记录

如果预计超过这个量级，**按标签或时间分片存储**：

```
data/
├── items/
│   ├── 2026-09.json      # 9 月创建的条目
│   ├── 2026-10.json
│   └── ...
├── tags.json
└── meta.json
```

前端加载时先读 `meta.json` 获取分片列表，再按需拉取。搜索时在内存中合并所有分片数据。

## 三、技术栈

| 层              | 选型                               | 理由                               |
| --------------- | ---------------------------------- | ---------------------------------- |
| 前端框架        | **Vite + React** 或 **纯 HTML/JS** | 轻量，构建产物直接部署 Pages       |
| 样式            | Tailwind CSS                       | 快速搭建 UI                        |
| GitHub API 交互 | **octokit/rest.js**                | 官方 SDK，处理认证、分页、错误重试 |
| 本地缓存        | **IndexedDB**（通过 Dexie.js）     | 离线读写，启动时先读本地缓存再同步 |
| PWA             | **vite-plugin-pwa**                | 支持“添加到主屏幕”、离线访问       |
| 部署            | GitHub Actions → GitHub Pages      | 推送即部署                         |

## 四、GitHub API 交互核心实现

### 4.1 读取数据（拉取）

使用 Contents API 的 `GET` 接口读取文件内容。响应中的 `content` 字段是 **base64 编码**的，需要解码。

```javascript
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: personalAccessToken });

async function fetchDataFile(path) {
  const { data } = await octokit.repos.getContent({
    owner: "your-username",
    repo: "my-collector-data",
    path: path, // e.g. "data/items.json"
  });

  // data.content 是 base64 编码
  const content = atob(data.content);
  return { json: JSON.parse(content), sha: data.sha };
}
```

**关键点**：每次读取时会返回文件的 `sha`，这是后续更新时必须提供的版本标识。

### 4.2 写入数据（提交）

使用 Contents API 的 `PUT` 接口创建或更新文件。**更新时必须提供当前文件的 `sha`**，否则 GitHub 会拒绝，这是一个天然的乐观锁。

```javascript
async function saveDataFile(path, jsonData, currentSha) {
  const content = btoa(JSON.stringify(jsonData, null, 2));

  const { data } = await octokit.repos.createOrUpdateFileContents({
    owner: "your-username",
    repo: "my-collector-data",
    path: path,
    message: `update: ${path} at ${new Date().toISOString()}`,
    content: content,
    sha: currentSha, // 更新时必传
  });

  return data.content.sha; // 新的 sha，用于下次更新
}
```

如果两个设备同时提交，**后提交的会因为 sha 不匹配而被拒绝**。此时前端需要重新拉取最新数据，合并后再提交（冲突解决策略见第五节）。

### 4.3 使用 Git Data API 做批量操作（可选优化）

如果一次要更新多个文件（如同时改 `items.json` 和 `tags.json`），使用 Contents API 会产生多次 commit。更好的方式是使用 **Git Data API**：

1. 创建 tree 对象，列出所有变更文件
2. 创建 commit 对象，指向新 tree
3. 更新 ref，将分支指向新 commit

这样一次操作只产生一个 commit，更清晰，也更省 API 调用次数。对于个人工具的规模，Contents API 已经够用，但随着数据分片增多，Git Data API 会更高效。

## 五、多端同步与冲突处理

这是整个方案最需要设计好的部分。

### 5.1 离线优先策略

应用启动时的数据流：

```
启动 → 读 IndexedDB 本地缓存 → 立即渲染（用户可操作）
                ↓
         后台请求 GitHub API
                ↓
     成功 → 用远端数据更新本地缓存和 UI
     失败 → 保持本地数据，标记“离线模式”
```

所有写操作**先写 IndexedDB**，UI 立即反馈成功。然后**异步推送到 GitHub**。如果推送失败（网络问题或 sha 冲突），标记为“待同步”，下次网络恢复时重试。

### 5.2 冲突解决策略

对于个人单用户多设备场景，冲突概率不高，但需要处理。推荐策略：

**按 item 粒度合并**。每条 item 有独立的 `id` 和 `updatedAt`。当检测到 sha 冲突时：

1. 重新拉取远端数据
2. 对比本地和远端的 items 列表
3. 对于每条 item：
   - 只在本地存在 → 保留本地
   - 只在远端存在 → 保留远端
   - 两边都有且 `updatedAt` 相同 → 无冲突
   - 两边都有但 `updatedAt` 不同 → **取 `updatedAt` 较新的**
4. 合并后重新提交

这种策略简单可靠，对于“笔记/收藏”场景足够。如果未来需要更精细的控制，可以引入逐字段的版本向量，但现阶段没必要。

### 5.3 设备标识

每台设备首次运行时生成一个 `deviceId`（UUID），存储在 IndexedDB 中。在 `meta.json` 中记录最近同步的设备，用于调试和冲突追溯。

## 六、认证与 Token 安全

这是本方案最大的技术挑战。**绝不能把 GitHub Personal Access Token（PAT）硬编码在前端代码里**，因为 Pages 的 JS 是公开的。

### 6.1 推荐方案：Fine-grained PAT + 用户在设置页填入

最务实的做法：

1. **用户在 GitHub 设置中创建 Fine-grained PAT**，权限仅勾选 `Contents: Read and write`，仓库范围仅限 `my-collector-data`
2. **在应用的“设置”页面**提供一个输入框，让用户粘贴 token
3. token 存储在 **IndexedDB**（或 `localStorage`）中，仅存于用户设备本地
4. 所有 API 请求由浏览器直接发起，token 不经过任何第三方

**安全性分析**：token 只存在于用户自己的设备上，不会被发送到除 GitHub 之外的任何服务器。风险仅限于设备本身被入侵，而这对于个人工具是可以接受的。

### 6.2 Token 有效期管理

Fine-grained PAT 可以设置过期时间。建议设置 **90 天**，到期后应用提示用户重新生成。可以在 `meta.json` 中记录 token 的过期日期，应用启动时检查。

### 6.3 备选方案：GitHub OAuth Device Flow

如果希望更优雅的登录体验，可以使用 **OAuth Device Flow**：

1. 用户在应用中点击“连接 GitHub”
2. 应用显示一个 8 位设备码，提示用户访问 `github.com/login/device` 并输入
3. 用户在 GitHub 页面完成授权
4. 应用获得 access token

这个流程不需要你在 GitHub 上注册 OAuth App 的回调 URL（因为 Device Flow 不依赖回调），适合纯静态应用。但实现复杂度比直接填 PAT 高一些。对于自用工具，**直接填 PAT 是更简单可靠的选择**。

### 6.4 关于 CORS

GitHub REST API **支持跨域请求**（响应头包含 `Access-Control-Allow-Origin: *`），因此浏览器可以直接调用，不需要代理。这一点与飞书 API 不同。你可以在本地用 `fetch` 直接测试。

## 七、速率限制与优化

使用 PAT 认证后，速率限制为 **每小时 5000 次请求**（按用户维度计算）。对于个人工具：

- 每次读操作 = 1 次请求
- 每次写操作 = 1 次请求
- 正常使用每天可能产生几十到几百次请求

**完全在限制范围内**。但仍建议优化：

1. **减少轮询**：不要设置定时刷新。只在应用启动、手动刷新、或窗口重新获得焦点时拉取数据。
2. **合并写入**：前端做 **写去抖（debounce）**，用户连续操作时，等 2-3 秒后再提交，合并为一次 commit。
3. **条件请求**：使用 `If-None-Match` 头，如果文件未变化则返回 304，**不计入速率限制**。
4. **本地缓存优先**：IndexedDB 中缓存数据，启动时先渲染本地，再后台同步。

## 八、部署与运维

### 8.1 前端部署

```yaml
# .github/workflows/deploy.yml（在 my-collector 仓库中）
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci && npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

### 8.2 数据自动备份

由于数据是 Git 仓库，**你天然拥有完整的历史版本**。额外的保护措施：

- 在数据仓库中启用 **GitHub Actions 定时任务**，每周将 JSON 打包为压缩文件，作为 Release 附件保存
- 或者定期 `git clone` 到本地

### 8.3 多端访问方式

- **桌面浏览器**：直接访问 Pages URL
- **手机**：在浏览器中打开 Pages URL，然后“添加到主屏幕”（PWA）
- **如果做浏览器扩展**：可以用同一个 token 和 API 逻辑，实现一键收藏当前页面

## 九、与其他方案的对比

| 维度         | GitHub 仓库方案             | 飞书多维表格       | Supabase        |
| ------------ | --------------------------- | ------------------ | --------------- |
| 数据所有权   | **完全属于你**              | 存储在飞书         | 存储在 Supabase |
| 是否需要代理 | **不需要**（API 支持 CORS） | 需要               | 不需要          |
| 版本历史     | **Git 原生，极强**          | 有限               | 需自行实现      |
| 查询能力     | 前端内存过滤                | 飞书内置视图 + API | SQL             |
| 离线能力     | **好**（IndexedDB 缓存）    | 差                 | 好              |
| 运维成本     | **零**                      | 零                 | 低              |
| 扩展性       | 受文件大小限制              | 受 API 额度限制    | 最强            |

GitHub 仓库方案最适合**个人使用、数据量中等、重视数据所有权和版本历史**的场景。它的“限制”（文件大小、写入并发）恰好是个人工具不会触及的边界。

## 十、实施检查清单

1. **创建两个仓库**：`my-collector`（前端，Public）和 `my-collector-data`（数据，Private）
2. **生成 Fine-grained PAT**：权限仅 `Contents: Read and write`，仓库仅限 `my-collector-data`
3. **初始化数据文件**：在数据仓库中创建 `data/items.json`、`data/tags.json`、`data/meta.json`，初始内容为 `{"version": 1, "items": []}` 等
4. **搭建前端骨架**：Vite + React + Octokit + Dexie
5. **实现读写逻辑**：先做“添加一条收藏”的完整链路（IndexedDB → 渲染 → GitHub 提交）
6. **实现设置页**：token 输入、连接测试、同步状态显示
7. **加入 PWA**：manifest + service worker，支持离线访问
8. **部署 Pages**：配置 GitHub Actions 自动部署
9. **浏览器扩展**（可选，第 2 阶段）：复用 API 逻辑，实现一键收藏

**建议的第一步**：先不做前端框架，用**一个纯 HTML 页面**（几百行 JS）把“读取 JSON → 显示列表 → 添加条目 → 提交回仓库”的闭环跑通。验证 API 调用、sha 更新、CORS 都正常后，再用框架重构。
