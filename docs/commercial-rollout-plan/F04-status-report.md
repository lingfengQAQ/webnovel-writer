# F04 健康报告（status）闭环计划

## 1. 闭环目标
- `status` 报告从“可生成”升级为“可运维决策”：可追溯、可告警、可机读。
- 报告结果与 index/state 真实数据一致，支持发布前门禁。

## 2. 模块范围
- `webnovel-writer/scripts/status_reporter.py`
- `webnovel-writer/scripts/data_modules/config.py`
- `webnovel-writer/scripts/data_modules/tests/test_status_reporter.py`

## 3. 接口清单
### CLI
- `webnovel status ...`

### 输出契约
- 文本报告（给作者）
- JSON 报告（给 CI / Dashboard）

## 4. 问题与改造点
- 问题 P1: 当前更偏“可读摘要”，缺少门禁级健康断言。
- 问题 P2: 报告中缺少数据来源与时效标记，难以排障。

## 5. 并行任务拆分（1 任务 = 1 子智能体）
| Task ID | 子智能体职责 | 代码边界（仅这些文件） | 依赖 | 完成定义（DoD） |
|---|---|---|---|---|
| F04-T1 | 增加 `--format json` 下的稳定 schema 与版本号 | `scripts/status_reporter.py` | 无 | JSON 可被 CI 稳定解析，字段含 `schema_version` |
| F04-T2 | 增加数据来源与新鲜度字段（state/index 的更新时间） | `scripts/status_reporter.py` | 无 | 报告可显示每类指标的来源与延迟 |
| F04-T3 | 增加健康阈值门禁（如关系为空、章节断档）并返回退出码 | `scripts/status_reporter.py`, `scripts/data_modules/config.py` | 无 | 关键异常返回非 0 退出码 |
| F04-T4 | 增加回归测试与快照测试 | `scripts/data_modules/tests/test_status_reporter.py` | T1,T2,T3 | 新旧输出差异可控，门禁分支有测试 |

## 6. 验收用例
- 用例 A: 关系数据缺失时，status 返回失败退出码并给出原因。
- 用例 B: 正常数据下，text/json 两种格式都能生成且字段完整。
- 用例 C: CI 可基于 JSON 报告做 pass/fail 判定。

## 7. 风险与回滚
- 风险: 门禁阈值过严导致误报。
- 回滚策略: 阈值配置化，先以 warning 模式灰度一周再强制 fail。
