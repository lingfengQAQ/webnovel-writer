# Claude Code 调用矩阵（命令归属与触发时机）

> 目的：明确“谁调用、什么时候调用、调用什么脚本”，避免把 Claude Code 内部流程误当成人工命令。

## 规则

- 本项目中的脚本默认由 **Claude Code Skill/Agent** 在流程节点触发。
- 除非文档显式说明，否则不把脚本视为“用户手动日常命令”。
- 新增脚本或新增命令触发点时，必须同步更新本文件。

## 命令级矩阵（入口 -> 调用方 -> 触发时机）

| 入口命令 | 调用方 | 触发时机 | 关键脚本/动作 |
|---|---|---|---|
| `/webnovel-init` | `webnovel-init` Skill | 新建项目、深度初始化阶段 | `scripts/init_project.py` + 生成 `idea_bank.json` |
| `/webnovel-plan` | `webnovel-plan` Skill | 卷纲/章纲生成完成并写回状态时 | `scripts/update_state.py --volume-planned ...` |
| `/webnovel-write` | `webnovel-write` Skill | 写作流程 Step 5 数据链更新时 | Task 调 `data-agent`（内部再写 state/index） |
| `/webnovel-query` | `webnovel-query` Skill | 查询“伏笔紧急度/Strand 节奏”等分析请求时 | `scripts/status_reporter.py --focus urgency/strand` |
| `/webnovel-resume` | `webnovel-resume` Skill | 中断恢复检测、清理、断点恢复时 | `scripts/workflow_manager.py detect/cleanup/clear` |

## 脚本级矩阵（脚本 -> 谁触发 -> 什么时候）

| 脚本 | 主要触发方 | 触发节点 | 备注 |
|---|---|---|---|
| `.claude/scripts/update_state.py` | `webnovel-plan` Skill | 章纲/卷规划落盘后更新 `state.json` | 也可被自动化脚本调用；默认不是人工常规入口 |
| `.claude/scripts/status_reporter.py` | `webnovel-query` Skill / `pacing-checker` Agent(可选) | 查询分析或节奏审查时 | 产出健康报告与紧急度分析 |
| `.claude/scripts/workflow_manager.py` | `webnovel-resume` Skill | 恢复流程 detect/cleanup/clear | 仅恢复场景触发 |
| `.claude/scripts/init_project.py` | `webnovel-init` Skill | 项目初始化阶段 | 负责项目脚手架与基础状态文件 |

## 内部库调用（非独立命令）

| 内部模块 | 调用方 | 触发时机 |
|---|---|---|
| `.claude/scripts/data_modules/state_validator.py` | `update_state.py`、`status_reporter.py` | 读写 `state.json` 时自动规范化与校验 |

## 变更约束（后续开发必须遵守）

1. 若新增“可由 Skill/Agent 触发”的脚本，必须补充到本矩阵。
2. 若脚本触发时机变化（例如从 plan 阶段改到 write 阶段），必须同步更新本矩阵。
3. PR/提交说明中需写清“调用方 + 触发节点 + 是否允许人工调用”。

