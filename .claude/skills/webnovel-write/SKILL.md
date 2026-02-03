---
name: webnovel-write
description: Writes webnovel chapters (3000-5000 words). Use when the user asks to write a chapter or runs /webnovel-write. Runs context, drafting, review, polish, and data extraction.
allowed-tools: Read Write Edit Grep Bash Task
---

# Chapter Writing Skill

## Project Root Guard（必须先确认）

- 必须在项目根目录执行（需存在 `.webnovel/state.json`）
- 若当前目录不存在该文件，先询问用户项目路径并 `cd` 进入
- 进入后设置变量：`$PROJECT_ROOT = (Resolve-Path ".").Path`

## Default flow

1. Context Agent → 创作任务书
2. 写作 → 3000-5000字正文
3. 审查 → 核心4个Checker
4. 润色 → 修复问题
5. Data Agent → 提取数据
6. Git → 备份

## Modes

- `/webnovel-write`：标准流程（含核心4个Checker）
- `/webnovel-write --fast`：跳过 Step 2B，其余同标准
- `/webnovel-write --minimal`：跳过 Step 2B，仅运行 consistency + continuity + ooc（不产出追读力数据）

## Step 1: Context Agent

使用 Task 工具调用 `context-agent`：

```
调用 context-agent，参数：
- chapter: {chapter_num}
- project_root: {PROJECT_ROOT}
- storage_path: .webnovel/
- state_file: .webnovel/state.json
```

**缺失处理**：大纲或 state.json 不存在时，提示用户先初始化。

**要求**：创作任务书必须包含“反派层级”（从大纲/章纲提取）。

## Step 2: 写作

- 遵循三大原则：大纲即法律 / 设定即物理 / 新实体需记录。
- 输出纯正文到 `正文/第{NNNN}章.md`。
- 章节内容需体现本章“反派层级”要求（无反派层级时标注“无”）。
- 开写前加载核心约束：

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/core-constraints.md"
```

场景写作与风格参考按需加载（见 `references/workflow-details.md`）。

## Step 3: 审查

**默认核心4个 Checker**：
- `consistency-checker`
- `continuity-checker`
- `ooc-checker`
- `reader-pull-checker`（用于写入追读力数据）

**关键章/卷末/用户明确要求**：额外运行
- `high-point-checker`
- `pacing-checker`

审查汇总表格与审查指标 JSON 模板见 `references/workflow-details.md`。

## Step 4: 润色

加载润色参考：

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/polish-guide.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/writing/typesetting.md"
```

先修复 critical/high，再处理 medium/low。

## Step 5: Data Agent

使用 Task 工具调用 `data-agent`：

```
调用 data-agent，参数：
- chapter: {chapter_num}
- chapter_file: "正文/第{NNNN}章.md"
- review_score: {overall_score from Step 3}
- project_root: {PROJECT_ROOT}
- storage_path: .webnovel/
- state_file: .webnovel/state.json
```

债务利息计算默认关闭，仅在开启债务追踪或用户明确要求时执行（见 `references/workflow-details.md`）。

## Step 6: Git 备份

```bash
git add . && git commit -m "Ch{chapter_num}: {title}"
```

## 详细流程与模板（按需加载）

需要以下内容时，读取：
- `references/workflow-details.md`
  - Step 1.5 章节设计（钩子/爽点/微兑现/差异化）
  - 审查汇总表格 + 审查指标 JSON 模板
  - 润色硬规则 + 检查清单
  - 债务/Override 处理与利息开关

Step 1.5 需要时可直接加载（避免深层引用）：
- `references/style-variants.md`
- `.claude/references/reading-power-taxonomy.md`
- `.claude/references/genre-profiles.md`
