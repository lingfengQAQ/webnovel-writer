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

**YOU MUST generate chapter content** following the webnovel-writer skill protocols:

---

**The webnovel-writer skill will automatically guide you** to apply:
- ✅ **Three Anti-Hallucination Laws** (大纲即法律/设定即物理/发明需申报)
- ✅ **Cool-Points Design** (5 types strategy: 打脸/升级/收获/扮猪吃虎/装逼打脸)
- ✅ **Strand Weave Pacing** (Quest/Fire/Constellation balance)
- ✅ **Dialogue and Description Standards**

---

**Context to Apply** (from Step 1):

1. **Outline Requirements** (from 大纲):
   - Goal: [本章必须完成的目标]
   - Cool Point: [必须交付的爽点]
   - New Entities: [必须引入的角色/地点/物品]
   - Foreshadowing: [必须埋设的伏笔]

2. **Protagonist State** (from state.json):
   - Power: [境界] [层数]层 → **CRITICAL: 不得超过此实力**
   - Location: [当前位置] → 章节场景必须符合
   - Golden Finger: [金手指] Lv.[等级]

3. **Previous Context** (from 前2章):
   - 关键剧情点
   - 人物关系变化
   - 已埋伏笔

4. **Review Feedback** (if loaded in Step 1.4 - CRITICAL):
   - 🔴 **Critical Issues to AVOID**: [从审查报告提取的问题]
   - 💡 **Recommendations to APPLY**: [从审查报告提取的Top 3建议]

---

**Generation Process**:

**YOU MUST follow these steps** while generating:

1. **Pre-Writing Planning** (think before writing):
   ```
   - 本章目标: [从大纲提取]
   - 爽点设计: [选择类型，避免连续3章同类型]
   - Strand选择: [Quest/Fire/Constellation，根据history避免连续5章]
   - 审查反馈应用: [如何规避Critical Issues + 应用Recommendations]
   ```

2. **Content Generation** (3000-5000 Chinese characters):
   - ✅ Follow outline Goal 100%
   - ✅ Deliver Cool Point as promised
   - ✅ Introduce required Entities with `[NEW_ENTITY: 类型, 名称, 描述]` tags
   - ✅ Plant Foreshadowing as planned
   - ✅ Protagonist power ≤ state.json (no power inflation)
   - ✅ Apply review feedback (avoid Critical Issues)

3. **Interactive Adjustment** (if user interrupts):
   - If user says "这段改一下" → Adjust immediately
   - If user says "Accept" → Continue
   - If user says "Reject" → Regenerate that section

4. **Self-Review** (before saving):
   - [ ] Word count: 3000-5000 chars?
   - [ ] Outline Goal achieved?
   - [ ] Cool-point delivered?
   - [ ] No power inflation (≤ state.json)?
   - [ ] New entities tagged with [NEW_ENTITY]?
   - [ ] Review feedback applied (if exists)?

5. **Save Output**:
   ```
   File: 正文/第{N:04d}章.md

   Format:
   # 第 {N} 章：{标题}

   {正文 3000-5000字}

   ---

   ## 本章统计
   - **字数**: {实际字数}
   - **爽点**: {类型}
   - **主导Strand**: {quest/fire/constellation}
   - **新角色**: {列表或"无"}
   - **伏笔**: {列表或"无"}
   ```

---

**CRITICAL Requirements**:
- ✅ 大纲即法律: 100% follow outline
- ✅ 设定即物理: Protagonist power ≤ state.json
- ✅ 发明需申报: All new entities tagged
- ✅ Apply review feedback (if loaded in Step 1.4)

**FORBIDDEN**:
- ❌ Deviating from outline
- ❌ Power inflation (exceeding state.json)
- ❌ Missing [NEW_ENTITY] tags
- ❌ Ignoring review feedback Critical Issues
- ❌ Skipping self-review

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

**Step 7.4: Interactive Fix Option (CONDITIONAL - CRITICAL)**

**IF** the consolidated review report contains **Critical Issues** (🔴 severity: critical/high):

**YOU MUST execute**:

1. **Extract Critical Issues from report**:
   - Parse the "关键问题汇总 (Critical Issues)" section
   - Count issues with 🔴 critical or 🟠 high severity

2. **Ask user for immediate fix**:
   ```
   🔴 审查发现 {count} 个Critical问题：

   {列出Critical Issues清单}

   是否立即修复当前章节？
   A) 是，立即修复并重新审查
   B) 否，记录到待修复清单，继续下一章
   ```

3. **Handle user choice**:

   **Choice A - 立即修复流程**:
   ```
   For each Critical Issue:
     1. 定位问题章节段落
     2. 应用修复（基于Recommendations）
     3. 保存修改后的章节文件
     4. 运行 backup_manager.py（新Git commit标记"修复版"）

   可选：重新调用5个审查员验证修复效果

   输出：
   ✅ 修复完成：{count}个Critical Issues已解决
   📋 新审查报告（如有）：审查报告/Review_Ch{N-1}-{N}_FIXED_YYYYMMDD.md
   ```

   **Choice B - 延迟修复流程**:
   ```bash
   python .claude/skills/webnovel-writer/scripts/update_state.py \
     --add-todo-fix "{N-1}-{N}" "审查报告/Review_Ch{N-1}-{N}_YYYYMMDD.md"
   ```

   **Purpose**: 记录到 state.json.todo_fixes 数组，后续可用 `/webnovel-fix` 批量处理

**IF** no Critical Issues:
- 跳过此步骤，流程结束

**FORBIDDEN**:
- 发现Critical Issues却不询问用户
- 自动修复而不征求用户意见

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
