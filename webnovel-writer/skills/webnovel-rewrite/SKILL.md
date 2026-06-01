---
name: webnovel-rewrite
description: 重写指定章节：先清理旧章节派生数据，再按写章主链逐章重新创作、审查、提交和备份。
allowed-tools: Read Write Edit Grep Bash Agent
---

# 重写章节

## 目标

对用户指定章节执行“清理旧数据 → 重新写章 → 审查 → 提交 → 备份”的完整链路。支持：

- 单章：`/webnovel-rewrite 12`
- 多章：`/webnovel-rewrite 12,15`
- 范围：`/webnovel-rewrite 12-15`
- 混合：`/webnovel-rewrite 12,15-17`

## Step 1：解析项目与清理旧章节

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT:?}/scripts"
export PROJECT_ROOT="$(python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" delete-chapters --chapters "{chapters}" --mode rewrite --format text
```

清理会删除指定章节的正文、commit、事件、摘要、索引、向量、长期记忆、项目记忆、角色图鉴和关系图谱投影，并用剩余 commit 重建运行时 read-model。

## Step 2：逐章重写

按章节号升序逐章执行 `../../skills/webnovel-write/SKILL.md` 的完整流程。每一章都必须走：

1. 刷新 story-system runtime 合同
2. 调用 `context-agent` 生成写作任务书
3. 起草正文
4. 调用 `reviewer` 审查
5. 润色修复 blocking issue
6. 调用 `data-agent` 并执行 `chapter-commit`
7. 执行项目备份

## 要求

- `{chapters}` 必须来自用户输入，不要自行扩大范围。
- 多章重写必须从小到大执行，保证后章上下文来自新提交的前章。
- 不复用已删除章节的旧正文、旧向量或旧角色关系投影作为事实来源。
- 若某章审查失败，先修复该章并完成 commit，再继续下一章。
- 完成后向用户报告每章的正文路径、审查结果和 commit 状态。
