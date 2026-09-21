---
name: webnovel-learn
description: 从当前会话提取成功写作模式并写入 project_memory.json
allowed-tools: Read Bash
argument-hint: "[要记住的写作经验]"
---

# /webnovel-learn

## Project Root Guard（必须先确认）

- 必须在项目根目录执行（需存在 `.webnovel/state.json`）
- 用统一入口解析项目根，避免写错目录：

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-${OPENCODE_PROJECT_DIR:-$PWD}}"
export CLAUDE_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${OPENCODE_PLUGIN_ROOT:-}}"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT:?}/scripts"
export PROJECT_ROOT="$(python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

## 目标

提取可复用的写作模式（钩子/节奏/对话/微兑现等），追加到 `.webnovel/project_memory.json`。

## 执行流程

1. 读取 `"$PROJECT_ROOT/.webnovel/state.json"` 的 `progress.current_chapter` 作为当前章节号；缺失则用 `source_chapter: null`，不阻断。
2. 解析用户输入（`/webnovel-learn` 后的经验文本；为空则取本次对话中用户认可的写法），归类 `pattern_type`（hook/pacing/dialogue/payoff/emotion/format/other，无法归类用 `other`）。
3. 调用 `project-memory add-pattern` 写入，不得手写或拼接 JSON：

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" project-memory add-pattern \
  --pattern-type "{pattern_type}" \
  --description "{用户输入或提炼后的完整描述}" \
  --category "{分类，可空}" \
  --importance "{high|medium|low}"
```

## 约束

- 不删除旧记录，仅追加。
- 追加前扫描已有 `patterns`；`pattern_type` + `description` 完全相同则跳过并告知用户，部分相似不去重。
- 禁止使用 `Write` 或手工编辑 `.webnovel/project_memory.json`。

## 成功标准

- `project_memory.json` 存在且格式合法，新 pattern 已追加到 `patterns` 数组。
- 输出包含 `status: success` 和完整 `learned` 对象。

## 失败恢复

| 故障 | 恢复方式 |
|------|---------|
| `project_memory.json` 不存在 | 脚本自动初始化 `{"patterns": []}` 后继续 |
| JSON 解析失败 | 不写入脏数据，告知用户文件损坏并建议手动修复 |
| `state.json` 缺失无法取章节号 | 用 `source_chapter: null`，不阻断 |
