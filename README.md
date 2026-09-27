# 满天星（my-collector）

碎片信息与链接收藏工具。**没有服务器，也没有数据库**——
数据保存在你自己的 GitHub **私有**仓库的 JSON 文件里，浏览器持访问令牌直接读写 GitHub API。
每次保存都是一次 Git 提交，所以自带版本历史、diff 与回滚能力。

- 需求：`docs/PRD/PRD-0927.md`
- 完整技术设计：`docs/tec/`（架构、数据模型、同步引擎、多端入口、安全与风险）
- 实现进度与设计偏离记录：`docs/tec/09-实现记录.md`

## 功能

- 记录链接（自动抓取网页标题）与纯文本笔记，支持标签与备注
- 关键词搜索（标题 / 正文 / 摘要 / 网址 / 标签名）、标签筛选、归档视图、批量操作
- 离线优先：断网也能记录，联网后自动推送；多设备改动自动合并（LWW + 墓碑）
- 深浅色主题、响应式布局（桌面三栏 / 移动单列）

## 四个记录入口

| 入口 | 怎么用 | 说明 |
| --- | --- | --- |
| 网页应用 | 打开站点，粘贴网址 | 会自动抓取标题；抓取失败可手填 |
| 书签小工具 | 「关于」页把按钮拖到书签栏 | 在任意网页点一下，带上标题/摘要/选中文字打开新建页 |
| Chrome 扩展 | 工具栏图标 / 右键菜单 / `Alt+Shift+S` | 见下方安装说明；与网页版各自配置一次令牌 |
| PWA 分享目标 | 手机分享菜单 → 满天星 | Android Chrome 支持；iOS 见「关于」页说明 |

安装 Chrome 扩展（自用，未上架商店）：

```bash
pnpm build:ext
```

然后打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择
`packages/extension/dist`。首次使用需在扩展的「设置」页单独粘贴一次访问令牌
（扩展读不到网页版浏览器里的令牌）。

安装 PWA：用 Chrome 打开部署地址，点地址栏的安装图标；手机端用「添加到主屏幕」。

## 快速开始

前置要求：Node.js ≥ 20、pnpm ≥ 9。

```bash
pnpm install
pnpm dev        # http://localhost:5173/my-collector/
```

首次使用：

1. 在 GitHub 上创建一个**私有**仓库用于存放数据，例如 `my-collector-data`
2. 打开 `https://github.com/settings/personal-access-tokens/new` 生成 **Fine-grained PAT**
   - Repository access：Only select repositories → 只勾选数据仓库
   - Permissions：仅 `Contents: Read and write`
3. 在应用的「设置」页填入仓库名与令牌 → 「测试连接」
4. 点「初始化数据仓库」创建 `data/` 骨架（一次原子提交）

> 令牌只保存在你本机的浏览器数据库里，只会发往 `api.github.com`。本应用不含任何统计或上报。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 网页版本地开发（Vite，端口 5173，路径前缀 `/my-collector/`） |
| `pnpm build` | 生产构建（含 Service Worker 与 manifest），产物在 `packages/web/dist` |
| `pnpm preview` | 预览构建产物 |
| `pnpm build:ext` | 构建 Chrome 扩展，产物在 `packages/extension/dist` |
| `pnpm dev:ext` | 扩展的 watch 构建（改完到 `chrome://extensions` 点刷新） |
| `pnpm typecheck` | core（tsc）+ web / extension（vue-tsc）类型检查 |
| `pnpm test` | Vitest 单元 / 集成测试（90 个用例） |
| `pnpm icons` | 重新生成 PWA / 扩展的 PNG 图标（零依赖脚本） |
| `pnpm preview` + `pnpm smoke` | 浏览器冒烟：逐页检查渲染、console 错误与 PWA 状态（需本机 Chrome） |

## 项目结构

```
packages/
├── core/       # 数据层：模型、GitHub 读写、IndexedDB、同步引擎、冲突合并、搜索
├── web/        # Vue 3 + Tailwind 单页应用 + PWA（部署到 GitHub Pages）
└── extension/  # Chrome MV3 扩展（复用 core 的数据层）
scripts/
├── smoke.mjs      # 浏览器冒烟测试
└── gen-icons.mjs  # 生成 PNG 图标
docs/
├── PRD/        # 需求
└── tec/        # 技术设计与实现记录
```

**数据层全部在 `packages/core`**，UI 不直接访问 IndexedDB 或 `fetch`，扩展也复用同一套读写与提交逻辑，
避免两端行为漂移。扩展走的是「直连提交 + 失败保留草稿」，不做完整离线队列
（Service Worker 会被随时终止，理由见 `docs/tec/06-多端入口设计.md` §5.3）。

## 部署（GitHub Pages）

1. 仓库 Settings → Pages → Source 选择 **GitHub Actions**
2. push 到 `main` 后由 `.github/workflows/deploy-web.yml` 自动构建并部署
3. 访问 `https://<username>.github.io/my-collector/`

构建时会把 `index.html` 复制为 `404.html`，用于支撑 GitHub Pages 上的 SPA 深链
（如 `/tags`、`/item/xxx` 直接访问不 404）。
