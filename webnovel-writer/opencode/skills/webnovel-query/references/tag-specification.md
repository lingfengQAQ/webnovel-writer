---
name: tag-specification
purpose: XML 标签格式参考（v5.1 引入，v5.4 可选使用）
version: "5.4"
---

<context>
此文件用于 XML 标签格式参考。

**v5.1 引入的变更（v5.4 沿用）**:
- 章节写作时**不再要求**添加 XML 标签
- Data Agent 会自动从纯正文中提取实体，写入 index.db
- 标签仅用于**手动标注**场景（如明确标记重要实体、补充提取遗漏）
- 如果你选择使用标签，请遵循以下规范
</context>

<instructions>

## 标签总览

| 标签 | 用途 | 必填属性 |
|------|------|----------|
| `<entity>` | 新建/自动更新实体（角色/地点/物品/势力/招式） | type, name |
| `<entity-alias>` | 注册实体别名/称号 | id/ref, alias |
| `<entity-update>` | 更新实体属性（支持 set/unset/add/remove/inc + 历史追踪） | id/ref, `<set>` 等 |
| `<skill>` | 金手指技能 | name, level, desc, cooldown |
| `<foreshadow>` | 伏笔埋设 | content, tier |
| `<relationship>` | 角色关系 | char1, char2, type |
| `<deviation>` | 大纲偏离标记 | reason |

## 属性详解

### tier（层级）
- **核心**: 影响主线剧情，必须追踪
- **支线**: 丰富剧情，应该追踪
- **装饰**: 增加真实感，可选追踪

### type（实体类型）
角色 / 地点 / 物品 / 势力 / 招式

### id / ref（实体引用）
- **id（推荐）**: 稳定唯一标识（便于后续更新/加别名）
- **ref**: 用已出现过的名称/别名引用（通过 index.db aliases 表自动解析）
- **type（可选）**: 当 ref 有歧义时用于消歧（如同名不同人）；若仍歧义必须改用 `id`

### `<entity-update>` 子操作
- **set**: `<set key="k" value="v" reason="可选"/>`
- **unset**: `<unset key="k" reason="可选"/>`
- **add**: `<add key="k" value="v" reason="可选"/>`（数组追加，自动去重）
- **remove**: `<remove key="k" value="v" reason="可选"/>`（数组移除）
- **inc**: `<inc key="k" delta="1" reason="可选"/>`（数值递增，默认 +1）

**顶层字段白名单**（可直接更新实体顶层而非 current）：`tier`, `desc`, `canonical_name`, `importance`, `status`, `parent`

> **建议**: `<entity>` 强烈建议补充 `desc` 和 `tier`，否则后续检索和一致性检查会变差。

## 放置规则

- **推荐**: 章节末尾统一放置（便于管理）
- **允许**: 实体首次出现的段落末尾
- **要求**: 标签独占一行，不夹在正文句子中

### 隐藏写法（推荐）

```markdown
正文内容...

<!--
<entity type="角色" id="luchen" name="陆辰" desc="主角，觉醒时空能力" tier="核心"/>
<entity-alias id="luchen" alias="陆队" context="加入特勤队后"/>
<entity-update id="luchen"><set key="realm" value="F级-觉醒者" reason="觉醒完成"/></entity-update>
<skill name="时间回溯" level="1" desc="回到10秒前" cooldown="24小时"/>
<foreshadow content="神秘老者的玉佩" tier="核心" target="50"/>
<relationship char1_id="luchen" char2_id="liwe" type="ally" intensity="60" desc="初步合作"/>
-->
```

</instructions>

<examples>

<example>
<input>标记新角色</input>
<output>
```xml
<entity type="角色" id="luchen" name="陆辰" desc="主角，觉醒时空能力的大学生" tier="核心"/>
<entity type="角色" id="liwe" name="李薇" desc="女主，神秘背景的校花" tier="核心"/>
<entity type="角色" name="咖啡店老板" desc="看似普通实则深藏不露" tier="装饰"/>
```
</output>
</example>

<example>
<input>注册新称号/别名</input>
<output>
```xml
<entity-alias id="luchen" alias="陆队" context="加入特勤队后"/>
<entity-alias ref="陆辰" alias="继承者" context="系统确认身份后"/>
```
</output>
</example>

<example>
<input>更新实体属性（境界/位置/状态/归属等）</input>
<output>
```xml
<entity-update id="luchen">
  <set key="realm" value="E级-掌控者" reason="危机中突破"/>
  <set key="location" value="城西废弃实验室"/>
</entity-update>
```
</output>
</example>

<example>
<input>标记新技能</input>
<output>
```xml
<skill name="时间回溯" level="1" desc="回到10秒前的状态" cooldown="24小时"/>
<skill name="空间锚点" level="2" desc="设置传送锚点，可瞬移返回" cooldown="1小时"/>
<skill name="时间感知" level="1" desc="被动技能，预知3秒内的危险" cooldown="无"/>
```
</output>
</example>

<example>
<input>埋设伏笔</input>
<output>
```xml
<foreshadow content="神秘老者留下的玉佩开始发光" tier="核心" target="50" location="废弃实验室"/>
<foreshadow content="李薇手腕上的奇怪纹身" tier="支线" target="30" characters="李薇,陆辰"/>
<foreshadow content="咖啡店老板意味深长的眼神" tier="装饰"/>
```
</output>
</example>

<example>
<input>标记大纲偏离</input>
<output>
```xml
<deviation reason="临时灵感，增加李薇与陆辰的情感互动，为后续感情线铺垫"/>
<deviation reason="原计划本章突破，但节奏过快，延迟到下章"/>
```
</output>
</example>

</examples>

<errors>
❌ `<entity type='角色' .../>` → ✅ 使用双引号 `type="角色"`
❌ `<entity type="角色" ...>` → ✅ 自闭合 `.../>` 或补全 `</entity>`
❌ `<Entity type="角色" .../>` → ✅ 小写标签名 `<entity`
❌ `[NEW_ENTITY: 角色, 陆辰, ...]` → ✅ 使用XML格式
❌ `<entity-update ref="xxx"></entity-update>` → ✅ 至少包含一个 `<set key="..." value="..."/>`
</errors>
