# F05 Dashboard 后端只读 API 闭环计划

## 1. 闭环目标
- Dashboard 后端 API 从“能查到数据”升级到“前端页面可直接消费且错误语义完整”。
- 提供总览与图谱数据接口，消除前端 mock 依赖。

## 2. 模块范围
- `webnovel-writer/dashboard/app.py`
- `webnovel-writer/dashboard/path_guard.py`
- `webnovel-writer/dashboard/tests/*`（新增 API 回归）

## 3. 接口清单
### 已有接口（需稳定化）
- `GET /api/project/info`
- `GET /api/entities`
- `GET /api/entities/{entity_id}`
- `GET /api/relationships`
- `GET /api/relationship-events`
- `GET /api/chapters`
- `GET /api/scenes`
- `GET /api/reading-power`
- `GET /api/review-metrics`
- `GET /api/state-changes`
- `GET /api/aliases`
- `GET /api/files/tree`
- `GET /api/files/read`

### 新增接口（支撑前端闭环）
- `GET /api/dashboard/overview`（聚合统计）
- `GET /api/graph`（`nodes[]` + `edges[]`）

## 4. 问题与改造点
- 问题 P1: 前端核心页面缺少可直接消费的聚合接口。
- 问题 P2: 图谱页面无后端接口支撑。
- 问题 P3: 部分查询的错误语义不统一。

## 5. 并行任务拆分（1 任务 = 1 子智能体）
| Task ID | 子智能体职责 | 代码边界（仅这些文件） | 依赖 | 完成定义（DoD） |
|---|---|---|---|---|
| F05-T1 | 实现 `GET /api/dashboard/overview` 聚合接口 | `dashboard/app.py` | 无 | 返回实体数、关系数、章节数、文件数、追读力概览 |
| F05-T2 | 实现 `GET /api/graph` 图谱接口（节点/边） | `dashboard/app.py` | 无 | 图谱页可直接渲染列表或可视化 |
| F05-T3 | 统一 API 错误模型与状态码（404/409/500） | `dashboard/app.py` | 无 | 所有新增/调整接口遵循统一错误体 |
| F05-T4 | 增加 API 回归测试（含空库、缺表、非法参数） | `dashboard/tests` 下新增测试文件 | T1,T2,T3 | 新接口 + 错误分支均覆盖 |

## 6. 验收用例
- 用例 A: index.db 缺表时返回结构化错误而不是前端崩溃。
- 用例 B: `overview` 与各明细接口统计可对账。
- 用例 C: `graph` 在空数据时返回空数组与明确状态。

## 7. 风险与回滚
- 风险: 聚合查询可能拖慢冷启动。
- 回滚策略: 聚合接口内部增加轻量缓存，保留明细接口作为兜底。
