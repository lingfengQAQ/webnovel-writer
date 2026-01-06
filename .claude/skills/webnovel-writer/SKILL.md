---
name: webnovel-writer
description: Knowledge base for writing Chinese webnovels with anti-hallucination protocols (大纲即法律/设定即物理/发明需申报), cool-points strategy, and pacing control (Strand Weave). Automatically loaded when writing webnovel chapters, creating chapter content, or discussing webnovel writing techniques.
allowed-tools: Read Write Edit Grep Bash AskUserQuestion Task
---

# 网文创作知识库

> **角色定位**: 提供网文创作的核心知识和规范，确保创作质量和一致性。
> **自动触发**: 当检测到网文创作相关任务时，这些知识会自动加载到上下文中。

---

## 📋 快速导航

| 章节 | 内容 |
|------|------|
| [核心原则](#-核心原则防幻觉三大定律) | 防幻觉三大定律 |
| [爽点系统](#-爽点系统cool-points) | 五大爽点类型 + 布局策略 |
| [节奏控制](#-节奏控制strand-weave) | Quest/Fire/Constellation 三线编织 |
| [写作规范](#-写作规范) | 对话、描写、章节结构 |
| [XML 标签](#-xml-标签规范) | 实体/技能/伏笔/偏离标签系统 |
| [参考文档](#-参考文档索引) | 65+ 专题指南 |
| [题材模板](#-题材模板库) | 9 大类型模板 |
| [质量检查](#-质量检查清单) | 短期/长期质量目标 |

---

## 🎯 核心原则：防幻觉三大定律

### 定律 1: 大纲即法律

**原则**: 不得擅自偏离已确认的大纲内容。

**实施规则**:
- 每章生成前，必须读取并确认章节大纲
- 如果大纲内容不够详细，**主动询问用户补充**，不得自行发挥
- 如需偏离大纲（如临时灵感），必须标记 `<deviation reason="..."/>` 并说明理由

**违规示例**:
```
大纲: 第 50 章 - 主角参加宗门大比，对战王少
违规: 擅自增加"大比中途秘境开启"的情节
```

**正确做法**:
```
检测到: 当前大纲未提及秘境开启
行动: 询问用户是否需要增加此情节，或严格按大纲执行
```

---

### 定律 2: 设定即物理

**原则**: 角色实力、招式、物品必须严格符合已有设定。

**自动检查清单**:
1. **实力检查**: 主角当前境界 → 可使用的招式范围
2. **地点检查**: 当前位置 → 可出现的角色/物品
3. **时间线检查**: 剧情时间点 → 角色状态的合理性

**违规标记**:
- `POWER_CONFLICT`: 战力/招式与设定冲突
- `LOCATION_ERROR`: 地点信息错误
- `TIMELINE_ISSUE`: 时间线矛盾

**示例**:
```
错误: 主角筑基 3 层，使用金丹期才能掌握的"破空斩"
正确: 检查 state.json，确认主角当前境界，选择对应的招式
```

---

### 定律 3: 发明需申报

**原则**: 所有新创造的角色、地点、物品必须标记并等待批准。

**XML 标签格式**（详见 [tag-specification.md](references/tag-specification.md)）:
```xml
<!-- 实体标签 -->
<entity type="类型" name="名称" desc="描述" tier="层级"/>

<!-- 技能标签 -->
<skill name="技能名" level="等级" desc="描述" cooldown="冷却时间"/>

<!-- 伏笔标签 -->
<foreshadow content="伏笔内容" tier="层级" target="目标章节" location="地点" characters="角色"/>

<!-- 大纲偏离标签 -->
<deviation reason="偏离原因"/>
```

**实体标签示例**:
```xml
<entity type="角色" name="陆辰" desc="主角，觉醒时空能力的大学生" tier="核心"/>
<entity type="地点" name="末日避难所" desc="幸存者聚集地，位于地下三层" tier="支线"/>
<entity type="物品" name="时空碎片" desc="强化金手指的稀有材料" tier="装饰"/>
<entity type="势力" name="守夜人组织" desc="隐秘世界的秩序维护者" tier="核心"/>
<entity type="功法" name="时空掌控" desc="陆辰的核心能力体系" tier="核心"/>
```

**层级权重（用于伏笔紧急度计算）**:
| 层级 | 权重 | 含义 |
|------|------|------|
| 核心 | 3.0 | 必须追踪，影响主线 |
| 支线 | 2.0 | 应该追踪，丰富剧情 |
| 装饰 | 1.0 | 可选追踪，增加真实感 |

**金手指技能标签示例**:
```xml
<skill name="时间回溯" level="1" desc="回到10秒前的状态" cooldown="24小时"/>
<skill name="空间锚点" level="2" desc="设置传送锚点，可瞬移返回" cooldown="1小时"/>
<skill name="时间感知" level="1" desc="被动技能，预知3秒内的危险" cooldown="无"/>
```

**伏笔标签示例**:
```xml
<foreshadow content="神秘老者留下的玉佩开始发光" tier="核心" target="50" location="废弃实验室" characters="陆辰"/>
<foreshadow content="李薇手腕上的奇怪纹身" tier="支线" target="30" characters="李薇,陆辰"/>
<foreshadow content="咖啡店老板意味深长的眼神" tier="装饰"/>
```

**后处理流程**:
1. Python 脚本自动提取所有 XML 标签（`<entity>`/`<skill>`/`<foreshadow>`/`<deviation>`）
2. 询问用户是否加入设定集
3. 用户确认后更新 `state.json` 和设定文档

---

## 读者体验补丁（反模板化）

### 1) 禁用“占位符正文”

**原则**：正文是给读者看的，禁止用“???”当作读者可见信息。

推荐写法（任选其一，且全书保持一致）：
- 用**代号/称呼**：系统名未知 → “暂称：继承者系统/面板/协议”
- 用**叙述句**：系统名未知 → “系统名称被权限屏蔽/无法读取”

**禁止**：
- 在正文里出现“???系统/???功能/???”这种占位符（会显得粗糙、模板感强）

### 2) “权限不足”使用规则

**原则**：每次“拒绝回答”都必须给读者一个“可推进剧情的替代信息”。

规则：
- 每章最多出现 **1 次**“权限不足/无法查询”
- 每次出现必须同时满足至少 1 条：
  - 给出**可执行的解锁条件**（等级/积分/地点/道具/行为）
  - 给出**部分答案**（范围/代号/危险等级区间/关键词）
  - 自动刷新一个**可落地任务**（让主角立刻有下一步）

### 3) 都市异能的“现实余波”硬要求（隐秘期）

只要出现“普通人可能注意到的大动静”（爆炸/坍塌/大火/封路/多人受伤），本章或下一章必须交代：
- **现实层面的余波**：警戒线、消防/救护车、监控调取、笔录、封控
- **舆情/官方口径**：热搜/群聊碎片 + 合理解释（施工事故/煤气爆炸/高压电起火）

### 4) 标签纪律（减少 AI 痕迹）

仅使用 workflow 明确规定的 XML 标签（详见 [tag-specification.md](references/tag-specification.md)）：
- ✅ `<entity type="..." name="..." desc="..." tier="..."/>` - 新实体标签
- ✅ `<skill name="..." level="..." desc="..." cooldown="..."/>` - 金手指技能标签
- ✅ `<foreshadow content="..." tier="..." .../>` - 伏笔标签
- ✅ `<deviation reason="..."/>` - 大纲偏离标签
- ✅ 推荐使用 HTML 注释包裹（`<!-- <entity.../> -->`），避免影响读者阅读
- ❌ 禁止自行发明新标签体系，除非同步更新脚本与规范
- ⚠️ 旧格式（`[NEW_ENTITY]`/`[GOLDEN_FINGER_SKILL]`/`[FORESHADOWING_JSON]`）仍兼容，但推荐迁移到 XML 格式

---

## 📖 爽点设计指南

### 爽点类型与标准流程

| 爽点类型 | 标准流程 | 示例 |
|---------|---------|------|
| **打脸型** | 嘲讽 → 铺垫 → 反转 → 震惊 | 被称"废物" → 隐藏实力 → 一招秒杀 → 全场哗然 |
| **升级型** | 困境 → 顿悟/机缘 → 突破 → 实力展示 | 瓶颈难破 → 得到天雷果 → 突破筑基 → 威压释放 |
| **收获型** | 危机 → 解决 → 奖励/认可 | 击败对手 → 长老赏识 → 获得秘境名额 |
| **扮猪吃虎** | 示弱 → 对手轻敌 → 全力爆发 → 碾压 | 装作受伤 → 敌人大意 → 突然反击 → 秒杀 |
| **装逼打脸** | 对手装逼 → 主角淡定 → 展示实力 → 对手震惊 | 敌人炫耀宝物 → 主角拿出更好的 → 对手羞愧 |

---

### 爽点密度要求

**基本要求**:
- 每章至少 **1 个爽点**
- 每 5 章至少 **1 个大爽点**（打脸+升级+收获组合）
- 每 10 章至少 **1 次实力提升**

**爽点强度分级**:
- **小爽**: 单一爽点（如打脸或升级）
- **中爽**: 双重爽点（打脸+升级）
- **大爽**: 三重爽点（打脸+升级+收获）
- **超爽**: 连续爽点链（一章内多个爽点叠加）

---

### 爽点设计技巧

1. **铺垫充分**: 爽点至少提前 1-2 章埋伏笔
2. **冲突激化**: 矛盾要足够尖锐，才能爽得彻底
3. **反转有力**: 转折要出乎意料但又合情合理
4. **情绪释放**: 读者情绪积累 → 爆发 → 满足

**反面教材**:
- ❌ 突然出现的爽点（没有铺垫）
- ❌ 生硬的打脸（对手智商突然下线）
- ❌ 无意义的升级（没有困难直接突破）

---

## 📊 节奏平衡：Strand Weave（情节线织网）

### 三条情节线

**Quest 线（主线）**: 主角的外部目标和冲突
- 打怪升级、完成任务、击败敌人
- 推动剧情发展的核心线
- 示例：参加宗门大比、探索秘境、复仇

**Fire 线（感情线）**: 主角的情感关系
- 与女主/伙伴的关系发展
- 友情、爱情、师徒情
- 示例：与李雪的暧昧发展、与师父的羁绊

**Constellation 线（世界观线）**: 世界设定的扩展
- 新势力、新地图、新设定的展示
- 丰富世界观，增加深度
- 示例：揭示修仙界格局、展示新的修炼体系

---

### 节奏平衡规则

**警告触发条件**:
- ⚠️ 连续 **5+ 章**走主线（Quest）→ 建议安排感情戏或世界观扩展
- ⚠️ 距上次感情线 > **10 章** → 建议推进感情关系
- ⚠️ 距上次世界观扩展 > **15 章** → 建议展示新势力/地点/设定

**strand_tracker 检查**（从 state.json 读取）:
```json
{
  "strand_tracker": {
    "quest": {"last_chapter": 45, "intensity": 8},
    "fire": {"last_chapter": 38, "intensity": 3},
    "constellation": {"last_chapter": 30, "intensity": 5}
  }
}
```

**节奏调整策略**:
- Quest 连续主导 → 插入感情戏或世界观描写
- Fire 久未出现 → 安排与伙伴/女主的互动
- Constellation 缺失 → 揭示新势力或展示新设定

---

### 情节线织网示例

**理想节奏**（每 10 章）:
```
Ch 1-2: Quest（主线推进）
Ch 3: Fire（感情发展）
Ch 4-5: Quest（继续主线）
Ch 6: Constellation（世界观扩展）
Ch 7-8: Quest（主线高潮）
Ch 9: Fire（感情升温）
Ch 10: Quest + Fire（融合）
```

**避免的反模式**:
- ❌ 连续 10 章纯打怪（节奏单调）
- ❌ 突然插入大段感情戏（破坏节奏）
- ❌ 世界观设定过度堆砌（读者疲劳）

---

## 📝 对话与描写规范

### 对话规范

**符合角色性格**:
- 参考角色卡中的性格描述
- 不同角色有不同的说话风格
- 示例：主角（隐忍冷静）vs 反派（嚣张狂妄）

**修仙题材用语**:
- ✅ 使用："阁下"、"道友"、"在下"
- ❌ 避免现代网络用语："牛逼"、"666"、"OMG"

**反派嘲讽自然化**:
- ❌ 错误："你这个废物，我一根手指就能碾死你！"（过度脸谱化）
- ✅ 正确："林家？呵，早已没落的家族，也敢在此放肆？"（自然且有杀伤力）

---

### 描写技巧

**战斗场景**:
- 动作 + 效果 + 反应
- 示例："一拳轰出，空气炸裂，王少脸色大变，慌忙抵挡"

**突破场景**:
- 氛围 + 身体变化 + 威压释放
- 示例："天地灵气疯狂涌入，主角周身金光闪耀，一股筑基期的威压瞬间扩散"

**情感场景**:
- 内心独白 + 细节刻画
- 示例："看着李雪担忧的眼神，林天心中一暖，这或许就是羁绊吧"

---

## ✅ 写作检查清单

生成章节后，必须自检：

**内容检查**:
- [ ] 是否符合大纲？（定律 1）
- [ ] 爽点是否充足（≥1）？
- [ ] 是否有设定冲突？（定律 2）
- [ ] 是否标记了所有 `<entity/>`？（定律 3）

**质量检查**:
- [ ] 是否有战力崩坏？（境界 vs 实力匹配）
- [ ] 人物是否 OOC（Out of Character）？
- [ ] 节奏是否拖沓？（检查 strand balance）
- [ ] 字数是否达标（3000-5000）？

**逻辑检查**:
- [ ] 时间线是否一致？
- [ ] 地点转换是否合理？
- [ ] 伏笔是否有效埋设/回收？

---

## 🔍 常见错误与修正

详见 **[common-mistakes.md](references/common-mistakes.md)**，包含：
- 战力崩坏、爽点缺失、擅自发明、人物 OOC 等 7 类错误
- 每类错误的识别方法和修正策略
- 快速自检清单

---

## 📚 参考文档（详细指南）

当需要更详细的指导时，可以参考以下文档：

### 核心文档
- **[anti-hallucination.md](references/anti-hallucination.md)** - 三大定律详细解释和案例
- **[cool-points-guide.md](references/cool-points-guide.md)** - 爽点设计完整指南，包含各题材爽点库
- **[pacing-control.md](references/pacing-control.md)** - 节奏控制技巧和案例分析
- **[genre-tropes.md](references/genre-tropes.md)** - 修仙/都市/玄幻等题材套路库
- **[strand-weave-pattern.md](references/strand-weave-pattern.md)** - Strand Weave 详细规范
- **[polish-guide.md](references/polish-guide.md)** - 内容润色指南（AI痕迹清除/语言优化/风格统一/自然化）
- **[workflow-resume.md](references/workflow-resume.md)** - 工作流中断恢复机制（用于 /webnovel-resume 命令）
- **[system-data-flow.md](references/system-data-flow.md)** - 数据链与组件地图（state/index/archive 口径与顺序）
- **[archiving-strategy.md](references/archiving-strategy.md)** - 数据归档策略（200万字长跑保障）
- **[git-workflow.md](references/git-workflow.md)** - Git 版本控制工作流规范

### 创作基础指南

#### 创意构思 (creativity/)
- **[inspiration-collection.md](references/creativity/inspiration-collection.md)** - 灵感收集与管理
- **[market-positioning.md](references/creativity/market-positioning.md)** - 市场定位分析
- **[creative-combination.md](references/creativity/creative-combination.md)** - 创意组合技巧
- **[selling-points.md](references/creativity/selling-points.md)** - 卖点提炼方法

#### 世界构建 (worldbuilding/)
- **[character-design.md](references/worldbuilding/character-design.md)** - 角色设计方法论
- **[power-systems.md](references/worldbuilding/power-systems.md)** - 力量体系设计指南
- **[world-rules.md](references/worldbuilding/world-rules.md)** - 世界规则构建
- **[faction-systems.md](references/worldbuilding/faction-systems.md)** - 势力体系设计
- **[setting-consistency.md](references/worldbuilding/setting-consistency.md)** - 设定一致性维护

#### 大纲规划 (outlining/)
- **[outline-structure.md](references/outlining/outline-structure.md)** - 大纲结构设计
- **[plot-frameworks.md](references/outlining/plot-frameworks.md)** - 剧情框架模板
- **[chapter-planning.md](references/outlining/chapter-planning.md)** - 章节规划技巧
- **[conflict-design.md](references/outlining/conflict-design.md)** - 冲突设计方法

#### 写作技巧 (writing/)
- **[dialogue-writing.md](references/writing/dialogue-writing.md)** - 对话写作技巧
- **[scene-description.md](references/writing/scene-description.md)** - 场景描写方法
- **[combat-scenes.md](references/writing/combat-scenes.md)** - 战斗场景写作
- **[emotion-psychology.md](references/writing/emotion-psychology.md)** - 情感与心理描写
- **[typesetting.md](references/writing/typesetting.md)** - 排版与阅读体验（移动端优先）

#### 高级技巧 (advanced/)
- **[multi-threading.md](references/advanced/multi-threading.md)** - 多线叙事技巧
- **[foreshadowing.md](references/advanced/foreshadowing.md)** - 伏笔设计与回收
- **[pacing-mastery.md](references/advanced/pacing-mastery.md)** - 节奏掌控进阶
- **[character-arc.md](references/advanced/character-arc.md)** - 人物弧光设计
- **[suspense-building.md](references/advanced/suspense-building.md)** - 悬念构建技巧

### 题材专项指南

| 题材 | 目录 | 主要内容 |
|------|------|---------|
| 狗血言情 | `genres/dog-blood-romance/` | 套路公式、角色原型、情感张力、甜虐设计 |
| 知乎短篇 | `genres/zhihu-short/` | 钩子技巧、快速人设、剧情压缩、结局模式 |
| 现实题材 | `genres/realistic/` | 真实感锚定、社会议题、对话/人物深度 |
| 古言题材 | `genres/period-drama/` | 历史背景、宫斗权谋、古风对话 |
| 玄幻题材 | `genres/xuanhuan/` | 力量体系、修炼等级、剧情/爽点模式 |
| 规则怪谈 | `genres/rules-mystery/` | 核心要素、线索/诡计设计、结构节奏 |

---

## 📦 题材模板库

开始新项目时，可以直接套用以下模板快速构建世界观和大纲：

### 通用模板
- **[golden-finger-templates.md](assets/templates/golden-finger-templates.md)** - 金手指设计框架（系统流/鉴定流/签到流）

### 题材专用模板
- **[修仙.md](assets/templates/genres/修仙.md)** - 凡人流/无敌流/家族流/苟道流 + 境界体系 + 200万字大纲
- **[系统流.md](assets/templates/genres/系统流.md)** - 数值面板/任务生成/系统与宿主关系
- **[都市异能.md](assets/templates/genres/都市异能.md)** - 都市异能题材核心套路
- **[狗血言情.md](assets/templates/genres/狗血言情.md)** - 霸总/追妻火葬场/重生复仇/替身文学
- **[知乎短篇.md](assets/templates/genres/知乎短篇.md)** - 十大开篇钩子/黄金300字/节奏控制
- **[古言.md](assets/templates/genres/古言.md)** - 宫斗/宅斗/权谋框架/古风对话规范
- **[现实题材.md](assets/templates/genres/现实题材.md)** - 职场/婚恋/社会议题处理
- **[规则怪谈.md](assets/templates/genres/规则怪谈.md)** - 本格推理十诫/线索设计/诡计分类

---

## 🎯 质量标准

**每章质量目标**:
- ✅ 字数：3000-5000 字
- ✅ 爽点：至少 1 个
- ✅ 设定一致性：无冲突
- ✅ 战力合理性：无崩坏
- ✅ 人物一致性：不 OOC
- ✅ 节奏流畅性：不拖沓

**长期质量目标**（每 10 章）:
- ✅ 大爽点：至少 1 个
- ✅ 实力提升：至少 1 次
- ✅ Strand 平衡：三线均有推进
- ✅ 伏笔回收：至少 1 个

---

## 📝 总结

作为网文创作知识库，本 Skill 提供：

1. **防幻觉三大定律**：确保内容一致性和逻辑严密
2. **爽点设计指南**：保证读者爽感密集输出
3. **Strand Weave**：维持节奏平衡，避免单调
4. **写作规范**：对话、描写、质量标准
5. **参考文档库**：65+ 专题指南（创意、世界观、大纲、写作技巧等）
6. **题材模板库**：9 大类型框架（修仙、系统流、都市异能、规则怪谈等）

**自动触发场景**:
- 执行网文命令时：`/webnovel-init`、`/webnovel-plan`、`/webnovel-write`、`/webnovel-review`、`/webnovel-resume`、`/webnovel-query`
- 用户询问"如何写网文"时
- 讨论爽点设计、节奏控制等话题时

**注意**: 本 Skill 仅提供知识和规范，具体的执行步骤（如调用 Python 脚本）由 Command 负责。
