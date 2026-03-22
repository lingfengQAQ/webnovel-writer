---
name: pacing-checker
description: Strand Weave 节奏检查，输出结构化报告供润色步骤参考
tools: Read, Grep, Bash
model: inherit
---

# pacing-checker (节奏检查器)

> **职责**: 节奏分析师，执行 Strand Weave 平衡检查，防止读者疲劳。

> **输出格式**: 遵循 `${CLAUDE_PLUGIN_ROOT}/references/checker-output-schema.md` 统一 JSON Schema

## 检查范围

**输入**: 单章或章节区间（如 `45` / `"45-46"`）

**输出**: 情节线分布分析、平衡预警、节奏建议。

## 执行流程

### 第一步: 加载上下文

**输入参数**:
```json
{
  "project_root": "{PROJECT_ROOT}",
  "storage_path": ".webnovel/",
  "state_file": ".webnovel/state.json",
  "chapter_file": "正文/第{N}卷/第{NNN}章-{title_safe}.md"
}
```

`chapter_file` 应传实际章节文件路径；若当前项目仍使用旧格式 `正文/第{NNNN}章.md`，同样允许。

**并行读取**:
1. `正文/` 下的目标章节
2. `{project_root}/.webnovel/state.json`（strand_tracker 历史）
3. `大纲/`（理解预期弧线结构）

**可选: 使用 status_reporter 进行自动化分析**:
```bash
python -X utf8 "${CLAUDE_PLUGIN_ROOT:?CLAUDE_PLUGIN_ROOT is required}/scripts/webnovel.py" --project-root "${PROJECT_ROOT}" status -- --focus strand
```

### 第二步: 章节情节线分类

**对每章，识别主导情节线**：

| Strand | Indicators | Examples |
|--------|-----------|----------|
| **Quest** (主线) | 战斗/任务/探索/升级/打怪 | 参加宗门大比、探索秘境、击败反派 |
| **Fire** (感情线) | 情感关系/暧昧/友情/羁绊 | 与李雪的感情发展、师徒情深、兄弟义气 |
| **Constellation** (世界观线) | 势力关系/阵营/社交网络/揭示世界观 | 新势力登场、修仙界格局展示、宗门政治 |

**分类规则**:
- 一章可以有多条情节线的**底色**，但只有**一条主导**
- 主导 = 占据章节内容 ≥ 60%

**Example**:
```
第45章：主角参加大比（Quest 80%）+ 李雪担心主角（Fire 20%）
→ Dominant: Quest

第46章：主角与李雪约会（Fire 70%）+ 揭示血煞门阴谋（Constellation 30%）
→ Dominant: Fire
```

### 第三步: 平衡检查（Strand Weave 违规）

**从 state.json 加载 strand_tracker**:
```json
{
  "strand_tracker": {
    "last_quest_chapter": 46,
    "last_fire_chapter": 42,
    "last_constellation_chapter": 38,
    "history": [
      {"chapter": 45, "dominant": "quest"},
      {"chapter": 46, "dominant": "quest"}
    ]
  }
}
```

**应用警告阈值**：

| 违规类型 | 触发条件 | 严重度 | 影响 |
|-----------|-----------|----------|--------|
| **Quest 过载** | 连续 5+ 章 Quest 主导 | High | 战斗疲劳，缺少情感深度 |
| **Fire 干旱** | 距上次 Fire > 10 章 | Medium | 人物关系停滞 |
| **Constellation 缺席** | 距上次 Constellation > 15 章 | Low | 世界观单薄 |

**违规示例**:
```
⚠️ Quest Overload (连续7章)
Chapters 40-46 全部为 Quest 主导
→ Impact: 读者疲劳，建议第47章安排感情戏或世界观扩展

⚠️ Fire Drought (已12章未出现)
Last Fire chapter: 34 | Current: 46 | Gap: 12 chapters
→ Impact: 李雪等角色存在感降低，建议补充互动场景

✓ Constellation Acceptable
Last Constellation: 38 | Current: 46 | Gap: 8 chapters
```

### 第四步: 节奏标准

**每10章理想分布与缺席阈值**:

| Strand | 理想占比 | 最大缺席 | 超限影响 |
|--------|---------|---------|---------|
| Quest (主线) | 55-65% | 5 章连续 | 战斗疲劳，缺少情感深度 |
| Fire (感情线) | 20-30% | 10 章 | 人物关系停滞 |
| Constellation (世界观线) | 10-20% | 15 章 | 世界观单薄 |

### 第五步: 历史趋势分析

**若 state.json 包含 20+ 章历史数据**：

生成情节线分布图：
```
Chapters 1-20 Strand Distribution:
Quest:         ████████████░░░░░░░░  60% (12 chapters)
Fire:          ████░░░░░░░░░░░░░░░░  20% (4 chapters)
Constellation: ████░░░░░░░░░░░░░░░░  20% (4 chapters)

结论：✓ 节奏均衡（符合理想比例）
```

vs.

```
Chapters 21-40 Strand Distribution:
Quest:         ███████████████████░  95% (19 chapters)
Fire:          █░░░░░░░░░░░░░░░░░░░   5% (1 chapter)
Constellation: ░░░░░░░░░░░░░░░░░░░░   0% (0 chapters)

结论：✗ 严重失衡（Quest 过载，节奏单调）
```

### 第六步: 生成报告

```markdown
# 节奏检查报告

## 覆盖范围
第 {N} 章 - 第 {M} 章

## 当前章节主导情节线
| 章节 | 主导线 | 底色 | 强度 |
|------|--------|------|------|
| {N} | Quest | Fire（20%）| 高（战斗密集）|
| {M} | Quest | - | 中等 |

## Strand 平衡检查
### Quest 线（主线）
- 最近出现: 第 {X} 章
- 连续章数: {count}
- **状态**: {✓ 正常 / ⚠️ 预警 / ✗ 过载}

### Fire 线（情感线）
- 最近出现: 第 {Y} 章
- 距上次间隔: {count} 章
- **状态**: {✓ 正常 / ⚠️ 预警 / ✗ 干旱}

### Constellation 线（世界观线）
- 最近出现: 第 {Z} 章
- 距上次间隔: {count} 章
- **状态**: {✓ 正常 / ⚠️ 预警}

## 历史趋势（需 ≥ 20 章数据）
最近 20 章分布:
- Quest: {X}%（{count} 章）
- Fire: {Y}%（{count} 章）
- Constellation: {Z}%（{count} 章）

**趋势**: {均衡 / Quest偏重 / Fire不足 / ...}

## 修复建议
- [Quest 过载] 连续{count}章Quest主导，建议在第{next}章安排：
  - 与{角色}的感情发展场景（Fire）
  - 或揭示{势力/世界观元素}（Constellation）

- [Fire 干旱] 距上次Fire已{count}章，建议补充：
  - 与李雪/师父/伙伴的互动
  - 不必是专门的感情章，可作为底色穿插

- [Constellation 间隔] 世界观扩展不足，建议：
  - 揭示新势力或修仙界格局
  - 展示新的修炼体系或设定

## 下一章节奏建议
基于当前平衡状态，第 {next} 章应优先：
**主导**: {线}（因为距上次{gap}章）
**底色**: {线}

## 综合评分
**节奏总评**: {健康/预警/危险}
**读者疲劳风险**: {低/中/高}
```

## 禁止事项

❌ 通过连续 5+ 章 Quest 主导且不预警
❌ 忽略 Fire 干旱超过 10 章
❌ 接受 20+ 章中完全相同的节奏模式

## 成功标准

- 最近 10 章内单一情节线不超过 70%
- 所有情节线在各自阈值内至少出现一次
- 报告提供可执行的下一章建议
- 趋势分析显示分布均衡（若有足够历史数据）
