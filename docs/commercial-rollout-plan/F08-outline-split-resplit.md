# F08 双纲拆分（split/resplit）闭环计划

## 1. 闭环目标
- 双纲工作台右键动作全部落到真实后端能力，无 no-op。
- `split/resplit` 的预览与应用闭环可追踪、可回滚、可测试。

## 2. 模块范围
- `webnovel-writer/dashboard/routers/outlines.py`
- `webnovel-writer/dashboard/models/outlines.py`
- `webnovel-writer/dashboard/services/split/service.py`
- `webnovel-writer/dashboard/services/split/resplit.py`
- `webnovel-writer/dashboard/frontend/src/api/outlines.js`
- `webnovel-writer/dashboard/frontend/src/pages/OutlineWorkspacePage.jsx`
- `webnovel-writer/dashboard/frontend/src/components/ResplitDialog.jsx`
- `webnovel-writer/dashboard/tests/test_outlines_split_api.py`
- `webnovel-writer/dashboard/tests/test_outlines_resplit_api.py`

## 3. 接口清单
- `GET /api/outlines`
- `POST /api/outlines/split/preview`
- `POST /api/outlines/split/apply`
- `GET /api/outlines/splits`
- `POST /api/outlines/resplit/preview`
- `POST /api/outlines/resplit/apply`
- `POST /api/outlines/order/validate`

## 4. 问题与改造点
- 问题 P1: 前端 `resplit-preview` 与 `assist-edit` 为占位 no-op。
- 问题 P2: outlines API 失败后静默 mock，隐藏真实错误。
- 问题 P3: 页面缺少“预览失败/应用失败”一致错误态。

## 5. 并行任务拆分（1 任务 = 1 子智能体）
| Task ID | 子智能体职责 | 代码边界（仅这些文件） | 依赖 | 完成定义（DoD） |
|---|---|---|---|---|
| F08-T1 | 把 `resplit-preview` 动作接入 `ResplitDialog` | `frontend/src/pages/OutlineWorkspacePage.jsx`, `frontend/src/components/ResplitDialog.jsx` | 无 | 右键重拆预览可弹窗并拿到后端数据 |
| F08-T2 | 将 `assist-edit` 动作改为真实联动（跳转或调用编辑协助） | `frontend/src/pages/OutlineWorkspacePage.jsx` | 无 | 右键协助修改不再 no-op |
| F08-T3 | 移除 outlines 前端生产 mock fallback，统一错误态 | `frontend/src/api/outlines.js` | 无 | API 异常时页面显示失败并可重试 |
| F08-T4 | 强化后端响应语义（错误码与幂等说明） | `dashboard/routers/outlines.py`, `dashboard/models/outlines.py` | 无 | OpenAPI/响应字段可支撑前端精确处理 |
| F08-T5 | 增加 split/resplit 全链路回归测试 | `dashboard/tests/test_outlines_split_api.py`, `dashboard/tests/test_outlines_resplit_api.py` | T1,T3,T4 | 预览、应用、幂等、失败分支全部覆盖 |

## 6. 验收用例
- 用例 A: 总纲选区触发 split 预览与应用，细纲实时刷新。
- 用例 B: 细纲触发 resplit 预览，应用后产生日志记录。
- 用例 C: 后端返回 4xx/5xx 时页面给出可重试错误态。

## 7. 风险与回滚
- 风险: UI 交互变更可能影响已有快捷键操作习惯。
- 回滚策略: 保留旧操作入口 1 个版本，新增入口灰度开启。
