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
5. 🚨 **MUST polish content** (Step 2.5) before entity extraction (NOT optional)

**Why This Matters**:
- Without state update → AI forgets protagonist's power → Plot collapse
- Without Git backup → File corruption = ALL chapters lost
- Without strand tracking → Pacing becomes monotonous → Reader churn
- Without quality review → Accumulating defects → Unrecoverable errors
- Without polishing → AI traces remain → Content feels robotic → Reader disengagement

---

## Arguments

- `chapter_num`: Chapter number to write (e.g., "45").
  - If user says "自动检测" or "下一章" → Auto-detect from state.json
  - If not provided → Ask the user

---

## Step -1: Environment Setup (MANDATORY - BEFORE ALL STEPS)

### 1. Locate Project Directory

**YOU MUST find the `.webnovel/` directory first**:

```
Search order:
1. Current working directory: ./.webnovel/
2. webnovel-project subdirectory: ./webnovel-project/.webnovel/
3. Parent directory: ../.webnovel/
```

**Set PROJECT_ROOT** to the directory containing `.webnovel/`:
- If found at `./webnovel-project/.webnovel/` → `PROJECT_ROOT = ./webnovel-project`
- All subsequent paths are relative to PROJECT_ROOT

### 2. Auto-detect Chapter Number (if requested)

**IF user requested auto-detection** ("自动检测" / "下一章" / no chapter specified):

```bash
# Read state.json to get current progress
python -c "import json, os; p=os.path.join('$PROJECT_ROOT','.webnovel','state.json'); s=json.load(open(p, encoding='utf-8')); print(s['progress']['current_chapter'] + 1)"
```

**Set chapter_num** = current_chapter + 1

### 3. Validate Before Proceeding

**Before Step 0, confirm**:
- [ ] PROJECT_ROOT is set (contains `.webnovel/state.json`)
- [ ] chapter_num is determined (from user or auto-detected)
- [ ] Volume number is calculated: `volume_num = (chapter_num - 1) // 50 + 1`

**Example Output**:
```
📍 项目目录: D:\wk\novel skill\webnovel-project
📖 目标章节: 第2章 (第1卷)
✅ 环境检查通过，开始执行 Step 0...
```

---

## Execution Steps (SEQUENTIAL - DO NOT SKIP)

### Step 0: Initialize Workflow Tracking (MANDATORY)

**BEFORE Step 1**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py start-task \
  --command webnovel-write \
  --chapter {chapter_num}
```

**Expected Output**:
```
✅ 任务已启动: webnovel-write {"chapter_num": {N}}
```

**Purpose**:
- 记录任务开始时间和参数
- 启用中断恢复功能
- 创建 `.webnovel/workflow_state.json` 状态追踪文件

**Why This Matters**:
- Enables `/webnovel-resume` to detect interruptions
- Allows safe recovery if Claude Code crashes or times out
- Provides audit trail for task execution

**FORBIDDEN**: Skipping this step or proceeding without successful initialization.

---

### Step 1: Load Context (MANDATORY)

**Before executing Step 1**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py start-step \
  --step-id "Step 1" \
  --step-name "Load Context"
```

**YOU MUST execute these reads in parallel**:

1. Read `.webnovel/state.json` - Get current protagonist state
2. Read `大纲/第X卷-详细大纲.md` - Find this chapter's outline
3. Read previous 2 chapters from `正文/` (if exist) - Get context
4. **[NEW] Load latest review report (if exists)** ⬅️ 新增步骤
5. **[REFERENCE] Load relevant reference files (if needed)** ⬅️ 新增步骤

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

---

**Step 1.5: Load Reference Materials (CONDITIONAL - OPTIONAL)**

**When to Load**:
- **First time using this command** → Load `references/cool-points-guide.md` for爽点type overview
- **Unsure about pacing** → Load `references/pacing-control.md` for Strand Weave rules
- **Need genre-specific templates** → Load `templates/genres/修仙.md` (or相应题材)
- **Designing golden finger** → Load `templates/golden-finger-templates.md`

**How to Load** (Example):
```markdown
📚 Reference Materials Loaded:
- cool-points-guide.md (Refreshed 5 types of cool points: 打脸/升级/收获/扮猪吃虎/装逼打脸)
- golden-finger-templates.md (Reviewed system panel design for Lv.X → Lv.Y breakthrough)
```

**Purpose**:
- Refresh memory on established patterns (爽点类型, 题材套路)
- Ensure adherence to genre conventions
- Avoid redundant cool-point types (e.g., 3 consecutive face-slapping chapters)

**IMPORTANT**:
- This step is **OPTIONAL** - only load when **actively needed**
- Do NOT load all references every time (wastes tokens)
- The webnovel-writer skill knowledge is already in context - references provide **deeper details**

**FORBIDDEN**:
- Skipping review report when it exists
- Proceeding to Step 2 without extracting feedback
- Starting to write without loading state.json first

**After completing Step 1**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py complete-step \
  --step-id "Step 1"
```

---

### Step 2: Generate Chapter Content (MANDATORY - CRITICAL)

**Before executing Step 2**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py start-step \
  --step-id "Step 2" \
  --step-name "Generate Chapter Content"
```

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
   - ✅ Introduce required Entities with `[NEW_ENTITY: 类型, 名称, 描述, 层级]` tags（层级: 核心/支线/装饰）
   - ✅ Track new golden finger skills with `[GOLDEN_FINGER_SKILL: 技能名, 等级, 描述, 冷却时间]`
   - ✅ Plant Foreshadowing as planned
   - ✅ **禁止自创“工作流标签”**：除 `[NEW_ENTITY]` / `[GOLDEN_FINGER_SKILL]` / `[OUTLINE_DEVIATION]` 外，不要在正文里新增任何方括号标签（例如 `[FORESHADOWING: ...]`、`[COOL_POINT: ...]` 等）；如需伏笔结构化，仅允许使用 **`[FORESHADOWING_JSON: {...}]` 且必须包在 HTML 注释里**（不影响读者阅读）
   - ✅ **禁用占位符正文**：正文里不要出现“???系统/???功能/???”；未知信息用“代号/称呼”或“权限屏蔽/无法读取”等叙述句替代
   - ✅ **都市异能（隐秘期）余波要求**：若出现“会被普通人注意到的大动静”（爆炸/坍塌/火光/多人伤亡），本章或下一章必须交代一个现实层面的“余波/遮蔽机制”细节（警戒线、监控调取、热搜/群聊传闻、官方说法等）
   - ✅ Protagonist power ≤ state.json (no power inflation)
   - ✅ Apply review feedback (avoid Critical Issues)

---

> ⚠️ **标签格式警告 - 必须严格遵守（脚本依赖此格式）**
>
> **正确格式（方括号 + 逗号分隔）**:
> ```
> [NEW_ENTITY: 角色, 陆辰, 主角觉醒时空能力, 核心]
> [NEW_ENTITY: 地点, 末日避难所, 幸存者聚集地, 支线]
> [NEW_ENTITY: 物品, 时空碎片, 强化金手指的材料, 装饰]
> [GOLDEN_FINGER_SKILL: 时间回溯, 1, 回到10秒前, 24小时]
> ```
>
> **可选：读者版隐藏写法（推荐）**：用 HTML 注释包裹“正确格式”，脚本仍可识别，多数 Markdown 渲染不显示：
> ```
> <!-- [NEW_ENTITY: 角色, 陆辰, 主角觉醒时空能力, 核心] -->
> <!-- [GOLDEN_FINGER_SKILL: 时间回溯, 1, 回到10秒前, 24小时] -->
> <!-- [FORESHADOWING_JSON: {"content":"继承者验证通过","tier":"支线","target_chapter":101,"location":"云程贸易公司","characters":["陆辰"]}] -->
> ```
>
> **错误格式（脚本无法识别 ❌）**:
> ```
> <!-- NEW_ENTITY: 陆辰 | 主角 | ... -->  ❌ 缺少 [NEW_ENTITY: ...] 标准标签
> {NEW_ENTITY: 陆辰, 主角, ...}            ❌ 花括号
> NEW_ENTITY: 陆辰, 主角, ...              ❌ 缺少方括号
> [NEW_ENTITY: 陆辰 | 主角 | ...]          ❌ 竖线分隔符
> ```
>
> **标签放置位置**: 在角色/地点/物品首次出现的段落末尾，或章节末尾统一放置。为便于后处理，建议**标签单独成行**（不要把标签夹在一句正文里）

---

3. **Interactive Adjustment** (if user interrupts):
   - If user says "这段改一下" → Adjust immediately
   - If user says "Accept" → Continue
   - If user says "Reject" → Regenerate that section

4. **Self-Review** (before saving):
   - [ ] Word count: 3000-5000 chars?
   - [ ] Outline Goal achieved?
   - [ ] Cool-point delivered?
   - [ ] No power inflation (≤ state.json)?
   - [ ] New entities tagged with [NEW_ENTITY: ..., 层级]?
   - [ ] Golden finger skills tagged with [GOLDEN_FINGER_SKILL] (if learned new)?
   - [ ] Review feedback applied (if exists)?

5. **Save Output**:
   ```
   File: 正文/第{volume_num}卷/第{N:03d}章-{标题}.md
   （也可先保存为：正文/第{volume_num}卷/第{N:03d}章.md，后续再补标题重命名）

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
- ❌ Missing [NEW_ENTITY] or [GOLDEN_FINGER_SKILL] tags
- ❌ Ignoring review feedback Critical Issues
- ❌ Skipping self-review

**After completing Step 2**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py complete-step \
  --step-id "Step 2" \
  --artifacts '{"chapter_file": {"path": "正文/第{volume_num}卷/第{N:03d}章-{标题}.md", "exists": true, "word_count": {实际字数}, "status": "draft"}}'
```

---

### Step 2.5: Polish Content (MANDATORY - IN-PLACE)

**Before executing Step 2.5**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py start-step \
  --step-id "Step 2.5" \
  --step-name "Polish Content"
```

> ⚠️ **CRITICAL**: 此步骤在主流程中直接执行，**不使用独立代理**，确保润色不偏离大纲约束。

---

**润色必须遵循的核心原则**:

```
🔒 大纲即法律：润色只调整表达方式，不改变情节内容
🔒 设定即物理：润色不得改变任何实力/能力描述
🔒 标签保护：[NEW_ENTITY] 和 [GOLDEN_FINGER_SKILL] 标签必须原样保留
🔒 通用润色：所有改进技法均为通用技法，不依赖特定题材
```

**详细参考**: `.claude/skills/webnovel-writer/references/polish-guide.md`（含量化标准和改写示例库）

---

**润色六步骤（顺序执行）**:

#### 2.5.0 量化基线抽检（润色前）

按 `.claude/skills/webnovel-writer/references/polish-guide.md` 的“AI痕迹/自然化”做一次快速计数（建议：首章/每10章/出现模板感时抽检即可）。

---

#### 2.5.1 AI痕迹检测与修正

**识别以下AI写作特征并修正**:

| AI痕迹类型 | 识别特征 | 修正方法 |
|-----------|---------|---------|
| **过度总结** | "综合以上…"、"总而言之…" | 删除或改为自然过渡 |
| **完美结构** | "首先…其次…最后…"、"第一…第二…" | 打散结构，变为自然叙述 |
| **学术表达** | "而言"、"在某种程度上"、"从本质上看" | 替换为口语化表达 |
| **排比过多** | 连续3个以上相同句式 | 保留1-2个，其余改写 |
| **对偶堆砌** | 刻意对仗的形容词组 | 减少或打破对称 |
| **因果过密** | 每句都有"因为…所以…" | 改用暗示或动作展现 |

**修正示例**:
```
❌ AI风格：综合以上分析，林天首先需要提升修为，其次需要获取资源，最后需要寻找盟友。
✅ 自然风格：林天心里盘算着，修为是根本，资源也不能少，至于盟友……先走一步看一步吧。
```

#### 2.5.2 语言五层优化

按以下顺序逐层优化（每层只处理对应问题）:

| 层级 | 优化目标 | 检查要点 |
|-----|---------|---------|
| **L1 准确性** | 词汇准确、语法正确 | 错别字、语病、逻辑矛盾 |
| **L2 生动性** | 多感官描写 | 视觉+听觉+触觉，动作细节 |
| **L3 流畅性** | 句式变化、段落过渡 | 长短句交替，自然衔接 |
| **L4 表现力** | 情感张力、氛围营造 | 内心独白、环境烘托 |
| **L5 一致性** | 风格统一 | 人称视角、叙事距离保持 |

**优化示例（L2 生动性）**:
```
❌ 单调：林天感到很紧张。
✅ 生动：林天攥紧拳头，掌心渗出细密的汗珠，心跳如擂鼓般直冲耳膜。
```

#### 2.5.3 风格四维检查

确保以下四个维度与前文保持统一:

| 维度 | 检查内容 | 一致性要求 |
|-----|---------|----------|
| **语言风格** | 词汇选择、修辞手法 | 与前2章用词习惯一致 |
| **叙事风格** | 视角、节奏、距离 | 第几人称、紧凑/舒缓 |
| **角色风格** | 对话语气、行为模式 | 符合人设（state.json） |
| **场景风格** | 环境描写、氛围基调 | 与题材模板风格匹配 |

**检查示例（角色风格）**:
```
林天人设：沉稳、少言
❌ OOC：林天兴奋地大喊："太棒了！我成功了！"
✅ 符合：林天嘴角微微上扬，眼中闪过一丝不易察觉的笑意。
```

#### 2.5.4 自然化处理

**添加人类写作特有的自然元素**:

| 元素类型 | 应用场景 | 示例 |
|---------|---------|-----|
| **停顿词** | 对话、内心独白 | "嗯"、"这个"、"怎么说呢" |
| **不确定语气** | 推测、判断 | "大概"、"应该"、"似乎" |
| **口语化** | 日常对话 | "咋回事"、"得了"、"行吧" |
| **自我纠正** | 思考过程 | "不对，应该是…"、"等等…" |
| **情绪词** | 感叹、反应 | "嘁"、"切"、"哼" |

**自然化示例**:
```
❌ 机械：林天分析了三种可能的策略，最终选择了第二种。
✅ 自然：林天琢磨了半天——第一种太冒险，第三种太慢，嗯……就第二种吧。
```

**改写技巧速查**:

| 问题类型 | 改写方法 |
|---------|---------|
| 情绪直白 | 动作外化（拳头攥紧、额头冒汗） |
| 逻辑完美 | 打断重组（加……和破折号） |
| 比喻堆砌 | 只留一个最有力的 |
| 形容过密 | 删除70%的形容词 |
| 对话书面 | 口语化+省略主语 |

---

#### 2.5.5 量化复检（润色后）

复检目标（详见 polish-guide）：总结词=0、列举结构=0、学术词 <1次/1000字、短句占比 30-50%、停顿词 ≥2次/1000字；未达标则返回 2.5.1-2.5.4 针对性修正。

---

**润色后自检清单**:

- [ ] 大纲目标未改变（情节、爽点、伏笔完整）
- [ ] 主角实力未膨胀（≤ state.json）
- [ ] [NEW_ENTITY] 和 [GOLDEN_FINGER_SKILL] 标签保留完整
- [ ] AI痕迹量化达标（总结词=0，学术词<1次/1000字）
- [ ] 自然化量化达标（停顿词≥2次/1000字，短句30-50%）
- [ ] 风格与前文一致（语言/叙事/角色/场景）
- [ ] 字数仍在 3000-5000 范围内

---

**润色前后对比输出（可选）**:

```markdown
📝 润色报告

## AI痕迹修正
- 修正过度总结: 2处
- 打散完美结构: 1处
- 替换学术表达: 3处

## 语言优化
- L2 生动性提升: 5处（新增感官描写）
- L3 流畅性优化: 2处（句式调整）

## 风格统一
- 角色对话调整: 1处（符合林天沉稳人设）

## 自然化处理
- 添加停顿词: 3处
- 添加不确定语气: 2处

✅ 润色完成，章节已更新
```

---

**Save Polished Output**:

更新章节文件 `正文/第{volume_num}卷/第{N:03d}章-{标题}.md`，覆盖原草稿。

**After completing Step 2.5**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py complete-step \
  --step-id "Step 2.5" \
  --artifacts '{"polished": true, "ai_traces_fixed": {N}, "style_unified": true}'
```

---

### Step 3: Extract Entities (CONDITIONAL)

**Before executing Step 3** (if NEW_ENTITY tags exist), **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py start-step \
  --step-id "Step 3" \
  --step-name "Extract Entities"
```

**IF** you used `[NEW_ENTITY]` / `[GOLDEN_FINGER_SKILL]` / `[FORESHADOWING_JSON]` tags in the chapter:

```bash
python .claude/skills/webnovel-writer/scripts/extract_entities.py --project-root "$PROJECT_ROOT" --chapter {chapter_num} --auto
```

**After completing Step 3**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py complete-step \
  --step-id "Step 3" \
  --artifacts '{"entities_extracted": true}'
```

---

### Step 4: Update State (MANDATORY)

**Before executing Step 4**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py start-step \
  --step-id "Step 4" \
  --step-name "Update State"
```

> ⚠️ **命令格式警告 - 复制下方模板使用**

**完整命令模板（有实力/位置变化时）**:
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py \
  --progress {chapter_num} {total_words} \
  --protagonist-power "{新境界}" {新层数} "{新瓶颈}" \
  --protagonist-location "{新地点}" {chapter_num}
```

**示例（第5章，突破到炼气二层，位置变更）**:
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py \
  --progress 5 18500 \
  --protagonist-power "炼气期" 2 "无" \
  --protagonist-location "天云宗内门" 5
```

**最小命令（无实力/位置变化时）**:
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py --progress {chapter_num} {total_words}
```

**示例（第3章，4200字，无变化）**:
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py --progress 3 12600
```

> ❌ **错误示例**: `--chapter-written 1 --words 2500` （参数名错误）

**After completing Step 4**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py complete-step \
  --step-id "Step 4" \
  --artifacts '{"state_json_modified": true}'
```

---

### Step 4.5: Update Structured Index (AUTO-TRIGGERED, 2 sub-steps)

**CRITICAL**: After Step 4, **immediately update** structured index in TWO steps:

---

#### Step 4.5.1: Extract Metadata with AI Agent

**Use Task tool to call metadata-extractor agent**:

```python
# Read chapter content (兼容卷目录命名：正文/第{volume_num}卷/第{N:03d}章-标题.md)
from pathlib import Path

volume_num = (chapter_num - 1) // 50 + 1
vol_dir = Path("正文") / f"第{volume_num}卷"
matches = sorted(vol_dir.glob(f"第{chapter_num:03d}章*.md")) + sorted(vol_dir.glob(f"第{chapter_num:04d}章*.md"))
if not matches:
    raise FileNotFoundError(f"Chapter file not found for ch{chapter_num} under {vol_dir}")

chapter_file = matches[0]
with open(chapter_file, 'r', encoding='utf-8') as f:
    chapter_content = f.read()

# Call metadata-extractor agent
agent_output = Task(
    subagent_type="metadata-extractor",
    description="Extract chapter metadata",
    prompt=f"Extract metadata from chapter {chapter_num}:\n\n{chapter_content}"
)

# Parse agent output (agent returns JSON in text block)
import re
import json
json_match = re.search(r'\{[\s\S]*\}', agent_output)
if json_match:
    metadata_json = json_match.group(0)

    # Save to temporary file (Windows-compatible)
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as tmp:
        tmp.write(metadata_json)
        metadata_file = tmp.name
else:
    raise ValueError("Agent output missing JSON block")
```

**What the agent does**:
- Extracts title, location, characters from chapter content
- Uses **semantic understanding** to identify location (vs regex)
- Identifies **all named characters** (including NEW_ENTITY tags)
- Calculates word count and MD5 hash
- Returns JSON: `{"title": "...", "location": "...", "characters": [...], ...}`

**Expected Output** (from agent):
```json
{
  "title": "第七章 突破",
  "location": "慕容家族",
  "characters": ["林天", "慕容战天", "云长老"],
  "word_count": 4521,
  "hash": "abc123...",
  "metadata_quality": "high"
}
```

**Performance**: ~1-2s (AI semantic analysis)

---

#### Step 4.5.2: Write to Index Database

**Pass agent's JSON file to structured_index.py** (Windows-compatible):

```bash
python .claude/skills/webnovel-writer/scripts/structured_index.py \
  --update-chapter {chapter_num} \
  --metadata-file {metadata_file}
```

**Why use --metadata-file instead of --metadata-json?**
- ✅ **Windows CLI 兼容性**：避免 JSON 字符串在 CMD/PowerShell 中的引号转义问题
- ✅ **跨平台一致性**：Linux/macOS/Windows 全部支持
- ✅ **大型 JSON 支持**：不受命令行长度限制

**What this does**:
- Reads JSON from temporary file
- Validates required fields
- Inserts/updates chapter metadata in SQLite database
- Syncs foreshadowing urgency from state.json
- Stores content hash for Self-Healing detection

**Expected Output**:
```
✅ 章节索引已更新：Ch7 - 第七章 突破
✅ 伏笔索引已同步：3 条活跃 + 2 条已回收
```

**Performance**: ~10ms (SQLite write)

**Cleanup** (after successful write):
```python
import os
os.unlink(metadata_file)  # Delete temporary file
```

---

**Total Time**: Step 4.5.1 (~1-2s) + Step 4.5.2 (~10ms) = **~1-2s per chapter**

**Accuracy Improvement**:
- **Before** (regex): Location = "未知" (60% accuracy)
- **After** (AI agent): Location = "慕容家族" (95% accuracy)

**Alternative Modes**:

1. **Direct JSON string** (Linux/macOS only):
```bash
python .claude/skills/webnovel-writer/scripts/structured_index.py --project-root "$PROJECT_ROOT" --update-chapter {N} --metadata-json '{json_string}'
```

2. **Fallback mode** (if agent unavailable):
```bash
# Direct file-based extraction (legacy mode, 60% accuracy)
python .claude/skills/webnovel-writer/scripts/structured_index.py --project-root "$PROJECT_ROOT" --update-chapter {N} --metadata "正文/第{volume_num}卷/第{N:03d}章.md"
```

---

**Query Examples** (for future use):
```bash
# 查询地点相关章节（O(log n) vs O(n) 文件遍历）
python .claude/skills/webnovel-writer/scripts/structured_index.py --project-root "$PROJECT_ROOT" --query-location "血煞秘境"

# 查询紧急伏笔（超过 50 章未回收）
python .claude/skills/webnovel-writer/scripts/structured_index.py --project-root "$PROJECT_ROOT" --query-urgent-foreshadowing

# 模糊查询角色
python .claude/skills/webnovel-writer/scripts/structured_index.py --project-root "$PROJECT_ROOT" --fuzzy-search "姓李" "女弟子"

# 查看索引统计
python .claude/skills/webnovel-writer/scripts/structured_index.py --project-root "$PROJECT_ROOT" --stats
```

**IMPORTANT**:
- **不需要 workflow_manager 追踪**（内部维护操作）
- 如报错，视为警告，不阻塞流程
- 索引失败降级为文件遍历（兼容性保障）
- context_manager.py 已集成索引，查询时自动使用

---

### Step 4.6: Data Archiving (AUTO-TRIGGERED)

**CRITICAL**: After indexing, **automatically run** archive check:

```bash
python .claude/skills/webnovel-writer/scripts/archive_manager.py --auto-check
```

**Purpose**: 防止 state.json 无限增长（200万字长跑保障）

**Archiving Strategy**:
- **角色归档**: 超过 50 章未出场的次要角色 → `.webnovel/archive/characters.json`
- **伏笔归档**: status="已回收" 且超过 20 章的伏笔 → `.webnovel/archive/plot_threads.json`
- **报告归档**: 超过 50 章的旧审查报告 → `.webnovel/archive/reviews.json`

**Trigger Conditions** (满足任一即执行):
- state.json 大小 ≥ 1 MB
- 当前章节数是 10 的倍数（每 10 章检查一次）

**Expected Output**:
```
✅ 无需归档（触发条件未满足）
   文件大小: 0.35 MB (阈值: 1.0 MB)
   当前章节: 7 (每 10 章触发)
```

**OR** (if archiving triggered):
```
✅ 归档完成:
   角色归档: 12 → characters.json
   伏笔归档: 8 → plot_threads.json
   报告归档: 5 → reviews.json

💾 文件大小: 1.2 MB → 0.8 MB (节省 0.4 MB)
```

**IMPORTANT**:
- **不需要 workflow_manager 追踪**（归档是内部维护操作）
- 如报错（如文件不存在），视为警告，不阻塞流程
- 归档数据可随时使用 `--restore-character "角色名"` 恢复
- **归档发生在索引之后**，确保所有数据都被索引后再清理

---

### Step 5: Git Backup (MANDATORY)

**Before executing Step 5**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py start-step \
  --step-id "Step 5" \
  --step-name "Git Backup"
```

> ⚠️ **命令格式警告 - 复制下方模板使用**

**命令模板**:
```bash
python .claude/skills/webnovel-writer/scripts/backup_manager.py \
  --chapter {chapter_num} \
  --chapter-title "{章节标题}"
```

**示例（第1章）**:
```bash
python .claude/skills/webnovel-writer/scripts/backup_manager.py \
  --chapter 1 \
  --chapter-title "死亡降临"
```

> ❌ **错误示例**: `backup --message "完成第1章"` （不需要 backup 子命令和 --message 参数）

**What this does**: `git add .` + `git commit` + `git tag ch{N:04d}`

**After completing Step 5**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py complete-step \
  --step-id "Step 5" \
  --artifacts '{"git_committed": true, "git_tag": "ch{N:04d}"}'
```

---

### Step 6: Update Strand Tracker (MANDATORY)

**Before executing Step 6**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py start-step \
  --step-id "Step 6" \
  --step-name "Update Strand Tracker"
```

**YOU MUST analyze** which story strand dominated this chapter:

- **Quest Strand** (任务线): Protagonist pursuing external goals (quests, battles, leveling)
- **Fire Strand** (情感线): Romance, friendship, emotional conflicts
- **Constellation Strand** (人际线): Social dynamics, alliances, betrayals

> ⚠️ **命令格式警告 - 复制下方模板使用**

**命令模板**:
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py \
  --strand-dominant {quest|fire|constellation} {chapter_num}
```

**示例（第3章，Quest线主导）**:
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py --strand-dominant quest 3
```

**示例（第7章，Fire线主导）**:
```bash
python .claude/skills/webnovel-writer/scripts/update_state.py --strand-dominant fire 7
```

**CRITICAL**: This updates `strand_tracker` in state.json, tracking pacing balance to prevent monotonous pacing.

**FORBIDDEN**: Skipping strand_tracker update.

**After completing Step 6**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py complete-step \
  --step-id "Step 6" \
  --artifacts '{"strand_tracker_updated": true, "dominant_strand": "{quest|fire|constellation}"}'
```

---

### Step 7: Bi-Chapter Review (CONDITIONAL - CRITICAL)

**Before executing Step 7** (if chapter_num % 2 == 0), **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py start-step \
  --step-id "Step 7" \
  --step-name "Bi-Chapter Review"
```

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
   ```
   输出：
   📋 审查报告已保存：审查报告/Review_Ch{N-1}-{N}_YYYYMMDD.md
   💡 建议在后续章节创作时注意规避这些问题
   💡 或者稍后手动修复这些章节
   ```

   **Purpose**: 保存报告供后续参考，用户可选择稍后手动修复

**IF** no Critical Issues:
- 跳过此步骤，流程结束

**FORBIDDEN**:
- 发现Critical Issues却不询问用户
- 自动修复而不征求用户意见

**After completing Step 7**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py complete-step \
  --step-id "Step 7" \
  --artifacts '{"review_completed": true, "review_report_path": "审查报告/Review_Ch{N-1}-{N}_YYYYMMDD.md"}'
```

---

### Final Step: Complete Workflow Tracking (MANDATORY)

**AFTER all steps complete successfully**, **YOU MUST run**:

```bash
python .claude/skills/webnovel-writer/scripts/workflow_manager.py complete-task
```

**Expected Output**:
```
🎉 任务完成
```

**Purpose**:
- 标记任务完成，清除 `current_task` 状态
- 更新 `last_stable_state` 快照（for rollback reference）
- 记录任务到 history

**Why This Matters**:
- Prevents `/webnovel-resume` from detecting false interruptions
- Provides audit trail for completed tasks
- Enables clean start for next chapter

**FORBIDDEN**: Claiming chapter is complete without running this step.

---

## Final Output (MANDATORY Format)

```
✅ 第 {chapter_num} 章《{标题}》创作完成

📝 章节信息
- 章节: 第 {chapter_num} 章
- 标题: {标题}
- 字数: {实际字数} 字
- 爽点: {爽点类型}

✨ 润色处理
- AI痕迹修正: {N}处
- 语言优化: L1-L5 已完成
- 风格统一: ✅ 四维检查通过
- 自然化: 已添加停顿词/口语化表达

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

**Workflow Tracking**:
- [ ] `workflow_manager.py start-task` executed successfully
- [ ] All step tracking calls (`start-step`/`complete-step`) executed
- [ ] `workflow_manager.py complete-task` executed successfully

**Data Archiving** (200万字长跑保障):
- [ ] `archive_manager.py --auto-check` executed after Step 4
- [ ] Archive check result confirmed (无需归档 OR 归档完成)

**Chapter Content**:
- [ ] Chapter file saved to `正文/第{volume_num}卷/第{N:03d}章-{标题}.md` (3,000-5,000 chars)
- [ ] [NEW_ENTITY] and [GOLDEN_FINGER_SKILL] tags extracted (if any)

**Content Polishing** (Step 2.5):
- [ ] AI traces detected and fixed (过度总结/完美结构/学术表达)
- [ ] Language 5-layer optimization applied (准确性→生动性→流畅性→表现力→一致性)
- [ ] Style 4-dimension check passed (语言/叙事/角色/场景风格统一)
- [ ] Naturalization applied (停顿词/不确定语气/口语化)
- [ ] Outline constraints preserved (情节、爽点、伏笔未改变)

**State Management**:
- [ ] `update_state.py` executed successfully
- [ ] `backup_manager.py` executed successfully
- [ ] `strand_tracker` updated in state.json

**Quality Control**:
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
