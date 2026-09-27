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
| `pnpm dev` | 本地开发（Vite，端口 5173，路径前缀 `/my-collector/`） |
| `pnpm build` | 生产构建，产物在 `packages/web/dist` |
| `pnpm preview` | 预览构建产物 |
| `pnpm typecheck` | core（tsc）+ web（vue-tsc）类型检查 |
| `pnpm test` | Vitest 单元 / 集成测试 |
| `pnpm test:watch` | 监听模式 |
| `pnpm preview` + `pnpm smoke` | 浏览器冒烟：逐页检查渲染与 console 错误（需本机 Chrome） |

## 项目结构

```
packages/
├── core/   # 与运行端无关的数据层：模型、GitHub 读写、IndexedDB、同步引擎、冲突合并、搜索
└── web/    # Vue 3 + Tailwind 的单页应用（部署到 GitHub Pages）
docs/
├── PRD/    # 需求
└── tec/    # 技术设计与实现记录
```

**数据层全部在 `packages/core`**，UI 不直接访问 IndexedDB 或 `fetch`。
后续要加的 Chrome 扩展会复用同一个 core 包，避免两端行为漂移。

## 部署（GitHub Pages）

1. 仓库 Settings → Pages → Source 选择 **GitHub Actions**
2. push 到 `main` 后由 `.github/workflows/deploy-web.yml` 自动构建并部署
3. 访问 `https://<username>.github.io/my-collector/`

构建时会把 `index.html` 复制为 `404.html`，用于支撑 GitHub Pages 上的 SPA 深链
（如 `/tags`、`/item/xxx` 直接访问不 404）。
