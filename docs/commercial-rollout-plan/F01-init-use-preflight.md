# F01 初始化/绑定/预检闭环计划

## 1. 闭环目标
- `init / use / where / preflight` 在任何工作区布局下都能给出一致、可解释、可恢复的结果。
- 项目根判定严格依赖 `.webnovel/state.json`，不再出现“误判可用项目”。
- `use` 即使无法写 pointer，也要显式返回原因并给出修复动作。

## 2. 模块范围
- `webnovel-writer/scripts/data_modules/webnovel.py`
- `webnovel-writer/scripts/project_locator.py`
- `webnovel-writer/scripts/init_project.py`
- `webnovel-writer/scripts/migrations/codex_migration.py`
- `webnovel-writer/scripts/data_modules/tests/test_project_locator.py`
- `webnovel-writer/scripts/data_modules/tests/test_webnovel_unified_cli.py`

## 3. 接口清单
### CLI
- `webnovel init ...`
- `webnovel use <project_root> [--workspace-root]`
- `webnovel where [--project-root ...]`
- `webnovel preflight [--format text|json] [--project-root ...]`

### 文件契约
- 工作区 pointer: `.codex/.webnovel-current-project`（兼容读取 `.claude/...`）
- 全局 registry: `~/.codex/webnovel-writer/registry.json`（兼容旧路径）
- 项目根判定: 必须存在 `.webnovel/state.json`

## 4. 问题与改造点
- 问题 P1: `_is_project_root` 判定过宽（仅 `.webnovel` 目录即判真）。
- 问题 P2: `use` 在无 `.codex/.claude` 场景静默跳过 pointer，用户难定位。
- 问题 P3: `preflight` 未暴露 pointer/registry 的细粒度健康信息。

## 5. 并行任务拆分（1 任务 = 1 子智能体）
| Task ID | 子智能体职责 | 代码边界（仅这些文件） | 依赖 | 完成定义（DoD） |
|---|---|---|---|---|
| F01-T1 | 收紧项目根判定逻辑，只认 `.webnovel/state.json` | `scripts/project_locator.py`, `scripts/migrations/codex_migration.py` | 无 | 所有 root 解析路径统一要求 `state.json`；误判样例回归通过 |
| F01-T2 | 优化 `use` 的可观测性，输出 pointer 跳过原因与建议 | `scripts/data_modules/webnovel.py`, `scripts/project_locator.py` | 无 | `workspace pointer: (skipped: reason=...)` 可见；错误码语义稳定 |
| F01-T3 | 扩展 `preflight` JSON 输出，增加 pointer/registry/root 细项 | `scripts/data_modules/webnovel.py` | 无 | `preflight --format json` 包含新检查项且可被机器消费 |
| F01-T4 | 补全回归测试覆盖边界路径与无 context 目录场景 | `scripts/data_modules/tests/test_project_locator.py`, `scripts/data_modules/tests/test_webnovel_unified_cli.py` | T1,T2,T3 | 新增测试全绿；历史通过用例不回归 |

## 6. 验收用例
- 用例 A: 仅有 `.webnovel/` 无 `state.json`，`where/preflight` 必须失败并给出明确原因。
- 用例 B: 工作区无 `.codex/.claude`，`use` 仍写 registry 且输出 pointer skipped reason。
- 用例 C: 迁移脚本对非项目目录返回可解释失败，不产出误导成功报告。

## 7. 风险与回滚
- 风险: 旧项目历史上仅有 `.webnovel/` 会被判定失效。
- 回滚策略: 提供一次性修复脚本补齐 `state.json` 基础骨架，再重跑 `preflight`。
