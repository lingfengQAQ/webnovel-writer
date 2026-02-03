---
name: webnovel-review
description: Reviews chapter quality using 6 specialized checkers (including reader-pull) and generates comprehensive reports. Activates when user requests chapter review or /webnovel-review.
allowed-tools: Read Grep Write Edit Bash Task AskUserQuestion
---

# Quality Review Skill

## Workflow Checklist

Copy and track progress:

```
质量审查进度：
- [ ] Step 1: 加载核心约束 (cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/core-constraints.md")
- [ ] Step 2: 加载爽点标准 (cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/cool-points-guide.md")
- [ ] Step 3: 加载节奏标准 (cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/strand-weave-pattern.md")
- [ ] Step 4: 加载常见错误 (cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/common-mistakes.md")
- [ ] Step 5: 加载项目状态 (cat .webnovel/state.json)
- [ ] Step 6: 确认上下文充足
- [ ] Step 7: 调用 6 个检查员 (并行 Task)
- [ ] Step 8: 生成审查报告
- [ ] Step 9: 处理关键问题
```

---

## Step 1: 加载核心约束（必须执行）

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/core-constraints.md"
```

## Step 2: 加载爽点标准（必须执行）

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/cool-points-guide.md"
```

## Step 3: 加载节奏标准（必须执行）

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/strand-weave-pattern.md"
```

## Step 4: 加载常见错误

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/common-mistakes.md"
```

**可选加载节奏控制参考**：
```bash
# 如需深入分析节奏控制，可加载此文件
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-review/references/pacing-control.md"
```

## Step 5: 加载项目状态

```bash
cat .webnovel/state.json
```

## Step 6: 确认上下文充足

**检查清单**：
- [ ] 三大定律已理解
- [ ] 爽点密度要求已理解
- [ ] Strand Weave 规范已理解
- [ ] 常见错误模式已了解
- [ ] state.json 可用于一致性检查
- [ ] 待审查章节已确定

**如有缺失 → 返回对应 Step**

## Step 7: 调用 6 个检查员（并行）

**使用 Task 工具并行调用 6 个专职检查员**：

调用格式示例（所有检查员并行执行）：
- 调用 `high-point-checker` 子代理：审查章节 {range}，重点检查爽点密度和多样性
- 调用 `consistency-checker` 子代理：审查章节 {range}，重点检查设定违规 vs state.json
- 调用 `pacing-checker` 子代理：审查章节 {range}，重点检查 Strand 分布
- 调用 `ooc-checker` 子代理：审查章节 {range}，重点检查角色行为一致性
- 调用 `continuity-checker` 子代理：审查章节 {range}，重点检查时间线和剧情连贯
- 调用 `reader-pull-checker` 子代理：审查章节 {range}，重点检查章末钩子与追读动机

**注意**：Claude 会自动根据描述匹配并调用对应的子代理

**汇总要求**：统计 critical / high / medium / low 的问题数量（用于趋势记录）

## Step 8: 生成审查报告

保存到: `审查报告/第{start}-{end}章审查报告.md`

**报告结构**：

```markdown
# 第 {start}-{end} 章质量审查报告

## 📊 综合评分

| 维度 | 评分 | 状态 |
|------|------|------|
| 爽点密度 | X/10 | ✅/🟡/🟠/🔴 |
| 设定一致性 | X/10 | ... |
| 节奏控制 | X/10 | ... |
| 人物塑造 | X/10 | ... |
| 连贯性 | X/10 | ... |
| 追读力 | X/10 | ... |
| **总评** | **X/60** | **等级** |

## 📋 修改优先级

### 🔴 高优先级（必须修改）
{检查员发现的问题}

### 🟠 中优先级（建议修改）
{检查员发现的问题}

### 🟡 低优先级（可选优化）
{检查员发现的问题}

## 📈 改进建议
{具体可行的建议}
```

**评分标准**：
- 9-10: 优秀
- 7-8: 良好
- 5-6: 及格
- <5: 不及格（高流失风险）

**审查指标 JSON（必须输出，用于趋势统计）**：
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

**保存审查指标**：
```bash
python -m data_modules.index_manager save-review-metrics \
  --data '{...}' \
  --project-root "."
```

## Step 9: 处理关键问题

如发现 🔴 问题，询问用户：
- A) 立即修复（推荐）
- B) 保存报告稍后处理

```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/update_state.py" \
  --add-review "{start}-{end}" "审查报告/第{start}-{end}章审查报告.md"
```
