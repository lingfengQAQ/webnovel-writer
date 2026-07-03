# 技术设计：M1 格式层核心库 + 派生缓存

## 1. 设计范围

四层能力（依赖链）：
1. **容错读写库**：解析/序列化 front matter、平铺 YAML、Markdown 表格、条目文件
2. **Storage Adapter 小端口**：按职责拆分的 8+ 独立 reader/writer 端口（ChapterReader、ThreadLedgerReader 等）
3. **`.cache/index.db` 五表 + 重建器**：node:sqlite，只读源文件全量重建，任何时刻可删
4. **41 精准读取接口 CLI**：分 P0/P1/P2 三层实现，每层一 commit 检查点

下游 M2+ 在这四层地基上长真实业务逻辑（写章流程、状态机、AI 角色）。

## 2. 架构分层与数据流

```
┌─────────────────────────────────────────────────────────────┐
│  CLI 41 接口层（P0/P1/P2）                                    │
│  read-chapter / list-threads / report-overdue-threads ...   │
└────────────┬────────────────────────────────────────────────┘
             │
             v
┌─────────────────────────────────────────────────────────────┐
│  Storage Adapter 小端口                                       │
│  ChapterReader / ThreadLedgerReader / EntityReader ...       │
│  （依赖缓存或直接读文件，调用方无感知）                        │
└────────────┬────────────────────────────────────────────────┘
             │
             v
┌──────────────────┐        ┌─────────────────────────────────┐
│  .cache/index.db │  ◄───  │  容错读写库（parser/serializer） │
│  五表 + 索引      │        │  front matter / YAML / Markdown │
└──────────────────┘        └─────────────────────────────────┘
      ▲                                ▲
      │ 重建器                          │
      │                                │
      └────────────────────────────────┘
               只读 定稿/大纲/文风 源文件
```

**关键原则**（spec §1.5）：
- 上层不知道下层用了缓存还是直接读文件
- Storage Adapter 是稳定接口，缓存策略变更不影响调用方
- 重建器只读源文件，不读工作区

## 3. 层 1：容错读写库

### 3.1 模块结构

```
v7/src/storage/parsers/
├── front-matter.js      # 分离 YAML front matter 与 Markdown 正文
├── yaml-safe.js         # 容错 YAML 解析（保留未知字段）
├── markdown-table.js    # 解析 Markdown 表格（时间线、名册）
└── book-config.js       # book.yaml 平铺字段提取

v7/src/storage/serializers/
├── yaml-dialect.js      # 防呆方言：平铺/块列表/危险值引号
└── front-matter.js      # 组装 front matter + 正文
```

### 3.2 Front Matter 解析契约

```js
// front-matter.js
export function parseFrontMatter(content) {
  // 输入：完整文件内容（含 --- 包裹的 YAML + Markdown 正文）
  // 输出：{ ok: boolean, data: object | null, body: string, error: string }
  // ok=true: data 是解析后对象，body 是去掉 front matter 的 Markdown 正文
  // ok=false: error 含错误描述（中文），data=null
}
```

**容错规则**：
- `---` 不存在或不配对：返回 `{ok: false, error: "缺少 front matter 分隔符"}`
- YAML 语法错误：返回 `{ok: false, error: "YAML 解析失败：<原因>"}`
- **不崩溃**：任何输入都返回对象，不抛异常

### 3.3 YAML 安全解析

```js
// yaml-safe.js
export function parseYAML(yamlString, options = {}) {
  // options.preserveUnknown: true（默认）保留未知字段
  // 返回：{ ok: boolean, data: object | null, error: string, raw: string }
  // raw: 原始 YAML 字符串（写回时用）
}
```

**保留未知字段策略**（不变量 9）：
- 解析时记录原始 YAML 字符串
- 写回时：已知字段用新值，未知字段从原始串提取后拼接

### 3.4 防呆序列化

```js
// yaml-dialect.js
export function serializeYAML(data, options = {}) {
  // 输入：JS 对象（平铺，不含嵌套映射）
  // 输出：符合防呆方言的 YAML 字符串
  // 规则：
  // 1. 一律平铺（检测嵌套抛错）
  // 2. 数组输出块格式：\n- item1\n- item2
  // 3. 危险值加引号：数字串/true/false/null/含冒号
  // 4. 两空格缩进
}

function needsQuoting(value) {
  // 判断是否需要引号：
  // - 纯数字字符串："123" → "\"123\""
  // - 布尔/null 字面值："true" → "\"true\""
  // - 含冒号/特殊字符："A:B" → "\"A:B\""
}
```

### 3.5 Markdown 表格解析

```js
// markdown-table.js
export function parseMarkdownTable(content) {
  // 输入：Markdown 表格文本（含表头 | A | B | C |）
  // 输出：{ ok: boolean, headers: string[], rows: object[], error: string }
  // rows: [{A: "值1", B: "值2"}, ...]
  // 容错：表头不对齐、空行跳过、不崩溃
}
```

**用途**：
- 时间线：`| 章 | 书内时间 | 一句话事件 | 在场 |`
- 名册：`| 正名 | 别名 | 类型 | 首现章 |`

## 4. 层 2：Storage Adapter 小端口

### 4.1 端口清单（拒绝上帝对象）

```
v7/src/storage/
├── adapters/
│   ├── ChapterReader.js         # 读章节 front matter、正文、范围
│   ├── ChapterWriter.js         # 写新章到定稿（M2 落地，本任务只定接口占位）
│   ├── ThreadLedgerReader.js    # 读三类条目（伏笔/悬念/感情线）
│   ├── ThreadLedgerWriter.js    # 更新条目、追加履历（M2 落地，占位）
│   ├── EntityReader.js          # 读角色卡、解析别名
│   ├── TimelineReader.js        # 读时间线、按在场过滤
│   ├── SecretReader.js          # 读信息差
│   ├── OutlineReader.js         # 读总纲/卷纲
│   └── BookConfigReader.js      # 读 book.yaml
└── index.js                     # 统一导出（按需 import）
```

### 4.2 ChapterReader 接口

```js
// ChapterReader.js
export class ChapterReader {
  constructor(repoPath, cache) {
    // repoPath: 书仓库根目录
    // cache: CacheManager 实例（可选，无缓存时直接读文件）
  }

  async readFrontMatter(chapterNum) {
    // 返回：{ ok, data: {章号, 标题, 卷, 视角, ...}, error }
    // 策略：优先查缓存 chapters 表，缺失时读文件
  }

  async readBody(chapterNum) {
    // 返回：{ ok, body: string, error }
    // 纯正文（不含 front matter）
  }

  async readTail(chapterNum, wordCount) {
    // 返回：{ ok, text: string, error }
    // 正文末尾 N 字
  }

  async readHead(chapterNum, wordCount) {
    // 正文开头 N 字
  }

  async readRange(startChapter, endChapter, fields = ['摘要']) {
    // 批量读取章号范围，指定字段
    // 返回：{ ok, chapters: [{章号, ...fields}], error }
  }
}
```

### 4.3 ThreadLedgerReader 接口

```js
// ThreadLedgerReader.js
export class ThreadLedgerReader {
  constructor(repoPath, cache) {}

  async readBasicInfo(threadId) {
    // threadId: "伏笔-031" / "悬念-008" / "感情线-012"
    // 返回：{ ok, data: {强度, 状态, 开启章, 预计收尾, 最后推进章}, error }
  }

  async readHistory(threadId) {
    // 返回：{ ok, history: [{章号, 动作, 描述, 证据}], error }
    // 从履历段落解析（第N章：动作——描述（见...））
  }

  async readClosurePlan(threadId) {
    // 返回：{ ok, plan: string, error }
    // 从 "## 收尾计划" 段落提取
  }

  async readDescription(threadId) {
    // 从 "## 描述" 段落提取
  }

  async listOverdue(bookConfig) {
    // 输入：book.yaml 配置（各类型悬了太久章数阈值）
    // 返回：[{id, type, 悬了多少章, 最后推进章}]
    // 计算：当前最大章号 − last_advanced_chapter > 阈值
  }

  async listByType(type, status = null) {
    // type: "foreshadow" / "suspense" / "romance"
    // status: "进行" / "已收尾" / "已放弃"（可选）
    // 返回：[{id, short_title, strength, status}]
  }
}
```

### 4.4 EntityReader 接口

```js
// EntityReader.js
export class EntityReader {
  constructor(repoPath, cache) {}

  async readCharacterFrontMatter(name) {
    // name: 正名
    // 返回：{ ok, data: {姓名, 境界, 位置, 状态, 持有, 最后变更章}, error }
  }

  async readCharacterFull(name) {
    // 返回：{ ok, frontMatter, body: string, error }
    // body 是设定/典型对话/关系段落
  }

  async resolveAlias(alias) {
    // 返回：{ ok, canonicalName: string | null, error }
    // 查 entity_aliases 表或解析名册文件
  }

  async listCharacters(filter = {}) {
    // filter: { status: "在世" } 等
    // 返回：[{正名, 状态, 位置, 境界}]
  }
}
```

### 4.5 其他端口（简要）

**TimelineReader**：`readCurrentVolume()` / `readVolumeRange(start, end)` / `readByParticipant(name)`

**SecretReader**：`readBasicInfo(id)` / `readContent(id)` / `listUnrevealed()`

**OutlineReader**：`readOutlineSection(type, volumeNum?, sectionTitle?)` / `listVolumes()`

**BookConfigReader**：`read()` 返回 book.yaml 平铺对象

## 5. 层 3：`.cache/index.db` 缓存表与重建器

> 术语澄清：习称「五表」指五张主表（`chapters` / `threads` / `secrets` / `entities` / `fingerprints`），另有 `entity_aliases` 别名关联表挂在 `entities` 下，**物理上共 6 张 CREATE TABLE**。下文 DDL 与 schema.js 以 6 张为准。

### 5.1 表结构（O4 §1 DDL，精简版）

```sql
-- chapters 表
CREATE TABLE chapters (
  chapter_num INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  volume_num INTEGER NOT NULL,
  perspective TEXT,
  story_time TEXT,
  word_count INTEGER NOT NULL,
  chapter_position TEXT NOT NULL,  -- 推进|过渡|日常
  hook_type TEXT,                  -- 危机钩-强 等
  mood_position TEXT,              -- 压抑|铺垫|小爽|大爽|转折
  file_path TEXT NOT NULL,
  is_key_chapter BOOLEAN DEFAULT 0
);
CREATE INDEX idx_chapters_volume ON chapters(volume_num);
CREATE INDEX idx_chapters_position ON chapters(chapter_position);
CREATE INDEX idx_chapters_hook ON chapters(hook_type);

-- threads 表（三类条目统一）
CREATE TABLE threads (
  id TEXT PRIMARY KEY,             -- 伏笔-031、悬念-008、感情线-012
  type TEXT NOT NULL,              -- foreshadow | suspense | romance
  short_title TEXT NOT NULL,
  strength TEXT NOT NULL,          -- 高|中|低
  status TEXT NOT NULL,            -- 进行|已收尾|已放弃
  opened_chapter INTEGER NOT NULL,
  planned_end TEXT,                -- 第7卷 或 章号
  last_advanced_chapter INTEGER,
  file_path TEXT NOT NULL
);
CREATE INDEX idx_threads_type ON threads(type);
CREATE INDEX idx_threads_status ON threads(status);

-- secrets 表
CREATE TABLE secrets (
  id TEXT PRIMARY KEY,
  short_title TEXT NOT NULL,
  known_to TEXT NOT NULL,          -- JSON array
  reader_knows BOOLEAN NOT NULL,
  registered_chapter INTEGER NOT NULL,
  keywords TEXT NOT NULL,          -- JSON array
  file_path TEXT NOT NULL
);
CREATE INDEX idx_secrets_reader_knows ON secrets(reader_knows);

-- entities 表
CREATE TABLE entities (
  id TEXT PRIMARY KEY,             -- 正名
  type TEXT NOT NULL,              -- character | location | item | faction
  status TEXT,
  location TEXT,
  realm TEXT,
  possessions TEXT,                -- JSON array
  last_changed_chapter INTEGER,
  file_path TEXT NOT NULL
);
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_status ON entities(status);

-- entity_aliases 表（别名 → 正名，唯一真相源）
CREATE TABLE entity_aliases (
  alias TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES entities(id)
);
CREATE INDEX idx_entity_aliases_entity ON entity_aliases(entity_id);

-- fingerprints 表
CREATE TABLE fingerprints (
  chapter_range_start INTEGER NOT NULL,
  chapter_range_end INTEGER NOT NULL,
  is_baseline BOOLEAN DEFAULT 0,
  avg_sentence_length REAL,
  sentence_length_variance REAL,
  avg_paragraph_length REAL,
  common_phrase_frequency TEXT,   -- JSON object
  vocabulary_richness REAL,
  fingerprint_data TEXT NOT NULL,  -- 完整指纹 JSON
  PRIMARY KEY(chapter_range_start, chapter_range_end)
);
CREATE INDEX idx_fingerprints_baseline ON fingerprints(is_baseline);
```

### 5.2 CacheManager 接口

```js
// v7/src/cache/index.js
export class CacheManager {
  constructor(dbPath) {
    // dbPath: 书仓库/.cache/index.db
    // 使用 node:sqlite (Node ≥ 22.13.0 内置)
  }

  async ensureReady(repoPath) {
    // 检查 index.db 是否存在且可用
    // 不存在或损坏 → 调用 rebuildFromSource(repoPath)
  }

  async rebuildFromSource(repoPath) {
    // 全量重建：DELETE 五表 → 扫描源文件 → INSERT
    // 只读 定稿/、大纲/、文风/
    // 返回：{ ok, warnings: [], errors: [] }
    // warnings: 履历引用不存在的章节文件
    // errors: 别名冲突（致命，拒绝重建）
  }

  async query(sql, params) {
    // 执行 SELECT 查询，返回结果集
  }

  async close() {
    // 关闭数据库连接
  }
}
```

### 5.3 重建器逻辑

```js
// v7/src/cache/rebuilder.js
export async function rebuildCache(repoPath, db) {
  // 步骤：
  // 1. 清空五表（DELETE）
  // 2. 扫描 定稿/正文/*.md → 填充 chapters 表
  // 3. 扫描 大纲/伏笔|悬念|感情线/*.md → 填充 threads 表
  // 4. 扫描 定稿/设定/信息差/*.md → 填充 secrets 表
  // 5. 解析 定稿/设定/名册.md → 填充 entities + entity_aliases 表
  // 6. 扫描 定稿/设定/角色/*.md → upsert entities 表（type=character）
  //    注意：必须 INSERT-or-UPDATE。角色卡可能不在名册里（名册非强制全覆盖），
  //    只 UPDATE 会丢掉这些角色 → 用 INSERT ... ON CONFLICT(id) DO UPDATE
  // 7. fingerprints 表留空（特征提取随 M3+ 体检补）
  // 8. 校验：
  //    - 履历引用章节文件是否存在（警告）
  //    - 别名唯一性（错误）
  // 9. 返回 warnings 和 errors
}

async function scanChapters(repoPath) {
  // 扫描 定稿/正文/*.md
  // 返回：Map<章号, 文件路径>
  // 用途：履历验证时查映射（避免 fs.access 通配符问题）
}
```

**校验规则**（O4 §4.3）：
- **履历证据章节验证**（spec 0.8 A3）：
  - 步骤：
    1. `scanChapters(repoPath)` 返回章号 → 文件路径映射（Map）
    2. 解析条目履历行的"第N章"，提取章号
    3. 查 Map，章号不存在 → 记 warning（不阻断重建）
  - 格式：`第152章：推进——林晚取得实证（见本章结尾对峙段）`
  - 验证范围：章节文件存在性（脚本能做的），不做语义验证（AI 两审负责）
- **别名唯一性**：同一 alias 指向多个 entity_id → 记 error，拒绝重建

### 5.4 派生值策略（不物化）

**查询时计算**（O4 §0 原则 5）：
- `悬了太久章数 = MAX(chapter_num) FROM chapters − last_advanced_chapter`
- `信息差蓄积章数 = MAX(chapter_num) − registered_chapter`
- `是否超期 = 悬了太久章数 > book.yaml 阈值`

**不写入表**：避免每章定稿刷新全表，避免缓存与真相脱节。

## 6. 层 4：41 精准读取接口 CLI

### 6.1 命令组织

```
v7/bin/webnovel-writer.js  ← 入口，动态 import 分发（按命令名加载 src/commands/${命令}.js）
v7/src/commands/            ← 命令模块目录（21 个文件承载 O4 §2 的 41 个接口，多数接口是同一文件的 --选项）
├── read-chapter.js         # 5 接口：<num> | --front-matter | --tail=N | --head=N | --摘要
├── read-chapters.js        # 2 接口：--range=<a>-<b> --摘要 | --recent=<N> --tail=<M>（复数，批量）
├── list-chapters.js        # 1 接口：--章定位=推进 [--卷=N]
├── read-thread.js          # 4 接口：--fields=基本信息 | --履历 | --收尾计划 | --描述
├── list-threads.js         # 3 接口：--悬了太久 | --type=<t> [--status=<s>] | --strength=<强>
├── read-timeline.js        # 4 接口：--current-volume | --current-and-prev | --卷=N | --在场=<名>
├── read-character.js       # 3 接口：<name> | --front-matter | --section=<标题>
├── resolve-alias.js        # 1 接口：<别名>
├── list-characters.js      # 1 接口：[--status=<状态>]
├── read-worldview.js       # 1 接口：--section=<标题>（读 定稿/设定/世界观.md）
├── read-secret.js          # 2 接口：--基本信息 | --内容
├── list-secrets.js         # 1 接口：--reader-knows=false
├── read-outline.js         # 4 接口：--总纲 --section=<标题> | --总纲 --结局 | --卷=N | --卷=N --section
├── list-volumes.js         # 1 接口：列出所有卷纲
├── grep-story.js           # 2 接口：<关键词> | --regex=<pattern>
├── report-overdue-threads.js       # 1 接口
├── report-secret-accumulation.js   # 1 接口
├── report-weak-hook-streak.js      # 1 接口
├── report-thread-activity.js       # 1 接口：--卷=N
├── report-book-stats.js            # 1 接口
└── report-style-drift.js   # 1 接口：能读指纹表并对比基线，但 M1 不做特征提取（表留空 → 返回友好错误）
```

> 接口总数核对（对齐 O4 §2.2-2.9）：条目 7 + 大纲 5 + 正文 8 + 时间线 4 + 设定 6 + 信息差 3 + 全文检索 2 + 报表 6 = **41**。权威逐条清单见 prd.md AC2。

**动态分发逻辑**（bin/webnovel-writer.js）：
```js
const command = process.argv[2]
if (!command || command === '--help') {
  console.log('用法：webnovel-writer <命令> [选项]')
  process.exit(0)
}

let cache
try {
  const mod = await import(`../src/commands/${command}.js`)
  const { positionalArgs, options } = parseArgs(process.argv.slice(3))

  const repoPath = process.cwd() // M3 状态机后续会处理工作目录定位
  cache = new CacheManager(path.join(repoPath, '.cache', 'index.db'))
  await cache.ensureReady(repoPath)

  const result = await mod.run(positionalArgs, options, { repoPath, cache })
  if (result.ok) {
    if (result.output) console.log(result.output)
    process.exitCode = 0
  } else {
    console.error(result.error)
    process.exitCode = 1
  }
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ENOENT') {
    console.error(`未知命令「${command}」。运行 webnovel-writer --help 查看可用命令。`)
    process.exitCode = 1
  } else {
    console.error(`执行命令「${command}」时出错：${err.message}`) // 永不带栈崩
    process.exitCode = 1
  }
} finally {
  if (cache) await cache.close() // 显式关闭，避免 Windows 文件锁
}
```

**分层实现**（每层一 sub-commit）：
- **P0（8 个）**：read-timeline (current-and-prev)、read-thread (基本+履历)、read-chapter (tail+摘要)、read-character (front-matter)、resolve-alias、report-overdue-threads
- **P1（7 个）**：read-chapter (front-matter+按章定位筛选)、list-secrets (未揭晓)、grep-story (关键词)、report-book-stats、report-weak-hook-streak
- **P2（26 个）**：其余全部

### 6.2 命令范式（可测契约）

**契约**：每个命令模块导出 `run(args, options, ctx)`，**只返回结果对象，不做 IO 副作用**（命令内部不 `console.log`、不 `process.exit`、不 `new CacheManager`）。打印、退出码、缓存生命周期由 bin 入口统一处理。命令因此可被单元测试直接调用（喂 fixture `repoPath` + 临时 `cache`，断言返回对象），这是 AC2「41 接口逐条测试」能成立的前提。

> 历史教训：早期版本让 `execute` 同时 `return` 又 `console.log + process.exit`，契约自相矛盾，导致命令层无法单测、35 个接口被写成空壳。本契约统一为"纯函数返回 + bin 副作用"。

```js
// 命令契约
// @param {string[]} args     位置参数（已剥离选项）
// @param {object}   options  解析后的 --选项（--key=value → {key:value}，--flag → {flag:true}）
// @param {{repoPath: string, cache: CacheManager}} ctx  注入的运行上下文
// @returns {Promise<{ok: boolean, output?: string, error?: string}>}
//   ok=true  → output 是要打印到 stdout 的字符串（JSON.stringify 或纯文本）
//   ok=false → error 是要打印到 stderr 的中文错误；bin 以 exit(1) 退出

// read-chapter.js 示例
import { ChapterReader } from '../storage/adapters/ChapterReader.js'

export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) {
    return { ok: false, error: '章号必须是数字' }
  }

  const reader = new ChapterReader(ctx.repoPath, ctx.cache)

  if (options['front-matter']) {
    const r = await reader.readFrontMatter(chapterNum)
    return r.ok
      ? { ok: true, output: JSON.stringify(r.data, null, 2) }
      : { ok: false, error: r.error }
  }
  // ... 其他分支同理：拿 adapter 结果 → 映射成 {ok, output|error}
}
```

**bin/webnovel-writer.js 是唯一副作用点**（打印 / 退出 / 缓存生命周期）：
```js
const cache = new CacheManager(path.join(repoPath, '.cache', 'index.db'))
await cache.ensureReady(repoPath)
try {
  const result = await mod.run(positionalArgs, options, { repoPath, cache })
  if (result.ok) {
    if (result.output) console.log(result.output)
    process.exitCode = 0
  } else {
    console.error(result.error)
    process.exitCode = 1
  }
} finally {
  await cache.close()  // 显式关闭，避免 Windows 文件锁
}
```

**统一输出格式**：
- 成功：`{ok: true, output}` → bin 打印 output 到 stdout，exit 0
- 失败：`{ok: false, error}` → bin 打印 error 到 stderr，exit 1
- 命令内部**不碰** `process` / `console` / 文件锁，保证可单测

### 6.3 特殊接口设计

**report-overdue-threads**：
```js
// 查询时计算悬了太久章数
const maxChapter = await db.query('SELECT MAX(chapter_num) FROM chapters')
const overdueThreads = await db.query(`
  SELECT id, type, short_title, last_advanced_chapter,
         (? - last_advanced_chapter) as overdue_count
  FROM threads
  WHERE status = '进行'
`, [maxChapter])

// 按 book.yaml 阈值过滤
const config = await bookConfigReader.read()
const TYPE_CN = { foreshadow: '伏笔', suspense: '悬念', romance: '感情线' }
const filtered = overdueThreads.filter(t => {
  // book.yaml 的 key 是中文「伏笔悬了太久章数」，threads.type 是英文，必须先映射
  const threshold = config.data[`${TYPE_CN[t.type]}悬了太久章数`] ?? 10
  return t.overdue_count > threshold
})

// 按类型分组输出
return groupBy(filtered, 'type')
```

**report-weak-hook-streak**：
```js
// 从 chapters 表倒序查连续弱钩
const recentChapters = await db.query(`
  SELECT chapter_num, hook_type
  FROM chapters
  ORDER BY chapter_num DESC
  LIMIT 20
`)

let streak = 0
for (const ch of recentChapters) {
  // spec §4.1: 钩子值形如"危机钩-强"、"危机钩-弱"、"情绪钩-弱"
  if (ch.hook_type?.includes('弱钩') || ch.hook_type?.endsWith('-弱')) {
    streak++
  } else {
    break
  }
}

return { streak }
```

**report-style-drift**（M1 边界）：
```js
// 读基线指纹（is_baseline=1）
const baseline = await db.query(`
  SELECT * FROM fingerprints WHERE is_baseline = 1
`)

// 读最近章段指纹（假设已有）
const recent = await db.query(`
  SELECT * FROM fingerprints
  ORDER BY chapter_range_end DESC
  LIMIT 1
`)

if (!baseline || !recent) {
  return { ok: false, error: '缺少指纹数据。fingerprints 表为空，请先运行体检以提取特征。' }
}

// 对比特征（简单差值）
const drift = {
  avg_sentence_length_delta: recent.avg_sentence_length - baseline.avg_sentence_length,
  // ... 其他特征
}

return { baseline, recent, drift }
```

**M1 边界说明**：`report-style-drift` 接口存在、能读 `fingerprints` 表并对比基线，但 M1 **不实现特征提取函数**。测试策略：手工插入基线数据 + 最近数据到 `fingerprints` 表，测试对比逻辑；真实特征提取（avg_sentence_length 计算等）留 M3+ 体检/卷复盘实现。

## 7. 测试策略

### 7.1 测试结构（镜像 src）

```
v7/test/
├── storage/
│   ├── parsers/
│   │   ├── front-matter.test.js
│   │   ├── yaml-safe.test.js
│   │   └── markdown-table.test.js
│   ├── serializers/
│   │   └── yaml-dialect.test.js
│   └── adapters/
│       ├── ChapterReader.test.js
│       ├── ThreadLedgerReader.test.js
│       └── EntityReader.test.js
├── cache/
│   ├── CacheManager.test.js
│   └── rebuilder.test.js
├── commands/
│   ├── read-chapter.test.js
│   ├── list-threads.test.js
│   └── ... (41 个接口各一测试)
└── fixtures/
    └── sample-book/          # 示例书仓库（定稿/大纲/文风完整结构）
        ├── book.yaml
        ├── 定稿/
        │   ├── 正文/
        │   │   ├── 0001-开局.md
        │   │   └── 0002-初遇.md
        │   ├── 设定/
        │   │   ├── 角色/林晚.md
        │   │   ├── 信息差/信息差-001-灭门真凶.md
        │   │   ├── 时间线/第01卷.md
        │   │   ├── 世界观.md          # read-worldview --section 用
        │   │   └── 名册.md
        │   └── 摘要/
        │       └── 章摘要/
        │           ├── 0001.md
        │           └── 0002.md        # read-chapters --range 摘要用
        └── 大纲/
            ├── 总纲.md                # read-outline --总纲 [--section|--结局] 用
            ├── 第01卷.md              # read-outline --卷 / list-volumes 用
            ├── 伏笔/伏笔-001-神秘老者.md
            ├── 悬念/悬念-001-玉佩来历.md   # list-threads --type=suspense 用
            └── 感情线/感情线-001-大师兄.md # list-threads --type=romance 用
```

> 扩充说明：原 fixture 只够测 P0/P1。P2 的 read-outline / list-volumes / read-worldview 需要 `大纲/总纲.md`、`大纲/第NN卷.md`、`定稿/设定/世界观.md`；list-threads 按类型筛选需要悬念/感情线各一条；read-chapters 范围摘要需要 ≥2 个章摘要。这些在「阶段 D 重建」前补齐。

**Fixture 完整示例**：

`0001-开局.md`（章节文件）：
```markdown
---
章号: 1
标题: 开局
卷: 1
视角: 林晚
书内时间: 大历1023年春月初一
字数: 2800
章定位: 推进
钩子: 危机钩-强
情绪定位: 铺垫
伏笔:
  - 埋下 伏笔-001
本章要写到的事:
  - 林晚初入宗门
  - 神秘老者出现
---

林晚抬头望着宗门大殿，心中忐忑不安。

（正文约 2800 字...）

结尾处，一道黑影闪过，留下一枚玉佩。
```

`伏笔-001-神秘老者.md`（条目文件）：
```markdown
---
强度: 高
状态: 进行
开启章: 1
预计收尾: 第3卷
最后推进章: 1
---
## 描述
神秘老者的真实身份。

## 收尾计划
第三卷揭晓：曾是宗门长老，因禁术被逐。

## 履历
- 第1章：埋下——神秘老者留玉佩（见本章结尾黑影段落）
```

`林晚.md`（角色卡）：
```markdown
---
姓名: 林晚
别名:
  - 晚晚
  - 林师妹
状态: 在世
位置: 青云宗
境界: 练气三层
持有:
  - 青霜剑
最后变更章: 1
---
## 设定
外门弟子，天赋中等但心性坚韧。

## 典型对话
"本姑娘才不怕！"

## 关系
与大师兄关系微妙。
```

`第01卷.md`（时间线）：
```markdown
| 章 | 书内时间 | 一句话事件 | 在场 |
|----|----------|------------|------|
| 1 | 1023春月初一 | 林晚入宗门，神秘老者留玉佩 | 林晚 |
```

`名册.md`：
```markdown
| 正名 | 别名 | 类型 | 首现章 |
|------|------|------|---------|
| 林晚 | 晚晚, 林师妹 | character | 1 |
| 神秘老者 | 黑衣人 | character | 1 |
```

`book.yaml`：
```yaml
spec_version: "7.0"
书名: 测试书
类型: 玄幻
每章目标字数: 3000
卷规模: 40
文体基线起: 1
文体基线止: 30
伏笔悬了太久章数: 10
悬念悬了太久章数: 10
感情线悬了太久章数: 30
连续弱钩上限: 3
关键章稿数: 3
自动确认细纲: false
连写批次大小: 8
```

### 7.2 关键测试用例

**AC1 删光 `.cache` 全量重建**
```js
// test/cache/rebuilder.test.js
test('删除缓存后全量重建，查询结果不变', async () => {
  const repoPath = 'test/fixtures/sample-book'
  const dbPath = `${repoPath}/.cache/index.db`
  
  // 第一次重建
  const cache1 = new CacheManager(dbPath)
  await cache1.ensureReady(repoPath)
  const result1 = await cache1.query('SELECT COUNT(*) as count FROM chapters')
  
  // 删除缓存
  await fs.rm(dbPath, { force: true })
  
  // 第二次重建
  const cache2 = new CacheManager(dbPath)
  await cache2.ensureReady(repoPath)
  const result2 = await cache2.query('SELECT COUNT(*) as count FROM chapters')
  
  assert.equal(result1[0].count, result2[0].count)
})
```

**AC3 容错读取保留未知字段**
```js
// test/storage/parsers/yaml-safe.test.js
test('未知字段保留并原样写回', async () => {
  const original = `---
章号: 1
标题: 测试
自定义字段: 自定义值
---
正文`
  
  const parsed = parseFrontMatter(original)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.data.自定义字段, '自定义值')
  
  // 修改已知字段
  parsed.data.标题 = '新标题'
  
  // 写回
  const serialized = serializeFrontMatter(parsed.data, parsed.body)
  assert.ok(serialized.includes('自定义字段: 自定义值'))
  assert.ok(serialized.includes('标题: 新标题'))
})
```

**AC4 防呆写出**
```js
// test/storage/serializers/yaml-dialect.test.js
test('列表输出块格式', () => {
  const data = { 伏笔: ['伏笔-001', '伏笔-002'] }
  const yaml = serializeYAML(data)
  assert.ok(yaml.includes('伏笔:\n  - 伏笔-001\n  - 伏笔-002'))
  assert.ok(!yaml.includes('[伏笔-001, 伏笔-002]'))
})

test('危险值加引号', () => {
  const data = { 章号: '123', 开关: 'true', 标题: '包含:冒号' }
  const yaml = serializeYAML(data)
  assert.ok(yaml.includes('章号: "123"'))
  assert.ok(yaml.includes('开关: "true"'))
  assert.ok(yaml.includes('标题: "包含:冒号"'))
})
```

**AC5 Windows 中文路径**
```js
// test/integration/chinese-path.test.js
test('Windows 中文路径全链路', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows 专用测试')
    return
  }
  
  const tmpDir = path.join(os.tmpdir(), '测试书仓库')
  // 构建含中文目录/文件的 fixture
  await setupChinesePathFixture(tmpDir)
  
  // 重建缓存
  const cache = new CacheManager(`${tmpDir}/.cache/index.db`)
  await cache.ensureReady(tmpDir)
  
  // 读取接口
  const reader = new ChapterReader(tmpDir, cache)
  const result = await reader.readFrontMatter(1)
  
  assert.equal(result.ok, true)
  assert.equal(result.data.标题, '测试章节')
  
  // 显式关闭数据库连接（避免 Windows 文件锁导致清理失败）
  await cache.close()
  
  // 清理
  await fs.rm(tmpDir, { recursive: true, force: true })
})
```

### 7.3 测试覆盖率目标

- **容错读写库**：每个 parser/serializer 覆盖正常路径 + 至少 2 个错误路径
- **Storage Adapter**：每个端口主方法有正常用例 + 边界（不存在的 ID、空结果）
- **缓存重建器**：删缓存重建、校验规则（履历章节不存在、别名冲突）
- **41 接口**：P0 每个接口 ≥2 用例（正常+边界），P1/P2 每个接口 ≥1 用例

## 8. 技术选型

### 8.1 YAML 库

**选项 A：js-yaml**
- 优势：成熟、广泛使用、MIT、依赖树极小（仅一个传递依赖 argparse）
- 劣势：需引入一个运行时依赖（后端规范 §1.1 要求零依赖）

**选项 B：手写轻量解析器**
- 优势：零依赖
- 劣势：开发成本高、边界情况多、YAML 规范复杂（1.2 版 100+ 页）

**决策**：使用 `js-yaml` 解析 + 手写序列化，理由：
1. YAML 规范复杂，手写解析器风险高（嵌套、转义、多行字符串、锚点等边界情况）
2. `js-yaml` 依赖树极小：`npm ls` 仅一个传递依赖 `argparse`（同 nodeca 维护、MIT、供其 CLI 用）
3. 防呆方言限制了输出格式复杂度（平铺、块列表），序列化可手写控制
4. 后端规范 §1.1 的"零依赖"目标在于避免臃肿依赖树，单一成熟库（4.1.0, 19kB min+gzip）是可接受的折中

**折中方案**：
- 解析用 `js-yaml`（复杂、依赖成熟度）
- 序列化手写（简单、可控、防呆方言强制执行）

**风险缓解**：
- `js-yaml` 是行业标准（每周 7000 万次下载、MIT、维护活跃）
- prd Constraints C1 明确标注为"唯一例外"
- 若未来需移除依赖，替换点单一（parsers/yaml-safe.js）

### 8.2 文件扫描

使用 Node 内置 `fs/promises` + `path`：
- `fs.readdir(dir, { recursive: true, withFileTypes: true })`（Node ≥20）递归扫描
- 按文件名前缀过滤（`0001-`、`伏笔-`）

### 8.3 node:sqlite

Node ≥ 22.13.0 内置（无需 `--experimental-sqlite` flag）：
```js
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('path/to/db.db')
db.exec('CREATE TABLE ...')
const stmt = db.prepare('SELECT * FROM chapters WHERE chapter_num = ?')
const rows = stmt.all(123)
```

**注意**：`node:sqlite` 是同步 API（`DatabaseSync`），但包在 async 函数里不影响上层异步调用。

## 9. 风险与缓解

### 9.1 风险：41 接口工作量大

**缓解**：
- 地基做扎实后，每个接口大多是"一次查询 + 格式化"的薄封装
- 按 P0→P1→P2 分层，每层一 commit 检查点，可随时切分任务
- P2 若时间紧，文体指纹相关接口（`report-style-drift`）可暂时返回"功能未实现"占位

### 9.2 风险：YAML 解析边界情况多

**缓解**：
- 防呆方言限制了输出格式复杂度（平铺、块列表）
- 容错读取只需"不崩溃 + 保留未知字段"，不需 100% 正确解析
- 依赖 `js-yaml` 的成熟度

### 9.3 风险：Windows 中文路径测试假阴性

**缓解**：
- 所有 IO 显式 `encoding: 'utf8'`
- CI Windows job 真实跑中文路径 fixture
- 测试用 `os.tmpdir()` 动态构建，不依赖硬编码路径

### 9.4 风险：重建器校验逻辑复杂

**缓解**：
- 履历章节验证只查文件存在性（`fs.access`），不做语义解析
- 别名唯一性用 Map 去重，O(n) 复杂度
- 两审负责语义校验（履历真假），重建器只做脚本能做的

## 10. 边界与非目标

**M1 做**：
- ✅ 容错读取、防呆写出
- ✅ Storage Adapter 小端口（Reader 全部、Writer 接口占位）
- ✅ 五表 DDL + 全量重建器
- ✅ 41 精准读取接口 CLI（P0/P1/P2 全部）
- ✅ 删缓存重建 CI 测试

**M1 不做**：
- ❌ Writer 端口真实实现（M2 定稿流程调用）
- ❌ 增量更新缓存（定稿时只写变化行）
- ❌ 文体特征提取算法（`fingerprints` 表建好留空，M3+ 体检补）
- ❌ CLI 命令注册机制优化（当前硬编码 switch，M3+ 重构）
- ❌ 向量库、语义检索（7.x 可选插件）

## 11. 实施检查清单

阶段划分见 `implement.md`，此处列设计完备性检查：

- [ ] 四层架构清晰（读写库 → 小端口 → 缓存 → CLI）
- [ ] 每个端口接口签名明确（参数、返回值、错误处理）
- [ ] 五表 DDL 可执行（语法正确、索引完整）
- [ ] 重建器逻辑明确（扫描顺序、校验规则、错误处理）
- [ ] 41 接口清单完整（对齐 O4 §2）
- [ ] 测试策略覆盖 AC1-AC12（prd.md 验收标准）
- [ ] 技术选型有理由（YAML 库、node:sqlite）
- [ ] 风险有缓解措施
- [ ] 边界清晰（Writer 占位、文体特征留空）

---

**设计完成**。下一步：`implement.md` 执行计划（四阶段 checklist + 验证命令 + 回滚点）。
