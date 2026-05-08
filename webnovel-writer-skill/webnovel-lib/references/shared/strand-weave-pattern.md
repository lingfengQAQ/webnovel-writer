---
name: strand-weave-pattern
purpose: 章节规划时检查三线平衡，避免节奏单调
---

<context>
此文件用于情节线平衡控制。Claude 已知多线叙事技巧，这里只补充网文特定的三线交织机制和 state.json 中的追踪器结构。
注意：此文件为 shared 单一事实源；禁止在各 Skill 的 references 下复制修改。若需更新，请修改本文件。
</context>

<instructions>

## 三条线定义与占比

| 线条 | 占比 | 定义 | 典型剧情 |
|------|------|------|----------|
| **Quest（主线）** | 55-65% | 核心任务、升级、战斗、夺宝 | 宗门大比、秘境、突破境界、复仇打脸 |
| **Fire（感情线）** | 20-30% | 情感关系发展（爱情/友情/师徒） | 相识暧昧、英雄救美、确认关系 |
| **Constellation（世界观线）** | 10-20% | 扩展设定、展示新势力/地点、势力关系、社交网络 | 揭示隐藏势力、介绍新大陆、主角身世 |

## 交织规则（低自由度 - 必须执行）

| 规则 | 警告条件 | 建议操作 |
|------|----------|----------|
| Quest 不连续超过 5 章 | chapters_since_switch >= 5 | 切换到 Fire 或 Constellation |
| Fire 不超过 10 章不出现 | current - last_fire > 10 | 安排感情戏（小甜蜜/吃醋） |
| Constellation 不超过 15 章不出现 | current - last_constellation > 15 | 展示新设定/势力/伏笔 |

## state.json 中的 strand_tracker 结构

```json
{
  "strand_tracker": {
    "last_quest_chapter": 45,
    "last_fire_chapter": 43,
    "last_constellation_chapter": 40,
    "current_dominant": "quest",
    "chapters_since_switch": 3,
    "history": [{"chapter": 46, "dominant": "quest"}, ...]
  }
}
```

兼容说明：
- `history[].dominant` 为当前标准字段（update_state.py 写入）
- 若项目存在旧数据 `history[].strand`，读取时应兼容映射到 dominant

## 前 30 章织网模板

```
第 1-5 章:   Quest ×5（开局快速推进主线）
第 6 章:     Fire（首次与女主相遇）
第 7-10 章:  Quest ×4（宗门大比）
第 11 章:    Fire（英雄救美）
第 12-14 章: Quest ×3（秘境夺宝）
第 15 章:    Constellation（揭示"圣地"存在）
第 16-19 章: Quest ×4（击败强敌）
第 20 章:    Fire（确认关系）
第 21-24 章: Quest ×4（突破境界）
第 25 章:    Constellation（发现主角身世线索）
第 26-30 章: Quest ×5（卷末高潮）
```

</instructions>

<examples>

<example>
<input>当前第 46 章，last_quest=45, last_fire=43, last_constellation=40, current_dominant="quest", chapters_since_switch=3</input>
<output>
**警告判断**:
- Quest 连续 3 章 < 5 章 → 暂无警告
- 距离 Fire 3 章 < 10 章 → 暂无警告
- 距离 Constellation 6 章 < 15 章 → 暂无警告

**本章建议**: 可继续 Quest，但建议下 1-2 章内安排 Fire 调节节奏
</output>
</example>

<example>
<input>当前第 55 章，last_fire=42，连续 13 章无感情线</input>
<output>
⚠️ **警告**: 距离上次感情线 > 10 章！

**建议**: 本章安排 Fire 线
- 选项 A: 女主出场，小甜蜜互动
- 选项 B: 英雄救美场景
- 选项 C: 吃醋/误会小剧情
</output>
</example>

<example type="edge_case">
<input>开局前 10 章需要快速建立主线，感情线可以少一点吗？</input>
<output>
✅ 可以。前 10 章占比可调整为：
- Quest: 70-80%
- Fire: 10-15%
- Constellation: 5-10%

但第 6-8 章必须安排至少 1 次 Fire（首次相遇/印象建立）
</output>
</example>

</examples>

<errors>
❌ 连续 10 章纯 Quest → ✅ 最多 5 章后切换
❌ 感情线超过 10 章不出现 → ✅ 每 5-10 章安排一次
❌ 世界观线超过 15 章不出现 → ✅ 每 10-15 章展示新设定
❌ 切换 Strand 后忘记更新 strand_tracker → ✅ 每章结束后自动更新
</errors>
