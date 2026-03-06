---
name: webnovel-plan
description: Builds volume and chapter outlines from the total outline, inherits creative constraints, and prepares writing-ready chapter plans. Use when the user asks for outlining or runs /webnovel-plan.
---

# Outline Planning

Purpose: refine 总纲 into volume + chapter outlines. Do not redesign the global story.
Setting policy: 先基于 init 产出的总纲+世界观补齐设定集基线；再在卷纲完成后，直接对现有设定集做增量补充。

## Project Root Guard
- OpenCode 的“工作区根目录”不一定等于“书项目根目录”。常见结构：工作区为 `D:\wk\xiaoshuo`，书项目为 `D:\wk\xiaoshuo\凡人资本论`。
- 必须先解析 `PROJECT_ROOT` 为真实书项目根（必须包含 `.webnovel/state.json`），后续所有读写路径都以该目录为准。

环境设置（bash 命令执行前）：
```bash
export WORKSPACE_ROOT="${OPENCODE_PROJECT_DIR:-$PWD}"

if [ -z "${OPENCODE_PLUGIN_ROOT}" ] || [ ! -d "${OPENCODE_PLUGIN_ROOT}/skills/webnovel-plan" ]; then
  echo "ERROR: 未设置 CLAUDE_PLUGIN_ROOT 或缺少目录: ${OPENCODE_PLUGIN_ROOT}/skills/webnovel-plan" >&2
  exit 1
fi
export SKILL_ROOT="${OPENCODE_PLUGIN_ROOT}/skills/webnovel-plan"

if [ -z "${OPENCODE_PLUGIN_ROOT}" ] || [ ! -d "${OPENCODE_PLUGIN_ROOT}/scripts" ]; then
  echo "ERROR: 未设置 CLAUDE_PLUGIN_ROOT 或缺少目录: ${OPENCODE_PLUGIN_ROOT}/scripts" >&2
  exit 1
fi
export SCRIPTS_DIR="${OPENCODE_PLUGIN_ROOT}/scripts"

export PROJECT_ROOT="$(python "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

## References（按步骤导航）

- Step 3（必读，节拍表模板）：[大纲-卷节拍表.md](../../templates/output/大纲-卷节拍表.md)
- Step 4.5（必读，时间线模板）：[大纲-卷时间线.md](../../templates/output/大纲-卷时间线.md)
- Step 4（必读，题材配置）：[genre-profiles.md](../../references/genre-profiles.md)
- Step 4（必读，Strand 节奏）：[strand-weave-pattern.md](../../references/shared/strand-weave-pattern.md)
- Step 4（可选，爽点结构需要细化）：[cool-points-guide.md](../../references/shared/cool-points-guide.md)
- Step 5/6（可选，冲突强度分层）：[conflict-design.md](references/outlining/conflict-design.md)
- Step 5（可选，需要钩子/节奏细分）：[reading-power-taxonomy.md](../../references/reading-power-taxonomy.md)
- Step 6（可选，章节微结构细化）：[chapter-planning.md](references/outlining/chapter-planning.md)
- Step 4/5（可选，电竞/直播文/克苏鲁）：[genre-volume-pacing.md](references/outlining/genre-volume-pacing.md)
- 归档（不进主流程）：`references/outlining/outline-structure.md`、`references/outlining/plot-frameworks.md`

## Reference Loading Levels (strict, lazy)

Use progressive disclosure and load only what current step requires:
- L0: No references before scope/volume is confirmed.
- L1: Before each step, load only the "必读" items in **References（按步骤导航）**.
- L2: Load optional items only when the trigger condition applies.

## Workflow
1. Load project data.
2. Build setting baseline from 总纲 + 世界观 (in-place incremental).
3. Select volume and confirm scope.
4. Generate volume beat sheet (节拍表).
4.5. Generate volume timeline (时间线表).
5. Generate volume skeleton.
6. Generate chapter outlines in batches.
7. Enrich existing setting files from volume outline (in-place incremental).
8. Validate + save + update state.

## 1) Load project data
```bash
cat "$PROJECT_ROOT/.webnovel/state.json"
cat "$PROJECT_ROOT/大纲/总纲.md"
```

Optional (only if they exist):
- `设定集/主角组.md`
- `设定集/女主卡.md`
- `设定集/反派设计.md`
- `设定集/世界观.md`
- `设定集/力量体系.md`
- `设定集/主角卡.md`
- `.webnovel/idea_bank.json` (inherit constraints)

If 总纲.md lacks volume ranges / core conflict / climax, ask the user to fill those before proceeding.

## 2) Build setting baseline from 总纲 + 世界观
目标：在不推翻现有内容的前提下，让设定集从“骨架模板”进入“可规划可写作”的基线状态。

输入来源：
- `大纲/总纲.md`
- `设定集/世界观.md`
- `设定集/力量体系.md`
- `设定集/主角卡.md`
- `设定集/反派设计.md`

执行规则（必须）：
- 只做增量补齐，不清空、不重写整文件。
- 优先补齐“可执行字段”：角色定位、势力关系、能力边界、代价规则、反派层级映射。
- 若总纲与现有设定冲突，先列冲突并阻断，等待用户裁决后再改。

基线补齐最小要求：
- `设定集/世界观.md`：世界规则边界、社会结构、关键地点用途。
- `设定集/力量体系.md`：境界链/能力限制/代价与冷却。
- `设定集/主角卡.md`：欲望、缺陷、初始资源与限制。
- `设定集/反派设计.md`：小/中/大反派层级与主角镜像关系。

## 3) Select volume
- Offer choices from 总纲.md (卷名 + 章节范围).
- Confirm any special requirement (tone, POV emphasis, romance, etc.).
If 总纲缺少卷名/章节范围/核心冲突/卷末高潮，先补问并更新总纲，再继续。

## 4) Generate volume beat sheet (节拍表)
目标：先把本卷“承诺→危机递增→中段反转→最低谷→大兑现+新钩子”钉死，避免卷中段漂移。

Load template:
```bash
cat "${SKILL_ROOT}/../../templates/output/大纲-卷节拍表.md"
```

Must satisfy (hard requirements):
- **中段反转（必填）**：不得留空；若无，写 `无（理由：...）`
- **危机链**：至少 3 次递增（表格 1-3 行不得空）
- **卷末新钩子**：必须能落到“最后一章的章末未闭合问题”

Write output:
```bash
@'
{beat_sheet_content}
'@ | Set-Content -Encoding UTF8 "$PROJECT_ROOT/大纲/第{volume_id}卷-节拍表.md"
```

Completion criteria:
- `大纲/第{volume_id}卷-节拍表.md` 存在且非空
- Step 4/5 能直接引用 Catalyst / 中段反转 / 最低谷 / 大兑现 / 新钩子来锚定节奏

## 4.5) Generate volume timeline (时间线表)

目标：为本卷建立时间轴基准，确保章节间时间推进逻辑自洽，避免"第一章灾变第二章火拼"的时间跳跃问题。

Load template:
```bash
cat "${SKILL_ROOT}/../../templates/output/大纲-卷时间线.md"
```

Must satisfy (hard requirements):
- **时间基准（必填）**：明确本卷使用的时间体系（末世第X天/仙历年月/现代日期）
- **本卷时间跨度（必填）**：本卷覆盖的时间范围
- **关键倒计时事件**：若有时限性事件（物资耗尽/大比开始/截止日期），必须列出并标注 D-N

Write output:
```bash
@'
{timeline_content}
'@ | Set-Content -Encoding UTF8 "$PROJECT_ROOT/大纲/第{volume_id}卷-时间线.md"
```

Completion criteria:
- `大纲/第{volume_id}卷-时间线.md` 存在且非空
- 时间基准和本卷跨度已明确
- 若存在倒计时事件，已在表中列出

## 5) Generate volume skeleton
Load genre profile and apply standards:
```bash
cat "${SKILL_ROOT}/../../references/genre-profiles.md"
cat "${SKILL_ROOT}/../../references/shared/strand-weave-pattern.md"
```

Optional (only if爽点结构需要细化):
```bash
cat "${SKILL_ROOT}/../../references/shared/cool-points-guide.md"
```

Optional (only if需要补强卷级冲突链与强度分层):
```bash
cat "${SKILL_ROOT}/references/outlining/conflict-design.md"
```

Load beat sheet (must exist):
```bash
cat "$PROJECT_ROOT/大纲/第{volume_id}卷-节拍表.md"
```

Extract for current genre:
- Strand 比例（Quest/Fire/Constellation）
- 爽点密度标准（每章最低/推荐）
- 钩子类型偏好

### Strand Weave 规划策略
Based on genre profile, distribute chapters:
- **Quest Strand** (主线推进): 55-65% 章节
  - 目标明确、进展可见、有阶段性成果
  - 例：突破境界、完成任务、获得宝物
- **Fire Strand** (情感/关系): 20-30% 章节
  - 人物关系变化、情感冲突、团队动态
  - 例：与女主互动、师徒矛盾、兄弟背叛
- **Constellation Strand** (世界/谜团): 10-20% 章节
  - 世界观揭示、伏笔埋设、谜团推进
  - 例：发现古老秘密、揭示反派阴谋、世界真相

**Weaving pattern** (recommended):
- 每 3-5 章切换主导 Strand
- 高潮章节可多 Strand 交织
- 卷末 3-5 章集中 Quest Strand

For 电竞/直播文/克苏鲁, apply dedicated volume pacing template:
```bash
cat "${SKILL_ROOT}/references/outlining/genre-volume-pacing.md"
```

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
cat "$PROJECT_ROOT/.webnovel/idea_bank.json"
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

## 6) Generate chapter outlines (batched)
Batching rule:
- ≤20 章：1 批
- 21–40 章：2 批
- 41–60 章：3 批
- >60 章：4+ 批

Optional (only if需要钩子/节奏细分):
```bash
cat "${SKILL_ROOT}/../../references/reading-power-taxonomy.md"
```

Optional (only if需要章节微结构/标题策略细化):
```bash
cat "${SKILL_ROOT}/references/outlining/chapter-planning.md"
```

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
- 阻力: {20字以内}
- 代价: {20字以内}
- 时间锚点: {末世第X天 时段/仙历X年X月X日/具体日期+时段}
- 章内时间跨度: {如 3小时/半天/1天}
- 与上章时间差: {如 紧接/6小时/1天/跨夜}
- 倒计时状态: {事件A D-3 -> D-2 / 无}
- 爽点: {类型} - {30字以内}
- Strand: {Quest|Fire|Constellation}
- 反派层级: {无/小/中/大}
- 视角/主角: {主角A/主角B/女主/群像}
- 关键实体: {新增或重要出场}
- 本章变化: {30字以内，优先可量化变化}
- 章末未闭合问题: {30字以内}
- 钩子: {类型} - {30字以内}
```

**时间字段说明**：
- **时间锚点**：本章发生的具体时间点，必须与时间线表一致
- **章内时间跨度**：本章内容覆盖的时间长度
- **与上章时间差**：与上一章结束时间的间隔
  - 紧接：无时间间隔，直接承接
  - 跨夜：过夜但不超过 12 小时
  - 具体时长：如 6小时、1天、3天
- **倒计时状态**：若存在倒计时事件，标注推进情况（D-N → D-(N-1)）

**字段说明**：
- **章末未闭合问题**：本章结尾必须保留的“未闭合决策/问题”，用于驱动读者点下一章。
  - 规则：必须与 **钩子** 的类型/强度一致；不得出现“钩子很强但问题很虚”的错配。
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

## 7) Enrich existing setting files from volume outline
目标：卷纲写完后，把本卷新增事实写回“现有设定集文件”，确保后续写作可直接读取。

输入来源：
- `大纲/第{volume_id}卷-节拍表.md`
- `大纲/第{volume_id}卷-详细大纲.md`
- 现有设定集文件（世界观/力量体系/主角卡/主角组/女主卡/反派设计）

写回策略（必须）：
- 仅增量补充相关段落，不覆盖整文件。
- 新增角色：写入对应角色卡或角色组条目（含首次出场章、关系、红线）。
- 新增势力/地点/规则：写入世界观或力量体系对应章节。
- 新增反派层级信息：写入反派设计并保持小/中/大层级一致。

冲突处理（硬规则）：
- 若卷纲新增信息与总纲或已确认设定冲突，标记 `BLOCKER` 并停止 state 更新。
- 只有冲突裁决完成后，才允许继续更新设定并进入保存步骤。

## 8) Validate + save
### Validation checks (must pass all)

**1. 爽点密度检查**
- 每章 ≥1 小爽点（强度 2-3）
- 每 5-8 章至少 1 个关键章节（强度 4-5）
- 每卷至少 1 个高潮章节（强度 6-7）

**2. Strand 比例检查**
Count chapters by Strand and compare with genre profile:
- Quest: 应占 55-65%
- Fire: 应占 20-30%
- Constellation: 应占 10-20%

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
- 阻力（20 字以内）
- 代价（20 字以内）
- 时间锚点（必填）
- 章内时间跨度（必填）
- 与上章时间差（必填）
- 倒计时状态（若有倒计时事件则必填）
- 爽点（类型 + 30 字描述）
- Strand（Quest/Fire/Constellation）
- 反派层级（无/小/中/大）
- 视角/主角
- 关键实体（至少 1 个）
- 本章变化（30 字以内）
- 章末未闭合问题（30 字以内）
- 钩子（类型 + 30 字描述）

**6. 时间线一致性检查（新增）**
- 时间线表文件存在：`大纲/第{volume_id}卷-时间线.md`
- 所有章节时间锚点已填写
- 时间单调递增（不得回跳，除非明确标注为闪回）
- 倒计时推进正确（D-5 → D-4 → D-3，不得跳跃）
- 大跨度时间跳跃（>3天）必须有过渡章说明或明确标注

**7. 设定补全检查**
- 本卷涉及的新角色/势力/规则已回写到现有设定集文件
- 所有新增条目可回溯到本卷章纲章节
- `BLOCKER` 数量为 0；若 >0，必须先裁决，不得进入 state 更新

Update state (include chapters range):
```bash
python "${SCRIPTS_DIR}/webnovel.py" --project-root "$PROJECT_ROOT" update-state -- \
  --volume-planned {volume_id} \
  --chapters-range "{start}-{end}"
```

Final check:
- 节拍表文件已写入：`大纲/第{volume_id}卷-节拍表.md`
- 时间线表文件已写入：`大纲/第{volume_id}卷-时间线.md`
- 章纲文件已写入：`大纲/第{volume_id}卷-详细大纲.md`
- 设定集已完成基线补齐与本卷增量补充（原文件内可见）
- 每章包含：目标/阻力/代价/时间锚点/章内时间跨度/与上章时间差/爽点/Strand/反派层级/视角/关键实体/本章变化/章末未闭合问题/钩子
- 时间线单调递增，倒计时推进正确
- 与总纲冲突/高潮一致，约束触发频率合理（如有 idea_bank）

### Hard fail conditions (must stop)
- 节拍表文件不存在或为空
- 节拍表中段反转缺失（未按“必填/无（理由）”规则填写）
- **时间线表文件不存在或为空**
- 章纲文件不存在或为空
- 任一章节缺少：目标/阻力/代价/时间锚点/章内时间跨度/与上章时间差/爽点/Strand/反派层级/视角/关键实体/本章变化/章末未闭合问题/钩子
- **任一章节时间字段（时间锚点/章内时间跨度/与上章时间差）缺失**
- **时间回跳且未标注为闪回**
- **倒计时算术冲突（如 D-5 直接跳到 D-2）**
- **重大事件发生时间与前章间隔不足且无合理解释（如末世第1天建帮派）**
- 与总纲核心冲突或卷末高潮明显冲突
- 设定集基线未补齐，或本卷增量未回写到现有设定集
- 存在 `BLOCKER` 未裁决
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
