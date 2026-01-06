---
name: webnovel-writer
description: Use this when executing /webnovel-* commands or discussing webnovel writing. READ SKILL.md FIRST to load the knowledge index. Provides anti-hallucination protocols (三大定律), cool-points strategy (爽点系统), and Strand Weave pacing control (节奏控制) for Chinese webnovel writing.
allowed-tools: Read Write Edit Grep Bash AskUserQuestion Task
---

# 网文创作知识库索引

> **🚨 强制要求**: 每次读取任何 reference 文件后，必须在回复中说明"📖 已读取: [文件名]"，确保知识库被正确加载。

> **使用方式**: 本文件是知识库的导航索引。根据当前执行的 command 和 step，读取对应的参考文档。

---

## 📋 Command 知识加载地图

### /webnovel-init（项目初始化）

| Phase | Step | 需要读取的知识 | 文件路径 |
|-------|------|---------------|----------|
| Phase 1 | 题材选择 | 题材套路库 | `.claude/skills/webnovel-writer/references/genre-tropes.md` |
| Phase 2 | 世界观构建 | 世界规则构建 | `.claude/skills/webnovel-writer/references/worldbuilding/world-rules.md` |
| Phase 2 | 力量体系 | 力量体系设计 | `.claude/skills/webnovel-writer/references/worldbuilding/power-systems.md` |
| Phase 2 | 势力设计 | 势力体系设计 | `.claude/skills/webnovel-writer/references/worldbuilding/faction-systems.md` |
| Phase 3 | 角色设计 | 角色设计方法论 | `.claude/skills/webnovel-writer/references/worldbuilding/character-design.md` |
| Phase 3 | 金手指设计 | 金手指模板 | `.claude/skills/webnovel-writer/assets/templates/golden-finger-templates.md` |
| Phase 4 | 总纲规划 | 大纲结构设计 | `.claude/skills/webnovel-writer/references/outlining/outline-structure.md` |
| Phase 4 | 剧情框架 | 剧情框架模板 | `.claude/skills/webnovel-writer/references/outlining/plot-frameworks.md` |
| Phase 5 | 数据初始化 | 数据链规范 | `.claude/skills/webnovel-writer/references/system-data-flow.md` |

**题材专项模板**（根据用户选择的题材读取）:
| 题材 | 模板文件 |
|------|----------|
| 修仙 | `.claude/skills/webnovel-writer/assets/templates/genres/修仙.md` |
| 系统流 | `.claude/skills/webnovel-writer/assets/templates/genres/系统流.md` |
| 都市异能 | `.claude/skills/webnovel-writer/assets/templates/genres/都市异能.md` |
| 狗血言情 | `.claude/skills/webnovel-writer/assets/templates/genres/狗血言情.md` |
| 知乎短篇 | `.claude/skills/webnovel-writer/assets/templates/genres/知乎短篇.md` |
| 古言 | `.claude/skills/webnovel-writer/assets/templates/genres/古言.md` |
| 现实题材 | `.claude/skills/webnovel-writer/assets/templates/genres/现实题材.md` |
| 规则怪谈 | `.claude/skills/webnovel-writer/assets/templates/genres/规则怪谈.md` |

---

### /webnovel-plan（大纲规划）

| Step | 需要读取的知识 | 文件路径 | 何时读取 |
|------|---------------|----------|----------|
| Step 1 | 章节规划技巧 | `.claude/skills/webnovel-writer/references/outlining/chapter-planning.md` | 开始规划前 |
| Step 2 | 爽点设计指南 | `.claude/skills/webnovel-writer/references/cool-points-guide.md` | **必读** - 规划爽点分布 |
| Step 2 | Strand Weave 规范 | `.claude/skills/webnovel-writer/references/strand-weave-pattern.md` | **必读** - 规划节奏平衡 |
| Step 3 | 冲突设计方法 | `.claude/skills/webnovel-writer/references/outlining/conflict-design.md` | 设计冲突时 |
| Step 4 | 伏笔设计与回收 | `.claude/skills/webnovel-writer/references/advanced/foreshadowing.md` | 埋伏笔时 |

---

### /webnovel-write（章节创作）

#### 🚨 Step 1 强制加载（YOU MUST read before writing）

**进入 Step 1 时，必须读取以下 2 个核心文件**：

```
Read .claude/skills/webnovel-writer/references/anti-hallucination.md
Read .claude/skills/webnovel-writer/references/tag-specification.md
```

**验证输出**：
```
📖 已读取: anti-hallucination.md（三大定律详解）
📖 已读取: tag-specification.md（XML标签规范）
```

#### 🚨 Step 2 强制加载（YOU MUST read before generating content）

**进入 Step 2 时，必须读取爽点设计指南**：

```
Read .claude/skills/webnovel-writer/references/cool-points-guide.md
```

**验证输出**：
```
📖 已读取: cool-points-guide.md（爽点设计指南）
```

**按需加载**（根据本章内容类型选择 1-2 个）：
| 内容类型 | 需要读取 | 文件路径 |
|---------|---------|----------|
| 对话戏 | 对话写作技巧 | `.claude/skills/webnovel-writer/references/writing/dialogue-writing.md` |
| 场景描写 | 场景描写方法 | `.claude/skills/webnovel-writer/references/writing/scene-description.md` |
| 战斗戏 | 战斗场景写作 | `.claude/skills/webnovel-writer/references/writing/combat-scenes.md` |
| 情感戏 | 情感与心理描写 | `.claude/skills/webnovel-writer/references/writing/emotion-psychology.md` |

#### 🚨 Step 2.5 强制加载（YOU MUST read before polishing）

**进入 Step 2.5 时，必须读取润色指南**：

```
Read .claude/skills/webnovel-writer/references/polish-guide.md
```

**验证输出**：
```
📖 已读取: polish-guide.md（内容润色指南）
```

#### 🚨 Step 5 强制加载（YOU MUST read before updating strand）

**进入 Step 5 时，必须读取 Strand Weave 规范**：

```
Read .claude/skills/webnovel-writer/references/strand-weave-pattern.md
```

**验证输出**：
```
📖 已读取: strand-weave-pattern.md（Strand Weave节奏规范）
```

#### 完整加载地图

| Step | 强制/按需 | 文件 | 用途 |
|------|----------|------|------|
| Step 1 | **🔴 强制** | `.claude/skills/webnovel-writer/references/anti-hallucination.md` | 三大定律详解 |
| Step 1 | **🔴 强制** | `.claude/skills/webnovel-writer/references/tag-specification.md` | XML标签规范 |
| Step 2 | **🔴 强制** | `.claude/skills/webnovel-writer/references/cool-points-guide.md` | 爽点设计 |
| Step 2 | 🟡 按需 | `.claude/skills/webnovel-writer/references/writing/dialogue-writing.md` | 对话技巧 |
| Step 2 | 🟡 按需 | `.claude/skills/webnovel-writer/references/writing/scene-description.md` | 场景描写 |
| Step 2 | 🟡 按需 | `.claude/skills/webnovel-writer/references/writing/combat-scenes.md` | 战斗场景 |
| Step 2 | 🟡 按需 | `.claude/skills/webnovel-writer/references/writing/emotion-psychology.md` | 情感心理 |
| Step 2.5 | **🔴 强制** | `.claude/skills/webnovel-writer/references/polish-guide.md` | 内容润色 |
| Step 5 | **🔴 强制** | `.claude/skills/webnovel-writer/references/strand-weave-pattern.md` | 节奏平衡 |
| Final | 🟡 按需 | `.claude/skills/webnovel-writer/references/common-mistakes.md` | 自检修正 |

#### 题材专项（首次创作该题材时加载）

| 题材 | 需要读取 |
|------|----------|
| 玄幻修仙 | `.claude/skills/webnovel-writer/references/genres/xuanhuan/` 目录下核心文件 |
| 规则怪谈 | `.claude/skills/webnovel-writer/references/genres/rules-mystery/` 目录下核心文件 |
| 狗血言情 | `.claude/skills/webnovel-writer/references/genres/dog-blood-romance/` 目录下核心文件 |
| 知乎短篇 | `.claude/skills/webnovel-writer/references/genres/zhihu-short/` 目录下核心文件 |
| 古言 | `.claude/skills/webnovel-writer/references/genres/period-drama/` 目录下核心文件 |
| 现实题材 | `.claude/skills/webnovel-writer/references/genres/realistic/` 目录下核心文件 |

---

### /webnovel-review（质量审查）

| Checker | 需要读取的知识 | 文件路径 |
|---------|---------------|----------|
| high-point-checker | 爽点设计指南 | `.claude/skills/webnovel-writer/references/cool-points-guide.md` |
| consistency-checker | 设定一致性维护 | `.claude/skills/webnovel-writer/references/worldbuilding/setting-consistency.md` |
| pacing-checker | Strand Weave 规范 | `.claude/skills/webnovel-writer/references/strand-weave-pattern.md` |
| pacing-checker | 节奏控制技巧 | `.claude/skills/webnovel-writer/references/pacing-control.md` |
| ooc-checker | 角色设计方法论 | `.claude/skills/webnovel-writer/references/worldbuilding/character-design.md` |
| ooc-checker | 人物弧光设计 | `.claude/skills/webnovel-writer/references/advanced/character-arc.md` |
| continuity-checker | 伏笔设计与回收 | `.claude/skills/webnovel-writer/references/advanced/foreshadowing.md` |
| continuity-checker | 多线叙事技巧 | `.claude/skills/webnovel-writer/references/advanced/multi-threading.md` |

---

### /webnovel-query（信息查询）

| 查询类型 | 需要读取的知识 | 文件路径 |
|---------|---------------|----------|
| 伏笔查询 | 伏笔设计与回收 | `.claude/skills/webnovel-writer/references/advanced/foreshadowing.md` |
| 金手指查询 | 金手指模板 | `.claude/skills/webnovel-writer/assets/templates/golden-finger-templates.md` |
| 数据查询 | 数据链规范 | `.claude/skills/webnovel-writer/references/system-data-flow.md` |

---

### /webnovel-resume（中断恢复）

| Step | 需要读取的知识 | 文件路径 |
|------|---------------|----------|
| Step 1 | 工作流恢复机制 | `.claude/skills/webnovel-writer/references/workflow-resume.md` |
| Step 2 | 数据链规范 | `.claude/skills/webnovel-writer/references/system-data-flow.md` |

---

## ⚡ 核心规范速查

### 防幻觉三大定律

| 定律 | 原则 | 违规标记 |
|------|------|----------|
| **大纲即法律** | 不得擅自偏离大纲 | `<deviation reason="..."/>` |
| **设定即物理** | 实力/招式/物品必须符合设定 | `POWER_CONFLICT` / `LOCATION_ERROR` / `TIMELINE_ISSUE` |
| **发明需申报** | 新实体必须标记 | `<entity/>` / `<skill/>` / `<foreshadow/>` |

> 📖 详细规则: `.claude/skills/webnovel-writer/references/anti-hallucination.md`

---

### XML 标签格式

```xml
<!-- 新实体 -->
<entity type="角色|地点|物品|势力|功法" name="名称" desc="描述" tier="核心|支线|装饰"/>

<!-- 金手指技能 -->
<skill name="技能名" level="等级" desc="描述" cooldown="冷却时间"/>

<!-- 伏笔 -->
<foreshadow content="伏笔内容" tier="核心|支线|装饰" target="目标章节" location="地点" characters="角色"/>

<!-- 大纲偏离 -->
<deviation reason="偏离原因"/>
```

> 📖 详细规则: `.claude/skills/webnovel-writer/references/tag-specification.md`

---

### 爽点密度要求

| 周期 | 要求 |
|------|------|
| 每章 | ≥1 个爽点 |
| 每 5 章 | ≥1 个大爽点（打脸+升级+收获组合） |
| 每 10 章 | ≥1 次实力提升 |

**爽点类型**: 打脸型 / 升级型 / 收获型 / 扮猪吃虎 / 装逼打脸

> 📖 详细规则: `.claude/skills/webnovel-writer/references/cool-points-guide.md`

---

### Strand Weave 节奏平衡

| 情节线 | 内容 | 警告条件 |
|--------|------|----------|
| **Quest（主线）** | 打怪升级、任务、冲突 | 连续 5+ 章 |
| **Fire（感情线）** | 爱情、友情、羁绊 | >10 章未出现 |
| **Constellation（世界观）** | 新势力、新设定 | >15 章未出现 |

> 📖 详细规则: `.claude/skills/webnovel-writer/references/strand-weave-pattern.md`

---

### 层级权重（伏笔紧急度）

| 层级 | 权重 | 含义 |
|------|------|------|
| 核心 | 3.0 | 必须追踪，影响主线 |
| 支线 | 2.0 | 应该追踪，丰富剧情 |
| 装饰 | 1.0 | 可选追踪，增加真实感 |

---

## 📚 完整参考文档索引

### 核心文档（10个）
| 文档 | 路径 | 用途 |
|------|------|------|
| 三大定律详解 | `.claude/skills/webnovel-writer/references/anti-hallucination.md` | 防幻觉核心规则 |
| 爽点设计指南 | `.claude/skills/webnovel-writer/references/cool-points-guide.md` | 爽点类型与布局 |
| 节奏控制技巧 | `.claude/skills/webnovel-writer/references/pacing-control.md` | 节奏调整策略 |
| 题材套路库 | `.claude/skills/webnovel-writer/references/genre-tropes.md` | 各题材常用套路 |
| Strand Weave 规范 | `.claude/skills/webnovel-writer/references/strand-weave-pattern.md` | 三线编织规则 |
| 内容润色指南 | `.claude/skills/webnovel-writer/references/polish-guide.md` | AI痕迹清除 |
| 工作流恢复机制 | `.claude/skills/webnovel-writer/references/workflow-resume.md` | 中断恢复策略 |
| 数据链规范 | `.claude/skills/webnovel-writer/references/system-data-flow.md` | state/index/archive |
| 归档策略 | `.claude/skills/webnovel-writer/references/archiving-strategy.md` | 200万字长跑 |
| Git 工作流 | `.claude/skills/webnovel-writer/references/git-workflow.md` | 版本控制规范 |
| XML 标签规范 | `.claude/skills/webnovel-writer/references/tag-specification.md` | 实体/技能/伏笔标签 |
| 常见错误 | `.claude/skills/webnovel-writer/references/common-mistakes.md` | 7类错误与修正 |

### 创意构思（4个）
| 文档 | 路径 |
|------|------|
| 灵感收集 | `.claude/skills/webnovel-writer/references/creativity/inspiration-collection.md` |
| 市场定位 | `.claude/skills/webnovel-writer/references/creativity/market-positioning.md` |
| 创意组合 | `.claude/skills/webnovel-writer/references/creativity/creative-combination.md` |
| 卖点提炼 | `.claude/skills/webnovel-writer/references/creativity/selling-points.md` |

### 世界构建（5个）
| 文档 | 路径 |
|------|------|
| 角色设计 | `.claude/skills/webnovel-writer/references/worldbuilding/character-design.md` |
| 力量体系 | `.claude/skills/webnovel-writer/references/worldbuilding/power-systems.md` |
| 世界规则 | `.claude/skills/webnovel-writer/references/worldbuilding/world-rules.md` |
| 势力体系 | `.claude/skills/webnovel-writer/references/worldbuilding/faction-systems.md` |
| 设定一致性 | `.claude/skills/webnovel-writer/references/worldbuilding/setting-consistency.md` |

### 大纲规划（4个）
| 文档 | 路径 |
|------|------|
| 大纲结构 | `.claude/skills/webnovel-writer/references/outlining/outline-structure.md` |
| 剧情框架 | `.claude/skills/webnovel-writer/references/outlining/plot-frameworks.md` |
| 章节规划 | `.claude/skills/webnovel-writer/references/outlining/chapter-planning.md` |
| 冲突设计 | `.claude/skills/webnovel-writer/references/outlining/conflict-design.md` |

### 写作技巧（5个）
| 文档 | 路径 |
|------|------|
| 对话写作 | `.claude/skills/webnovel-writer/references/writing/dialogue-writing.md` |
| 场景描写 | `.claude/skills/webnovel-writer/references/writing/scene-description.md` |
| 战斗场景 | `.claude/skills/webnovel-writer/references/writing/combat-scenes.md` |
| 情感心理 | `.claude/skills/webnovel-writer/references/writing/emotion-psychology.md` |
| 排版规范 | `.claude/skills/webnovel-writer/references/writing/typesetting.md` |

### 高级技巧（5个）
| 文档 | 路径 |
|------|------|
| 多线叙事 | `.claude/skills/webnovel-writer/references/advanced/multi-threading.md` |
| 伏笔设计 | `.claude/skills/webnovel-writer/references/advanced/foreshadowing.md` |
| 节奏掌控 | `.claude/skills/webnovel-writer/references/advanced/pacing-mastery.md` |
| 人物弧光 | `.claude/skills/webnovel-writer/references/advanced/character-arc.md` |
| 悬念构建 | `.claude/skills/webnovel-writer/references/advanced/suspense-building.md` |

### 题材专项（6个目录，40+ 文件）
| 题材 | 目录 | 文件数 |
|------|------|--------|
| 玄幻修仙 | `.claude/skills/webnovel-writer/references/genres/xuanhuan/` | 4 |
| 规则怪谈 | `.claude/skills/webnovel-writer/references/genres/rules-mystery/` | 7 |
| 狗血言情 | `.claude/skills/webnovel-writer/references/genres/dog-blood-romance/` | 7 |
| 知乎短篇 | `.claude/skills/webnovel-writer/references/genres/zhihu-short/` | 7 |
| 古言 | `.claude/skills/webnovel-writer/references/genres/period-drama/` | 5 |
| 现实题材 | `.claude/skills/webnovel-writer/references/genres/realistic/` | 5 |

---

## 📦 模板库索引

### 通用模板
| 模板 | 路径 | 用途 |
|------|------|------|
| 金手指设计 | `.claude/skills/webnovel-writer/assets/templates/golden-finger-templates.md` | 系统流/鉴定流/签到流 |

### 题材专用模板（8个）
| 题材 | 路径 |
|------|------|
| 修仙 | `.claude/skills/webnovel-writer/assets/templates/genres/修仙.md` |
| 系统流 | `.claude/skills/webnovel-writer/assets/templates/genres/系统流.md` |
| 都市异能 | `.claude/skills/webnovel-writer/assets/templates/genres/都市异能.md` |
| 狗血言情 | `.claude/skills/webnovel-writer/assets/templates/genres/狗血言情.md` |
| 知乎短篇 | `.claude/skills/webnovel-writer/assets/templates/genres/知乎短篇.md` |
| 古言 | `.claude/skills/webnovel-writer/assets/templates/genres/古言.md` |
| 现实题材 | `.claude/skills/webnovel-writer/assets/templates/genres/现实题材.md` |
| 规则怪谈 | `.claude/skills/webnovel-writer/assets/templates/genres/规则怪谈.md` |

---

## ✅ 质量检查清单

### 每章必检
- [ ] 符合大纲？（定律 1）
- [ ] 爽点 ≥1？
- [ ] 无设定冲突？（定律 2）
- [ ] 新实体已标记？（定律 3）
- [ ] 字数 3000-5000？

### 每卷必检
- [ ] 大爽点 ≥2？
- [ ] Strand 三线平衡？
- [ ] 伏笔有回收？
- [ ] 实力提升 ≥2 次？

---

## 🔧 读者体验补丁

### 禁用"占位符正文"
- ❌ 禁止: "???系统/???功能/???"
- ✅ 用代号: "暂称：继承者系统/面板/协议"
- ✅ 用叙述: "系统名称被权限屏蔽/无法读取"

### "权限不足"使用规则
- 每章最多 **1 次**
- 必须给出: 解锁条件 / 部分答案 / 可落地任务

### 都市异能"现实余波"
- 大动静后必须交代: 警戒线、官方口径、舆情

---

**总计**: 70+ 参考文档，8 个题材模板，覆盖网文创作全流程。
