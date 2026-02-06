---
name: webnovel-review
description: Reviews chapter quality with checker agents and generates reports. Use when the user asks for a chapter review or runs /webnovel-review.
allowed-tools: Read Grep Write Edit Bash Task AskUserQuestion
---

# Quality Review Skill

## Project Root Guard（必须先确认）

- 必须在项目根目录执行（需存在 `.webnovel/state.json`）
- 若当前目录不存在该文件，先询问用户项目路径并 `cd` 进入
- 进入后设置变量：`$PROJECT_ROOT = (Resolve-Path ".").Path`

## Review depth

- **Core (default)**: consistency / continuity / ooc / reader-pull
- **Full (关键章/用户要求)**: core + high-point + pacing

## Step 1: 加载参考（按需）

## Reference Loading Levels (strict, lazy)

- L0: 先确定审查深度（Core / Full），再加载参考。
- L1: 每次只加载当前深度的最小文件。
- L2: 仅在问题定位需要时加载扩展参考。

### L1 (minimum)
- Core 必读：`references/core-constraints.md`

### L2 (conditional)
- Full 或节奏/爽点相关问题时加载：
  - `references/cool-points-guide.md`
  - `references/strand-weave-pattern.md`
- 仅在返工建议需要时加载：
  - `references/common-mistakes.md`
  - `references/pacing-control.md`

**必读**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/core-constraints.md"
```

**建议（Full 或需要时）**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/cool-points-guide.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/strand-weave-pattern.md"
```

**可选**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/common-mistakes.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/pacing-control.md"
```

## Step 2: 加载项目状态（若存在）

```bash
cat "$PROJECT_ROOT/.webnovel/state.json"
```

## Step 3: 并行调用检查员（Task）

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

保存审查指标：
```bash
python -m data_modules.index_manager save-review-metrics --data '{...}' --project-root "."
```

## Step 5: 处理关键问题

如发现 critical 问题，询问用户：
- A) 立即修复（推荐）
- B) 仅保存报告，稍后处理
