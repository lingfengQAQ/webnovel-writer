# F03 数据层命令（index/state/rag）闭环计划

## 1. 闭环目标
- `index / state / rag` 与 `update-state` 在数据一致性上达成可验证闭环。
- 任何状态更新后，Dashboard 与 CLI 读取结果不再长期偏离。

## 2. 模块范围
- `webnovel-writer/scripts/data_modules/webnovel.py`
- `webnovel-writer/scripts/update_state.py`
- `webnovel-writer/scripts/data_modules/index_manager.py`
- `webnovel-writer/scripts/data_modules/state_manager.py`
- `webnovel-writer/scripts/data_modules/rag_adapter.py`
- `webnovel-writer/scripts/data_modules/tests/test_webnovel_unified_cli.py`

## 3. 接口清单
### CLI
- `webnovel index ...`
- `webnovel state ...`
- `webnovel rag ...`
- `webnovel update-state ...`

### 数据契约
- `state.json`：运行态写入源。
- `index.db`：Dashboard/查询优先读取源。
- 一致性要求：关键关系数据不能出现“state 有、index 无”。

## 4. 问题与改造点
- 问题 P1: `update-state` 仅写 `state.json`，未触发索引同步。
- 问题 P2: 缺少一致性探针，无法在命令层快速发现偏差。

## 5. 并行任务拆分（1 任务 = 1 子智能体）
| Task ID | 子智能体职责 | 代码边界（仅这些文件） | 依赖 | 完成定义（DoD） |
|---|---|---|---|---|
| F03-T1 | 在 `update-state` 落盘后增加可配置索引同步钩子 | `scripts/update_state.py`, `scripts/data_modules/webnovel.py` | 无 | 默认路径完成 state->index 同步；失败时返回明确错误码 |
| F03-T2 | 为 `index/state/rag` 增加一致性检查子命令或开关 | `scripts/data_modules/index_manager.py`, `scripts/data_modules/state_manager.py`, `scripts/data_modules/rag_adapter.py` | 无 | 可一键输出一致性检查结果与修复建议 |
| F03-T3 | 增加一致性元数据（更新时间戳/版本）用于 Dashboard 对账 | `scripts/update_state.py`, `scripts/data_modules/state_manager.py` | 无 | 可从元数据判断“谁更新得更晚” |
| F03-T4 | 增加 CLI 集成回归测试（包含异常分支） | `scripts/data_modules/tests/test_webnovel_unified_cli.py` | T1,T2,T3 | 回归用例覆盖同步成功、同步失败、跳过同步 |

## 6. 验收用例
- 用例 A: `update-state` 后执行 `/api/relationships` 与 state 中关系数量一致。
- 用例 B: 同步失败时 CLI 退出码非 0，且输出具体失败阶段。
- 用例 C: `index/state/rag` 命令在不一致时能给出诊断提示。

## 7. 风险与回滚
- 风险: 同步钩子增加命令时延。
- 回滚策略: 保留 `--skip-index-sync` 仅用于紧急绕过，默认仍开启同步。
