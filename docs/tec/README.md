# 满天星（my-collector）技术设计方案

> 本目录是「满天星」的完整技术设计文档。方案基于 `docs/PRD/PRD-0927.md`（BRD）与 `docs/AI方案 0.1.md`（参考方案），
> 并经需求确认后定稿。
>
> **当前状态**：方案已确认，M0/M1 已实现并可运行（见 [09-实现记录.md](./09-实现记录.md)）；
> 实现过程中的设计偏离都记录在 09 文档里，并已回写到对应章节。

## 一、一句话方案

用 **GitHub 私有仓库当数据库**、**GitHub Pages 托管一个 Vue3 静态 SPA**，
浏览器持 Fine-grained PAT 直连 GitHub REST API 读写 JSON 文件——
零自建后端、零运维、数据与版本历史 100% 归自己所有，并支持离线记录与多端同步。

## 二、文档索引

| 文档 | 内容 |
| --- | --- |
| [01-架构总览.md](./01-架构总览.md) | 目标/非目标、架构图、技术栈、代码仓库结构、端到端数据流 |
| [02-数据模型与存储.md](./02-数据模型与存储.md) | 数据仓库文件布局、Item/Tag/Meta Schema、分片策略、软删除、校验 |
| [03-GitHub数据层与认证.md](./03-GitHub数据层与认证.md) | PAT 权限与生命周期、Contents API 读取、Git Data API 原子写入、并发控制、限流预算 |
| [04-同步引擎与冲突处理.md](./04-同步引擎与冲突处理.md) | Dexie 本地库、outbox 队列、状态机、LWW 合并算法、冲突矩阵、重试退避 |
| [05-前端应用设计.md](./05-前端应用设计.md) | 目录结构、路由、Pinia stores、页面线框与交互、视觉规范、移动端适配 |
| [06-多端入口设计.md](./06-多端入口设计.md) | Bookmarklet、Chrome 扩展（MV3）、PWA 分享目标、网页元信息抓取链路 |
| [07-工程化与交付计划.md](./07-工程化与交付计划.md) | monorepo、构建、GitHub Actions 部署、测试策略、里程碑 M0–M6、风险登记册 |
| [08-安全与风险.md](./08-安全与风险.md) | 威胁模型、Token 全生命周期、XSS/注入防护、隐私边界、数据恢复 |
| [09-实现记录.md](./09-实现记录.md) | **实现进度、验证证据、设计偏离记录（D-01~D-08）、测试抓到的真实缺陷、已知缺口** |

## 三、关键决策速览（ADR 摘要）

| # | 决策项 | 结论 | 来源 |
| --- | --- | --- | --- |
| D1 | 数据存储 | GitHub **私有**仓库 `salenju/my-collector-data`，JSON 文件即数据库 | 已确认 |
| D2 | 前端托管 | `salenju/my-collector` → GitHub Pages（Actions 自动部署） | 已确认 |
| D3 | 技术栈 | Vite + Vue 3 + TypeScript + Tailwind CSS，UI 组件用 headless 库（reka-ui） | PRD + 已确认 |
| D4 | 架构形态 | 纯静态 SPA，**无自建后端**；数据层抽为独立 `core` 包供 Web/扩展复用 | 已确认 |
| D5 | 认证 | 手填 **Fine-grained PAT**（仅 `Contents: Read and write`，仅授权数据仓库） | 已确认 |
| D6 | 本地缓存 | **IndexedDB（Dexie）离线优先**：先写本地立即成功，后台异步推送 | 已确认 |
| D7 | 标签模型 | v1 扁平列表，数据结构预留 `parentId`，未来可直接升级为层级 | 已确认 |
| D8 | 搜索 | v1 关键词模糊匹配（标题/内容/标签/URL）+ 标签筛选；Fuse.js／组合筛选留 a2 | 已确认 |
| D9 | 记录入口 | 网页手动 + Bookmarklet + Chrome 扩展 + PWA 分享目标（**四个全做**，分期交付） | 已确认 |
| D10 | 链接元信息 | 自动抓取，失败自动降级为手动填写 | 已确认 |
| D11 | 写入原子性 | 多文件变更统一走 **Git Data API 单次 commit**，避免半成功状态 | 本方案新增 |
| D12 | 数据分片 | 从 v1 起按 `createdAt` 月份分片（`data/items/YYYY-MM.json`），免未来迁移 | 本方案新增 |
| D13 | SPA 路由 | History 模式 + 构建时生成 `404.html` 兜底（GitHub Pages 必需） | 本方案新增 |
| D14 | 扩展与 Web 凭据 | 各自本地保存 PAT；`externally_connectable` 一键同步 PAT 留 a2 | 本方案新增 |

## 四、待确认的遗留小决策

以下是方案中已给出**默认选择**、但你可以推翻的点，不阻塞设计评审：

| # | 事项 | 方案默认值 | 影响 |
| --- | --- | --- | --- |
| Q1 | 元信息抓取代理 | 默认用公共代理 `r.jina.ai`，设置页可切换为自建 Cloudflare Worker（附录含参考实现） | 默认会把收藏的 URL 发给第三方；对隐私敏感建议选自建 |
| Q2 | 站点访问路径 | `https://salenju.github.io/my-collector/`（子路径 `base=/my-collector/`） | 若绑自定义域名可去掉子路径，PWA scope 更干净 |
| Q3 | 浏览器书签导入 | v1 不做，排在 M6（解析 Chrome/Firefox 导出的书签 HTML） | 存量收藏的迁移速度 |
| Q4 | 删除语义 | v1 用「归档 + 软删除墓碑」，回收站 UI 排在 a2 | 影响合并算法与列表默认视图 |

## 五、术语表

| 术语 | 含义 |
| --- | --- |
| 条目 / Item | 一条收藏，`type` 为 `link`（链接）或 `note`（纯笔记） |
| 分片 / Shard | 数据仓库中的一个 JSON 文件，按月切分条目 |
| outbox | 本地待推送变更队列，网络恢复后重放 |
| 墓碑 / Tombstone | 软删除标记（`deletedAt`），用于多端同步时正确传播删除 |
| LWW | Last-Write-Wins，按 `updatedAt` 取新者的冲突合并策略 |
| SHA | GitHub 文件/提交的版本标识；写入时作为天然的乐观锁 |
