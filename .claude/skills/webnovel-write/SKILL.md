---
name: webnovel-write
description: Writes webnovel chapters (3000-5000 words) using v5.4 architecture. Context Agent outputs creative brief, writer produces pure text, review agents report issues, webnovel polish fixes problems, Data Agent extracts entities and records hooks/patterns.
allowed-tools: Read Write Edit Grep Bash Task
---

# Chapter Writing Skill

## Workflow Checklist

⚠️ **强制要求**: 开始写作前，**必须复制以下清单**到回复中并逐项勾选。跳过任何步骤视为工作流不完整。

```
章节创作进度 (v5.4)：
- [ ] Step 1: Context Agent 搜集上下文（创作任务书）
- [ ] Step 1.5: 章节设计（开头/钩子/爽点模式）
- [ ] Step 2A: 生成粗稿（剧情正确、场面成立）
- [ ] Step 2B: 风格适配器（网文化改写，剧情不变）
- [ ] Step 3: 审查 (6个Agent并行，输出汇总表格)
- [ ] Step 4: 网文化润色（基于审查报告）
- [ ] Step 5: Data Agent 处理数据链
- [ ] Step 6: Git 备份
```

**工作流规则**:
1. 每完成一个 Step，立即更新 TodoWrite 状态
2. Step 之间的验证必须通过才能进入下一步
3. 如遇阻断，记录 deviation 但不可跳过

---

## 模式说明（可选）

```
/webnovel-write --mode fast    # 快速模式：跳过 Step 2B
/webnovel-write --mode minimal # 极简模式：跳过 Step 2B + 仅运行3个核心 checker
```

**模式影响**:
- **标准模式**: 完整执行 Step 1-6
- **快速模式**: 跳过 Step 2B（风格适配），其余照常
- **极简模式**: 跳过 Step 2B + 仅运行 3 个核心审查（consistency / continuity / ooc）

---

## Step 1: Context Agent 搜集上下文

**调用 Context Agent**:

使用 Task 工具调用 `context-agent` subagent：

```
调用 context-agent，参数：
- chapter: {chapter_num}
- project_root: {PROJECT_ROOT}
- storage_path: .webnovel/
- state_file: .webnovel/state.json
```

**Agent 自动完成**:
1. 读取本章大纲，分析需要什么信息
2. 读取 state.json 获取主角状态快照
3. 查询 index.db (v5.1+ schema) 召回实体/别名/关系
4. 调用 data_modules.rag_adapter 语义检索
5. Grep 设定集搜索相关设定
6. 评估伏笔紧急度
7. 选择风格样本
8. 组装**创作任务书**（人话版）

**输出**：创作任务书（非 JSON），包含：
- 本章核心任务（冲突一句话、必须完成、绝对不能）
- 接住上章（上章钩子、读者期待、开头必须）
- 出场角色（状态、动机、情绪底色、说话风格、红线）
- 场景与力量约束（地点、可用/禁用能力）
- 风格指导（本章类型、参考样本、最近模式、本章建议）
- 伏笔管理（必须处理、可选提及）
- 连贯性检查点（时间、位置、情绪）
- 章末钩子设置（建议类型、禁止事项）

**失败处理**:
- 如果大纲不存在 → 提示用户先创建大纲
- 如果 state.json 不存在 → 提示用户初始化项目

---

## Step 1.5: 章节设计（v5.3 引入，v5.4 沿用）

**目标**: 在写作前明确本章结构与变体，避免模式重复，设计追读力策略。

### 1.5.1 加载必要参考

**加载变体池（必须执行）**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/style-variants.md"
```

**加载追读力分类标准（必须执行）**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/references/reading-power-taxonomy.md"
```

**加载题材Profile（必须执行）**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/references/genre-profiles.md"
```
根据 `state.json → project.genre` 选择对应题材的配置。

### 1.5.2 章节结构设计

**输出内容**:
- 核心冲突一句话
- 开头类型（冲突开场/悬疑开场/动作开场/对话开场/氛围开场）
- 情绪节奏（低→高/高→低/低→高→低/平稳）
- 信息密度（low/medium/high）
- 是否过渡章（true/false）

### 1.5.3 追读力设计块（v5.3 引入）

**必须输出以下设计**:

```markdown
## 追读力设计

### 钩子策略
- 章末钩子类型：{危机钩/悬念钩/情绪钩/选择钩/渴望钩}
- 目标强度：{strong/medium/weak}
- 钩子描述：{一句话概括钩子内容}

### 爽点规划
- 主爽点模式：{8种模式之一}
- 爽点结构：{30/40/30分布描述}
- 备选模式：{如主模式无法实现}

### 微兑现清单（题材要求：≥{N}个）
1. {类型}: {描述}
2. {类型}: {描述}
...

### 差异化检查
- 最近3章钩子类型：{列表}
- 最近3章开头类型：{列表}
- 最近5章爽点模式：{列表}
- 本章差异化点：{说明如何避免重复}

### 债务状态（如有）
- 当前债务余额：{amount}
- 逾期债务：{count}
- 本章偿还计划：{如适用}
```

### 1.5.4 差异化检查

**执行查询**:
- 读取 `state.json → chapter_meta` 或调用 `index.db` 查询最近章节
- 对比本章设计与历史模式

**避免规则**:
- 钩子类型：避免与最近3章重复
- 开头类型：避免与最近3章重复
- 爽点模式：避免与最近5章过度重复（同一模式≤40%）

**如必须重复**:
- 记录Override理由
- 规划差异化执行方式（如同为装逼打脸，但不同场景/规模/参与者）

### 1.5.5 过渡章特殊处理

如本章标记为过渡章：
- 钩子强度可降为 weak
- 微兑现数量可降至 profile.transition_min
- 必须记录 Override Contract（如违反软建议）
- 过渡章不可连续超过 profile.transition_max_consecutive

---

## Step 2A: 生成粗稿（剧情正确）

**字数**: 3000-5000 字（短章 <2000 字需声明）

**核心原则**:
- **大纲即法律**: 100% 执行大纲
- **设定即物理**: 实力 ≤ 上下文包中的设定
- **纯正文**: 不需要写任何 XML 标签

**加载核心约束**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/core-constraints.md"
```

**按需加载场景参考**:

| 场景类型 | 判断条件 | 执行命令 |
|---------|---------|---------|
| 战斗戏 | 大纲含打斗/对决/追逐 | `cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/writing/combat-scenes.md"` |
| 情感戏 | 大纲含告白/冲突/羁绊 | `cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/writing/emotion-psychology.md"` |
| 对话密集 | 预估对话 >50% | `cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/writing/dialogue-writing.md"` |
| 复杂场景 | 新地点/大场面描写 | `cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/writing/scene-description.md"` |
| 欲念描写 | 大纲含暧昧/亲密/情欲场景 | `cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/writing/desire-description.md"` |

**可选加载题材风格参考**（用户指定时加载）:
```bash
# 如需特定题材的写作风格参考，可按需加载 genres 目录下的对应文件
# 可用题材目录:
#   xuanhuan/          - 玄幻修仙
#   dog-blood-romance/ - 狗血言情
#   zhihu-short/       - 知乎短篇
#   period-drama/      - 古言/宫斗
#   realistic/         - 现实题材
#   rules-mystery/     - 规则怪谈/推理
# 示例: cat "${CLAUDE_PLUGIN_ROOT}/genres/xuanhuan/power-systems.md"
```

**输出格式**:
- Markdown 文件: `正文/第{NNNN}章.md`
- **不追加摘要**（摘要由 Data Agent 独立写入 `.webnovel/summaries/`）

---

## Step 2B: 风格适配器（网文化改写）

**跳过条件**: fast / minimal 模式跳过

**加载风格适配器**:
```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/style-adapter.md"
```

**目标**:
- 保持剧情不变
- 提升网文口感（短句、动作、对白张力、情绪反应）
- 强化开头冲突与章末钩子

---

## Step 3: 审查

⚠️ **强制要求**: 必须在**同一条消息**中并行调用全部审查 Agent（除非 minimal 模式）。

**执行命令（不可修改）**:

在一条消息中发送 Task 工具调用，每个调用需传入以下公共参数：
- project_root: {PROJECT_ROOT}
- storage_path: .webnovel/
- state_file: .webnovel/state.json
- chapter_file: "正文/第{NNNN}章.md"

**标准/快速模式：6 个 Agent**

| # | subagent_type | 必须 | 说明 |
|---|---------------|------|------|
| 1 | `high-point-checker` | ✅ | 爽点密度检查 |
| 2 | `consistency-checker` | ✅ | 设定一致性检查 |
| 3 | `pacing-checker` | ✅ | Strand 节奏检查 |
| 4 | `ooc-checker` | ✅ | 人物 OOC 检查 |
| 5 | `continuity-checker` | ✅ | 连贯性检查 |
| 6 | `reader-pull-checker` | ✅ | 追读力检查 |

**极简模式：仅 3 个核心 Agent**
- `consistency-checker`
- `continuity-checker`
- `ooc-checker`

**验证**: 收到全部报告后，**必须输出以下汇总表格**：

```
┌─────────────────────────────────────────────────┐
│ 审查汇总 - 第 {chapter_num} 章                    │
├──────────────────────┬───────────┬──────────────┤
│ Agent                │ 结果      │ 关键问题数    │
├──────────────────────┼───────────┼──────────────┤
│ high-point-checker   │ PASS/FAIL │ {N}          │
│ consistency-checker  │ PASS/FAIL │ {N}          │
│ pacing-checker       │ PASS/FAIL │ {N}          │
│ ooc-checker          │ PASS/FAIL │ {N}          │
│ continuity-checker   │ PASS/FAIL │ {N}          │
│ reader-pull-checker  │ PASS/FAIL │ {N}          │
├──────────────────────┴───────────┴──────────────┤
│ critical issues: {N}  |  high issues: {N}       │
│ 是否可进入润色: {是/否}                           │
└─────────────────────────────────────────────────┘
```

**审查指标 JSON（必须输出，用于趋势统计）**：
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

**保存审查指标**：
```bash
python -m data_modules.index_manager save-review-metrics \
  --data '{...}' \
  --project-root "."
```

**Only proceed to Step 4 when:**
1. 已收到全部审查报告（或 minimal 模式仅 3 份）
2. 已输出汇总表格

> **Minimal 模式**: 汇总表格仅列出已执行的 3 个 Agent。

---

## Step 4: 网文化润色（基于审查报告）

⚠️ **强制要求**: 必须按以下顺序执行全部子步骤（4.0-4.4），不可跳过。

### 4.0 加载润色指南（必须先执行）

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/polish-guide.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-write/references/writing/typesetting.md"
```

### 4.1 修复审查问题

| 严重度 | 处理方式 |
|-------|---------|
| critical | **必须修复**，否则记录 deviation |
| high | 优先修复 |
| medium | 建议修复 |
| low | 可选修复 |

### 4.2 网文口感硬规则检查

- 开头 120 字必须出现冲突/风险/强情绪
- 每 800-1200 字至少一次局面变化
- 结尾 80-150 字设置钩子
- 对话每句必须带意图
- 连续 400 字纯解释 → 必须打散

### 4.3 AI 痕迹检测（辅助提醒）

**注意**: 词频统计仅作为提醒，不再作为硬性门槛。若明显超标，请修复并简要说明。

- 总结词：`综合|总之|由此可见|总而言之`
- 列举结构：`首先|其次|最后|第一|第二|第三`
- 学术词：`而言|某种程度上|本质上`
- 因果连词：`因为|所以|由于|因此`

### 4.4 输出检查清单（必须输出）

```
┌─────────────────────────────────────────────────┐
│ 润色检查清单 - 第 {chapter_num} 章               │
├─────────────────────────────────────────────────┤
│ [x] polish-guide.md 已加载                      │
│ [x] typesetting.md 已加载                       │
│ [x] critical issues 已修复: {是/否/无}          │
│ [x] high issues 已修复: {是/否/无}              │
├─────────────────────────────────────────────────┤
│ 网文口感检查:                                   │
│   - 开头120字冲突: {是/否}                       │
│   - 局面变化频率: {达标/偏少}                    │
│   - 章末钩子: {是/否}                            │
├─────────────────────────────────────────────────┤
│ AI痕迹提醒: {已检查/未检查}                      │
│ [x] 未违反润色红线                              │
│ 是否可进入 Data Agent: {是/否}                  │
└─────────────────────────────────────────────────┘
```

**Only proceed to Step 5 when:**
1. 已加载 polish-guide.md + typesetting.md
2. 已修复所有 critical/high issues（或记录 deviation）
3. 网文口感硬规则已达标（不足则记录 deviation）
4. 已输出检查清单

**输出**: 润色后的章节文件（覆盖原文件）

---

## Step 5: Data Agent 处理数据链

**调用 Data Agent**:

使用 Task 工具调用 `data-agent` subagent：

```
调用 data-agent，参数：
- chapter: {chapter_num}
- chapter_file: "正文/第{NNNN}章.md"
- review_score: {overall_score from Step 3}
- project_root: {PROJECT_ROOT}
- storage_path: .webnovel/
- state_file: .webnovel/state.json
```

**Agent 自动完成**:

1. **AI 实体提取**（Agent 内置，无需外部 LLM）
2. **实体消歧**（高/中/低置信度策略）
3. **写入存储**
   - 更新 state.json (精简状态 + chapter_meta)
   - 更新 index.db (实体/别名/状态变化/关系)
4. **AI 场景切片**（生成场景摘要）
5. **向量嵌入**（rag_adapter）
6. **风格样本评估**（review_score > 80）
7. **摘要分离存储**：写入 `.webnovel/summaries/ch{NNNN}.md`

**输出**:
```json
{
  "entities_appeared": 5,
  "entities_new": 1,
  "state_changes": 2,
  "scenes_chunked": 4,
  "uncertain": [...],
  "warnings": [...]
}
```

---

## Step 6: Git 备份

```bash
git add . && git commit -m "Ch{chapter_num}: {title}"
```

---

## 错误处理

### Context Agent 失败
```
⚠️ 上下文包生成失败
→ 检查大纲是否存在
→ 检查 state.json 是否初始化
→ 手动加载必要上下文后继续
```

### 审查发现严重问题
```
⚠️ 审查发现 critical 级别问题
→ 润色步骤必须修复
→ 如果无法修复，记录 deviation
```

### Data Agent 失败
```
⚠️ AI 提取失败
→ 记录 warning
→ 可选：手动添加关键实体
→ Git 备份仍然执行
```

---

## 成功标准

章节完成后，**必须输出最终验证报告**：

```
┌─────────────────────────────────────────────────┐
│ 章节完成验证 - 第 {chapter_num} 章               │
├─────────────────────────────────────────────────┤
│ 1. [x] 字数: {N}字 (3000-5000)                  │
│ 2. [x] 大纲执行: 100%                           │
│ 3. [x] 审查Agent: {6/6 or 3/3} 已调用           │
│ 4. [x] 审查汇总表格: 已输出                      │
│ 5. [x] polish-guide.md: 已加载                  │
│ 6. [x] 网文口感规则: 已检查                      │
│ 7. [x] 润色检查清单: 已输出                      │
│ 8. [x] Data Agent: 成功提取 {N} 个实体          │
│ 9. [x] summaries: 已生成 ch{NNNN}.md            │
│ 10.[x] Git: 已提交 ({commit_hash})              │
├─────────────────────────────────────────────────┤
│ 最终状态: {成功/有deviation}                     │
└─────────────────────────────────────────────────┘
```

**验证失败处理**:
- 如有任何项目未完成，记录 deviation 原因
- deviation 不阻断工作流，但必须记录
- 连续 3 章出现相同 deviation → 标记为系统问题
