# F06 Skills 管理（后端 + 前端）闭环计划

## 1. 闭环目标
- Skills 管理从“功能可用”升级为“可审计、可追责、可安全发布”。
- 前后端统一错误语义，避免管理动作假成功。

## 2. 模块范围
- `webnovel-writer/dashboard/routers/skills.py`
- `webnovel-writer/dashboard/models/skills.py`
- `webnovel-writer/dashboard/services/skills/*`
- `webnovel-writer/dashboard/frontend/src/api/skills.js`
- `webnovel-writer/dashboard/frontend/src/pages/SkillsPage.jsx`

## 3. 接口清单
- `GET /api/skills`
- `POST /api/skills`
- `PATCH /api/skills/{skill_id}`
- `POST /api/skills/{skill_id}/enable`
- `POST /api/skills/{skill_id}/disable`
- `DELETE /api/skills/{skill_id}`
- `GET /api/skills/audit`

## 4. 问题与改造点
- 问题 P1: 商业场景下需要更严格的 ID/命名校验与冲突处理。
- 问题 P2: 审计信息需要支持按时间/动作筛选以便追责。
- 问题 P3: 前端错误提示需要可定位（网络/权限/冲突分离）。

## 5. 并行任务拆分（1 任务 = 1 子智能体）
| Task ID | 子智能体职责 | 代码边界（仅这些文件） | 依赖 | 完成定义（DoD） |
|---|---|---|---|---|
| F06-T1 | 增强技能 ID/名称校验与唯一性错误码 | `dashboard/services/skills/*`, `dashboard/routers/skills.py` | 无 | 冲突返回稳定 error_code，可被前端识别 |
| F06-T2 | 扩展审计接口筛选能力（action/actor/time） | `dashboard/models/skills.py`, `dashboard/routers/skills.py`, `dashboard/services/skills/*` | 无 | `/audit` 支持筛选与分页 |
| F06-T3 | 前端 API/页面错误态升级（网络、权限、冲突） | `frontend/src/api/skills.js`, `frontend/src/pages/SkillsPage.jsx` | 无 | 用户可明确区分错误类型并重试 |
| F06-T4 | 技能管理回归测试（API + 前端关键路径） | `dashboard/tests` 与 `frontend` 对应测试文件 | T1,T2,T3 | 创建/启用/禁用/删除/审计全链路可测 |

## 6. 验收用例
- 用例 A: 创建重复 skill_id 返回冲突错误，前端显示“ID 已存在”。
- 用例 B: 审计列表可按动作筛选，分页总数正确。
- 用例 C: 网络中断时前端给出连接失败信息，不静默吞错。

## 7. 风险与回滚
- 风险: 校验收紧后，历史脏数据无法更新。
- 回滚策略: 提供一次性迁移脚本修正历史 ID，再启用强校验。
