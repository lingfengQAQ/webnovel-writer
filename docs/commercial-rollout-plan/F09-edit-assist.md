# F09 Edit Assist（编辑协助）闭环计划

## 1. 闭环目标
- 编辑协助从“伪预览”升级为“真实改写建议 + 可控应用”。
- 在未接入改写引擎前，接口应明确 `501`/`unsupported`，禁止假功能上线。

## 2. 模块范围
- `webnovel-writer/dashboard/routers/edit_assist.py`
- `webnovel-writer/dashboard/models/edit_assist.py`
- `webnovel-writer/dashboard/services/edit_assist/service.py`
- `webnovel-writer/dashboard/tests/test_edit_assist_api.py`

## 3. 接口清单
- `POST /api/edit-assist/preview`
- `POST /api/edit-assist/apply`
- `GET /api/edit-assist/logs`

## 4. 问题与改造点
- 问题 P1: 当前 preview 由 `_render_preview_text` 直接拼接 prompt，非真实改写。
- 问题 P2: apply 实际写入的是伪预览文本，存在产品语义欺骗。
- 问题 P3: 日志缺少模型/策略来源，不利于质量复盘。

## 5. 并行任务拆分（1 任务 = 1 子智能体）
| Task ID | 子智能体职责 | 代码边界（仅这些文件） | 依赖 | 完成定义（DoD） |
|---|---|---|---|---|
| F09-T1 | 引入改写引擎适配层（provider interface） | `dashboard/services/edit_assist/service.py` | 无 | preview 来自真实引擎输出，不再字符串拼接 |
| F09-T2 | 未配置引擎时返回显式 `501` 与 `EDIT_ASSIST_UNAVAILABLE` | `dashboard/routers/edit_assist.py`, `dashboard/services/edit_assist/service.py` | 无 | 不再返回“看似成功”的 placeholder 结果 |
| F09-T3 | apply 仅接受结构化 proposal（含版本与来源校验） | `dashboard/models/edit_assist.py`, `dashboard/services/edit_assist/service.py` | T1 | 非真实 proposal 不能被 apply |
| F09-T4 | 扩展日志字段（provider/model/latency/rollback） | `dashboard/models/edit_assist.py`, `dashboard/services/edit_assist/service.py` | 无 | `logs` 可用于质量分析与审计 |
| F09-T5 | 回归测试升级（成功/冲突/不可用/回滚） | `dashboard/tests/test_edit_assist_api.py` | T1,T2,T3,T4 | 关键分支全部自动化覆盖 |

## 6. 验收用例
- 用例 A: 引擎可用时，preview 返回真实改写文本与来源信息。
- 用例 B: 引擎不可用时，preview/apply 返回 501，不写入正文。
- 用例 C: 版本冲突时 apply 返回 409，并记录失败日志。

## 7. 风险与回滚
- 风险: 接入外部引擎增加延迟与失败率。
- 回滚策略: 保留只读建议模式（不允许 apply）作为降级路径。
