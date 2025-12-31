# 情节线织网模式（Strand Weave Pattern）

> **来源**: 借鉴自 Crucible Writing System 的多线交织机制
> **目的**: 防止网文节奏单调，确保主线/感情线/世界观均衡发展

---

## 核心理念

200万字网文最怕"单一节奏"：
- ❌ 连续 20 章都在打架（审美疲劳）
- ❌ 连续 15 章都在谈恋爱（主线停滞）
- ❌ 连续 10 章都在修炼（枯燥乏味）

**解决方案**: 将小说拆分为三条主线，按"频率"交织：

```
Quest (主线) ━━━━━━━━━━━━━━  占比 60%
Fire (感情)     ━━━━━━      占比 25%
Constellation   ━━━━        占比 15%
(世界观)
```

---

## 三条线定义

### 1. Quest（主线，占比 60%）

**定义**: 主角的核心任务、升级、战斗、夺宝等推进剧情的主要冲突。

**典型剧情**:
- 宗门大比
- 秘境夺宝
- 击败强敌
- 突破境界
- 复仇/打脸

**示例**:
```
第 1-5 章: Quest（主角参加外门大比）
第 10-15 章: Quest（主角进入血煞秘境）
第 20-25 章: Quest（主角突破金丹期）
```

---

### 2. Fire（感情线，占比 25%）

**定义**: 主角与配角的情感关系发展（爱情/友情/师徒情/亲情）。

**典型剧情**:
- 与女主相识/暧昧/确认关系
- 英雄救美
- 情侣日常
- 后宫争宠（如有）
- 师徒对话/成长

**示例**:
```
第 6 章: Fire（主角与李雪首次深度对话）
第 12 章: Fire（主角英雄救美，好感度 +20）
第 18 章: Fire（确认关系，接吻场景）
```

---

### 3. Constellation（世界观，占比 15%）

**定义**: 扩展世界观、展示新势力/新地点/新设定，为后续剧情铺垫。

**典型剧情**:
- 揭示隐藏势力（如"圣地"/"魔道"）
- 介绍新大陆/新秘境
- 展示更高境界的强者
- 揭秘主角身世/金手指来历
- 埋设大伏笔（如"千年前的大战"）

**示例**:
```
第 8 章: Constellation（主角听闻"圣地"传说）
第 16 章: Constellation（遇到金丹期强者，见识更强实力）
第 30 章: Constellation（发现主角身世秘密）
```

---

## 交织规则

### 规则 1: 避免单线连续超过 5 章

**错误示例**（Quest 连续 10 章）:
```
第 1-10 章: Quest Quest Quest Quest Quest Quest Quest Quest Quest Quest
→ 读者会感到疲劳，缺乏变化
```

**正确示例**（Quest + Fire 交织）:
```
第 1-3 章: Quest Quest Quest
第 4 章:   Fire（感情线插入，缓和节奏）
第 5-7 章: Quest Quest Quest
第 8 章:   Constellation（世界观扩展）
第 9-10 章: Quest Quest
```

### 规则 2: Fire 不能超过 10 章不出现

**警告**:
- 距离上次感情线 > 10 章 → 读者会忘记女主
- 建议每 5-10 章插入一次感情戏（小甜蜜/英雄救美/吃醋）

### 规则 3: Constellation 不能超过 15 章不出现

**警告**:
- 距离上次世界观扩展 > 15 章 → 世界观停滞，缺乏新鲜感
- 建议每 10-15 章展示新设定/新势力/新伏笔

---

## state.json 中的 strand_tracker

```json
{
  "strand_tracker": {
    "last_quest_chapter": 45,         // 上次主线高潮章节号
    "last_fire_chapter": 43,          // 上次感情线章节号
    "last_constellation_chapter": 40, // 上次世界观扩展章节号
    "current_dominant": "quest",      // 当前主导线
    "chapters_since_switch": 3,       // 距离上次切换主导线的章节数
    "history": [                      // 历史记录（最近 20 章）
      {"chapter": 46, "strand": "quest"},
      {"chapter": 45, "strand": "quest"},
      {"chapter": 44, "strand": "quest"},
      {"chapter": 43, "strand": "fire"},
      ...
    ]
  }
}
```

---

## Think 步骤中的检查逻辑

在生成第 N 章前，主笔 AI 必须执行以下检查：

```python
# 伪代码
current_chapter = 46
last_quest = 45
last_fire = 43
last_constellation = 40
current_dominant = "quest"
chapters_since_switch = 3

# 警告判断
if chapters_since_switch >= 5:
    ⚠️ 警告：已连续 5 章走主线，建议切换到 Fire 或 Constellation

if current_chapter - last_fire > 10:
    ⚠️ 警告：距离上次感情线 > 10 章，建议安排感情戏

if current_chapter - last_constellation > 15:
    ⚠️ 警告：距离上次世界观扩展 > 15 章，建议展示新设定

# 本章决策
本章主导线: Fire（因为距离上次感情线已 3 章，且主线已连续 3 章）
理由: 平衡节奏，插入主角与李雪的甜蜜日常
```

---

## 实战案例

### 案例 1：前 30 章的织网示例

```
第 1-5 章:   Quest Quest Quest Quest Quest（开局必须快速推进主线）
第 6 章:     Fire（首次与女主相遇）
第 7-10 章:  Quest Quest Quest Quest（宗门大比）
第 11 章:    Fire（英雄救美）
第 12-14 章: Quest Quest Quest（秘境夺宝）
第 15 章:    Constellation（揭示"圣地"存在）
第 16-19 章: Quest Quest Quest Quest（击败强敌）
第 20 章:    Fire（确认关系）
第 21-24 章: Quest Quest Quest Quest（突破境界）
第 25 章:    Constellation（发现主角身世线索）
第 26-30 章: Quest Quest Quest Quest Quest（卷末高潮）
```

**分析**:
- Quest 占比: 23/30 = 77%（略高于 60%，因为前期需要快速建立主线）
- Fire 占比: 3/30 = 10%（前期感情线可以少一点）
- Constellation 占比: 2/30 = 7%（前期世界观埋伏笔即可）

### 案例 2：中期（第 200-250 章）的织网示例

此时主线已稳定，需要更多感情线和世界观：

```
第 200-203 章: Quest Quest Quest Quest（主线推进）
第 204 章:    Fire（后宫日常/吃醋戏）
第 205-208 章: Quest Quest Quest Quest（新副本）
第 209 章:    Fire（感情线深化）
第 210-212 章: Quest Quest Quest（击败 BOSS）
第 213 章:    Constellation（揭示魔道入侵预兆）
第 214-216 章: Quest Quest Quest（收尾）
第 217 章:    Fire（女主表白/甜蜜）
第 218-220 章: Quest Quest Quest（下一个副本开启）
第 221 章:    Constellation（新大陆线索）
...
```

**分析**:
- Quest 占比: 约 55-60%（主线稳定）
- Fire 占比: 约 25-30%（感情线需要深化）
- Constellation 占比: 约 15%（世界观扩展）

---

## 自动更新 strand_tracker

每次生成章节后，系统应自动更新：

```python
# 伪代码（在 webnovel-write 完成后执行）
if 本章主导线 == "quest":
    state.strand_tracker.last_quest_chapter = current_chapter
    if state.strand_tracker.current_dominant == "quest":
        state.strand_tracker.chapters_since_switch += 1
    else:
        state.strand_tracker.current_dominant = "quest"
        state.strand_tracker.chapters_since_switch = 1

# 同理处理 fire 和 constellation

# 记录历史
state.strand_tracker.history.append({
    "chapter": current_chapter,
    "strand": 本章主导线
})

# 保持历史记录最多 20 条
if len(state.strand_tracker.history) > 20:
    state.strand_tracker.history.pop(0)
```

---

## 总结：三大好处

1. **防止节奏单调**: 强制多线交织，避免"连续 10 章打架"
2. **保持新鲜感**: 定期切换主导线，读者不会审美疲劳
3. **平衡发展**: 确保主线/感情线/世界观都不被遗忘

**记住**: 200万字网文 = 几十个"小短篇"的嵌套，每个篇章需要节奏变化！

---

**集成到主笔 AI**:
- 在 Think 步骤中强制检查 `strand_tracker`
- 根据警告调整本章主导线
- 生成后更新 `state.json`
