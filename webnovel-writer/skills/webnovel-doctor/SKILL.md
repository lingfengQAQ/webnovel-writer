---
name: webnovel-doctor
description: 对网文项目做只读体检/诊断（/webnovel-doctor）——检查目录、文件、JSON、SQLite、RAG 配置、依赖与 Dashboard 构建产物是否完整。
version: 0.1.0
allowed-tools: Read Bash
argument-hint: "[--chapter N] [--deep]"
---

# Webnovel Doctor

## 目标

只读诊断当前书项目：确认所处阶段应有的目录、文件、JSON、SQLite、RAG 配置、Python 依赖与 Dashboard 构建产物是否完整。

## 原则

1. 只读诊断：不写项目文件、不自动修复、不安装依赖、不启动 Dashboard。
2. 先 `project-status` 取短状态，再 `doctor` 做阶段感知检查。
3. 统一用 `python -X utf8`，避免中文路径编码问题。
4. 缺失项按 runtime 推导的阶段解释影响与修复建议，不把 init 刚结束的项目按已写多章项目检查。

## 执行

准备路径：

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-${OPENCODE_PROJECT_DIR:-$PWD}}"
export CLAUDE_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${OPENCODE_PLUGIN_ROOT:-}}"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT:?}/scripts"
```

短状态：

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" project-status --format summary
```

标准体检：

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" doctor --format text
```

指定章节加 `--chapter {chapter_num}`，深度体检加 `--deep`。

## 输出方式

汇报包含：当前 `phase` 与 `target_chapter`、是否有 blocker、缺失或异常文件路径、RAG / Python / Dashboard 配置是否缺失、每个问题的影响和建议修复动作。

不执行真实修复，不展示或要求粘贴 API key。
