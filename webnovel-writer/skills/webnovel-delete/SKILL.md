---
name: webnovel-delete
description: 删除指定章节，并清理正文、commit、事件、摘要、索引、向量、记忆、角色图鉴和关系图谱等派生数据。
allowed-tools: Read Bash
---

# 删除章节

## 目标

按用户给出的章节号或范围删除章节，并清理所有由这些章节派生出的运行时数据。支持：

- 单章：`/webnovel-delete 7`
- 多章：`/webnovel-delete 1,3,8`
- 范围：`/webnovel-delete 1-19`
- 混合：`/webnovel-delete 1,3,5-7`

删除范围包括正文、`.story-system` commit/event/chapter/review 合同、`.webnovel/summaries`、审查报告、`index.db` 中的角色/场景/关系/事件投影、`vectors.db` 中对应 chunk、长期记忆条目和 `state.json` 中的章节投影。

## 执行

先解析真实书项目根目录：

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT:?}/scripts"
export PROJECT_ROOT="$(python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

先预览删除计划：

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" delete "{chapters}" --dry-run --format text
```

确认用户同意后再执行：

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" delete "{chapters}" --yes --format text
```

## 要求

- `{chapters}` 必须来自用户输入，不要自行扩大范围。
- 删除前不改大纲和设定集；只清理正文与运行时派生产物。
- 默认只 dry-run；破坏性删除必须显式 `--yes`。
- 非末尾章节删除只警告不阻断，但要向用户说明可能留下章节号空缺。
- 向量只删除目标章节 chunk，不重新请求 embedding。
- 执行结束后向用户报告删除章节、删除文件数、清理向量 chunk 数、清理索引行数和 state 投影变化。
