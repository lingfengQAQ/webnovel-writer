---
name: webnovel-plan
description: Plans detailed volume outlines with chapter-by-chapter breakdown, cool-point distribution, and Strand Weave pacing. Activates when user requests outline planning or /webnovel-plan.
allowed-tools: Read Write Edit AskUserQuestion Bash
---

# Outline Planning Skill

## 定位说明

本技能用于**将总纲细化为章节大纲**，而非从头设计卷结构。

- 卷的章节范围、核心冲突、关键爽点、伏笔安排等信息**从总纲获取**
- 用户可选择**微调**总纲设定，但不建议大幅修改
- 重点是为每一章设计具体内容：目标、爽点、Strand、实体、伏笔

---

## Project Root Guard（必须先确认）

- 必须在项目根目录执行（需存在 `.webnovel/state.json`）
- 若当前目录不存在该文件，先询问用户项目路径并 `cd` 进入
- 进入后设置变量：`$PROJECT_ROOT = (Resolve-Path ".").Path`
- **禁止**在 `.claude/` 下写入任何项目文件

---

## Workflow Checklist

```
大纲规划进度：
- [ ] Phase 1: 加载核心资料
- [ ] Phase 2: 加载项目数据 + 解析总纲
- [ ] Phase 2.5: 加载创意约束（如存在） ← 新增
- [ ] Phase 3: 确认上下文充足
- [ ] Phase 4: 选择规划范围
- [ ] Phase 5: 微调确认（可选）
- [ ] Phase 6: 生成章节大纲
- [ ] Phase 7: 质量验证（含约束继承检查）
- [ ] Phase 8: 保存并更新状态
```

---

## Phase 1: 加载核心资料

### 1.1 加载爽点指南（必须执行）

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-plan/references/cool-points-guide.md"
```

**关键规则**：
- 每章 ≥1 个小爽点（单一模式）
- 每 5 章 ≥1 个组合爽点（2种模式叠加）
- 每 10-15 章 ≥1 个里程碑爽点（改变主角地位）
- 避免连续 3 章同类型

### 1.2 加载节奏规范（必须执行）

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-plan/references/strand-weave-pattern.md"
```

**关键规则**：
- Quest ≤5 连续章
- Fire 每 10 章内出现
- Constellation 每 15 章内出现
- 目标比例: Quest 55-65%, Fire 20-30%, Constellation 10-20%

### 1.3 加载大纲设计参考（必须执行）

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-plan/references/outlining/chapter-planning.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-plan/references/outlining/conflict-design.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-plan/references/outlining/outline-structure.md"
cat "${CLAUDE_PLUGIN_ROOT}/skills/webnovel-plan/references/outlining/plot-frameworks.md"
```

---

## Phase 2: 加载项目数据

### 2.1 加载状态和总纲

```bash
cat "$PROJECT_ROOT/.webnovel/state.json"
cat "$PROJECT_ROOT/大纲/总纲.md"
```

### 2.1.1 读取人物与反派设定（如存在）

```bash
if (Test-Path "$PROJECT_ROOT/设定集/主角组.md") { Get-Content "$PROJECT_ROOT/设定集/主角组.md" -Encoding UTF8 }
if (Test-Path "$PROJECT_ROOT/设定集/女主卡.md") { Get-Content "$PROJECT_ROOT/设定集/女主卡.md" -Encoding UTF8 }
if (Test-Path "$PROJECT_ROOT/设定集/反派设计.md") { Get-Content "$PROJECT_ROOT/设定集/反派设计.md" -Encoding UTF8 }
```
### 2.2 解析总纲卷结构

从总纲中提取：
- 总体结构（阶段/章节/境界/地图）
- 各卷信息：
  - 章节范围
  - 核心冲突
  - 关键爽点（已设计的）
  - 卷末高潮
  - 主要登场角色
  - 伏笔安排（埋/收）

### 2.3 检查已有详细大纲

```bash
Get-ChildItem "$PROJECT_ROOT/大纲/第*卷*.md" -ErrorAction SilentlyContinue
```

---

## Phase 2.5: 加载创意约束（如存在）

### 2.5.1 检查 idea_bank.json

```bash
if (Test-Path "$PROJECT_ROOT/.webnovel/idea_bank.json") {
    Get-Content "$PROJECT_ROOT/.webnovel/idea_bank.json" -Encoding UTF8
}
```

### 2.5.2 提取继承约束

如果 `idea_bank.json` 存在，提取以下约束用于大纲规划：

| 约束类型 | 来源字段 | 用途 |
|---------|---------|------|
| 反套路规则 | `constraints_inherited.anti_trope` | 每 N 章至少触发 1 次 |
| 硬约束 | `constraints_inherited.hard_constraints` | 贯穿全卷的世界观/能力限制 |
| 主角缺陷 | `constraints_inherited.protagonist_flaw` | 影响主角行为和成长 |
| 反派镜像 | `constraints_inherited.antagonist_mirror` | 设计反派冲突 |

### 2.5.3 约束触发频率

| 卷规模 | 约束触发频率 |
|--------|-------------|
| ≤20章 | 每 5 章至少 1 次 |
| 21-40章 | 每 5 章至少 1 次 |
| 41-60章 | 每 6 章至少 1 次 |
| >60章 | 每 7 章至少 1 次 |

**约束触发示例**：
- 反套路规则"金手指有代价" → 第5章主角使用金手指付出代价
- 硬约束"修仙者不能杀凡人" → 第12章主角面临凡人威胁但无法直接出手

---

## Phase 3: 确认上下文充足

**检查清单**：
- [ ] 爽点类型和密度要求已理解
- [ ] Strand Weave 比例已理解
- [ ] 总纲卷结构已解析（知道有多少卷、每卷范围）
- [ ] 当前写作进度已知（state.json）
- [ ] 章节规划技巧已加载（outlining/*）

**如有缺失 → 返回对应 Phase**

---

## Phase 4: 选择规划范围

### 4.1 选择要规划的卷

**[AskUserQuestion Round 1]**

根据总纲解析结果，动态生成选项：

| 问题 | 选项示例 |
|------|----------|
| 要规划第几卷？ | 第1卷：废材崛起(1-50章) / 第2卷：宗门大比(51-100章) / 第3卷：乱葬探秘(101-150章) / 其他卷 |

> 选项从总纲自动提取，显示卷名和章节范围。如果用户选"其他卷"，追问具体卷号。

### 4.2 显示该卷总纲信息

选择卷后，展示从总纲获取的信息：

```
【第X卷总纲信息】
- 章节范围: 第{start}-{end}章
- 核心冲突: {conflict}
- 关键爽点: {cool_points}
- 卷末高潮: {climax}
- 登场角色: {characters}
- 反派层级: {antagonist_tier}
- 伏笔安排: {foreshadowing}
```

---

## Phase 5: 微调确认（可选）

### 5.1 确认是否调整

**[AskUserQuestion Round 2]**

| 问题 | 选项 |
|------|------|
| 是否调整卷设定？ | 使用总纲设定（推荐） / 微调核心冲突 / 微调爽点安排 / 微调伏笔 |
| 爽点类型侧重？ | 按总纲均衡分布 / 侧重打脸反杀 / 侧重淘宝捡漏 / 侧重识破伪装 |

### 5.2 Strand 分布偏好

**[AskUserQuestion Round 3]**

| 问题 | 选项 |
|------|------|
| 本卷节奏偏好？ | Quest重(战斗升级) / Fire重(感情发展) / Constellation重(世界观) / 均衡分布 |
| 感情线安排？ | 推进现有感情线 / 引入新角色 / 维持暧昧 / 本卷无感情戏 |

### 5.3 实力提升确认

**[AskUserQuestion Round 4]**（如总纲有境界变化）

| 问题 | 选项 |
|------|------|
| 境界突破时机？ | 卷初突破 / 卷中突破 / 卷末突破（推荐） / 无突破 |
| 突破方式？ | 战斗中顿悟 / 闭关修炼 / 机缘获得 / 生死危机激发 |

---

## Phase 6: 生成章节大纲

### ⚠️ Token 控制策略

**问题**：50章详细大纲一次性生成约 12000-17000 字，容易导致思考超时(504错误)。

**解决方案：分批生成**

| 卷规模 | 分批策略 | 每批章节数 |
|--------|----------|-----------|
| ≤20章 | 1批完成 | 全部 |
| 21-40章 | 2批 | 每批10-20章 |
| 41-60章 | 3批 | 每批15-20章 |
| >60章 | 4+批 | 每批15章 |

**执行流程**：
1. 先生成**卷骨架**（卷摘要 + Strand规划 + 爽点密度表）
2. 分批生成**章节详细大纲**（每批10-20章）
3. 每批生成后保存，再继续下一批

### 6.1 第一步：生成卷骨架

```markdown
# 第 {volume_id} 卷：{卷名}

> **章节范围**: 第 {start} - {end} 章
> **核心冲突**: {从总纲获取或用户调整}
> **本卷目标**: {境界/地位/关系变化}

## 卷摘要
{2-3 段落，概述本卷剧情走向}

---

## Strand Weave 规划（先规划，后填充）

| 章节范围 | 主导 Strand | 内容概要 |
|---------|------------|---------|
| 第1-5章 | Quest | {简要概述} |
| 第6章 | Fire | {简要概述} |
| 第7-10章 | Quest | {简要概述} |
| ... | ... | ... |

### Strand 占比统计
- Quest: X% (目标: 55-65%)
- Fire: Y% (目标: 20-30%)
- Constellation: Z% (目标: 10-20%)

---

## 爽点密度规划（先规划关键节点）

| 章节 | 爽点类型 | 具体内容 | 强度 |
|------|---------|---------|------|
| 第1章 | 小爽点 | {开局爽点} | ⭐ |
| 第5章 | 组合爽点 | {第一个组合} | ⭐⭐ |
| 第10章 | 里程碑爽点 | {第一个里程碑} | ⭐⭐⭐ |
| 第{end}章 | 里程碑爽点 | {卷末高潮} | ⭐⭐⭐ |

---

## 伏笔规划

| 章节 | 操作 | 伏笔内容 | 层级 |
|------|------|---------|------|
| 第X章 | 埋设 | {内容} | 支线 |
| 第Y章 | 回收 | {内容} | 核心 |

## 主角/女主推进（如适用）

| 角色 | 本卷目标 | 关键转折 | 关系推进 |
|------|----------|----------|----------|
| 主角 | {目标} | {转折} | {关系} |
| 女主 | {目标} | {转折} | {关系} |

## 反派分层推进

| 层级 | 目标 | 出场章节 | 本卷推进 |
|------|------|----------|----------|
| 小反派 | {目标} | {章节} | {推进方式} |
| 中反派 | {目标} | {章节} | {推进方式} |
| 大反派 | {目标} | {章节} | {推进方式} |
```

**骨架生成后，询问用户是否继续生成章节详情。**

### 6.2 第二步：分批生成章节详情

**[AskUserQuestion Round 5]**（骨架完成后）

| 问题 | 选项 |
|------|------|
| 骨架已生成，继续生成章节详情？ | 生成第1-10章 / 生成第1-20章 / 全部生成（可能超时） / 先保存骨架 |

**每批章节格式**（增强版，控制字数）：

```markdown
## 第 {batch_start}-{batch_end} 章详情

### 第 {N} 章：{标题}
- **目标**: {20字以内}
- **开头类型**: {冲突开场/悬疑开场/动作开场/对话开场/氛围开场}
- **爽点**: {类型} - {30字以内}
- **Strand**: {Quest|Fire|Constellation}
- **视角/主角**: {主角A/主角B/女主/群像}
- **反派层级**: {无/小反派/中反派/大反派}
- **实体**: {新增角色/物品，如有}
- **钩子类型**: {危机钩/悬念钩/情绪钩/选择钩/渴望钩}
- **钩子内容**: {章末悬念，30字以内}
- **接住上章**: {如何接住上章钩子，20字以内}
```

**每批约 1500-2500 字，避免超时。**

### 6.3 分批保存策略

每批生成后立即追加保存到大纲文件：

```bash
# 第一批
@'
{第1-10章内容}
'@ | Add-Content -Encoding UTF8 "$PROJECT_ROOT/大纲/第{volume_id}卷-详细大纲.md"

# 第二批
@'
{第11-20章内容}
'@ | Add-Content -Encoding UTF8 "$PROJECT_ROOT/大纲/第{volume_id}卷-详细大纲.md"
```

这样即使中途失败，已生成的内容不会丢失。

---

## Phase 7: 质量验证

**验证清单**：

### 爽点检查
- [ ] 每章有 ≥1 小爽点
- [ ] 每 5 章有 ≥1 组合爽点
- [ ] 每 10-15 章有 ≥1 里程碑爽点
- [ ] 无 3+ 连续同类型爽点

### Strand 检查
- [ ] Quest ≤5 连续章
- [ ] Fire 每 10 章内出现
- [ ] Constellation 每 15 章内出现
- [ ] 占比符合目标范围

### 一致性检查
- [ ] 与总纲核心冲突一致
- [ ] 与总纲伏笔安排一致
- [ ] 登场角色符合总纲设定
- [ ] 卷末高潮符合预期
- [ ] 多主角/女主视角分配合理（如适用）

### 约束继承检查（如有 idea_bank.json）
- [ ] 反套路规则每 N 章至少触发 1 次
- [ ] 硬约束在关键章节体现
- [ ] 主角缺陷影响至少 2 个关键决策
- [ ] 反派镜像设计在反派出场章节体现

**约束触发统计表**（如适用）：

```markdown
## 约束触发统计

| 约束 | 触发章节 | 触发方式 |
|------|---------|---------|
| {反套路规则} | 第X章, 第Y章 | {描述} |
| {硬约束1} | 第A章, 第B章 | {描述} |
| {硬约束2} | 第C章 | {描述} |
| 主角缺陷 | 第D章, 第E章 | {影响决策} |
```

---

## Phase 8: 保存并更新状态

### 8.1 保存大纲文件

```bash
# 保存到: 大纲/第{volume_id}卷-详细大纲.md
```

### 8.2 更新项目状态

```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/update_state.py" \
  --project-root "$PROJECT_ROOT" \
  --volume-planned {volume_id} \
  --chapters-range "{start}-{end}"
```

### 8.3 输出下一步建议

- 如需继续规划下一卷 → 重新执行 /webnovel-plan
- 如准备开始写作 → 执行 /webnovel-write

---

## AskUserQuestion 轮次汇总

| 轮次 | 阶段 | 问题数 | 说明 |
|------|------|--------|------|
| Round 1 | Phase 4 | 1 | 选择要规划的卷 |
| Round 2 | Phase 5 | 2 | 确认是否调整 + 爽点侧重 |
| Round 3 | Phase 5 | 2 | Strand偏好 + 感情线 |
| Round 4 | Phase 5 | 2 | 境界突破（如适用） |
| Round 5 | Phase 6 | 1 | 骨架完成后确认生成范围 |

**总计**: 5轮，约8个问题（Round 4/5 可选）
