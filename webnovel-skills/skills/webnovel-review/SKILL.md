---
name: webnovel-review
description: 使用审查 Agent 评估章节质量，生成报告并写回审查指标。
allowed-tools: Read Grep Write Edit Bash Agent AskUserQuestion
---

# Quality Review Skill

## 目标

- 解析真实书项目根目录，按统一流程完成章节审查。
- 调用统一 `reviewer` 生成结构化问题列表与审查报告。
- 把审查指标写入 `index.db`，并把审查记录写入 `.webnovel/state.json` 兼容投影，主链事实仍以 review contract 与 accepted `CHAPTER_COMMIT` 为准。
- 审查时优先依据 `.story-system/reviews/chapter_{NNN}.review.json` 与 latest accepted `CHAPTER_COMMIT` 判断主链事实。
- 若存在关键问题，明确交给用户决定是否立即返工。

## 常见误区

- ❌ 没看 reviewer 原始 JSON 就直接口头总结
- ❌ 有 blocking issue 仍将流程视为通过
- ❌ 把 report 文件生成等同于已落库（`save-review-metrics` 未跑）
- ❌ 主流程伪造 `overall_score` 或审查结论
- ❌ 按需参考一次性全部读完

## 优先级链

1. 用户明确要求（最高）
2. `blocking=true` 硬门槛
3. 项目私有约束（设定集、已有剧情）
4. skill 默认流程
5. reference 建议（最低）

## 决策树入口

- 若项目根不合法或缺少 `.webnovel/state.json` → **阻断**
- 若正文文件不存在 → **阻断**
- 若 reviewer 返回 `blocking=true` issue → 进入 Step 6 用户裁决
- 若所有 issue 均为非 blocking → 正常落库，流程结束

## 执行流程

### Step 1：解析项目根目录并建立环境变量

```bash
export WORKSPACE_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
export SKILL_ROOT="${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review"
export SCRIPTS_DIR="${CLAUDE_PLUGIN_ROOT}/scripts"
export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

若目标章缺少 runtime 合同，先补齐：

```bash
GENRE="$(python -X utf8 -c "import json,sys; s=json.load(open('${PROJECT_ROOT}/.webnovel/state.json',encoding='utf-8')); print(s.get('project',{}).get('genre',''))")"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" \
  story-system "${CHAPTER_GOAL}" --genre "${GENRE}" --chapter {chapter_num} --persist --emit-runtime-contracts --format both
```

要求：
- `PROJECT_ROOT` 必须包含 `.webnovel/state.json`
- 任一关键目录不存在时立即阻断
- `CHAPTER_GOAL` 必须来自详细大纲真实目标；若 `chapter_brief.meta.query` 仍是 `{章纲目标}` / `第N章章纲目标`，按系统问题记录。
- 中高严重度 `ai_flavor` issue 会由 review-pipeline 回流到 `.story-system/anti_patterns.json`，作为后续写章避雷模式。

### Step 2：按需加载参考资料

#### md 必读

| Trigger | Reference |
|---------|-----------|
| always | `../../references/shared/core-constraints.md` |
| always | `../../references/review-schema.md` |

#### md 按需

| Trigger | Reference |
|---------|-----------|
| 审查涉及爽点或钩子分析 | `../../references/shared/cool-points-guide.md` |
| 审查涉及多线交织 | `../../references/shared/strand-weave-pattern.md` |
| ai_flavor issue ≥ 3 | `../../skills/webnovel-write/references/anti-ai-guide.md` |
| blocking issue 需用户决策 (Step 6) | `../../references/review/blocking-override-guidelines.md` |

### Step 3：加载项目投影状态与待审正文

```bash
cat "${PROJECT_ROOT}/.webnovel/state.json"
```

要求：
- 明确当前章节号与对应正文文件
- 若缺少正文或兼容状态文件，立即阻断

### Step 4：调用统一审查 Agent

必须通过 `Agent` 工具调用 `reviewer`，禁止主流程伪造结论或口头总结代替 subagent 输出。

```text
Agent(
  subagent_type: "webnovel-writer:reviewer",
  prompt: "chapter={chapter_num}; chapter_file={chapter_file}; project_root=${PROJECT_ROOT}; scripts_dir=${SCRIPTS_DIR}。严格输出 reviewer schema JSON，并保存到 ${PROJECT_ROOT}/.webnovel/tmp/review_results.json。"
)
```

输入：
- `chapter`
- `chapter_file`
- `project_root`
- `scripts_dir`

输出约束：
- 只输出 JSON
- 每个 issue 必须有 `evidence`
- 不输出 `overall_score`

中间产物约定：
- reviewer 原始结果：`${PROJECT_ROOT}/.webnovel/tmp/review_results.json`
- 落库指标：`${PROJECT_ROOT}/.webnovel/tmp/review_metrics.json`

### Step 5：生成审查报告并落库

报告保存到：`审查报告/第{chapter_num}章审查报告.md`

报告结构：
- 总览（问题数 / 阻断数）
- 阻断问题
- 其他问题
- 修复方向

标准文件流：

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" review-pipeline \
  --chapter {chapter_num} \
  --review-results "${PROJECT_ROOT}/.webnovel/tmp/review_results.json" \
  --metrics-out "${PROJECT_ROOT}/.webnovel/tmp/review_metrics.json" \
  --report-file "审查报告/第{chapter_num}章审查报告.md"

python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" index save-review-metrics \
  --data "@${PROJECT_ROOT}/.webnovel/tmp/review_metrics.json"
```

要求：
- `review-pipeline` 生成的 `review_metrics.json` 必须可直接写入 `review_metrics` 表
- 阻断判断以 reviewer 原始结果中的 `blocking=true` 为准

### Step 6：写入兼容审查记录并处理阻断

先写入兼容审查记录（read-model/projection，不是写后事实真源）：

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" update-state -- --add-review "{chapter_num}-{chapter_num}" "审查报告/第{chapter_num}章审查报告.md"
```

如存在任意 `blocking=true` 问题，必须使用 `AskUserQuestion` 询问用户：
- 立即修复
- 仅保存报告，稍后处理

若用户选择立即修复：
- 输出返工清单
- 在用户明确授权下做最小修改

若用户选择稍后处理：
- 保留报告与指标记录，结束流程

## 成功标准

1. 已解析真实书项目根目录。
2. 已通过 `reviewer` 输出结构化问题 JSON。
3. 审查报告已生成。
4. `review_metrics` 已写入 `index.db`。
5. 审查记录已写入 `.webnovel/state.json` 兼容投影。
6. 如存在阻断问题，用户已明确选择处理策略。
