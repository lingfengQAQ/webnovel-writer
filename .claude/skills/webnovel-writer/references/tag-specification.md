# XML 标签规范 v2.0

> **目的**：统一网文创作工作流中的元数据标签格式，便于脚本解析和数据追踪。

---

## 一、标签总览

| 标签 | 用途 | 必填属性 | 可选属性 |
|------|------|----------|----------|
| `<entity>` | 新实体（角色/地点/物品/势力/功法） | type, name, desc, tier | - |
| `<skill>` | 金手指技能 | name, level, desc, cooldown | - |
| `<foreshadow>` | 伏笔埋设 | content, tier | target, location, characters |
| `<deviation>` | 大纲偏离标记 | reason | - |

---

## 二、标签详细规范

### 1. `<entity>` - 实体标签

**用途**：标记章节中首次出现的新角色、地点、物品、势力、功法等。

**格式**：
```xml
<entity type="类型" name="名称" desc="简短描述" tier="层级"/>
```

**属性说明**：

| 属性 | 必填 | 取值 | 说明 |
|------|------|------|------|
| `type` | ✅ | 角色/地点/物品/势力/功法/招式 | 实体类型 |
| `name` | ✅ | 字符串 | 实体名称 |
| `desc` | ✅ | 字符串 | 简短描述（50字内） |
| `tier` | ✅ | 核心/支线/装饰 | 重要程度 |

**层级说明**：
- **核心**：影响主线剧情，必须追踪
- **支线**：丰富剧情，应该追踪
- **装饰**：增加真实感，可选追踪

**示例**：
```xml
<entity type="角色" name="陆辰" desc="主角，觉醒时空能力的大学生" tier="核心"/>
<entity type="地点" name="末日避难所" desc="幸存者聚集地，位于地下三层" tier="支线"/>
<entity type="物品" name="时空碎片" desc="强化金手指的稀有材料" tier="装饰"/>
<entity type="势力" name="守夜人组织" desc="隐秘世界的秩序维护者" tier="核心"/>
<entity type="功法" name="时空掌控" desc="陆辰的核心能力体系" tier="核心"/>
```

---

### 2. `<skill>` - 金手指技能标签

**用途**：记录主角金手指系统解锁的新技能。

**格式**：
```xml
<skill name="技能名" level="等级" desc="技能描述" cooldown="冷却时间"/>
```

**属性说明**：

| 属性 | 必填 | 取值 | 说明 |
|------|------|------|------|
| `name` | ✅ | 字符串 | 技能名称 |
| `level` | ✅ | 数字或Lv格式 | 技能等级 |
| `desc` | ✅ | 字符串 | 技能效果描述 |
| `cooldown` | ✅ | 时间字符串 | 冷却时间（无冷却填"无"） |

**示例**：
```xml
<skill name="时间回溯" level="1" desc="回到10秒前的状态" cooldown="24小时"/>
<skill name="空间锚点" level="2" desc="设置传送锚点，可瞬移返回" cooldown="1小时"/>
<skill name="时间感知" level="1" desc="被动技能，预知3秒内的危险" cooldown="无"/>
```

---

### 3. `<foreshadow>` - 伏笔标签

**用途**：结构化记录埋设的伏笔，便于追踪和回收。

**格式**：
```xml
<foreshadow content="伏笔内容" tier="层级" target="目标回收章节" location="发生地点" characters="相关角色"/>
```

**属性说明**：

| 属性 | 必填 | 取值 | 说明 |
|------|------|------|------|
| `content` | ✅ | 字符串 | 伏笔内容描述 |
| `tier` | ✅ | 核心/支线/装饰 | 伏笔重要程度 |
| `target` | ⬜ | 章节号 | 计划回收的章节 |
| `location` | ⬜ | 字符串 | 伏笔发生地点 |
| `characters` | ⬜ | 逗号分隔 | 相关角色列表 |

**示例**：
```xml
<foreshadow content="神秘老者留下的玉佩开始发光" tier="核心" target="50" location="废弃实验室" characters="陆辰"/>
<foreshadow content="李薇手腕上的奇怪纹身" tier="支线" target="30" characters="李薇,陆辰"/>
<foreshadow content="咖啡店老板意味深长的眼神" tier="装饰"/>
```

---

### 4. `<deviation>` - 大纲偏离标签

**用途**：标记偏离大纲的创作，说明理由以便后续调整。

**格式**：
```xml
<deviation reason="偏离原因"/>
```

**属性说明**：

| 属性 | 必填 | 取值 | 说明 |
|------|------|------|------|
| `reason` | ✅ | 字符串 | 偏离原因和说明 |

**示例**：
```xml
<deviation reason="临时灵感，增加李薇与陆辰的情感互动，为后续感情线铺垫"/>
<deviation reason="原计划本章突破，但节奏过快，延迟到下章"/>
```

---

## 三、标签放置规则

### 1. 放置位置

- **推荐**：章节末尾统一放置（便于管理）
- **允许**：实体首次出现的段落末尾
- **要求**：标签独占一行，不要夹在正文句子中

### 2. 隐藏写法（推荐）

使用 HTML 注释包裹，读者阅读时不可见，脚本仍可解析：

```markdown
正文内容...

<!--
<entity type="角色" name="陆辰" desc="主角，觉醒时空能力" tier="核心"/>
<entity type="地点" name="末日避难所" desc="幸存者聚集地" tier="支线"/>
<skill name="时间回溯" level="1" desc="回到10秒前" cooldown="24小时"/>
<foreshadow content="神秘老者的玉佩" tier="核心" target="50"/>
-->

---

## 本章统计
...
```

### 3. 可见写法（调试用）

不使用注释包裹，标签直接可见（仅用于调试或草稿阶段）：

```markdown
正文内容...

<entity type="角色" name="陆辰" desc="主角，觉醒时空能力" tier="核心"/>

---

## 本章统计
...
```

---

## 四、与旧格式对照

| 旧格式 | 新格式 |
|--------|--------|
| `[NEW_ENTITY: 角色, 陆辰, 主角, 核心]` | `<entity type="角色" name="陆辰" desc="主角" tier="核心"/>` |
| `[GOLDEN_FINGER_SKILL: 时间回溯, 1, 回到10秒前, 24小时]` | `<skill name="时间回溯" level="1" desc="回到10秒前" cooldown="24小时"/>` |
| `[FORESHADOWING_JSON: {...}]` | `<foreshadow content="..." tier="..." .../>` |
| `[OUTLINE_DEVIATION: 原因]` | `<deviation reason="原因"/>` |

---

## 五、脚本解析

`extract_entities.py` 支持解析以下模式：

```python
# 实体标签
<entity type="..." name="..." desc="..." tier="..."/>

# 技能标签
<skill name="..." level="..." desc="..." cooldown="..."/>

# 伏笔标签
<foreshadow content="..." tier="..." [target="..."] [location="..."] [characters="..."]/>

# 偏离标签
<deviation reason="..."/>
```

**注意**：
- 属性值使用双引号 `""`
- 自闭合标签结尾 `/>`
- 支持 HTML 注释包裹 `<!-- ... -->`

---

## 六、常见错误

```xml
<!-- ❌ 错误示例 -->
<entity type='角色' .../>          <!-- 单引号 -->
<entity type="角色" ...>           <!-- 未闭合 -->
<Entity type="角色" .../>          <!-- 大写标签名 -->
[NEW_ENTITY: 角色, ...]            <!-- 旧格式 -->

<!-- ✅ 正确示例 -->
<entity type="角色" name="陆辰" desc="主角" tier="核心"/>
```

---

## 七、版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v2.0 | 2026-01-05 | 全面迁移到 XML 格式 |
| v1.0 | 2026-01-01 | 初版方括号格式 |
