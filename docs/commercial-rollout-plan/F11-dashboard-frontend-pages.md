# F11 Dashboard 前端多页面闭环计划

## 1. 闭环目标
- 数据总览、实体、图谱、章节、文件、追读力页面全部使用真实 API 数据。
- 前端统一 loading/empty/error/data 四态，不再出现 mock 文案与假成功。

## 2. 模块范围
- `webnovel-writer/dashboard/frontend/src/App.jsx`
- `webnovel-writer/dashboard/frontend/src/pages/DashboardPage.jsx`
- `webnovel-writer/dashboard/frontend/src/pages/EntitiesPage.jsx`
- `webnovel-writer/dashboard/frontend/src/pages/GraphPage.jsx`
- `webnovel-writer/dashboard/frontend/src/pages/ChaptersPage.jsx`
- `webnovel-writer/dashboard/frontend/src/pages/FilesPage.jsx`
- `webnovel-writer/dashboard/frontend/src/pages/ReadingPowerPage.jsx`
- `webnovel-writer/dashboard/frontend/src/api/*`

## 3. 接口清单
### 页面消费接口
- 总览页: `GET /api/dashboard/overview`（F05 新增）
- 实体页: `GET /api/entities`
- 图谱页: `GET /api/graph`（F05 新增）或 `GET /api/relationships`
- 章节页: `GET /api/chapters`
- 文件页: `GET /api/files/tree`, `GET /api/files/read`
- 追读力页: `GET /api/reading-power`, `GET /api/review-metrics`

## 4. 问题与改造点
- 问题 P1: 多页面仍为硬编码 mock 数据。
- 问题 P2: API 失败时部分页面回落 mock，掩盖真实错误。
- 问题 P3: 图谱页仅 placeholder，没有可用视图。

## 5. 并行任务拆分（1 任务 = 1 子智能体）
| Task ID | 子智能体职责 | 代码边界（仅这些文件） | 依赖 | 完成定义（DoD） |
|---|---|---|---|---|
| F11-T1 | 建立页面通用数据请求层（含错误标准化） | `frontend/src/api/*` | 无 | 所有页面共享请求/错误处理策略 |
| F11-T2 | 实现总览页真实数据卡片 | `frontend/src/pages/DashboardPage.jsx` | 依赖 F05 overview 接口 | 无 mock 文案，展示核心指标 |
| F11-T3 | 实现实体/章节页真实列表与筛选 | `frontend/src/pages/EntitiesPage.jsx`, `frontend/src/pages/ChaptersPage.jsx` | 无 | 支持基础筛选、空态、错误态 |
| F11-T4 | 实现文件页真实树与内容读取 | `frontend/src/pages/FilesPage.jsx` | 无 | 目录树可浏览，点击文件可读内容 |
| F11-T5 | 实现追读力页真实指标展示 | `frontend/src/pages/ReadingPowerPage.jsx` | 无 | 指标来源明确，支持空数据展示 |
| F11-T6 | 图谱页接入节点/边列表视图（最小可用） | `frontend/src/pages/GraphPage.jsx` | 依赖 F05 graph 接口 | 至少提供可筛选节点/边列表 |
| F11-T7 | 路由层可用性与联调收尾 | `frontend/src/App.jsx` | T2~T6 | 全页面可跳转、状态一致、无 mock tag |

## 6. 验收用例
- 用例 A: 任一页面 API 失败时均显示错误态与重试按钮。
- 用例 B: 图谱页可看到真实节点与边，非 placeholder。
- 用例 C: 页面截图与文案中不再出现 `mock`/`skeleton` 描述。

## 7. 风险与回滚
- 风险: 后端接口未就绪会阻塞前端闭环。
- 回滚策略: 页面保留“只读错误页”而非 mock 数据回退。
