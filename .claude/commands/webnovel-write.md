---
allowed-tools: Read, Write, Edit, Grep, Bash
argument-hint: [章节号]
description: 按大纲创作指定章节的正文内容（3000-5000字），自动进行三大定律检查和爽点规划
---

# /webnovel-write

> **System Prompt**: You are the **Writer AI** of the Webnovel Studio. Your task is to write a chapter following the outline and **MANDATORY POST-EXECUTION PROCEDURES**.

## CRITICAL WARNING ⚠️

**ABSOLUTE REQUIREMENTS - VIOLATION = FAILURE**:
1. 🚨 **MUST call update_state.py** after writing (NOT optional)
2. 🚨 **MUST call backup_manager.py** for Git commit (NOT optional)
3. 🚨 **MUST update strand_tracker** (NOT optional)
4. 🚨 **FORBIDDEN to skip** any numbered step below

**Why This Matters**:
- Without state update → AI will forget protagonist's power in Chapter 10 → Plot collapse
- Without Git backup → File corruption = ALL chapters lost
- Without strand tracking → Pacing becomes monotonous → Reader churn

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

**FORBIDDEN**: Starting to write without loading state.json first.

---

### Step 2: Write Chapter Content (MANDATORY)

**Target**: 3,000 - 5,000 words (Chinese characters)

**CRITICAL CHECKS** (built into writing process):

✅ **Law 1 - Outline is Law**: Match the chapter outline EXACTLY:
   - Goal must be achieved
   - Cool Point must be delivered
   - Entities must appear as planned

✅ **Law 2 - Settings are Physics**: Respect protagonist state from state.json:
   - Current realm (e.g., "筑基期 3 层")
   - Current location
   - Current skills/items

✅ **Law 3 - New Inventions Need Declaration**: Tag new entities:
   ```
   [NEW_ENTITY: 角色, 李雪, 天云宗外门弟子，主角的青梅竹马]
   ```

**Output Format** (Chapter File):
```markdown
# 第 {N} 章：{标题}

{正文内容 3000-5000字}

---

## 本章统计

- **字数**: {实际字数}
- **爽点**: {爽点类型}（如：打脸/突破/获得宝物）
- **新角色**: {新角色列表}
- **伏笔**: {埋设的伏笔}
```

**SAVE TO**: `正文/第{N:04d}章.md` (e.g., `正文/第0045章.md`)

---

### Step 3: Extract Entities (CONDITIONAL - If [NEW_ENTITY] tags exist)

**IF** you used `[NEW_ENTITY]` tags in the chapter:

**YOU MUST run**:
```bash
python .claude/skills/webnovel-writer/scripts/extract_entities.py "正文/第{N:04d}章.md" --auto
```

**Purpose**: Sync new characters/locations/items to 设定集/

**FORBIDDEN**: Skipping entity extraction when tags exist.

---

### Step 4: Update State (MANDATORY - CRITICAL)

**THIS STEP IS NOT OPTIONAL. YOU MUST EXECUTE IT.**

**Run the following command** (adjust parameters based on what happened in this chapter):

```bash
python .claude/skills/webnovel-writer/scripts/update_state.py \
  --progress {chapter_num} {total_words} \
  --protagonist-power "{新境界}" {新层数} "{新瓶颈}" \
  --protagonist-location "{新地点}" {chapter_num}
```

**Example** (Chapter 45, protagonist broke through to 筑基 5 层):
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py \
  --progress 45 198765 \
  --protagonist-power "筑基期" 5 "即将突破筑基后期" \
  --protagonist-location "血煞秘境" 45
```

**Minimum Required** (even if protagonist didn't level up):
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py \
  --progress {chapter_num} {total_words}
```

**CRITICAL**: This updates `current_chapter`, `total_words`, `last_updated` in state.json.

**FORBIDDEN**: Finishing the task without running this command.

---

### Step 5: Git Backup (MANDATORY - CRITICAL)

**THIS STEP IS NOT OPTIONAL. YOU MUST EXECUTE IT.**

**Run the following command**:

```bash
python .claude/skills/webnovel-writer/scripts/backup_manager.py \
  --chapter {chapter_num} \
  --chapter-title "{章节标题}"
```

**Example**:
```bash
python .claude/skills/webnovel-writer/scripts/backup_manager.py \
  --chapter 45 \
  --chapter-title "血战秘境"
```

**What This Does**:
1. `git add .` - Stage all changes
2. `git commit -m "Chapter {N}: {标题}"` - Atomic commit
3. `git tag ch{N:04d}` - Create rollback point

**Why Critical**: Without Git backup, you cannot rollback if the story goes wrong in Chapter 100.

**FORBIDDEN**: Finishing the task without running this command.

---

### Step 6: Update Strand Tracker (MANDATORY - CRITICAL)

**YOU MUST analyze** which story strand dominated this chapter:

- **Quest Strand** (任务线): Protagonist pursuing external goals (quests, battles, leveling)
- **Fire Strand** (情感线): Romance, friendship, emotional conflicts
- **Constellation Strand** (人际线): Social dynamics, alliances, betrayals

**Based on your analysis, YOU MUST update** state.json manually:

**Read** current state.json → **Increment** the appropriate counter → **Write** back

**Example Python snippet** (you can adapt to Bash if needed):
```python
import json
from pathlib import Path

state_file = Path(".webnovel/state.json")
state = json.load(state_file.open('r', encoding='utf-8'))

# Determine dominant strand for this chapter
dominant = "quest"  # or "fire" or "constellation"

# Update tracker
tracker = state["strand_tracker"]
tracker[f"last_{dominant}_chapter"] = {chapter_num}
tracker["current_dominant"] = dominant
tracker["chapters_since_switch"] += 1 if tracker["current_dominant"] == dominant else 0
tracker["history"].append({
    "chapter": {chapter_num},
    "dominant": dominant
})

# Save
json.dump(state, state_file.open('w', encoding='utf-8'), ensure_ascii=False, indent=2)
```

**Why Critical**: Prevents pacing monotony. System needs this data to warn you at Chapter 10 if you've run 10 chapters of pure combat.

**FORBIDDEN**: Finishing the task without updating strand_tracker.

---

### Step 7: Check Review Checkpoint (CONDITIONAL)

**IF** `chapter_num % 10 == 0` (every 10 chapters):

**OUTPUT to user**:
```
✅ 第 {chapter_num} 章完成！

⚠️ 检测到审查节点（每10章）
💡 建议运行: /webnovel-review {chapter_num - 9}-{chapter_num}
```

**Purpose**: Remind user to run quality checks every 10 chapters.

---

## Final Output (MANDATORY Format)

**YOU MUST output** this summary to the user:

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

{如果是10的倍数}
⚠️ 审查节点提醒
💡 建议运行: /webnovel-review {range}
{结束}
```

---

## Execution Checklist (VERIFY BEFORE CLAIMING "DONE")

Before you tell the user "Chapter X is complete", **YOU MUST verify**:

- [ ] Chapter file saved to `正文/第{N:04d}章.md`
- [ ] Word count: 3,000 - 5,000 Chinese characters
- [ ] [NEW_ENTITY] tags extracted (if any)
- [ ] `update_state.py` executed successfully
- [ ] `backup_manager.py` executed successfully
- [ ] `strand_tracker` updated in state.json
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

---

**Start executing Step 1 now.**
