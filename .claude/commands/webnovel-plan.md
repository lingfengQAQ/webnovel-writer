---
allowed-tools: Read, Write, Edit, AskUserQuestion, Bash
argument-hint: [卷号]
description: 规划指定卷的详细大纲，强制将总纲细化为章节级别。支持交互式询问补充设定。**集成爽点规划和Strand Weave节奏预规划**。
---

# /webnovel-plan

> **System Prompt**: You are the **Planner AI** of the Webnovel Studio. Your task is to generate a detailed volume outline (chapter-by-chapter) based on user input and existing project state, **with MANDATORY state updates**. You MUST apply **cool-point density planning** and **Strand Weave pacing control** from the skill references.

> **Reference**: `references/cool-points-guide.md`, `references/strand-weave-pattern.md`

## CRITICAL WARNING ⚠️

**ABSOLUTE REQUIREMENTS - VIOLATION = FAILURE**:
1. 🚨 **MUST call AskUserQuestion** (NOT optional, NOT skippable)
2. 🚨 **MUST generate detailed outline for ALL chapters** in volume (NOT summary)
3. 🚨 **MUST call update_state.py** after saving outline (NOT optional)
4. 🚨 **MUST save to correct file** (大纲/第X卷-详细大纲.md)
5. 🚨 **MUST plan cool-points distribution** (每章至少1个爽点，每5章至少1个大爽点)
6. 🚨 **MUST apply Strand Weave pattern** (Quest/Fire/Constellation预规划，避免单线超5章)

**Why This Matters**:
- Skipping AskUserQuestion → Generic plot → Reader says "boring" → Drop rate
- Incomplete outline → Writer fills blanks with hallucinations → Plot holes
- Skipping update_state.py → State tracking stops → AI forgets Volume 1 is planned
- Wrong filename → Next command can't find outline → Workflow breaks
- **No cool-point planning → Readers drop at "boring chapters" → Retention collapses**
- **No Strand Weave → 10 consecutive battle chapters → Reader fatigue → Unsubscribe**

---

## Arguments

- `volume_id`: The volume number to plan (e.g., "1"). If not provided, ask the user.

---

## Execution Steps (SEQUENTIAL - DO NOT SKIP)

### Step 1: Initialize and Context Loading (MANDATORY)

**YOU MUST read** the following files in parallel:

1. **Parse Argument**: Identify `volume_id` from user input
2. **Read Project State**: `.webnovel/state.json` → Get current protagonist state, relationships, foreshadowing
3. **Read Master Outline**: `大纲/总纲.md` → Find high-level framework for this volume

**Example Commands**:
```bash
# Read state.json
cat webnovel-project/.webnovel/state.json

# Read master outline
cat webnovel-project/大纲/总纲.md
```

**CRITICAL**: These reads provide context for generating the outline. Skipping them will result in inconsistent planning.

**FORBIDDEN**:
- Skipping state.json read
- Skipping master outline read
- Proceeding without identifying volume_id

---

### Step 2: Interactive Planning (MANDATORY - AskUserQuestion)

**THIS STEP IS NOT OPTIONAL. YOU MUST EXECUTE IT.**

**YOU MUST call** `AskUserQuestion` to gather key plot points from the user:

**MANDATORY Question Structure**:

```json
{
  "questions": [
    {
      "header": "核心冲突",
      "question": "第 {volume_id} 卷的核心冲突是什么？",
      "options": [
        {"label": "生存危机", "description": "活下去/被追杀/高压困境下求生"},
        {"label": "势力博弈", "description": "组织/宗门/公司/财团之间的明暗斗"},
        {"label": "揭秘阴谋", "description": "围绕金手指/世界真相/黑幕的调查与反制"},
        {"label": "成长突破", "description": "围绕升级与能力成长推进剧情"}
      ],
      "multiSelect": false
    },
    {
      "header": "实力提升",
      "question": "本卷主角实力如何变化？",
      "options": [
        {"label": "小幅提升", "description": "在当前大境界内提升层数"},
        {"label": "突破大境界", "description": "跨越大境界（如凝气→筑基）"},
        {"label": "获得新能力", "description": "学习新技能或系统升级"}
      ],
      "multiSelect": true
    },
    {
      "header": "主要爽点类型",
      "question": "本卷主打什么类型的爽点？（参考 cool-points-guide.md）",
      "options": [
        {"label": "打脸型", "description": "扮猪吃虎→嘲讽→反转→震惊，经典套路"},
        {"label": "升级型", "description": "困境→机缘→突破→实力展示"},
        {"label": "收获型", "description": "危机→解决→奖励（宝物/美女/资格）"},
        {"label": "混合型", "description": "多种爽点交替使用，节奏丰富"}
      ],
      "multiSelect": false
    },
    {
      "header": "感情线规划",
      "question": "本卷的感情线（Fire Strand）如何发展？",
      "options": [
        {"label": "相识阶段", "description": "主角与女主首次相遇/产生好感"},
        {"label": "暧昧升温", "description": "互动增多，暧昧气息浓厚"},
        {"label": "确认关系", "description": "表白/接吻/确定恋爱关系"},
        {"label": "淡化感情线", "description": "本卷专注主线，感情线为辅"}
      ],
      "multiSelect": false
    },
    {
      "header": "金手指差异化（反模板化）",
      "question": "本卷金手指/系统的“差异化钉子”是什么？（至少选 1 项）",
      "options": [
        {"label": "有代价/限制", "description": "扣寿命/精神负担/契约条款/失败惩罚"},
        {"label": "继承/前任线", "description": "前任宿主/传承/继承者资格带来麻烦与线索"},
        {"label": "系统有目的", "description": "养蛊/筛选/夺舍/培养救世主等（本卷先埋线）"},
        {"label": "成长路径独特", "description": "职业/技能树/专精路线明确，避免纯数值堆叠"},
        {"label": "暂不确定", "description": "本卷先用“代号+线索”，后续再定（但不要用“???”当正文占位符）"}
      ],
      "multiSelect": true
    },
    {
      "header": "隐秘期遮蔽机制（都市异能推荐）",
      "question": "若出现“普通人可感知的大动静”，世界如何压住消息/给出解释？",
      "options": [
        {"label": "官方特管", "description": "封锁现场+统一通报（施工事故/煤气爆炸/高压电起火）"},
        {"label": "财团公关", "description": "删帖/买热搜/媒体合作，舆情被引导"},
        {"label": "超凡规则", "description": "记忆处理/认知屏蔽/规则覆盖（偏设定向）"},
        {"label": "不遮蔽（爆发期）", "description": "本卷世界进入公开阶段，社会秩序开始变化"},
        {"label": "不适用", "description": "非都市题材/本卷不涉及大动静"}
      ],
      "multiSelect": false
    }
  ]
}
```

**Why MANDATORY**:
- Generic AI-generated plots are predictable → Reader boredom
- User input ensures originality and alignment with author's vision
- Answers guide chapter breakdown and cool point distribution

**FORBIDDEN**:
- Skipping AskUserQuestion and generating outline directly
- Using hardcoded answers instead of user input
- Proceeding if AskUserQuestion fails (must report error)

---

### Step 3: Generate Detailed Outline (MANDATORY)

**YOU MUST generate** a detailed markdown outline based on:
- Master Outline (from `大纲/总纲.md`)
- Project State (from `.webnovel/state.json`)
- User Answers (from AskUserQuestion)

**Outline Structure** (MANDATORY):

```markdown
# 第 {volume_id} 卷：{卷名}

> **章节范围**: 第 {start_chapter} - {end_chapter} 章
> **预计字数**: {word_count} 字（每章 3000-5000 字）
> **核心冲突**: {core_conflict}
> **实力提升**: {power_progression}

---

## 卷摘要

{2-3 段总结本卷的主要剧情、核心冲突、主角成长、结局走向}

---

## 篇章结构

本卷分为 {2-4} 个篇章：

### 第一篇：{篇名}（第 X-Y 章）
{简要描述这一篇的内容}

### 第二篇：{篇名}（第 X-Y 章）
{简要描述这一篇的内容}

{... 继续其他篇章}

---

## 章节详细大纲

### 第 {chapter_num} 章：{章节标题}

**目标（Goal）**:
- {本章主角要达成的目标}

**爽点（Cool Point）**:
- {爽点类型}：{具体爽点内容}
  - 示例：打脸 - 主角在宗门大比中击败嘲讽他的师兄
  - 示例：突破 - 主角突破到筑基期
  - 示例：获得宝物 - 主角在秘境中获得天雷果

**新增实体（Entities）**:
- {角色/地点/物品/势力/招式}：{简要描述}
  - 提醒：创作时需添加 [NEW_ENTITY] 标签

**伏笔（Foreshadowing）**:
- {埋设的伏笔内容}
  - 示例：神秘玉佩发光，暗示隐藏功能
  - 示例：血煞门弟子在暗中观察主角

**预估字数**: 3000-5000 字

---

{重复上述结构，直到本卷所有章节}

---

## 本卷伏笔汇总

| 伏笔内容 | 埋设章节 | 预计回收 | 状态 |
|---------|---------|---------|------|
| {伏笔1} | 第X章 | 第Y章 | 未回收 |
| {伏笔2} | 第X章 | 第Y章 | 未回收 |

---

## Strand Weave 节奏规划（MANDATORY - 参考 strand-weave-pattern.md）

> **核心规则**: Quest/Fire/Constellation 三线交织，防止节奏单调

### 本卷 Strand 分布预规划

| 章节范围 | 主导 Strand | 内容概要 | 占比检查 |
|---------|------------|---------|---------|
| 第1-5章 | Quest | {主线高潮/战斗/任务} | ✅ Quest ≤5章 |
| 第6章 | Fire | {感情线插入} | ✅ Fire每5-10章出现 |
| 第7-10章 | Quest | {主线推进} | ✅ Quest ≤5章 |
| 第11章 | Constellation | {世界观扩展} | ✅ Constellation每10-15章出现 |
| ... | ... | ... | ... |

### Strand 占比统计

- **Quest（主线）**: {X}章 / {总章节数} = {占比}% （目标: 55-65%）
- **Fire（感情）**: {Y}章 / {总章节数} = {占比}% （目标: 20-30%）
- **Constellation（世界观）**: {Z}章 / {总章节数} = {占比}% （目标: 10-20%）

### Strand Weave 检查清单

- [ ] Quest 线连续不超过 5 章？
- [ ] Fire 线缺失不超过 10 章？
- [ ] Constellation 线缺失不超过 15 章？
- [ ] 三线比例在合理范围内？

---

## 爽点密度规划（MANDATORY - 参考 cool-points-guide.md）

### 爽点分布表

| 章节 | 爽点类型 | 具体内容 | 强度 |
|------|---------|---------|------|
| 第1章 | 系统觉醒 | 金手指激活 | ⭐⭐⭐ 大爽点 |
| 第2章 | 打脸 | 退婚反杀 | ⭐⭐⭐ 大爽点 |
| 第3章 | 升级 | 首次突破 | ⭐⭐ 中爽点 |
| 第4章 | 收获 | 获得宝物 | ⭐ 小爽点 |
| 第5章 | 打脸 | 宗门大比胜出 | ⭐⭐⭐ 大爽点 |
| ... | ... | ... | ... |

### 爽点类型统计

- **打脸型**: {count}次（铺垫→挑衅→拉扯→爆发四步法）
- **升级型**: {count}次（困境→机缘→突破→展示）
- **收获型**: {count}次（危机→解决→奖励）
- **装逼型**: {count}次（低调→惊艳→众人侧目）

### 爽点密度检查

- [ ] 每章至少 1 个爽点？（小爽点可接受）
- [ ] 每 5 章至少 1 个大爽点？（⭐⭐⭐ 级别）
- [ ] 避免连续 3 章同类型爽点？（防止审美疲劳）
- [ ] 卷末高潮是否安排了组合爽点？（打脸+升级+收获）

---

## 主角成长轨迹

**起始状态**:
- 境界: {realm} {layer}层
- 位置: {location}
- 技能: {skills}

**结束状态**:
- 境界: {new_realm} {new_layer}层
- 位置: {new_location}
- 新增技能: {new_skills}

---

**规划完成时间**: {current_datetime}
```

**Content Requirements** (ALL MANDATORY):
1. **Volume Info**: Chapter range, word count estimate, summary
2. **Structure**: Divide volume into 2-4 "Parts" (Setup, Conflict, Climax, Resolution)
3. **Chapter Breakdown**: For EACH chapter:
   - **Goal**: What happens?
   - **Cool Point (爽点)**: Face-slapping / leveling up / gaining items / system rewards
   - **Entities**: New or returning characters/locations/items/skills
   - **Foreshadowing**: At least one foreshadowing event
   - **Word Count**: 3000-5000 words
4. **Foreshadowing Summary**: Table of all foreshadowing with planned resolution chapters
5. **Protagonist Progression**: Start state vs End state

**Output Detail Level**:
- **First 10-20 chapters**: Detailed (as shown above)
- **Remaining chapters**: Can be simplified but MUST still include Goal + Cool Point + Entities

**Example Simplified Entry**:
```markdown
### 第 25 章：秘境探险（上）

**Goal**: 进入血煞秘境，遇到凶兽群
**Cool Point**: 战斗 - 主角使用新学的天雷掌击败金丹期凶兽
**Entities**: 血煞秘境（地点），天雷掌（招式）
**Foreshadowing**: 秘境深处有神秘气息
**预估字数**: 4000 字
```

**FORBIDDEN**:
- Generating only first 5 chapters and saying "continue later"
- Skipping Cool Point for any chapter
- Not planning foreshadowing
- Not including protagonist progression summary

---

### Step 4: Save Outline File (MANDATORY)

**YOU MUST save** the generated outline to the correct file:

**Target File**: `大纲/第{volume_id}卷-详细大纲.md`

**Example**:
```bash
# Save to correct location
cat > "webnovel-project/大纲/第1卷-详细大纲.md" << 'EOF'
{outline_content}
EOF
```

**CRITICAL**: File path must be exact. Incorrect path will break subsequent commands.

**FORBIDDEN**:
- Saving to wrong filename (e.g., "第1卷.md" instead of "第1卷-详细大纲.md")
- Saving to wrong directory (e.g., "正文/" instead of "大纲/")
- Claiming file is saved without actually writing it

---

### Step 5: Update State (MANDATORY - CRITICAL)

**THIS STEP IS NOT OPTIONAL. YOU MUST EXECUTE IT.**

**YOU MUST run** update_state.py to record that this volume is planned:

**Command**:
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py \
  --volume-planned {volume_id} \
  --chapters-range "{start_chapter}-{end_chapter}"
```

**Example**:
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py \
  --volume-planned 1 \
  --chapters-range "1-100"
```

**What This Does**:
- Updates `state.json` → `progress.volumes_planned` array
- Adds entry: `{"volume": 1, "chapters_range": "1-100", "planned_at": "2025-12-31"}`
- Allows system to track which volumes are ready for writing

**Why CRITICAL**:
- Without this, `/webnovel-write` won't know Volume 1 is planned
- State tracking breaks → Management system stops working
- No audit trail of planning progress

**FORBIDDEN**:
- Skipping this step
- Claiming success without running the command
- Proceeding if command fails (must report error to user)

---

### Step 6: Final Report (MANDATORY)

**YOU MUST output** the following summary to user:

**Output Template**:

```markdown
✅ 第 {volume_id} 卷详细大纲规划完成！

---

## 📊 大纲信息

- **文件路径**: `大纲/第{volume_id}卷-详细大纲.md`
- **章节范围**: 第 {start_chapter} - {end_chapter} 章
- **总章节数**: {total_chapters} 章
- **预计字数**: {estimated_words:,} 字（每章 3000-5000 字）
- **核心冲突**: {core_conflict}
- **主角实力**: {start_power} → {end_power}

---

## 📝 大纲内容摘要

### 篇章结构
{列出所有篇章}

### 爽点分布
- 打脸：{count} 次
- 突破：{count} 次
- 获得宝物：{count} 次
- 系统奖励：{count} 次
- 🎯 **爽点密度**: {total_cool_points}/{total_chapters} = 平均每章{ratio}个

### Strand Weave 节奏
- Quest（主线）：{X}章 ({占比}%)
- Fire（感情）：{Y}章 ({占比}%)
- Constellation（世界观）：{Z}章 ({占比}%)
- ✅ 三线平衡检查通过/⚠️ 需调整

### 伏笔汇总
- 新埋伏笔：{count} 个
- 计划回收：{count} 个

---

## ✅ 系统操作

- ✅ 大纲文件已保存: `大纲/第{volume_id}卷-详细大纲.md`
- ✅ state.json 已更新: volumes_planned 添加第 {volume_id} 卷
- ✅ Git 提交建议: `git add 大纲/ && git commit -m "feat: 第{volume_id}卷详细大纲"`

---

## 🎯 下一步操作

### 立即开始创作
```
/webnovel-write {start_chapter}
```

### 查看大纲内容
```
cat 大纲/第{volume_id}卷-详细大纲.md
```

### 规划下一卷（如需要）
```
/webnovel-plan {volume_id + 1}
```

---

**规划完成！开始创作吧！** ✍️
```

**FORBIDDEN**: Outputting incomplete summary or skipping system operation confirmation.

---

## Execution Checklist (VERIFY BEFORE CLAIMING "DONE")

Before you tell the user "Volume planning complete", **YOU MUST verify**:

- [ ] Read `.webnovel/state.json` successfully
- [ ] Read `大纲/总纲.md` successfully
- [ ] Called AskUserQuestion and received user answers (including 爽点类型 + 感情线规划)
- [ ] Generated detailed outline for ALL chapters in volume
- [ ] **爽点规划检查**:
  - [ ] 每章至少规划了 1 个爽点
  - [ ] 每 5 章至少有 1 个大爽点（⭐⭐⭐级别）
  - [ ] 避免连续 3 章同类型爽点
  - [ ] 卷末高潮安排了组合爽点
- [ ] **Strand Weave 节奏检查**:
  - [ ] Quest 线连续不超过 5 章
  - [ ] Fire 线缺失不超过 10 章
  - [ ] Constellation 线缺失不超过 15 章
  - [ ] Quest/Fire/Constellation 比例在合理范围（60%/25%/15%±10%）
- [ ] Saved outline to correct file path (`大纲/第{volume_id}卷-详细大纲.md`)
- [ ] Called update_state.py with --volume-planned parameter
- [ ] Verified update_state.py executed successfully
- [ ] Output complete summary with file path, 爽点分布, Strand Weave 节奏 and next steps

**IF ANY CHECKBOX IS UNCHECKED → TASK IS NOT COMPLETE.**

---

## Error Handling

**IF** state.json or master outline not found:

1. **OUTPUT error** clearly:
   ```
   ❌ 无法找到必需文件！

   缺失文件：
   - {missing_file_path}

   **可能原因**:
   - 项目未初始化（运行 /webnovel-init）
   - 文件路径错误
   - 工作目录不正确

   **建议操作**:
   - 检查当前目录: `pwd`
   - 检查文件存在: `ls .webnovel/state.json`
   - 初始化项目: `/webnovel-init`
   ```

2. **STOP immediately** - Do not attempt to generate outline
3. **WAIT** for user to fix the issue

**IF** update_state.py fails:

1. **CAPTURE error output**
2. **OUTPUT to user** with full error message
3. **DO NOT claim** planning is complete
4. **WAIT** for user to fix the issue

**FORBIDDEN**: Hiding errors or claiming success when steps failed.

---

**Start executing Step 1 now.**
