---
name: webnovel-plan
description: Builds volume and chapter outlines from the total outline, inherits creative constraints, and prepares writing-ready chapter plans. Use when the user asks for outlining or runs /webnovel-plan.
---

# Outline Planning

Purpose: refine 总纲 into volume + chapter outlines. Do not redesign the global story.

## Project Root Guard
- Must run inside a project containing `.webnovel/state.json`.
- If missing, ask for the project path and `cd` into it.

## Reference Loading Levels (strict, lazy)

Use progressive disclosure and load only what current step requires:
- L0: No references before scope/volume is confirmed.
- L1: Minimum set for current generation step.
- L2: Conditional references only if constraints/genre details are needed.

### L1 (step-gated minimum)
- Before Step 3 (volume skeleton):
  - `references/strand-weave-pattern.md`
  - `.claude/references/genre-profiles.md`

### L2 (conditional)
- Before Step 3, load only if爽点结构需要细化:
  - `references/cool-points-guide.md`
- Before Step 4, load only if需要钩子/节奏细分:
  - `.claude/references/reading-power-taxonomy.md`

## Workflow
1. Load project data.
2. Select volume and confirm scope.
3. Generate volume skeleton.
4. Generate chapter outlines in batches.
5. Validate + save + update state.

## 1) Load project data
```bash
cat "$PROJECT_ROOT/.webnovel/state.json"
cat "$PROJECT_ROOT/大纲/总纲.md"
```

Optional (only if they exist):
- `设定集/主角组.md`
- `设定集/女主卡.md`
- `设定集/反派设计.md`
- `.webnovel/idea_bank.json` (inherit constraints)

If 总纲.md lacks volume ranges / core conflict / climax, ask the user to fill those before proceeding.

## 2) Select volume
- Offer choices from 总纲.md (卷名 + 章节范围).
- Confirm any special requirement (tone, POV emphasis, romance, etc.).
If 总纲缺少卷名/章节范围/核心冲突/卷末高潮，先补问并更新总纲，再继续。

## 3) Generate volume skeleton
Load genre profile and apply standards:
```bash
cat ".claude/references/genre-profiles.md"
```

Extract for current genre:
- Strand 比例（Quest/Fire/Constellation）
- 爽点密度标准（每章最低/推荐）
- 钩子类型偏好

### Strand Weave 规划策略
Based on genre profile, distribute chapters:
- **Quest Strand** (主线推进): 40-60% 章节
  - 目标明确、进展可见、有阶段性成果
  - 例：突破境界、完成任务、获得宝物
- **Fire Strand** (情感/关系): 20-35% 章节
  - 人物关系变化、情感冲突、团队动态
  - 例：与女主互动、师徒矛盾、兄弟背叛
- **Constellation Strand** (世界/谜团): 10-25% 章节
  - 世界观揭示、伏笔埋设、谜团推进
  - 例：发现古老秘密、揭示反派阴谋、世界真相

**Weaving pattern** (recommended):
- 每 3-5 章切换主导 Strand
- 高潮章节可多 Strand 交织
- 卷末 3-5 章集中 Quest Strand

### 爽点密度规划策略
Based on genre profile:
- **常规章节**: 1-2 个小爽点（强度 2-3）
- **关键章节**: 2-3 个爽点，至少 1 个中爽点（强度 4-5）
- **高潮章节**: 3-4 个爽点，至少 1 个大爽点（强度 6-7）

**Distribution rule**:
- 每 5-8 章至少 1 个关键章节
- 每卷至少 1 个高潮章节（通常在卷末）

### 约束触发规划策略
If idea_bank.json exists:
```bash
cat ".webnovel/idea_bank.json"
```

Calculate trigger frequency:
- **反套路规则**: 每 N 章触发 1 次
  - N = max(5, 总章数 / 10)
  - 例：50 章卷 → 每 5 章触发
  - 例：100 章卷 → 每 10 章触发
- **硬约束**: 贯穿全卷，在章节目标/爽点设计中体现
- **主角缺陷**: 每卷至少 2 次成为冲突来源
- **反派镜像**: 反派出场章节必须体现镜像对比

Use this template and fill from 总纲 + idea_bank:

```markdown
# 第 {volume_id} 卷：{卷名}

> 章节范围: 第 {start} - {end} 章
> 核心冲突: {conflict}
> 卷末高潮: {climax}

## 卷摘要
{2-3 段落概述}

## 关键人物与反派
- 主要登场角色：
- 反派层级：

## Strand Weave 规划
| 章节范围 | 主导 Strand | 内容概要 |
|---------|------------|---------|

## 爽点密度规划
| 章节 | 爽点类型 | 具体内容 | 强度 |
|------|---------|---------|------|

## 伏笔规划
| 章节 | 操作 | 伏笔内容 |
|------|------|---------|

## 约束触发规划（如有）
- 反套路规则：每 N 章触发一次
- 硬约束：贯穿全卷
```

## 4) Generate chapter outlines (batched)
Batching rule:
- ≤20 章：1 批
- 21–40 章：2 批
- 41–60 章：3 批
- >60 章：4+ 批

### Chapter generation strategy
For each chapter, determine:

**1. Strand assignment** (follow volume skeleton distribution)
- Quest: 主线任务推进、目标达成、能力提升
- Fire: 人物关系、情感冲突、团队动态
- Constellation: 世界揭示、伏笔埋设、谜团推进

**2. 爽点设计** (based on Strand and position)
- Quest Strand → 成就爽点（打脸、逆袭、突破）
- Fire Strand → 情感爽点（认可、保护、告白）
- Constellation Strand → 认知爽点（真相、预言、身份）

**3. 钩子设计** (based on next chapter's Strand)
- 悬念钩子：提出问题、制造危机
- 承诺钩子：预告奖励、暗示转折
- 情感钩子：关系变化、角色危机

**4. 反派层级** (based on volume skeleton)
- 无：日常章节、修炼章节、关系章节
- 小：小冲突、小反派、局部对抗
- 中：中反派出场、重要冲突、阶段性对抗
- 大：大反派出场、核心冲突、卷级高潮

**5. 关键实体** (new or important)
- 新角色：姓名 + 一句话定位
- 新地点：名称 + 一句话描述
- 新物品：名称 + 功能
- 新势力：名称 + 立场

**6. 约束检查** (if idea_bank exists)
- 是否触发反套路规则？
- 是否体现硬约束？
- 是否展现主角缺陷？
- 是否体现反派镜像？

Chapter format (include 反派层级 for context-agent):

```markdown
### 第 {N} 章：{标题}
- 目标: {20字以内}
- 爽点: {类型} - {30字以内}
- Strand: {Quest|Fire|Constellation}
- 反派层级: {无/小/中/大}
- 视角/主角: {主角A/主角B/女主/群像}
- 关键实体: {新增或重要出场}
- 钩子: {类型} - {30字以内}
```

**字段说明**：
- **钩子**：本章应设置的章末钩子（规划用）
  - 例：悬念钩 - 神秘人身份即将揭晓
  - 意思是：本章结尾要设置这个悬念钩子
  - 下章 context-agent 会读取 chapter_meta[N].hook（实际实现的钩子），生成"接住上章"指导
  - 钩子类型参考：悬念钩 | 危机钩 | 承诺钩 | 情绪钩 | 选择钩 | 渴望钩

Save after each batch:
```bash
@'
{batch_content}
'@ | Add-Content -Encoding UTF8 "$PROJECT_ROOT/大纲/第{volume_id}卷-详细大纲.md"
```

## 5) Validate + save
### Validation checks (must pass all)

**1. 爽点密度检查**
- 每章 ≥1 小爽点（强度 2-3）
- 每 5-8 章至少 1 个关键章节（强度 4-5）
- 每卷至少 1 个高潮章节（强度 6-7）

**2. Strand 比例检查**
Count chapters by Strand and compare with genre profile:
- Quest: 应占 40-60%
- Fire: 应占 20-35%
- Constellation: 应占 10-25%

If deviation > 15%, adjust chapter assignments.

**3. 总纲一致性检查**
- 卷核心冲突是否贯穿章节？
- 卷末高潮是否在最后 3-5 章体现？
- 关键人物是否按计划登场？

**4. 约束触发频率检查** (if idea_bank exists)
- 反套路规则触发次数 ≥ 总章数 / N（N = max(5, 总章数/10)）
- 硬约束在至少 50% 章节中体现
- 主角缺陷至少 2 次成为冲突来源
- 反派镜像在反派出场章节中体现

**5. 完整性检查**
Every chapter must have:
- 目标（20 字以内）
- 爽点（类型 + 30 字描述）
- Strand（Quest/Fire/Constellation）
- 反派层级（无/小/中/大）
- 视角/主角
- 关键实体（至少 1 个）
- 钩子（类型 + 30 字描述）

Update state (include chapters range):
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/update_state.py" \
  --project-root "$PROJECT_ROOT" \
  --volume-planned {volume_id} \
  --chapters-range "{start}-{end}"
```

Final check:
- 章纲文件已写入：`大纲/第{volume_id}卷-详细大纲.md`
- 每章包含：目标/爽点/Strand/反派层级/视角/关键实体/钩子
- 与总纲冲突/高潮一致，约束触发频率合理（如有 idea_bank）

### Hard fail conditions (must stop)
- 章纲文件不存在或为空
- 任一章节缺少：目标/爽点/Strand/反派层级/视角/关键实体/钩子
- 与总纲核心冲突或卷末高潮明显冲突
- 约束触发频率不足（当 idea_bank 启用时）

### Rollback / recovery
If any hard fail triggers:
1. Stop and list the failing items.
2. Re-generate only the failed batch (do not overwrite the whole file).
3. If the last batch is invalid, remove that batch and rewrite it.
4. Only update state after Final check passes.

Next steps:
- 继续规划下一卷 → /webnovel-plan
- 开始写作 → /webnovel-write
