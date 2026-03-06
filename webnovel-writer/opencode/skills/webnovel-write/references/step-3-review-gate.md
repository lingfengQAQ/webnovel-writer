# Step 3 Review Gate

## 调用约束（硬规则）

- 必须使用 `Task` 调用审查 subagent，禁止主流程直接内联“自审结论”。
- 审查任务可并行发起，必须在全部返回后统一聚合。
- `overall_score` 必须来自聚合结果，不可主观估分。
- 单章写作场景下，统一传入：`{chapter, chapter_file, project_root}`。

## 审查路由模式

- 标准/`--fast`：`auto` 路由（核心 3 个 + 条件命中）。
- `--minimal`：固定核心 3 个（不启用条件审查器）。

核心审查器（始终执行）：
- `consistency-checker`
- `continuity-checker`
- `ooc-checker`

条件审查器（仅 `auto` 命中时执行）：
- `reader-pull-checker`
- `high-point-checker`
- `pacing-checker`

## Auto 路由判定信号

输入信号来源：
1. Step 1.5 合同（是否过渡章、追读力设计、核心冲突）。
2. 本章正文（战斗/反转/高光/章末未闭合问题等信号）。
3. 大纲标签（关键章/高潮章/卷末章/转场章）。
4. 最近章节节奏（连续主线、情感线断档、世界观线断档）。

路由规则：
- `reader-pull-checker`：当满足任一条件时启用
  - 非过渡章；
  - 有明确未闭合问题/期待锚点；
  - 用户显式要求“追读力审查”。
- `high-point-checker`：当满足任一条件时启用
  - 关键章/高潮章/卷末章；
  - 正文出现战斗、反杀、打脸、身份揭露、大反转等高光信号。
- `pacing-checker`：当满足任一条件时启用
  - 章号 >= 10；
  - 最近章节存在明显节奏失衡风险；
  - 用户显式要求“节奏审查”。

## Task 调用模板（示意）

```text
selected = ["consistency-checker", "continuity-checker", "ooc-checker"]

if mode != "minimal":
  if trigger_reader_pull: selected.append("reader-pull-checker")
  if trigger_high_point: selected.append("high-point-checker")
  if trigger_pacing: selected.append("pacing-checker")

parallel Task(agent, {chapter, chapter_file, project_root}) for agent in selected
```

## 输出契约（统一）

每个 checker 返回值必须遵循 `${OPENCODE_PLUGIN_ROOT}/references/checker-output-schema.md`：
- 必含：`agent`、`chapter`、`overall_score`、`pass`、`issues`、`metrics`、`summary`
- 允许扩展字段（如 `hard_violations`、`soft_suggestions`），但不得替代必填字段

聚合输出最小字段：
- `chapter`（单章）
- `start_chapter`、`end_chapter`（单章时二者都等于 `chapter`）
- `selected_checkers`
- `overall_score`
- `severity_counts`
- `critical_issues`
- `issues`（扁平化聚合）
- `dimension_scores`（按已启用 checker 计算）

## 汇总输出模板

```text
审查汇总 - 第 {chapter_num} 章
- selected_checkers: {list}
- critical issues: {N}
- high issues: {N}
- overall_score: {score}
- 可进入润色: {是/否}
```

## 审查指标落库（必做）

```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" index save-review-metrics --data '@review_metrics.json'
```

## 进入 Step 4 前闸门

- `overall_score` 已生成。
- `save-review-metrics` 已成功。
- 审查报告中的 `issues`、`severity_counts` 可被 Step 4 直接消费。
- **时间线闸门（新增）**：若存在 `TIMELINE_ISSUE` 且 `severity >= high`，禁止进入 Step 4/5，必须先修复。

### 时间线闸门规则

**Hard Block（必须修复才能继续）**：
- `TIMELINE_ISSUE` + `severity = critical`（倒计时算术错误）
- `TIMELINE_ISSUE` + `severity = high`（事件先后矛盾/年龄冲突/时间回跳/大跨度无过渡）

**Soft Warning（建议修复但可继续）**：
- `TIMELINE_ISSUE` + `severity = medium`（时间锚点缺失）
- `TIMELINE_ISSUE` + `severity = low`（轻微时间模糊）

**闸门判定逻辑**：
```text
timeline_issues = filter(issues, type="TIMELINE_ISSUE")
critical_timeline = filter(timeline_issues, severity in ["critical", "high"])

if len(critical_timeline) > 0:
    BLOCK: "存在 {len(critical_timeline)} 个严重时间线问题，必须修复后才能进入润色步骤"
    for issue in critical_timeline:
        print(f"- 第{issue.chapter}章: {issue.description}")
    return BLOCKED
else:
    PASS: "时间线检查通过"
```

**修复指引**：
- 倒计时错误 → 修正倒计时推进，确保 D-N → D-(N-1) 连续
- 时间回跳 → 添加闪回标记，或调整时间锚点
- 大跨度无过渡 → 添加时间过渡句/段，或插入过渡章
- 事件先后矛盾 → 调整事件发生顺序或添加时间跳跃说明
