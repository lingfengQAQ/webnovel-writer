# Webnovel Write - Workflow Details

## Contents
- Step 1.5 章节设计
- Step 2B 风格适配器
- Step 3 审查模板
- Step 4 润色硬规则与清单
- Step 5 债务与利息开关

## Step 1.5 章节设计（标准/关键章建议执行）

**加载参考**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/style-variants.md"
cat "${CLAUDE_PLUGIN_ROOT}/references/reading-power-taxonomy.md"
cat "${CLAUDE_PLUGIN_ROOT}/references/genre-profiles.md"
```

**输出结构**:
- 核心冲突一句话
- 开头类型（冲突/悬疑/动作/对话/氛围）
- 情绪节奏（低→高/高→低/低→高→低/平稳）
- 信息密度（low/medium/high）
- 是否过渡章（true/false）
- 追读力设计：钩子类型/强度、微兑现清单、爽点模式

**差异化检查**:
- 钩子类型避免与最近3章重复
- 开头类型避免与最近3章重复
- 爽点模式避免与最近5章过度重复

如必须重复，记录 Override 理由并给出差异化执行方式。

## Step 2B 风格适配器（fast/minimal 可跳过）

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/style-adapter.md"
```

目标：不改剧情，只提升网文口感与张力。

**执行清单（网文增强）**:
- 保证章首300字内交代“目标 + 阻力”。
- 按 600-900 字间隔埋入微兑现，避免长段无反馈。
- 章内至少出现1次可量化变化（关系/资源/风险/地位）。
- 章末钩子优先“选择钩/危机钩”，并与下章目标可衔接。
- 如为直播/电竞题材，增加“外部反馈（弹幕/舆论/比分）-> 主角决策”链路。

## Step 3 审查模板

**审查汇总表格**:
```
┌─────────────────────────────────────────────────┐
│ 审查汇总 - 第 {chapter_num} 章                    │
├──────────────────────┬───────────┬──────────────┤
│ Agent                │ 结果      │ 关键问题数    │
├──────────────────────┼───────────┼──────────────┤
│ consistency-checker  │ PASS/FAIL │ {N}          │
│ continuity-checker   │ PASS/FAIL │ {N}          │
│ ooc-checker          │ PASS/FAIL │ {N}          │
│ reader-pull-checker  │ PASS/FAIL │ {N}          │
│ high-point-checker   │ PASS/FAIL │ {N}          │
│ pacing-checker       │ PASS/FAIL │ {N}          │
├──────────────────────┴───────────┴──────────────┤
│ critical issues: {N}  |  high issues: {N}       │
│ 是否可进入润色: {是/否}                           │
└─────────────────────────────────────────────────┘
```

**审查指标 JSON**:
```json
{
  "start_chapter": {chapter_num},
  "end_chapter": {chapter_num},
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
  "report_file": "",
  "notes": ""
}
```

保存审查指标：
```bash
python -m data_modules.index_manager save-review-metrics --data '{...}' --project-root "."
```

## Step 4 润色硬规则与清单

**硬规则（不满足需记录 deviation）**:
- 开头 120 字出现冲突/风险/强情绪
- 每 800-1200 字至少一次局面变化
- 结尾 80-150 字设置钩子
- 对话每句带意图
- 连续 400 字纯解释 → 必须打散

**AI 痕迹提醒（出现就改写）**:
- “首先/其次/最后”
- “综合以上/值得注意的是”
- 过多“因此/所以/然而”

**简版清单**:
- [ ] critical/high 问题已修复或记录 deviation
- [ ] 硬规则检查完成
- [ ] AI 痕迹已检查
- [ ] 未违反润色红线

## Step 5 债务与利息开关

- 默认不计算利息。
- 仅在“开启债务追踪”或用户明确要求时执行：

```bash
python -m data_modules.index_manager accrue-interest --chapter {chapter_num} --project-root "."
```
