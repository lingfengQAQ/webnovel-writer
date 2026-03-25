# F10 Runtime 迁移与运行态 API 闭环计划

## 1. 闭环目标
- Runtime API 从 placeholder 升级为真实检测与真实迁移执行。
- Dashboard 可直接判断当前运行态健康情况并触发迁移。

## 2. 模块范围
- `webnovel-writer/dashboard/routers/runtime.py`
- `webnovel-writer/dashboard/models/runtime.py`
- `webnovel-writer/dashboard/services/runtime/*`（新增）
- `webnovel-writer/scripts/migrations/codex_migration.py`
- `webnovel-writer/scripts/data_modules/webnovel.py`
- `webnovel-writer/scripts/data_modules/tests/test_codex_migration.py`

## 3. 接口清单
### API
- `GET /api/runtime/profile`
- `POST /api/runtime/migrate`

### CLI
- `webnovel migrate codex [--dry-run]`

## 4. 问题与改造点
- 问题 P1: `/api/runtime/profile` 返回固定 placeholder，非真实检测。
- 问题 P2: `/api/runtime/migrate` 未执行迁移，仅返回占位。
- 问题 P3: 模型字段不反映迁移报告结构。

## 5. 并行任务拆分（1 任务 = 1 子智能体）
| Task ID | 子智能体职责 | 代码边界（仅这些文件） | 依赖 | 完成定义（DoD） |
|---|---|---|---|---|
| F10-T1 | 新增 runtime service，封装 profile 检测逻辑 | `dashboard/services/runtime/*`（新增）, `dashboard/routers/runtime.py` | 无 | profile 返回真实状态（pointer、legacy 痕迹、可迁移项） |
| F10-T2 | 将 migrate API 接入 `migrate_codex_runtime` 执行链 | `dashboard/routers/runtime.py`, `scripts/migrations/codex_migration.py` | T1 | dry-run/apply 均可执行并返回结构化报告 |
| F10-T3 | 重构 runtime API model，去除 placeholder 字段 | `dashboard/models/runtime.py` | T1,T2 | 响应字段与迁移报告一一对应 |
| F10-T4 | 为不可用路径返回 501 而非假成功 | `dashboard/routers/runtime.py` | 无 | 未实现分支统一返回 `Not Implemented` 语义 |
| F10-T5 | 增加 API + 迁移回归测试 | `scripts/data_modules/tests/test_codex_migration.py` 与新增 `dashboard/tests/test_runtime_api.py` | T1,T2,T3,T4 | 关键路径自动化通过 |

## 6. 验收用例
- 用例 A: profile 能识别 `.claude` 残留、pointer 冲突、可迁移条目数。
- 用例 B: migrate dry-run 不改文件，apply 真正落盘并输出 moved/removed/skipped。
- 用例 C: 不支持场景返回 501，前端可感知不可用态。

## 7. 风险与回滚
- 风险: 迁移动作涉及真实文件移动，误操作代价高。
- 回滚策略: 强制先 dry-run，再二次确认 apply；迁移报告持久化备份。
