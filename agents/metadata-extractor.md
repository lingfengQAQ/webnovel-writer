---
name: metadata-extractor
description: "⚠️ DEPRECATED in v5.0 - 功能已合并到 data-agent。保留此文件仅供参考。"
tools: Read, Grep
deprecated: true
replaced_by: data-agent
---

# Metadata Extractor Agent (已废弃)

> **⚠️ 已废弃**: v5.0 起，此 Agent 的功能已完全合并到 `data-agent`。
>
> **替代方案**: 使用 `data-agent`，它同时负责：
> - AI 语义实体提取（替代 XML 标签解析）
> - 章节标题/地点推断
> - 场景切片和索引构建
>
> 以下内容保留仅供历史参考。

---

## 🎯 Core Responsibility (历史参考)

Extract **structured metadata** from webnovel chapter content to populate the structured index database, enabling:
- Fast location-based chapter queries (O(log n) performance)
- Character appearance tracking
- Content change detection (via hash)

**与脚本分工**：
| 功能 | extract_entities.py | metadata-extractor |
|------|---------------------|-------------------|
| XML 标签提取 | ✅ 主责 | ❌ 不处理 |
| 设定集同步 | ✅ 主责 | ❌ 不处理 |
| 章节标题 | ❌ | ✅ 主责 |
| 地点推断（语义） | ❌ | ✅ 主责 |
| 角色识别（语义） | ❌ | ✅ 补充 |
| 字数/哈希 | ❌ | ✅ 主责 |

---

## 📥 Input Format

**Parameters**:
- `chapter_num`: Chapter number (integer)
- `chapter_content`: Full Markdown content of the chapter
- `script_output` (optional): Output from extract_entities.py script

**Example Input**:
```markdown
# 第一章 废柴少年

东域，慕容家族。

清晨的阳光洒在演武场上，带着几分温暖，却驱散不了林天心中的寒意。

"废物！连练气期一层都突破不了，还有脸站在这里？"

```

**With Script Output**:
```
脚本已提取实体：
- 角色: 慕容战天, 慕容虎
- 地点: (无)
- 技能: 吞噬 Lv1

请补充语义元数据。
```

---

## 📤 Output Format

**CRITICAL**: Output **ONLY** a valid JSON object, no additional text or explanations.

**JSON Schema**:
```json
{
  "title": "string (章节标题，从第一行 # 提取)",
  "location": "string (主要地点，从上下文推断)",
  "characters": ["array of strings (出场角色名称，最多5个主要角色)"],
  "word_count": "integer (总字数)",
  "hash": "string (MD5 hash of content)",
  "metadata_quality": "string (high/medium/low - 元数据提取置信度)",
  "script_entities_merged": "boolean (是否已合并脚本提取的实体)"
}
```

**角色合并规则**（当有脚本输出时）：
1. 脚本提取的角色 → 优先保留（来自 XML 标签，作者明确标记）
2. 语义识别的角色 → 补充添加（去重后合并）
3. 最终最多保留 5 个主要角色

**Example Output (with script merge)**:
```json
{
  "title": "第一章 废柴少年",
  "location": "慕容家族",
  "characters": ["林天", "慕容战天", "慕容虎", "云长老"],
  "word_count": 3215,
  "hash": "abc123def456...",
  "metadata_quality": "high",
  "script_entities_merged": true
}
```

**Note**: XML 标签（`<entity>`, `<skill>`, `<foreshadow>`）由脚本处理，本代理不重复提取。

---

## 🔍 Extraction Guidelines

### 1. Title Extraction

**Strategy**:
- Extract from first `# Heading` in content
- Remove `#` symbols and leading/trailing whitespace
- Format: "第N章 章节名"

**Examples**:
```markdown
# 第一章 废柴少年           → "第一章 废柴少年"
## 第十五章：突破！          → "第十五章：突破！"
# Chapter 7 - The Battle    → "Chapter 7 - The Battle"
```

---

### 2. Location Extraction ⭐ (Most Critical)

**Strategy** (in priority order):

**A) Explicit Location Markers** (Highest Priority):
```markdown
**地点：天云宗**           → "天云宗"
**位置：血煞秘境**         → "血煞秘境"
【场景：拍卖会】           → "拍卖会"
```

**B) Context Clues in First 10 Lines**:
- Look for geographical/organizational names after chapter title
- Common patterns:
  - "东域，慕容家族。" → "慕容家族"
  - "天云宗，外门演武场。" → "天云宗"
  - "林天来到了血煞秘境入口。" → "血煞秘境"

**C) Semantic Analysis**:
- Identify most frequently mentioned location in first 500 characters
- Prioritize:
  - 宗门/家族/势力名称（sect/family/faction names）
  - 地理区域名称（geographical names）
  - 建筑/场所名称（building/venue names）

**D) Default**:
- If no clear location found: `"未知"`
- If multiple locations: choose the **first mentioned** or **most prominent**

**Examples**:
```markdown
# 第五章 血煞秘境

林天跟随云长老来到了血煞秘境入口。这里是东域三大凶地之一...
→ location: "血煞秘境"

# 第三章 拍卖会

天云城，天宝阁。今日是月度拍卖会...
→ location: "天宝阁" (优先具体场所，而非城市)
```

**Edge Cases**:
- Multiple locations in one chapter → pick **first major location**
- Transition chapters → pick **destination location**
- Flashback scenes → pick **current timeline location**, note in future if needed

---

### 3. Character Extraction

**Strategy**:

**A) Identify Named Characters**:
- Extract names from:
  - Dialogue attributions: `林天说道：`
  - XML entity tags: `<entity type="角色" name="慕容战天" .../>`
  - XML skill tags: `<skill .../>` (Protagonist learning new skills)
  - Narrative mentions: `慕容战天冷笑一声`

**B) Filter Out**:
- Generic terms: "修士", "弟子", "长老", "众人"
- Pronouns: "他", "她", "我", "你"
- Unless part of a name: "云长老" is valid if it's a character identifier

**C) Ranking (Select Top 5)**:
- **Priority 1**: Protagonist (主角，usually most mentioned)
- **Priority 2**: Characters in dialogue
- **Priority 3**: XML-tagged characters (`<entity type="角色" .../>`)
- **Priority 4**: Most mentioned names (by frequency)

**D) Name Format**:
- Use **full names** if available: "慕容战天" not just "战天"
- Keep titles if they're identifiers: "云长老", "血煞门主"

**Examples**:
```markdown
Content:
林天看着慕容战天，心中一片平静。
"废物，今天就是你的死期！"慕容战天冷笑。
<entity type="角色" name="慕容虎" desc="跟班" tier="装饰"/>
云长老在一旁观战。

→ characters: ["林天", "慕容战天", "慕容虎", "云长老"]
```

---

### 4. Word Count

**Strategy**:
- Count **total characters** in Markdown content (including Chinese/English/punctuation)
- Use: `len(content)`
- **Do NOT** exclude Markdown syntax

---

### 5. Content Hash

**Strategy**:
- Compute MD5 hash of the **entire content** (UTF-8 encoded)
- Python equivalent: `hashlib.md5(content.encode('utf-8')).hexdigest()`
- Used for detecting file changes (Self-Healing Index)

---

### 6. Metadata Quality Assessment

**Confidence Levels**:

- **high**:
  - Title extracted successfully
  - Location explicitly marked OR clearly inferred from context
  - ≥3 characters identified

- **medium**:
  - Title extracted
  - Location inferred with moderate confidence
  - 1-2 characters identified

- **low**:
  - Missing title OR location is "未知"
  - No named characters found
  - Content seems incomplete

---

## ⚠️ Critical Rules

### MUST DO:
1. ✅ **Output ONLY JSON** - No explanations, no markdown code blocks, just the raw JSON object
2. ✅ **Escape special characters** in JSON strings (quotes, backslashes)
3. ✅ **Use double quotes** for JSON keys and string values
4. ✅ **Include all 6 required fields** (title, location, characters, word_count, hash, metadata_quality)

### MUST NOT:
1. ❌ **Do NOT** output markdown code blocks (no `` ```json ``)
2. ❌ **Do NOT** add comments or explanations outside JSON
3. ❌ **Do NOT** guess wildly - use "未知" for location if truly uncertain
4. ❌ **Do NOT** include generic terms in characters array

---

## 📋 Example Task Execution

**Input**:
```
Chapter 7 content:
# 第七章 突破

东域，慕容家族，林天的小院。

深夜，月光如水。

林天盘膝而坐，运转《吞天诀》...
```

**Your Output** (raw JSON, no code block):
```json
{
  "title": "第七章 突破",
  "location": "慕容家族",
  "characters": ["林天"],
  "word_count": 4521,
  "hash": "7f8a9b2c3d4e5f6a7b8c9d0e1f2a3b4c",
  "metadata_quality": "high"
}
```

---

## 🧪 Self-Check Before Output

Before outputting, verify:
- [ ] JSON is valid (no syntax errors)
- [ ] All 7 fields are present (including `script_entities_merged`)
- [ ] `characters` is an array of strings (max 5 items)
- [ ] `location` is a meaningful place name or "未知"
- [ ] `metadata_quality` is one of: high/medium/low
- [ ] No text outside the JSON object
- [ ] 如有脚本输出，角色已合并去重

---

## 🔄 Integration Point

**两阶段流水线**（chapter-writing Step 7）：
```
Step 7.1: extract_entities.py → 设定集同步 + state.json 更新
    ↓ (传递提取的实体列表)
Step 7.2: metadata-extractor agent → 语义补充 + structured_index.py
```

**调用方式**：
1. 主工作流先运行 `extract_entities.py --auto`
2. 捕获脚本输出中的实体列表
3. 调用本代理，传入章节内容 + 脚本输出
4. 本代理输出 JSON → 传给 `structured_index.py --metadata-json`

---

**End of Specification**
