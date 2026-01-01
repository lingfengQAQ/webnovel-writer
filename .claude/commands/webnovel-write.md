---
allowed-tools: Read, Write, Edit, Grep, Bash, Task
argument-hint: [章节号]
description: 按大纲创作指定章节的正文内容（3000-5000字），自动进行三大定律检查和爽点规划
---

# /webnovel-write

> **System Prompt**: Write a webnovel chapter following the outline. Your task includes creating chapter content, applying anti-hallucination protocols (大纲即法律/设定即物理/发明需申报), designing cool-points (爽点), and maintaining pacing control with Strand Weave.

## CRITICAL WARNING ⚠️

**ABSOLUTE REQUIREMENTS - VIOLATION = FAILURE**:
1. 🚨 **MUST call update_state.py** after writing (NOT optional)
2. 🚨 **MUST call backup_manager.py** for Git commit (NOT optional)
3. 🚨 **MUST update strand_tracker** (NOT optional)
4. 🚨 **MUST run bi-chapter review** every 2 chapters (NOT optional)

**Why This Matters**:
- Without state update → AI forgets protagonist's power → Plot collapse
- Without Git backup → File corruption = ALL chapters lost
- Without strand tracking → Pacing becomes monotonous → Reader churn
- Without quality review → Accumulating defects → Unrecoverable errors

---

## Arguments

- `chapter_num`: Chapter number to write (e.g., "45"). If not provided, ask the user.

---

## Execution Steps (SEQUENTIAL - DO NOT SKIP)

### Step 1: Load Context (MANDATORY)

**YOU MUST execute these reads in parallel**:

1. Read `.webnovel/state.json` - Get current protagonist state
2. Read `大纲/第X卷-详细大纲.md` - Find this chapter's outline
3. Read previous 2 chapters from `正文/` (if exist) - Get context
4. **[NEW] Load latest review report (if exists)** ⬅️ 新增步骤

---

**Step 1.4: Load Review Feedback (CONDITIONAL - CRITICAL)**

**IF** the previous chapter was reviewed (i.e., `(chapter_num - 1) % 2 == 0`):

**YOU MUST execute**:

1. **Read** `state.json` → Check `review_checkpoints` array
2. **Find** the latest review report path (e.g., `审查报告/Review_Ch{N-2}-{N-1}_YYYYMMDD.md`)
3. **Extract** from the report:
   - 🔴 **Critical Issues** (problems that MUST be avoided in current chapter)
   - 💡 **Top 3 Recommendations** (improvements to prioritize)
4. **Prepare feedback summary** to pass to chapter-writer agent

**Example**:
```markdown
📋 Review Feedback Loaded (From Ch{N-2}-{N-1} Report):

🔴 Critical Issues to Avoid:
  - 连续3章打脸型爽点（需变化爽点类型）
  - Quest线已连续5章主导（需切换到Fire或Constellation）
  - 战斗描写过于简略（需增加细节）

💡 Priority Recommendations:
  1. 增加Fire线（慕容雪情感戏）比重
  2. 引入Constellation线（家族关系变化）
  3. 爽点类型建议：升级型 or 收获型
```

**Purpose**: Ensure the chapter-writer agent applies quality feedback, preventing defect accumulation.

**FORBIDDEN**:
- Skipping review report when it exists
- Proceeding to Step 2 without extracting feedback
- Starting to write without loading state.json first

---

### Step 2: Generate Chapter Content (MANDATORY - CRITICAL)

**THIS STEP IS NOT OPTIONAL. YOU MUST EXECUTE IT.**

**YOU MUST call the chapter-writer agent** to generate chapter content:

---

**Step 2.1: Prepare Context Summary for Agent**

**Extract from loaded context**:

1. **Outline Summary**:
   ```
   Goal: [本章目标]
   Cool Point: [爽点类型和表现]
   New Entities: [需要引入的角色/地点/物品]
   Foreshadowing: [需要埋设的伏笔]
   ```

2. **Protagonist State**:
   ```
   Realm: [境界] [层数]层
   Location: [当前位置]
   Bottleneck: [瓶颈描述]
   Golden Finger: [金手指名称] Lv.[等级]
   ```

3. **Previous Context** (if chapter > 1):
   ```
   [前2章内容摘要，100-200字，包含关键剧情点]
   ```

4. **Review Feedback** (if loaded in Step 1.4):
   ```
   🔴 Critical Issues: [列表]
   💡 Recommendations: [Top 3]
   ```

---

**Step 2.2: Invoke chapter-writer Agent (MANDATORY)**

**YOU MUST call the Task tool with the following parameters**:

```
Task(
  subagent_type="chapter-writer",
  description="Write chapter {chapter_num} content",
  prompt="Generate Chapter {chapter_num} following the webnovel-writer skill protocols.

**Context**:

**Outline**:
- Goal: {从大纲提取}
- Cool Point: {从大纲提取}
- New Entities: {从大纲提取}
- Foreshadowing: {从大纲提取}

**Protagonist State**:
- Realm: {realm} {layer}层
- Location: {location}
- Bottleneck: {bottleneck}
- Golden Finger: {golden_finger} Lv.{level}

**Previous Chapters** (if exists):
{前2章摘要，100-200字}

**Review Feedback** (if exists):
🔴 Critical Issues to Avoid:
{从审查报告提取的关键问题列表}

💡 Priority Recommendations:
{从审查报告提取的Top 3建议}

**Output Requirements**:
1. Save to: 正文/第{chapter_num:04d}章.md
2. Word count: 3000-5000 Chinese characters
3. Follow anti-hallucination laws strictly
4. Include at least 1 cool-point
5. Tag new entities with [NEW_ENTITY: 类型, 名称, 描述]
6. Apply review feedback (avoid Critical Issues, try to apply Recommendations)
7. Self-review before saving

The webnovel-writer skill knowledge will guide you on:
- Three anti-hallucination laws (大纲即法律/设定即物理/发明需申报)
- Cool-points design (5 types strategy)
- Strand Weave pacing control
- Dialogue and description standards
"
)
```

**The chapter-writer agent will**:
1. ✅ Validate context completeness
2. ✅ Create pre-writing plan (strand selection, cool-point design)
3. ✅ Generate 3000-5000 word chapter content
4. ✅ Perform self-review against quality checklist
5. ✅ Save to `正文/第{N:04d}章.md`

---

**Step 2.3: Wait for Agent Completion**

**After the agent returns**:
- ✅ Verify the chapter file was created
- ✅ Verify word count is within range (3000-5000)
- ✅ Proceed to Step 3

**IF agent reports error or self-review failure**:
```
❌ Chapter generation failed: [error message]
STOP execution and report to user.
DO NOT proceed to Step 3.
```

---

**CRITICAL**:
- This is NOT optional. You MUST use the Task tool to call chapter-writer agent.
- You MUST NOT write chapter content directly yourself.
- You MUST pass all context (outline, state, previous chapters, review feedback) to the agent.

**FORBIDDEN**:
- Writing chapter content directly without calling chapter-writer agent
- Skipping context summary preparation
- Proceeding without waiting for agent completion
- Ignoring agent error reports

---

### Step 3: Extract Entities (CONDITIONAL)

**IF** you used `[NEW_ENTITY]` tags in the chapter:

```bash
python .claude/skills/webnovel-writer/scripts/extract_entities.py "正文/第{N:04d}章.md" --auto
```

---

### Step 4: Update State (MANDATORY)

```bash
python .claude/skills/webnovel-writer/scripts/update_state.py \
  --progress {chapter_num} {total_words} \
  --protagonist-power "{新境界}" {新层数} "{新瓶颈}" \
  --protagonist-location "{新地点}" {chapter_num}
```

**Minimum required** (if no power/location change):
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py --progress {chapter_num} {total_words}
```

---

### Step 5: Git Backup (MANDATORY)

```bash
python .claude/skills/webnovel-writer/scripts/backup_manager.py \
  --chapter {chapter_num} \
  --chapter-title "{章节标题}"
```

**What this does**: `git add .` + `git commit` + `git tag ch{N:04d}`

---

### Step 6: Update Strand Tracker (MANDATORY)

**YOU MUST analyze** which story strand dominated this chapter:

- **Quest Strand** (任务线): Protagonist pursuing external goals (quests, battles, leveling)
- **Fire Strand** (情感线): Romance, friendship, emotional conflicts
- **Constellation Strand** (人际线): Social dynamics, alliances, betrayals

**After determining the dominant strand, run**:

```bash
python .claude/skills/webnovel-writer/scripts/update_state.py \
  --strand-dominant {quest|fire|constellation} {chapter_num}
```

**Example** (Chapter 3 dominated by Quest):
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py --strand-dominant quest 3
```

**CRITICAL**: This updates `strand_tracker` in state.json, tracking pacing balance to prevent monotonous pacing.

**FORBIDDEN**: Skipping strand_tracker update.

---

### Step 7: Bi-Chapter Review (CONDITIONAL - CRITICAL)

**IF** `chapter_num % 2 == 0` (every 2 chapters):

**YOU MUST launch 5 review subagents in parallel using the Task tool.**

**For EACH subagent below, invoke Task tool with**:
- `subagent_type`: The subagent name
- `description`: Brief task (3-5 words)
- `prompt`: "Review chapters {N-1} and {N}. Read the chapter files from 正文/ directory and generate a structured report following your protocol."

**Required subagents** (invoke all 5 in parallel):

1. **high-point-checker** - Check cool-point (爽点) density and quality
2. **consistency-checker** - Verify setting consistency (设定一致性)
3. **pacing-checker** - Analyze strand balance (节奏检查)
4. **ooc-checker** - Detect character OOC (人物失真)
5. **continuity-checker** - Verify narrative flow (连贯性)

**After ALL 5 subagents return their reports**:

**Step 7.1: Consolidate Review Reports (MANDATORY)**

1. **Collect all 5 reports** from the subagents
2. **Create consolidated report file**:
   ```bash
   # Save to: 审查报告/Review_Ch{N-1}-{N}_YYYYMMDD.md
   ```

3. **Report structure** (Markdown format):
   ```markdown
   # 双章审查报告 (Chapters {N-1}-{N})

   > **审查日期**: YYYY-MM-DD
   > **审查章节**: 第 {N-1}-{N} 章
   > **审查员**: 5 个（爽点/一致性/节奏/OOC/连贯性）

   ## 1. 爽点密度检查 (High-Point Checker)
   [Paste high-point-checker report here]

   ## 2. 设定一致性检查 (Consistency Checker)
   [Paste consistency-checker report here]

   ## 3. 节奏平衡检查 (Pacing Checker)
   [Paste pacing-checker report here]

   ## 4. 人物OOC检查 (OOC Checker)
   [Paste ooc-checker report here]

   ## 5. 连贯性检查 (Continuity Checker)
   [Paste continuity-checker report here]

   ## 综合评分 (Overall Score)
   - **爽点密度**: X/10
   - **设定一致性**: X/10
   - **节奏平衡**: X/10
   - **人物一致性**: X/10
   - **连贯性**: X/10
   - **总分**: XX/50

   ## 关键问题汇总 (Critical Issues)
   - [List all critical/high severity issues from 5 reports]

   ## 改进建议 (Recommendations)
   - [Top 3-5 actionable recommendations]
   ```

**Step 7.2: Update state.json Review Checkpoint (MANDATORY)**

```bash
python .claude/skills/webnovel-writer/scripts/update_state.py \
  --add-review "{N-1}-{N}" "审查报告/Review_Ch{N-1}-{N}_YYYYMMDD.md"
```

**Step 7.3: Present Summary to User**

Output consolidated findings to user (see Final Output section below).

**Purpose**: Catch accumulating defects before they compound, and maintain quality audit trail.

**CRITICAL**:
- This is NOT optional. You MUST use the Task tool, not generate reviews yourself.
- You MUST save the consolidated report file.
- You MUST update state.json review_checkpoints.

---

## Final Output (MANDATORY Format)

```
✅ 第 {chapter_num} 章《{标题}》创作完成

📝 章节信息
- 章节: 第 {chapter_num} 章
- 标题: {标题}
- 字数: {实际字数} 字
- 爽点: {爽点类型}

📊 状态更新
- 总进度: {current_chapter}/{target_chapters} 章
- 总字数: {total_words}/{target_words} 字
- 完成度: {完成百分比}%

💪 主角状态
- 实力: {realm} {layer}层
- 位置: {location}
- 金手指: {golden_finger} Lv.{level}

🔧 系统操作
- ✅ state.json 已更新
- ✅ Git 备份已完成 (commit: {git_hash})
- ✅ strand_tracker 已更新 (dominant: {dominant_strand})

{IF chapter_num % 2 == 0}
🔍 双章审查
- ✅ 已调用5个审查员 (high-point/consistency/pacing/ooc/continuity)
- 📋 审查报告已保存: 审查报告/Review_Ch{N-1}-{N}_YYYYMMDD.md
- ✅ state.json review_checkpoints 已更新
{ENDIF}
```

---

## Execution Checklist (VERIFY BEFORE CLAIMING "DONE")

- [ ] Chapter file saved to `正文/第{N:04d}章.md` (3,000-5,000 chars)
- [ ] [NEW_ENTITY] tags extracted (if any)
- [ ] `update_state.py` executed successfully
- [ ] `backup_manager.py` executed successfully
- [ ] `strand_tracker` updated in state.json
- [ ] Bi-chapter review run (if chapter_num % 2 == 0)
- [ ] Final output summary displayed to user

**IF ANY CHECKBOX IS UNCHECKED → TASK IS NOT COMPLETE.**

---

## Error Handling

**IF** any script fails:
1. **STOP immediately** - Do not proceed to next step
2. **OUTPUT the error** to user with full stack trace
3. **DO NOT claim** the chapter is complete
4. **WAIT** for user to fix the issue

**FORBIDDEN**: Hiding script errors or claiming success when a step failed.
