# Dashboard 前端重做计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重做 dashboard 前端：砍掉废数据、加数据可视化、拆分文件、新增伏笔追踪和系统状态页。

**Architecture:** React 19 + Vite，新增图表库和路由。后端补聚合 API。

**Tech Stack:** React 19, Vite, react-router-dom v7, Apache ECharts (echarts + echarts-for-react), Pixelarticons (pixelarticons)

**Design:** 视觉风格和具体图表形式待确认，见 `dashboard/frontend/design.md`（待更新）

---

## 文件结构

### 前端（dashboard/frontend/src/）

```
src/
├── main.jsx                    # 入口，挂载 Router
├── App.jsx                     # Layout shell（侧边栏 + Router Outlet + SSE）
├── api.js                      # API 请求（保留，补新端点）
├── index.css                   # 全局样式
├── components/
│   ├── ChartWrapper.jsx        # 图表组件封装（统一风格）
│   ├── Badge.jsx               # Badge 组件
│   ├── Pager.jsx               # 翻页控制组件（大数据量分窗口浏览）
│   └── DataTable.jsx           # 带分页的表格组件（从 MiniTable 提取）
└── pages/
    ├── OverviewPage.jsx        # 总览
    ├── CharactersPage.jsx      # 角色图鉴（实体 + 关系图合并）
    ├── PacingPage.jsx          # 节奏雷达
    ├── ForeshadowingPage.jsx   # 伏笔追踪
    ├── FilesPage.jsx           # 文档浏览（迁移）
    └── SystemPage.jsx          # 系统状态
```

### 后端（dashboard/app.py 补充 API）

```
/api/stats/chapter-trend       # 聚合：每章字数 + 审查得分 + 钩子强度
/api/commits                   # 最近 N 个 commit 的 meta + projection_status
/api/contracts/summary         # MASTER_SETTING 摘要 + 当前卷/章合同存在性
/api/env-status                # RAG/Rerank 环境配置状态（PR #50）
/api/env-status/probe          # RAG/Rerank 主动探测（PR #50）
```

---

## Task 1: 后端补聚合 API

**Files:**
- Modify: `webnovel-writer/dashboard/app.py`

- [ ] **Step 1: 加 `/api/stats/chapter-trend`**

从 index.db 聚合查询，一次返回每章的字数、审查得分、钩子类型和强度。支持 `limit` 和 `offset` 参数，默认返回最近 50 章。

- [ ] **Step 2: 加 `/api/commits`**

读取 `.story-system/commits/` 目录下的 commit JSON 文件，返回 chapter、status、projection_status。支持 `limit` 参数。

- [ ] **Step 3: 加 `/api/contracts/summary`**

读取合同树文件存在性和关键字段（MASTER_SETTING 的 primary_genre/core_tone、volume/chapter/review 合同数量）。

- [ ] **Step 4: 合并 PR #50 的 env-status API**

从 PR #50 提取 `/api/env-status` 和 `/api/env-status/probe` 代码。

- [ ] **Step 5: 测试 + Commit**

---

## Task 2: 前端基础设施（路由 + 文件拆分 + 公共组件）

**Files:**
- Modify: `dashboard/frontend/package.json`
- Modify: `dashboard/frontend/src/main.jsx`
- Modify: `dashboard/frontend/src/App.jsx`
- Modify: `dashboard/frontend/src/api.js`
- Create: `dashboard/frontend/src/components/*.jsx`

- [ ] **Step 1: 安装依赖**

```bash
npm install echarts echarts-for-react react-router-dom pixelarticons
```

- [ ] **Step 2: 提取公共组件**

从现有 App.jsx 提取 Badge、DataTable（原 MiniTable）、Pager（翻页控制）。

Pager 组件要点：
- 支持窗口大小（每页 N 条）+ 翻页 + "跳到最新"
- 适配 500+ 章数据量

- [ ] **Step 3: 改造 main.jsx 加路由**

每个 page 组件 lazy import + React Router。

- [ ] **Step 4: 瘦身 App.jsx 为纯 Layout Shell**

只保留：侧边栏导航 + SSE 连接 + Router Outlet。所有页面逻辑移到 pages/。

- [ ] **Step 5: 更新 api.js**

补新端点的 fetch 函数（chapter-trend, commits, contracts-summary, env-status, env-probe）。

- [ ] **Step 6: 构建验证 + Commit**

---

## Task 3: 总览页

**Files:**
- Create: `dashboard/frontend/src/pages/OverviewPage.jsx`

**功能：**
- 统计卡：总字数/进度、当前章节/卷、Story Runtime 状态、审查均分、紧急伏笔数
- 审查得分可视化：ECharts 折线图，支持翻页浏览（默认最近 N 章）
- 字数分布可视化：ECharts 柱状图，按卷分组
- Strand Weave 整体分布
- 紧急伏笔 Top 5 表格
- 最近 3 章概要卡片

**删除：**
- MergedDataView（全量数据视图）
- FULL_DATA_GROUPS / FULL_DATA_DOMAINS 常量

**大数据量适配：**
- 可视化组件默认显示最近窗口，支持翻页
- 字数按卷分组，不一次性铺开所有章节

- [ ] **Step 1: 实现 + 构建验证 + Commit**

---

## Task 4: 角色图鉴页

**Files:**
- Create: `dashboard/frontend/src/pages/CharactersPage.jsx`

**功能：**
- Tab 1 列表视图：实体列表 + 筛选 + 详情面板 + 状态变化历史（保留现有逻辑）
- Tab 2 关系图谱：ECharts graph series（力导向布局）+ 章节时间轴滑块

关系图谱时间轴要点：
- 滑块控制当前章节，节点/边按 `first_appearance` / `chapter` 过滤
- 关系标签支持随章节变化（如"初识"→"宿敌"）
- 播放/暂停按钮，自动推进章节
- 显示当前章节号 + 当前可见节点数

- [ ] **Step 1: 实现 + Commit**

---

## Task 5: 节奏雷达页

**Files:**
- Create: `dashboard/frontend/src/pages/PacingPage.jsx`

**功能：**
- 钩子强度走势：ECharts 面积折线图，支持翻页，每页 N 章
- Strand 分布：ECharts 堆叠柱状图，逐章 Strand 分布
- 字数分布：ECharts 柱状图，按卷分组

**大数据量适配：**
- 所有组件支持翻页 + "跳到最新"

- [ ] **Step 1: 实现 + Commit**

---

## Task 6: 伏笔追踪页

**Files:**
- Create: `dashboard/frontend/src/pages/ForeshadowingPage.jsx`

**功能：**
- 统计卡：总伏笔、活跃、已回收、紧急/超期
- 状态筛选按钮：全部 / 紧急 / 活跃 / 已回收
- 伏笔时间线：ECharts 自定义 bar series（横向甘特），埋设章→目标章，颜色按状态，蓝线标当前章
- 完整伏笔表格：内容、状态、埋设章、目标章、紧急度

**大数据量适配：**
- 甘特图默认只显示活跃+紧急，已回收折叠
- 横轴范围自动适配（不铺满 1-500）

- [ ] **Step 1: 实现 + Commit**

---

## Task 7: 系统状态页

**Files:**
- Create: `dashboard/frontend/src/pages/SystemPage.jsx`

**功能：**
- Story Runtime 健康状态（mainline/fallback、latest commit）
- 合同树概览（MASTER_SETTING 题材/调性、volume/chapter/review 数量）
- 最近 Commit 历史表格（章节、accepted/rejected、5 路 projection_status）
- RAG 环境状态（embed/rerank key、vector_db 大小、rag_mode）+ 诊断按钮

- [ ] **Step 1: 实现 + Commit**

---

## Task 8: 文档浏览迁移 + 最终清理

**Files:**
- Create: `dashboard/frontend/src/pages/FilesPage.jsx`
- Modify: `dashboard/frontend/src/App.jsx`

- [ ] **Step 1: 迁移 FilesPage（逻辑不变）**
- [ ] **Step 2: 最终清理 App.jsx（删除所有已迁移的组件和常量）**
- [ ] **Step 3: 前端构建 + 启动验证所有 6 页 + Commit**

---

## 导航变更

| 旧导航 | 新导航 | 图标 (Pixelarticons) | 变化 |
|--------|--------|---------------------|------|
| 📊 数据总览 | 总览 | `chart-bar` | 删全量视图，加可视化 |
| 👤 设定词典 | 角色图鉴 | `users` | 合并关系图谱，2D 替 3D，加时间轴 |
| 🕸️ 关系图谱 | _(合并到角色)_ | — | 删除独立页面 |
| 📝 章节一览 | 节奏雷达 | `trending-up` | 新页面 |
| 📁 文档浏览 | 文档浏览 | `folder` | 不变 |
| 🔥 追读力 | 伏笔追踪 | `bookmark` | 新页面 |
| _(无)_ | 系统状态 | `sliders` | 新页面 |

## 删除的数据

- RAG 查询日志、工具调用统计、Override 合约明细、债务事件明细
- 无效事实列表、写作清单评分原始数据、全量数据视图（MergedDataView）

## 待确认项（设计讨论后更新）

- [x] ~~视觉风格确认~~ → 保留像素风
- [x] ~~图表库选型~~ → Apache ECharts（echarts + echarts-for-react）
- [x] ~~关系图库选型~~ → ECharts graph series（力导向布局）
- [x] ~~审查得分可视化形式~~ → 折线图
- [x] ~~字数分布可视化形式~~ → 柱状图（按卷分组）
- [x] ~~钩子强度可视化形式~~ → 面积折线图
- [x] ~~Strand 分布可视化形式~~ → 堆叠柱状图
