# `.cache/index.db` 设计与精准读取接口

> 日期：2026-06-26（0.2 修订：2026-06-27，按 review 修派生数据物化策略）
> 状态：设计文档（O4 消解）
> 上游：`story-repo-spec-2026-06-10.md` 0.8、`v7-prd.md` 1.0
> 目的：补全 spec §11 的表 DDL 和精准读取接口完整清单，作为 M1 实施的输入
>
> 0.2 修订要点：随章号漂移的派生值（悬了太久章数、蓄积章数、是否超期）一律不物化，改查询时计算；文体指纹去掉时间戳身份以保证可重建；清理重复存储（卷号、别名、与主键重复的 UNIQUE）；补连续弱钩报表接口。

---

## 0. 设计原则

1. **重建器即格式的参考实现**：能从源文件完整重建，说明格式自洽
2. **缓存可丢弃**：删除后系统仍可用（首查触发重建或全文件扫描降级）
3. **只读 `定稿/`、`大纲/`、`文风/`**：工作区不入缓存（未定稿的内容不是真相源）
4. **表名英文，内容中文**：机器协议 vs 业务数据分离
5. **派生值默认查询时算**：随"当前章号"漂移的值（悬了太久、蓄积章数、是否超期）一律不物化，否则每写一章就要全表刷新、极易失同步。只有证明是热点的静态派生值才物化，且**物化值不得依赖全局游标（当前章号）**。

---

## 1. 表结构设计

### 1.1 `chapters` 表

**用途**：章节 front matter 展开，支持按章号、卷号、章定位、钩子、情绪定位查询。

```sql
CREATE TABLE chapters (
  chapter_num INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  volume_num INTEGER NOT NULL,
  perspective TEXT,                    -- 视角角色
  story_time TEXT,                     -- 书内时间（自由文本）
  word_count INTEGER NOT NULL,
  chapter_position TEXT NOT NULL,      -- 推进|过渡|日常
  hook_type TEXT,                      -- 危机钩-强 等
  mood_position TEXT,                  -- 压抑|铺垫|小爽|大爽|转折
  file_path TEXT NOT NULL,             -- 相对于 repo 根目录
  is_key_chapter BOOLEAN DEFAULT 0     -- 是否关键章（来源见说明）
);

CREATE INDEX idx_chapters_volume ON chapters(volume_num);
CREATE INDEX idx_chapters_position ON chapters(chapter_position);
CREATE INDEX idx_chapters_hook ON chapters(hook_type);
```

**说明**：
- 不存储"本章要写到的事"、伏笔/悬念/感情线列表（这些从 front matter 动态读取，太易变）
- 按卷查询直接对 `volume_num` 建索引，不再额外存一份 `volume_num_idx`
- `is_key_chapter` 来源需明确：**卷首章**可由卷边界确定性推断；**转折/高潮章**无可靠源字段——M1 实施时若要标记，应在章 front matter 增一个字段承载，否则本列只标卷首，其余恒 0（不靠脚本猜语义，符合不变量 7）

---

### 1.2 `threads` 表

**用途**：三类线索条目统一存放（伏笔/悬念/感情线），支持按类型、状态、强度、悬了太久查询。

```sql
CREATE TABLE threads (
  id TEXT PRIMARY KEY,                 -- 伏笔-031、悬念-008、感情线-012
  type TEXT NOT NULL,                  -- foreshadow | suspense | romance
  short_title TEXT NOT NULL,           -- 灭门真凶
  strength TEXT NOT NULL,              -- 高|中|低
  status TEXT NOT NULL,                -- 进行|已收尾|已放弃
  opened_chapter INTEGER NOT NULL,
  planned_end TEXT,                    -- 第7卷 或 章号（强度"高"时必填，约束在写出器/重建器强制，DDL 不管）
  last_advanced_chapter INTEGER,       -- 最后推进章（可为空）
  file_path TEXT NOT NULL
);

CREATE INDEX idx_threads_type ON threads(type);
CREATE INDEX idx_threads_status ON threads(status);
```

**说明**：
- **"悬了太久"不物化**：`悬了多少章 = 当前最大章号 − last_advanced_chapter`、`是否超期 = 该值 > 阈值`，都在查询/视图里现算（阈值取 `book.yaml` 各类型配置）。物化它们会让每次定稿都得刷新全表，且随时与真相脱节。
- 履历不入表（太易变，从文件读取）
- `planned_end` 的"强度高必填"是业务约束，DDL 的可空 TEXT 管不住，由写出器与重建器校验

---

### 1.3 `secrets` 表

**用途**：信息差管理，支持泄密扫描、蓄积章数查询。

```sql
CREATE TABLE secrets (
  id TEXT PRIMARY KEY,                 -- 信息差-021
  short_title TEXT NOT NULL,           -- 灭门真凶
  known_to TEXT NOT NULL,              -- JSON array: ["大长老", "神秘老者"]
  reader_knows BOOLEAN NOT NULL,       -- 读者是否已知
  registered_chapter INTEGER NOT NULL,
  keywords TEXT NOT NULL,              -- JSON array: ["大长老", "灭门", "血书"]
  file_path TEXT NOT NULL
);

CREATE INDEX idx_secrets_reader_knows ON secrets(reader_knows);
```

**说明**：
- `known_to` 和 `keywords` 存为 JSON 字符串（`node:sqlite` 内置的 SQLite 支持 JSON 函数）
- **蓄积章数不物化**：`蓄积章数 = 当前最大章号 − registered_chapter`，查询时现算（同 threads 的"悬了太久"），避免每章刷新全表

---

### 1.4 `entities` 表

**用途**：名册（角色、地点、物品、势力），支持别名解析、位置查询、境界查询。

```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,                 -- 正名
  type TEXT NOT NULL,                  -- character | location | item | faction
  status TEXT,                         -- 在世|已死|失踪|封印...（角色专用）
  location TEXT,                       -- 最后已知位置（角色专用）
  realm TEXT,                          -- 境界（角色专用）
  possessions TEXT,                    -- JSON array（角色专用）
  last_changed_chapter INTEGER,
  file_path TEXT NOT NULL
);

CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_status ON entities(status);
CREATE INDEX idx_entities_location ON entities(location);

-- 别名表（别名 → 正名 反查的唯一真相源；正名自身的别名清单从这里聚合，不在 entities 再存一份）
CREATE TABLE entity_aliases (
  alias TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES entities(id)
);

CREATE INDEX idx_entity_aliases_entity ON entity_aliases(entity_id);
```

**说明**：
- 别名只在 `entity_aliases` 存一份（反查正名、聚合某实体的别名清单都靠它），不在 `entities` 再存 JSON 副本，避免两份脱同步
- 地点、物品、势力的角色专用字段（status/location/realm/possessions）为 NULL

---

### 1.5 `fingerprints` 表

**用途**：文体指纹历史，支持文体漂移检测、体检。

```sql
CREATE TABLE fingerprints (
  chapter_range_start INTEGER NOT NULL,
  chapter_range_end INTEGER NOT NULL,
  is_baseline BOOLEAN DEFAULT 0,       -- 是否为基线指纹

  -- 文体特征（部分常用项提列，加速查询）
  avg_sentence_length REAL,
  sentence_length_variance REAL,
  avg_paragraph_length REAL,
  common_phrase_frequency TEXT,        -- JSON object
  vocabulary_richness REAL,

  fingerprint_data TEXT NOT NULL,      -- 完整指纹 JSON（包含上述字段 + 更多）

  PRIMARY KEY(chapter_range_start, chapter_range_end)
);

CREATE INDEX idx_fingerprints_baseline ON fingerprints(is_baseline);
```

**说明**：
- **指纹是确定性派生物**：同一章段（定稿不可改）任何时候重算都一样，所以身份只用 `(章段起, 章段止)`——**不带时间戳**。带 `computed_at` 会让"删 `.cache` 重建"对不上（时间戳无法复现），破坏不变量 2。
- 何时算哪段由调用方决定（体检/卷复盘），算出来按章段 upsert；删缓存后这些行从定稿文本原样重算
- 基线指纹由 `book.yaml` 的 `文体基线起/止` 决定

---

## 2. 精准读取接口完整清单

### 2.1 设计原则

- **命令式 API**：每个接口是一个明确的脚本命令，可在 CLI 调用
- **AI 友好**：接口名称和参数都是自然语言式，不需要记忆复杂参数
- **默认精准**：返回最小必要数据，避免全文加载
- **统一输出**：所有接口输出 JSON 或纯文本，AI 可直接消费

### 2.2 条目读取（7 个接口）

| 接口 | 命令 | 输入 | 输出 |
|------|------|------|------|
| 读条目基本信息 | `read-thread <id> --fields=基本信息` | 条目 ID | JSON：强度、状态、开启章、预计收尾 |
| 读条目履历 | `read-thread <id> --履历` | 条目 ID | 履历列表（按章号排序） |
| 读条目收尾计划 | `read-thread <id> --收尾计划` | 条目 ID | 收尾计划文本 |
| 读条目描述 | `read-thread <id> --描述` | 条目 ID | 描述文本 |
| 列出悬了太久的条目 | `list-threads --悬了太久` | 无 | JSON 数组：ID、类型、悬了多少章 |
| 列出某类型条目 | `list-threads --type=<type> [--status=<status>]` | 类型、状态（可选） | JSON 数组：条目列表 |
| 按强度筛选条目 | `list-threads --strength=高` | 强度 | JSON 数组：条目列表 |

### 2.3 大纲读取（5 个接口）

| 接口 | 命令 | 输入 | 输出 |
|------|------|------|------|
| 读总纲指定小节 | `read-outline --总纲 --section=<标题>` | 小节标题 | Markdown 文本 |
| 读总纲结局段 | `read-outline --总纲 --结局` | 无 | Markdown 文本 |
| 读卷纲全文 | `read-outline --卷=<N>` | 卷号 | Markdown 全文 |
| 读卷纲指定小节 | `read-outline --卷=<N> --section=<标题>` | 卷号、小节标题 | Markdown 文本 |
| 列出所有卷纲 | `list-volumes` | 无 | JSON 数组：卷号、卷名、章数范围 |

### 2.4 正文读取（8 个接口）

| 接口 | 命令 | 输入 | 输出 |
|------|------|------|------|
| 读章节 front matter | `read-chapter <num> --front-matter` | 章号 | JSON：完整 front matter |
| 读章节正文 | `read-chapter <num>` | 章号 | Markdown 正文（不含 front matter） |
| 读章节结尾 N 字 | `read-chapter <num> --tail=<N>` | 章号、字数 | 正文末尾 N 字 |
| 读章节开头 N 字 | `read-chapter <num> --head=<N>` | 章号、字数 | 正文开头 N 字 |
| 读章摘要 | `read-chapter <num> --摘要` | 章号 | 章摘要文本 |
| 读章节范围摘要 | `read-chapters --range=<start>-<end> --摘要` | 章号范围 | JSON 数组：章号、摘要 |
| 读近 N 章结尾 | `read-chapters --recent=<N> --tail=<M>` | 章数、字数 | JSON 数组：章号、结尾 M 字 |
| 按章定位筛选章节 | `list-chapters --章定位=推进 [--卷=<N>]` | 章定位、卷号（可选） | JSON 数组：章号、标题 |

### 2.5 时间线读取（4 个接口）

| 接口 | 命令 | 输入 | 输出 |
|------|------|------|------|
| 读当前卷时间线 | `read-timeline --current-volume` | 无（从状态推断） | Markdown 表格 |
| 读当前卷+上一卷时间线 | `read-timeline --current-and-prev` | 无 | Markdown 表格 |
| 读指定卷时间线 | `read-timeline --卷=<N>` | 卷号 | Markdown 表格 |
| 按在场角色筛选 | `read-timeline --在场=<角色名>` | 角色名 | 过滤后的 Markdown 表格 |

### 2.6 设定读取（6 个接口）

| 接口 | 命令 | 输入 | 输出 |
|------|------|------|------|
| 读角色卡 front matter | `read-character <name> --front-matter` | 角色正名 | JSON：境界、位置、状态、持有 |
| 读角色卡完整 | `read-character <name>` | 角色正名 | Markdown 全文（含 front matter） |
| 读角色卡指定小节 | `read-character <name> --section=<标题>` | 角色正名、小节标题 | Markdown 文本 |
| 解析别名 | `resolve-alias <别名>` | 别名 | 正名（或"未找到"） |
| 列出所有角色 | `list-characters [--status=<status>]` | 状态（可选） | JSON 数组：正名、状态、位置 |
| 读世界观指定小节 | `read-worldview --section=<标题>` | 小节标题 | Markdown 文本 |

### 2.7 信息差读取（3 个接口）

| 接口 | 命令 | 输入 | 输出 |
|------|------|------|------|
| 读信息差基本信息 | `read-secret <id> --基本信息` | 信息差 ID | JSON：知情人、读者已知、关键词 |
| 读信息差内容 | `read-secret <id> --内容` | 信息差 ID | 内容文本 |
| 列出未揭晓信息差 | `list-secrets --reader-knows=false` | 无 | JSON 数组：ID、短题、蓄积章数 |

### 2.8 全文检索（2 个接口）

| 接口 | 命令 | 输入 | 输出 |
|------|------|------|------|
| 关键词全文检索 | `grep-story <关键词>` | 关键词 | JSON 数组：章号、匹配行、上下文 |
| 正则表达式检索 | `grep-story --regex=<pattern>` | 正则表达式 | JSON 数组：章号、匹配行、上下文 |

### 2.9 报表生成（6 个接口）

| 接口 | 命令 | 输入 | 输出 |
|------|------|------|------|
| 悬了太久清单 | `report-overdue-threads` | 无 | JSON：按类型分组的清单 |
| 信息差蓄积报表 | `report-secret-accumulation` | 无 | JSON：未揭晓信息差、蓄积章数 |
| 文体漂移报告 | `report-style-drift` | 无 | JSON：当前指纹 vs 基线的差异 |
| 条目活跃率报表 | `report-thread-activity --卷=<N>` | 卷号 | JSON：本卷开/推进/收尾条目清单 |
| 连续弱钩计数 | `report-weak-hook-streak` | 无 | JSON：末尾连续弱钩章数（全书近况/机检"连续弱钩上限"用） |
| 全书统计摘要 | `report-book-stats` | 无 | JSON：总章数、总字数、条目数、角色数 |

---

## 3. 接口实现优先级

### P0（M1 必须）

写章流程（§8 第 3 步备料）依赖的接口：

- 时间线：读当前卷+上一卷
- 条目：读条目基本信息、读条目履历
- 正文：读近 N 章结尾、读章摘要
- 设定：读角色卡 front matter、解析别名
- 报表：悬了太久清单

### P1（M2-M3 需要）

机检与全书近况依赖：

- 正文：读章节 front matter、按章定位筛选
- 信息差：列出未揭晓信息差
- 全文检索：关键词全文检索
- 报表：全书统计摘要、连续弱钩计数

### P2（M4-M6 优化）

AI 角色与自动模式：

- 大纲：读卷纲全文、读总纲指定小节
- 正文：读章节范围摘要
- 报表：条目活跃率报表、文体漂移报告

---

## 4. 重建器职责

### 4.1 输入

- 源文件：`定稿/`、`大纲/`、`文风/`（只读，不读 `工作区/`）
- 配置：`book.yaml`（当前章号、基线章号、阈值）

### 4.2 输出

- 五表全量重建：删除旧数据 → 扫描源文件 → INSERT
- 触发时机：`.cache/index.db` 不存在或损坏时

### 4.3 校验

- 履历证据引用：验证章节文件存在（spec 0.8 A3 决策）
- 条目文件 vs front matter 一致性：`定稿/正文/` front matter 中提到的条目必须有对应文件
- 别名唯一性：同一别名不能指向多个实体

### 4.4 边界

- **不做**：语义验证（履历证据是否真实、泄密是否真泄密）→ 由两审负责
- **不做**：条目推进逻辑验证（"埋下"→"推进"→"回收"顺序）→ 由写章流程保证

---

## 5. 缓存失效与增量更新

### 5.1 定稿时的增量更新

定稿步骤（§8 第 8 步）完成一次 commit 后，触发增量更新：

```sql
-- 插入新章节
INSERT INTO chapters (...) VALUES (...);

-- 更新涉及的条目（只写"最后推进章"，悬了太久查询时再算）
UPDATE threads SET last_advanced_chapter = ?, status = ? WHERE id = ?;

-- 更新涉及的角色
UPDATE entities SET location = ?, realm = ?, last_changed_chapter = ? WHERE id = ?;

-- 新增信息差
INSERT INTO secrets (...) VALUES (...);
```

> 注意：定稿只写"事实"列（最后推进章、状态、位置…），**不写任何随当前章号漂移的派生值**——那些在查询时算，所以每章定稿只动当章真正变化的几行，不刷全表。

### 5.2 失效策略

- **全量重建**：删除 `.cache/`、book.yaml 修改、检测到格式版本升级
- **增量更新**：定稿一章、手改检测后补登
- **懒加载**：查询时发现缓存缺失 → 扫描对应源文件 → 插入缓存

---

## 6. 与 spec 的对应关系

| spec 章节 | 表 | 接口 |
|---|---|---|
| §4.1 章节文件 | `chapters` | 2.4 正文读取 |
| §4.2 角色卡 | `entities` (type=character) | 2.6 设定读取 |
| §4.3 信息差 | `secrets` | 2.7 信息差读取 |
| §4.4 时间线 | 不入表（直接读文件） | 2.5 时间线读取 |
| §4.5 名册 | `entities` + `entity_aliases` | 解析别名 |
| §5 三类条目 | `threads` | 2.2 条目读取 |
| §6 文风铁律 | 不入表（直接读文件） | 无（AI 全文读取） |
| §6.2 文体指纹 | `fingerprints` | 报表：文体漂移 |

---

## 7. 实施检查清单

- [ ] 五表 DDL 在 SQLite 中可执行（语法检查）
- [ ] 所有表都有主键和必要索引
- [ ] 重建器逻辑明确：输入/输出/校验/边界
- [ ] 精准读取接口清单完整（41 个接口）
- [ ] 接口优先级明确（P0/P1/P2）
- [ ] 本文档补进 spec 0.8 §11（或作为附录）

---

## 8. 后续工作

- **M1 第一步**：根据本文档实现重建器和 P0 接口
- **M2-M3**：实现 P1 接口
- **M4-M6**：实现 P2 接口
- **7.x**：语义召回（向量索引）作为可选插件，不入核心表

---

**设计完成时间**：2026-06-26  
**设计者**：Claude Opus 4.8 + Codex 架构审查  
**状态**：待审查 → M1 实施输入
