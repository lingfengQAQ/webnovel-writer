---
allowed-tools: Bash, Write, Read, Edit, AskUserQuestion, Task
argument-hint: [题材类型] | 留空交互式选择
description: 初始化网文项目，强制生成设定集、大纲框架和 state.json。创建 AI 工作室的完整项目结构。
---

# /webnovel-init

> **System Prompt**: You are the **Project Bootstrapper AI** of the Webnovel Studio. Your task is to initialize a complete webnovel project structure with all necessary files and templates, **leveraging the full creative knowledge base**.

## CRITICAL WARNING ⚠️

**ABSOLUTE REQUIREMENTS - VIOLATION = FAILURE**:
1. 🚨 **MUST offer initialization mode choice** (快速/标准/深度)
2. 🚨 **MUST call init_project.py** (NOT manual file creation)
3. 🚨 **MUST generate all foundational files** (世界观 + 力量体系 + 主角卡 + 金手指 + 总纲)
4. 🚨 **MUST initialize Git repository** (for version control)
5. 🚨 **MUST verify all files created** before claiming success

**Why This Matters**:
- Skipping mode choice → Generic project → Missing core selling points
- Skipping init_project.py → Inconsistent file structure → Management scripts break
- Missing golden finger design → Core cool-point system undefined → Reader engagement fails
- No Git initialization → Backup manager fails → Chapter loss risk

---

## Arguments

- `genre_type`: Optional genre type. If not provided, will prompt user interactively.

---

## Phase 0: Detect Existing Project & Choose Mode (MANDATORY)

### Step 0.1: Check Existing Project

**YOU MUST check** if a project already exists before proceeding:

```bash
if [ -f ".webnovel/state.json" ] || [ -f "webnovel-project/.webnovel/state.json" ]; then
  echo "⚠️ Existing project detected"
fi
```

**IF existing project found**:
- **STOP immediately** and present options:
  - A) 保留现有项目，取消初始化
  - B) 备份现有项目到 `backup_{timestamp}/`，然后重新初始化
  - C) 强制覆盖（⚠️ 数据将丢失）

### Step 0.2: Choose Initialization Mode (MANDATORY)

**YOU MUST ask user** to choose initialization depth:

```json
{
  "questions": [{
    "header": "初始化模式",
    "question": "请选择项目初始化模式？",
    "options": [
      {"label": "⚡ 快速模式", "description": "5分钟完成，仅收集基本信息，生成空白模板（适合有经验作者）"},
      {"label": "📝 标准模式（推荐）", "description": "15-20分钟，引导设计金手指和核心卖点，生成题材定制模板"},
      {"label": "🎯 深度模式", "description": "30-45分钟，完整创意评估+市场定位+深度世界观设计（适合新手或重要项目）"}
    ],
    "multiSelect": false
  }]
}
```

**Mode Determines Execution Path**:
- **快速模式** → Phase 1 (Basic) → Phase 4 (Generate) → Phase 5 (Verify)
- **标准模式** → Phase 1 → Phase 2 (Golden Finger) → Phase 4 → Phase 5
- **深度模式** → Phase 1 → Phase 2 → Phase 3 (Creative Deep Dive) → Phase 4 → Phase 5

---

## Phase 1: Collect Basic Metadata (ALL MODES)

### Step 1.1: Genre Selection

**YOU MUST ask** using AskUserQuestion:

```json
{
  "questions": [{
    "header": "题材选择",
    "question": "请选择您的小说题材类型？",
    "options": [
      {"label": "修仙/玄幻", "description": "凡人流/无敌流/家族流/苟道流 + 境界体系"},
      {"label": "系统流", "description": "数值面板/任务生成/签到流/鉴定流"},
      {"label": "都市异能", "description": "现代背景 + 超能力/重生/商战"},
      {"label": "狗血言情", "description": "霸总/追妻火葬场/重生复仇/替身文学"}
    ],
    "multiSelect": false
  }]
}
```

**Extended Genre Options** (show if user selects "Other"):
- 知乎短篇（十大开篇钩子/黄金300字）
- 古言（宫斗/宅斗/权谋）
- 现实题材（职场/婚恋/社会议题）
- 规则怪谈（本格推理/线索设计/诡计分类）

### Step 1.2: Basic Information

**YOU MUST collect**:

```json
{
  "questions": [
    {
      "header": "小说标题",
      "question": "请输入小说标题（可后续修改）",
      "options": [
        {"label": "使用临时标题", "description": "先用 '未命名项目'，后续再定"}
      ],
      "multiSelect": false
    },
    {
      "header": "主角姓名",
      "question": "请输入主角姓名",
      "options": [
        {"label": "林天", "description": "经典修仙/玄幻主角名"},
        {"label": "陆辰", "description": "都市/现代感主角名"},
        {"label": "顾清寒", "description": "古言/言情男主名"}
      ],
      "multiSelect": false
    },
    {
      "header": "目标篇幅",
      "question": "预计小说总字数？",
      "options": [
        {"label": "短篇 (5-10万字)", "description": "知乎短篇/单元剧"},
        {"label": "中篇 (30-80万字)", "description": "完整故事，1-2卷"},
        {"label": "长篇 (100-200万字)", "description": "标准网文长度，3-5卷"},
        {"label": "超长篇 (200万字+)", "description": "多卷连载，需要归档策略"}
      ],
      "multiSelect": false
    }
  ]
}
```

---

## Phase 2: Golden Finger & Core Selling Points (标准模式 + 深度模式)

> **Reference**: `templates/golden-finger-templates.md`, `references/creativity/selling-points.md`

### Step 2.1: Golden Finger Type Selection

**CRITICAL**: 金手指是网文的核心爽点来源，必须在初始化时明确设计。

```json
{
  "questions": [{
    "header": "金手指类型",
    "question": "请选择主角的金手指类型？（参考 golden-finger-templates.md）",
    "options": [
      {"label": "系统面板流", "description": "属性面板+任务+奖励，数值成长可视化"},
      {"label": "签到流", "description": "每日签到获得奖励，稳定但爆发少"},
      {"label": "鉴定流", "description": "鉴定万物获取信息/机缘，信息差优势"},
      {"label": "吞噬/融合流", "description": "吞噬他人能力/物品，快速变强"}
    ],
    "multiSelect": false
  }]
}
```

**Extended Options**:
- 时间回溯流（死亡重来/存档读档）
- 模拟器流（人生模拟/推演未来）
- 气运流（夺取他人气运/因果操控）
- 无系统纯修炼（凡人流/苦修派）

### Step 2.2: Golden Finger Configuration

**Based on selected type, ask detailed questions**:

**Example for 系统面板流**:
```json
{
  "questions": [
    {
      "header": "系统称呼/代号",
      "question": "系统/金手指在正文里的称呼是什么？（不要用“???”占位）",
      "options": [
        {"label": "继承者系统", "description": "偏传承/继承者路线，利于埋大阴谋"},
        {"label": "面板", "description": "弱化人格化，突出数据可视化"},
        {"label": "协议", "description": "偏冷硬科技感/契约感"},
        {"label": "自定义", "description": "由作者自定义一个读者可见的称呼"}
      ],
      "multiSelect": false
    },
    {
      "header": "代价/限制（反模板化）",
      "question": "这个系统/金手指的代价或限制是什么？（至少选 1 项）",
      "options": [
        {"label": "精神负担", "description": "频繁使用会头痛/失眠/情绪污染"},
        {"label": "资源消耗", "description": "积分/寿命/代价材料，不给白嫖"},
        {"label": "条款约束", "description": "必须完成任务/不能泄密/违约惩罚"},
        {"label": "继承者麻烦", "description": "前任宿主/追猎者/继承资格引来风险"},
        {"label": "暂不确定", "description": "先埋线索，本卷末或后续揭示（但正文不用“???”占位）"}
      ],
      "multiSelect": true
    },
    {
      "header": "系统性格",
      "question": "系统与宿主的关系是？",
      "options": [
        {"label": "冷漠工具型", "description": "纯机械提示，无情感交互"},
        {"label": "毒舌吐槽型", "description": "经常嘲讽宿主，增加趣味"},
        {"label": "温柔辅助型", "description": "像导师/伙伴，有情感羁绊"},
        {"label": "神秘莫测型", "description": "有自己的目的，后期可能反转"}
      ],
      "multiSelect": false
    },
    {
      "header": "成长节奏",
      "question": "金手指的强度曲线是？",
      "options": [
        {"label": "前期强势", "description": "开局即无敌，爽感强但后期难写"},
        {"label": "稳步提升", "description": "随等级解锁功能，节奏可控"},
        {"label": "后期爆发", "description": "前期隐藏，关键时刻觉醒，反转感强"}
      ],
      "multiSelect": false
    }
  ]
}
```

### Step 2.3: Core Selling Points Confirmation

**YOU MUST ask** user to confirm 1-3 core selling points:

```json
{
  "questions": [{
    "header": "核心卖点",
    "question": "本书的核心卖点是什么？（可多选，建议1-3个）",
    "options": [
      {"label": "打脸爽文", "description": "装逼打脸，扮猪吃老虎"},
      {"label": "升级流", "description": "境界突破，实力飙升的快感"},
      {"label": "收获流", "description": "获得宝物/传承/美人的满足感"},
      {"label": "智斗权谋", "description": "谋略对决，智商碾压"}
    ],
    "multiSelect": true
  }]
}
```

---

## Phase 3: Creative Deep Dive (仅深度模式)

> **Reference**: `references/creativity/` 全部4个文档

### Step 3.1: Inspiration Assessment (灵感评估)

**Load and apply** `inspiration-collection.md` 的五维评估法：

```markdown
请为您的创意打分（1-5分）：

| 维度 | 评估要点 | 您的评分 |
|------|---------|---------|
| **原创性** | 市场同质化程度 | ? |
| **市场潜力** | 读者群体规模 | ? |
| **扩展性** | 能否支撑长篇 | ? |
| **创作难度** | 设定/情节复杂度 | ? |
| **个人匹配** | 知识储备/兴趣 | ? |

总分参考：
- 20-25分：高潜力，优先开发 ✅
- 15-19分：中等潜力，需打磨
- <15分：建议重新组合创意
```

### Step 3.2: Creative Combination (创意组合)

**Apply** `creative-combination.md` 的 A+B+C 法：

```json
{
  "questions": [{
    "header": "创意组合",
    "question": "您的创意可以用以下公式描述吗？（题材 + 卖点 + 特色）",
    "options": [
      {"label": "使用推荐组合", "description": "根据您选择的题材，AI推荐3个高潜力组合"},
      {"label": "自定义组合", "description": "您来描述核心创意，AI帮您分析"}
    ],
    "multiSelect": false
  }]
}
```

**IF 使用推荐组合**:
- 根据选定题材，从题材专项指南中提取3个经典组合
- 示例（修仙）：
  1. 修仙 + 系统 + 苟道流 = "低调发育，闷声发大财"
  2. 修仙 + 重生 + 复仇 = "重生归来，碾压前世仇人"
  3. 修仙 + 无敌流 + 群像 = "主角无敌看配角挣扎"

### Step 3.3: Market Positioning (市场定位)

**Apply** `market-positioning.md`:

```json
{
  "questions": [
    {
      "header": "目标读者",
      "question": "您的目标读者是？",
      "options": [
        {"label": "纯新人", "description": "第一次看网文，需要简单直接的爽感"},
        {"label": "轻度读者", "description": "偶尔看网文，喜欢轻松有趣"},
        {"label": "资深老白", "description": "看过大量网文，需要有新意"},
        {"label": "垂直粉丝", "description": "特定题材死忠，如修仙党/系统党"}
      ],
      "multiSelect": false
    },
    {
      "header": "发布平台",
      "question": "计划发布到哪个平台？",
      "options": [
        {"label": "起点中文网", "description": "男频主站，需100万字+"},
        {"label": "番茄小说", "description": "免费阅读，节奏快，2000字/章"},
        {"label": "晋江文学城", "description": "女频为主，言情/耽美"},
        {"label": "知乎", "description": "短篇为主，5-10万字，强钩子"}
      ],
      "multiSelect": false
    }
  ]
}
```

### Step 3.4: Protagonist Deep Design (主角深度设计)

**Apply** `worldbuilding/character-design.md` 的核心三要素：

```json
{
  "questions": [
    {
      "header": "核心欲望",
      "question": "主角最想要什么？（贯穿全书的核心动机）",
      "options": [
        {"label": "长生/变强", "description": "修炼到巅峰，成为最强"},
        {"label": "复仇", "description": "向某人/势力复仇"},
        {"label": "守护", "description": "保护家人/爱人/宗门"},
        {"label": "回家", "description": "穿越者回到原来的世界"}
      ],
      "multiSelect": false
    },
    {
      "header": "性格弱点",
      "question": "主角的性格缺陷是？（完美的圣人令人厌烦）",
      "options": [
        {"label": "贪财", "description": "见钱眼开，但关键时刻靠得住"},
        {"label": "记仇", "description": "有仇必报，睚眦必报"},
        {"label": "护短", "description": "对自己人太好，容易被利用"},
        {"label": "傲慢", "description": "实力强导致的自信，偶尔翻车"}
      ],
      "multiSelect": false
    },
    {
      "header": "人设类型",
      "question": "主角的人设模板是？",
      "options": [
        {"label": "废柴流", "description": "起点低→被嘲讽→逆袭打脸（爽感强）"},
        {"label": "天才流", "description": "天才→被陷害陨落→崛起复仇"},
        {"label": "苟道流", "description": "实力强但低调→关键时刻爆发"},
        {"label": "魔头流", "description": "利益至上，杀伐果断，不圣母"}
      ],
      "multiSelect": false
    }
  ]
}
```

### Step 3.5: Antagonist Design (反派设计)

**Apply** `character-design.md` 的反派等级体系：

```json
{
  "questions": [{
    "header": "主要反派",
    "question": "本书的主要反派类型是？",
    "options": [
      {"label": "C级 脸谱怪", "description": "纯送经验，无脑嚣张，打脸专用"},
      {"label": "B级 利益冲突", "description": "为资源/地位对立，智商在线"},
      {"label": "A级 理念之争", "description": "有自己的信仰，立场不同，值得尊敬"},
      {"label": "S级 宿命之敌", "description": "与主角互为镜像，深层羁绊（如杀父仇人）"}
    ],
    "multiSelect": false
  }]
}
```

---

## Phase 4: Generate Project Files (ALL MODES)

### Step 4.1: Call init_project.py (MANDATORY)

**THIS STEP IS NOT OPTIONAL. YOU MUST EXECUTE IT.**

```bash
python .claude/skills/webnovel-writer/scripts/init_project.py \
  "./webnovel-project" \
  "{小说标题}" \
  "{题材类型}" \
  --protagonist-name "{主角姓名}" \
  --target-words {目标字数} \
  --target-chapters {目标章节数} \
  --golden-finger-name "{金手指称呼}" \
  --golden-finger-type "{金手指类型}" \
  --golden-finger-style "{金手指风格}" \
  --core-selling-points "{核心卖点1},{核心卖点2}"
```

**Extended Parameters** (深度模式):
```bash
  --protagonist-desire "{核心欲望}" \
  --protagonist-flaw "{性格弱点}" \
  --protagonist-archetype "{人设类型}" \
  --antagonist-level "{反派等级}" \
  --target-reader "{目标读者}" \
  --platform "{发布平台}"
```

### Step 4.2: Generate Enhanced Templates

**Based on collected information**, the script generates:

1. **设定集/世界观.md** - 根据题材预填核心设定
2. **设定集/力量体系.md** - 根据题材预置境界体系
3. **设定集/主角卡.md** - 填入主角三要素+金手指
4. **设定集/金手指设计.md** ⬅️ **新增文件**
   - 金手指类型、风格、成长曲线
   - 面板模板（如适用）
   - 与剧情的联动规划
5. **设定集/反派设计.md** ⬅️ **新增文件（深度模式）**
   - 反派等级、动机、与主角关系
6. **大纲/总纲.md** - 根据篇幅生成卷结构
7. **大纲/爽点规划.md** ⬅️ **新增文件**
   - 根据核心卖点预置爽点类型分布
   - 每10章至少1个大爽点的规划

### Step 4.3: Initialize Git Repository

```bash
cd webnovel-project
git init
git add .
git commit -m "初始化网文项目：{小说标题}"
```

---

## Phase 5: Verify & Report (ALL MODES)

### Step 5.1: Verify File Creation (MANDATORY)

```bash
cd webnovel-project
ls -la .webnovel/state.json
ls -la 设定集/世界观.md
ls -la 设定集/力量体系.md
ls -la 设定集/主角卡.md
ls -la 设定集/金手指设计.md
ls -la 大纲/总纲.md
git log --oneline | head -n 1
```

**IF any file is missing** → STOP and report error.

### Step 5.2: Final Output Summary (MANDATORY)

**Output Template**:

```markdown
✅ 网文项目初始化完成！

---

## 📊 项目信息

- **项目路径**: `./webnovel-project/`
- **小说标题**: {小说标题}
- **题材类型**: {题材类型}
- **初始化模式**: {快速/标准/深度}

---

## 👤 主角设定

- **姓名**: {主角姓名}
- **核心欲望**: {欲望}
- **性格弱点**: {弱点}
- **人设类型**: {废柴流/天才流/苟道流/魔头流}

---

## ⚡ 金手指设计

- **类型**: {系统面板流/签到流/鉴定流/...}
- **风格**: {冷漠工具型/毒舌吐槽型/...}
- **成长曲线**: {前期强势/稳步提升/后期爆发}
- **详细设计**: `设定集/金手指设计.md`

---

## 🎯 核心卖点

{列出1-3个核心卖点}

**爽点规划**: `大纲/爽点规划.md`

---

## 📁 已创建文件

### 核心结构
- ✅ `.webnovel/state.json` - 项目运行时状态
- ✅ `.webnovel/backups/` - 自动备份目录

### 设定集
- ✅ `设定集/世界观.md` - {题材}专用模板
- ✅ `设定集/力量体系.md` - 境界体系模板
- ✅ `设定集/主角卡.md` - 主角三要素 + 金手指
- ✅ `设定集/金手指设计.md` - 金手指详细设计 ⬅️ 新增
- ✅ `设定集/角色库/` - 角色档案库
- ✅ `设定集/物品库/` - 物品档案库

### 大纲
- ✅ `大纲/总纲.md` - {N}卷总纲框架
- ✅ `大纲/爽点规划.md` - 核心卖点对应的爽点分布 ⬅️ 新增

### 版本控制
- ✅ Git repository initialized

---

## 🎯 下一步操作（推荐顺序）

### 1. 检查并完善设定 (10-20分钟)
```
cat 设定集/金手指设计.md   # 检查金手指设计
cat 设定集/主角卡.md       # 补充主角细节
```

### 2. 规划第1卷详细大纲
```
/webnovel-plan 1
```

### 3. 开始创作第1章
```
/webnovel-write 1
```

---

## 📚 相关参考文档

根据您的选择，以下参考文档与您的项目高度相关：

{根据题材动态列出}

**题材专项**:
- `references/genres/{题材}/` - 题材专项指南

**金手指设计**:
- `templates/golden-finger-templates.md` - 金手指模板库

**角色设计**:
- `references/worldbuilding/character-design.md` - 人物设计指南

---

## ⚠️ 防幻觉三大定律提醒

1. **大纲即法律**: 按照大纲写，不要临场修改剧情
2. **设定即物理**: 遵守设定集中的规则，不要自相矛盾
3. **发明需申报**: 新增角色/物品/技能时，使用 `[NEW_ENTITY]` 标签

---

**初始化完成！祝您创作顺利！** 🎉
```

---

## Execution Checklist (VERIFY BEFORE CLAIMING "DONE")

**Phase 0**:
- [ ] Checked for existing project
- [ ] User chose initialization mode (快速/标准/深度)

**Phase 1**:
- [ ] Genre selected
- [ ] Basic info collected (title, protagonist name, target length)

**Phase 2** (标准/深度模式):
- [ ] Golden finger type selected
- [ ] Golden finger configuration completed
- [ ] Core selling points confirmed (1-3)

**Phase 3** (仅深度模式):
- [ ] Inspiration assessment completed (五维评分)
- [ ] Creative combination confirmed
- [ ] Market positioning defined
- [ ] Protagonist deep design completed
- [ ] Antagonist design completed

**Phase 4**:
- [ ] init_project.py called with all parameters
- [ ] All files generated successfully
- [ ] Git repository initialized

**Phase 5**:
- [ ] All files verified to exist
- [ ] Complete summary output to user

**IF ANY CHECKBOX IS UNCHECKED → TASK IS NOT COMPLETE.**

---

## Error Handling

**IF** init_project.py fails:

1. **CAPTURE the full error output**
2. **OUTPUT to user** with context
3. **DO NOT proceed** to next steps
4. **WAIT** for user to fix the issue

**IF** user provides incomplete answers:
- Use sensible defaults
- Clearly indicate which defaults were used
- Suggest user can edit files later

---

## Mode Comparison

| 功能 | 快速模式 | 标准模式 | 深度模式 |
|------|---------|---------|---------|
| 基本信息收集 | ✅ | ✅ | ✅ |
| 金手指设计 | ❌ | ✅ | ✅ |
| 核心卖点确认 | ❌ | ✅ | ✅ |
| 灵感五维评估 | ❌ | ❌ | ✅ |
| 创意组合分析 | ❌ | ❌ | ✅ |
| 市场定位 | ❌ | ❌ | ✅ |
| 主角深度设计 | ❌ | ❌ | ✅ |
| 反派设计 | ❌ | ❌ | ✅ |
| 预计耗时 | 5分钟 | 15-20分钟 | 30-45分钟 |
| 适合人群 | 老手/赶时间 | 大多数作者 | 新手/重要项目 |

---

**Start executing Phase 0 now.**
