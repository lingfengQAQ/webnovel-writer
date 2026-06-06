---
name: webnovel-review
description: 使用审查 Agent 评估章节质量，生成报告并写回审查指标。
allowed-tools: Read Grep Write Edit Bash Agent AskUserQuestion
argument-hint: "[章号或范围，如 5 或 1-5]"
---

# Quality Review Skill

## 目标

- 解析真实书项目根，调度统一 `reviewer` 完成结构化审查并落库。
- 主链事实以 `.story-system/reviews/chapter_{NNN}.review.json` 与 latest accepted `CHAPTER_COMMIT` 为准；`.webnovel/state.json` 仅为兼容投影。
- 有 `blocking=true` 问题时交用户裁决。

## 红线

- 必须通过 `Agent` 工具调用 `reviewer`，禁止主流程伪造结论或口头总结代替 subagent 输出。
- reviewer 只返回严格 JSON；主流程负责把返回值写入 `${PROJECT_ROOT}/.webnovel/tmp/review_results.json`。
- 报告与 metrics 只由 `review-pipeline --save-metrics` 产出；主流程不伪造 `overall_score`。
- 项目根不合法 / 缺 `.webnovel/state.json` / 缺待审正文 → 阻断。

## 执行流程

### Step 1：解析项目根

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

`PROJECT_ROOT` 必须包含 `.webnovel/state.json`，否则阻断。

### Step 2：目标章缺合同时刷新 runtime 合同

目标章缺 runtime 合同时，先用详细大纲的真实本章目标刷新（`CHAPTER_GOAL` 禁止 `{章纲目标}` / `第N章章纲目标` 占位文本）：

```bash
GENRE="$(python -X utf8 -c "import json; s=json.load(open('${PROJECT_ROOT}/.webnovel/state.json',encoding='utf-8')); pi=s.get('project_info',{}); print(pi.get('genre') or s.get('project',{}).get('genre',''))")"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" \
  story-system "${CHAPTER_GOAL}" --genre "${GENRE}" --chapter {chapter_num} --persist --emit-runtime-contracts --format both
```

### Step 3：按需加载参考

| Trigger | Reference |
|---------|-----------|
| always | `../../references/shared/core-constraints.md` |
| always | `../../references/review-schema.md` |
| 审查涉及爽点或钩子 | `../../references/shared/cool-points-guide.md` |
| 审查涉及多线交织 | `../../references/shared/strand-weave-pattern.md` |
| blocking issue 需用户裁决 (Step 8) | `../../references/review/blocking-override-guidelines.md` |

### Step 4：加载投影状态与待审正文

```bash
cat "${PROJECT_ROOT}/.webnovel/state.json"
```

确认当前章节号与对应正文文件；缺正文或缺兼容状态文件立即阻断。

### Step 5：调用统一审查 Agent

必须通过 `Agent` 工具调用 `reviewer`。审查方法与维度细则由 reviewer 自带，本 Skill 不展开。

```text
Agent(
  subagent_type: "webnovel-writer:reviewer",
  prompt: "chapter={chapter_num}; chapter_file={chapter_file}; project_root=${PROJECT_ROOT}; scripts_dir=${SCRIPTS_DIR}。严格输出 reviewer schema JSON，不评分，不口头总结。"
)
```

reviewer 返回后，主流程把严格 JSON 写入 `${PROJECT_ROOT}/.webnovel/tmp/review_results.json`（reviewer 不持 Write，是这份 artifact 的非写入方）。

### Step 6：生成报告并落库

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" review-pipeline \
  --chapter {chapter_num} \
  --review-results "${PROJECT_ROOT}/.webnovel/tmp/review_results.json" \
  --metrics-out "${PROJECT_ROOT}/.webnovel/tmp/review_metrics.json" \
  --report-file "审查报告/第{chapter_num}章审查报告.md" \
  --save-metrics
```

`review-pipeline --save-metrics` 同时完成报告生成、`review_metrics.json` 输出、`review_metrics` 表写入。阻断判断以 review_results 中的 `blocking=true` 为准。

### Step 7：写入兼容审查记录

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" update-state -- --add-review "{chapter_num}-{chapter_num}" "审查报告/第{chapter_num}章审查报告.md"
```

兼容投影 / read model，不是写后事实真源。

### Step 8：处理阻断

存在任意 `blocking=true` 问题时，用 `AskUserQuestion` 让用户裁决：

- 立即修复：输出返工清单，仅在用户明确授权下做最小修改。
- 仅保存报告，稍后处理：保留报告与指标记录，结束流程。

## 成功标准

1. 已解析真实书项目根。
2. 已通过 `reviewer` 输出结构化问题 JSON，落盘到 `.webnovel/tmp/review_results.json`。
3. 审查报告已生成，`review_metrics` 已写入 `index.db`，`review_metrics.json` 已输出。
4. 审查记录已写入 `.webnovel/state.json` 兼容投影。
5. 存在阻断问题时，用户已明确选择处理策略。
