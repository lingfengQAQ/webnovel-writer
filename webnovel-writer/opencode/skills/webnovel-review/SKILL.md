---
name: webnovel-review
description: Reviews chapter quality with checker agents and generates reports. Use when the user asks for a chapter review or runs /webnovel-review.
tools: Read Grep Write Edit Bash Task AskUserQuestion
---

# Quality Review Skill

## Project Root Guard（必须先确认）

- OpenCode 的“工作区根目录”不一定等于“书项目根目录”。常见结构：工作区为 `D:\wk\xiaoshuo`，书项目为 `D:\wk\xiaoshuo\凡人资本论`。
- 必须先解析真实书项目根（必须包含 `.webnovel/state.json`），后续所有读写路径都以该目录为准。

环境设置（bash 命令执行前）：
```bash
export WORKSPACE_ROOT="${OPENCODE_PROJECT_DIR:-$PWD}"

if [ -z "${OPENCODE_PLUGIN_ROOT}" ] || [ ! -d "${OPENCODE_PLUGIN_ROOT}/skills/webnovel-review" ]; then
  echo "ERROR: 未设置 CLAUDE_PLUGIN_ROOT 或缺少目录: ${OPENCODE_PLUGIN_ROOT}/skills/webnovel-review" >&2
  exit 1
fi
export SKILL_ROOT="${OPENCODE_PLUGIN_ROOT}/skills/webnovel-review"

if [ -z "${OPENCODE_PLUGIN_ROOT}" ] || [ ! -d "${OPENCODE_PLUGIN_ROOT}/scripts" ]; then
  echo "ERROR: 未设置 CLAUDE_PLUGIN_ROOT 或缺少目录: ${OPENCODE_PLUGIN_ROOT}/scripts" >&2
  exit 1
fi
export SCRIPTS_DIR="${OPENCODE_PLUGIN_ROOT}/scripts"

export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

## 0.5 工作流断点（best-effort，不得阻断主流程）

> 目标：让 `/webnovel-resume` 能基于真实断点恢复。即使 workflow_manager 出错，也**只记录警告**，审查继续。

推荐（bash）：
```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" workflow start-task --command webnovel-review --chapter {end} || true
```

Step 映射（必须与 `workflow_manager.py get_pending_steps("webnovel-review")` 对齐）：
- Step 1：加载参考
- Step 2：加载项目状态
- Step 3：并行调用检查员
- Step 4：生成审查报告
- Step 5：保存审查指标到 index.db
- Step 6：写回审查记录到 state.json
- Step 7：处理关键问题（AskUserQuestion）
- Step 8：收尾（完成任务）

Step 记录模板（bash，失败不阻断）：
```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" workflow start-step --step-id "Step 1" --step-name "加载参考" || true
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" workflow complete-step --step-id "Step 1" --artifacts '{"ok":true}' || true
```

## Review depth

- **Core (default)**: consistency / continuity / ooc / reader-pull
- **Full (关键章/用户要求)**: core + high-point + pacing

## Step 1: 加载参考（按需）

## References（按步骤导航）

- Step 1（必读，硬约束）：[core-constraints.md](../../references/shared/core-constraints.md)
- Step 1（可选，Full 或节奏/爽点相关问题）：[cool-points-guide.md](../../references/shared/cool-points-guide.md)
- Step 1（可选，Full 或节奏/爽点相关问题）：[strand-weave-pattern.md](../../references/shared/strand-weave-pattern.md)
- Step 1（可选，仅在返工建议需要时）：[common-mistakes.md](references/common-mistakes.md)
- Step 1（可选，仅在返工建议需要时）：[pacing-control.md](references/pacing-control.md)

## Reference Loading Levels (strict, lazy)

- L0: 先确定审查深度（Core / Full），再加载参考。
- L1: 只加载 References 区的“必读”条目。
- L2: 仅在问题定位需要时加载 References 区的“可选”条目。

**必读**:
```bash
cat "${SKILL_ROOT}/../../references/shared/core-constraints.md"
```

**建议（Full 或需要时）**:
```bash
cat "${SKILL_ROOT}/../../references/shared/cool-points-guide.md"
cat "${SKILL_ROOT}/../../references/shared/strand-weave-pattern.md"
```

**可选**:
```bash
cat "${SKILL_ROOT}/references/common-mistakes.md"
cat "${SKILL_ROOT}/references/pacing-control.md"
```

## Step 2: 加载项目状态（若存在）

```bash
cat "$PROJECT_ROOT/.webnovel/state.json"
```

## Step 3: 并行调用检查员（Task）

**调用约束**:
- 必须通过 `Task` 工具调用审查 subagent，禁止主流程直接内联审查结论。
- 各 subagent 结果全部返回后再生成总评与优先级。

**Core**:
- `consistency-checker`
- `continuity-checker`
- `ooc-checker`
- `reader-pull-checker`

**Full 追加**:
- `high-point-checker`
- `pacing-checker`

## Step 4: 生成审查报告

保存到：`审查报告/第{start}-{end}章审查报告.md`

**报告结构（精简版）**:
```markdown
# 第 {start}-{end} 章质量审查报告

## 综合评分
- 爽点密度 / 设定一致性 / 节奏控制 / 人物塑造 / 连贯性 / 追读力
- 总评与等级

## 修改优先级
- 🔴 高优先级（必须修改）
- 🟠 中优先级（建议修改）
- 🟡 低优先级（可选优化）

## 改进建议
- 可执行的修复建议
```

**审查指标 JSON（用于趋势统计）**:
```json
{
  "start_chapter": {start},
  "end_chapter": {end},
  "overall_score": 48,
  "dimension_scores": {
    "爽点密度": 8,
    "设定一致性": 7,
    "节奏控制": 7,
    "人物塑造": 8,
    "连贯性": 9,
    "追读力": 9
  },
  "severity_counts": {"critical": 1, "high": 2, "medium": 3, "low": 1},
  "critical_issues": ["设定自相矛盾"],
  "report_file": "审查报告/第{start}-{end}章审查报告.md",
  "notes": ""
}
```

注意：此处只生成审查指标 JSON；落库见 Step 5。

## Step 5: 保存审查指标到 index.db（必做）

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" index save-review-metrics --data '@review_metrics.json'
```

## Step 6: 写回审查记录到 state.json（必做）

将审查报告记录写回 `state.json.review_checkpoints`，用于后续追踪与回溯（依赖 `update_state.py --add-review`）：
```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" update-state -- --add-review "{start}-{end}" "审查报告/第{start}-{end}章审查报告.md"
```

## Step 7: 处理关键问题

如发现 critical 问题（`severity_counts.critical > 0` 或 `critical_issues` 非空），**必须使用 AskUserQuestion** 询问用户：
- A) 立即修复（推荐）
- B) 仅保存报告，稍后处理

若用户选择 A：
- 输出“返工清单”（逐条 critical 问题 → 定位 → 最小修复动作 → 注意事项）
- 如用户明确授权可直接修改正文文件，则用 `Edit` 对对应章节文件做最小修复，并建议重新运行一次 `/webnovel-review` 验证

若用户选择 B：
- 不做正文修改，仅保留审查报告与指标记录，结束本次审查

## Step 8: 收尾（完成任务）

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" workflow start-step --step-id "Step 8" --step-name "收尾" || true
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" workflow complete-step --step-id "Step 8" --artifacts '{"ok":true}' || true
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" workflow complete-task --artifacts '{"ok":true}' || true
```
