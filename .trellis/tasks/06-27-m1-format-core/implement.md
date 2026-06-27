# 执行计划：M1 格式层核心库 + 派生缓存

> 前置：已读 prd.md、design.md，以及后端规范（质量/数据/错误/目录结构）+ spec 0.8 + O4 缓存设计。
> 落点全部在 `v7/src/` 与 `v7/test/`；不碰 v6 与根遗产。
> 本机命令：`cd v7 && node --test`（Node 24.15.0 可用）；Python 脚本用 `PYTHONUTF8=1 python`。

---

## ⚠ 计划修正与重建（2026-06-27 review 后）

**背景**：A–E 六个 commit 已落地，但 review 发现 D.2+D.3（`2bb34f6`）把 35 个 P1/P2 接口写成 `console.log('{}')` 空壳，且命令层零测试。根因是 design §6.2 旧契约自相矛盾（既 `return` 又 `console.log + process.exit`），命令无法单测。已 `git revert 2bb34f6` 撤回空壳。

**修正后契约**（design §6.2 已改）：命令导出 `run(args, options, ctx)` 只返回 `{ok, output?, error?}`，**不碰 process/console/cache 生命周期**；bin 唯一负责打印、退出码、`cache.ensureReady/close`。命令因此可单测，AC2 才成立。

**重建顺序**（覆盖原 D.0–D.3，全部真实现 + 每接口 test/commands 测试）：
- [x] R0 卫生：`v7/.gitignore` 忽略 `.cache/`；删冗余 `test/chinese-path.test.js`（保留 `test/integration/chinese-path.test.js`）；rebuilder `scanCharacters` 改 upsert（修角色卡丢数据 bug）
- [x] R1 契约重构：bin 改 `run`+ctx 分发；6 个 P0 命令（read-chapter/read-thread/read-timeline/read-character/resolve-alias/report-overdue-threads）改 `run` 契约 + 补 `test/commands/*.test.js`
- [x] R2 fixture 扩充：补 `大纲/总纲.md`、`大纲/第01卷.md`、`定稿/设定/世界观.md`、`定稿/摘要/章摘要/0002.md`、悬念/感情线各一条目（design §7.1）
- [x] R3 P1 真实现 + 测试：list-chapters、list-secrets、grep-story（关键词）、report-book-stats、report-weak-hook-streak、read-chapter `--front-matter`（已在 P0 文件内）
- [x] R4 P2 真实现 + 测试：read-chapters（新建）、read-worldview（新建）、read-outline、list-volumes、list-threads、list-characters、read-secret、grep-story `--regex`、report-secret-accumulation、report-thread-activity、report-style-drift（边界占位：读指纹对比基线、不做特征提取）
- [x] R5 补齐 6 个缺失 adapter 测试 + 全量 AC1-AC12 复核

**41 接口权威清单**见 prd.md AC2 表（21 命令文件承载）。下方原始 A–E checklist 保留作历史参考。

---

## 四阶段依赖链

```
阶段 A：容错读写库（parser/serializer）
    ↓
阶段 B：Storage Adapter 小端口（8+ Reader + Writer 占位）
    ↓
阶段 C：.cache/index.db 五表 + 重建器（node:sqlite）
    ↓
阶段 D：41 精准读取接口 CLI（分 P0/P1/P2 三层，每层 sub-commit）
```

每阶段独立验证 + 一次 commit 检查点（除阶段 D 分三 sub-commit）。

---

## 阶段 A：容错读写库

### A1 YAML 依赖与基础工具

- [ ] A1.1 安装 `js-yaml`：`cd v7 && npm install js-yaml`（MIT、依赖树仅含 argparse）
- [ ] A1.2 建 `v7/src/storage/parsers/` 与 `v7/src/storage/serializers/` 目录

### A2 Front Matter 解析

- [ ] A2.1 `v7/src/storage/parsers/front-matter.js`：
  - `parseFrontMatter(content)` 函数（分离 `---` 包裹的 YAML 与 Markdown 正文）
  - 返回 `{ok, data, body, error, rawYAML}`（rawYAML 用于保留未知字段）
  - 容错：`---` 不存在/不配对 → ok=false；YAML 语法错误 → ok=false；不抛异常
- [ ] A2.2 测试 `v7/test/storage/parsers/front-matter.test.js`：
  - 正常路径：含 front matter 的章节文件
  - 边界：无 front matter、单个 `---`、YAML 语法错误
  - 断言：ok 值、error 中文、不崩溃

### A3 YAML 安全解析与序列化

- [ ] A3.1 `v7/src/storage/parsers/yaml-safe.js`：
  - `parseYAML(yamlString, options)` 包装 `js-yaml.load`
  - 捕获异常返回 `{ok: false, error}`
  - 保留 rawYAML 字段（未来写回用）
- [ ] A3.2 `v7/src/storage/serializers/yaml-dialect.js`：
  - `serializeYAML(data)` 手写序列化（防呆方言）
  - 规则（design §3.4）：平铺检测、数组块格式、危险值引号、两空格缩进
  - `needsQuoting(value)` 辅助函数
- [ ] A3.3 测试 `v7/test/storage/parsers/yaml-safe.test.js`：
  - 正常 YAML、语法错误、空字符串
- [ ] A3.4 测试 `v7/test/storage/serializers/yaml-dialect.test.js`：
  - 列表输出块格式（断言不含 `[a, b]`）
  - 危险值加引号（`"123"`, `"true"`, `"A:B"`）
  - 嵌套映射抛错

### A4 容错读取保留未知字段

- [ ] A4.1 `v7/src/storage/serializers/front-matter.js`：
  - `serializeFrontMatter(data, body, originalYAML)` 组装 `---\nYAML\n---\n正文`
  - 保留未知字段：从 originalYAML 提取非 data 中的字段，拼接到输出
- [ ] A4.2 测试 `v7/test/storage/parsers/yaml-safe.test.js`（补充用例）：
  - 含 `自定义字段: 值` 的 YAML，解析 → 修改已知字段 → 序列化，断言自定义字段保留

### A5 Markdown 表格与 book.yaml

- [ ] A5.1 `v7/src/storage/parsers/markdown-table.js`：
  - `parseMarkdownTable(content)` 提取表头与行（返回 `{ok, headers, rows, error}`）
  - 容错：表头不对齐跳过、空行忽略、解析失败不崩溃
- [ ] A5.2 `v7/src/storage/parsers/book-config.js`：
  - `parseBookConfig(yamlString)` 读取平铺字段（spec §3）
  - 返回 `{ok, data: {书名, 类型, 每章目标字数, ...}, error}`
- [ ] A5.3 测试：
  - `v7/test/storage/parsers/markdown-table.test.js`：时间线表、名册表
  - `v7/test/storage/parsers/book-config.test.js`：正常 book.yaml、缺字段

**验证 A**：`cd v7 && node --test test/storage/parsers/ test/storage/serializers/` 全绿

**提交 A**：`feat(v7): M1 阶段 A——容错读写库（parser/serializer）`

---

## 阶段 B：Storage Adapter 小端口

### B1 目录与基础

- [ ] B1.1 建 `v7/src/storage/adapters/` 目录
- [ ] B1.2 建 `v7/test/fixtures/sample-book/` 示例书仓库（design §7.1 完整示例）：
  - 至少 2 章：`定稿/正文/0001-开局.md`（含完整 front matter，见 design §7.1）、`0002-初遇.md`
  - 1 角色卡：`定稿/设定/角色/林晚.md`（含 front matter + 设定/对话/关系段落）
  - 1 伏笔：`大纲/伏笔/伏笔-001-神秘老者.md`（含履历格式示例）
  - 1 信息差：`定稿/设定/信息差/信息差-001-灭门真凶.md`
  - 1 时间线：`定稿/设定/时间线/第01卷.md`（Markdown 表格）
  - 1 名册：`定稿/设定/名册.md`（Markdown 表格）
  - 1 章摘要：`定稿/摘要/章摘要/0001.md`
  - `book.yaml`（含基本配置，见 design §7.1）
  - **照抄 design §7.1 完整示例**，不要自己编格式

### B2 ChapterReader

- [ ] B2.1 `v7/src/storage/adapters/ChapterReader.js`：
  - 构造函数 `constructor(repoPath, cache)`（cache 可选）
  - `readFrontMatter(chapterNum)`：优先查缓存 chapters 表，缺失时读文件
  - `readBody(chapterNum)`、`readTail(chapterNum, wordCount)`、`readHead(...)`
  - `readRange(start, end, fields)`
- [ ] B2.2 测试 `v7/test/storage/adapters/ChapterReader.test.js`：
  - 用 sample-book fixture
  - 无缓存路径（直接读文件）
  - 不存在章号返回 `{ok: false, error}`

### B3 ThreadLedgerReader

- [ ] B3.1 `v7/src/storage/adapters/ThreadLedgerReader.js`（design §4.3）：
  - `readBasicInfo(threadId)`、`readHistory(threadId)`、`readClosurePlan(threadId)`、`readDescription(threadId)`
  - `listOverdue(bookConfig)`（查询时计算悬了太久章数）
  - `listByType(type, status)`
- [ ] B3.2 测试 `v7/test/storage/adapters/ThreadLedgerReader.test.js`：
  - 读伏笔-001 基本信息、履历
  - listOverdue 逻辑（mock 当前最大章号）

### B4 EntityReader

- [ ] B4.1 `v7/src/storage/adapters/EntityReader.js`（design §4.4）：
  - `readCharacterFrontMatter(name)`、`readCharacterFull(name)`
  - `resolveAlias(alias)`（查 entity_aliases 表或解析名册）
  - `listCharacters(filter)`
- [ ] B4.2 测试：读林晚角色卡、解析别名

### B5 其他 Reader 端口

- [ ] B5.1 `TimelineReader.js`：`readCurrentVolume()`, `readVolumeRange(start, end)`, `readByParticipant(name)`
- [ ] B5.2 `SecretReader.js`：`readBasicInfo(id)`, `readContent(id)`, `listUnrevealed()`
- [ ] B5.3 `OutlineReader.js`：`readOutlineSection(type, volumeNum, sectionTitle)`, `listVolumes()`
- [ ] B5.4 `BookConfigReader.js`：`read()` 返回 book.yaml 对象
- [ ] B5.5 各自测试（至少正常路径）

### B6 Writer 端口占位

- [ ] B6.1 `ChapterWriter.js`、`ThreadLedgerWriter.js` 只定接口（抛 "M2 实现" 占位错误）
- [ ] B6.2 `v7/src/storage/index.js` 统一导出所有端口

**验证 B**：`cd v7 && node --test test/storage/adapters/` 全绿

**提交 B**：`feat(v7): M1 阶段 B——Storage Adapter 小端口（8 Reader + Writer 占位）`

---

## 阶段 C：.cache/index.db 五表 + 重建器

### C1 CacheManager 骨架

- [ ] C1.1 `v7/src/cache/index.js`：
  - `class CacheManager` 构造函数（dbPath）
  - `ensureReady(repoPath)`：检查 db 存在性，不存在调用 `rebuildFromSource`
  - `query(sql, params)`、`close()`
  - 使用 `node:sqlite` 的 `DatabaseSync`
- [ ] C1.2 `v7/src/cache/schema.js`：五表 DDL 字符串（design §5.1 完整 SQL）

### C2 五表初始化

- [ ] C2.1 `ensureReady` 内执行 schema.js 的 CREATE TABLE + CREATE INDEX
- [ ] C2.2 测试 `v7/test/cache/CacheManager.test.js`：
  - 创建临时 db，执行 DDL 不崩溃
  - 查询空表返回 `[]`

### C3 重建器核心逻辑

- [ ] C3.1 `v7/src/cache/rebuilder.js`：`rebuildCache(repoPath, db)` 函数（design §5.3）
  - 步骤 1-7：扫描源文件 → INSERT 各表
  - 步骤 8：校验（履历章节存在性、别名唯一性）
  - 返回 `{ok, warnings: [], errors: []}`
- [ ] C3.2 扫描辅助函数：
  - `scanChapters(repoPath)` 返回 Map<章号, 文件路径>（用于履历验证）
  - `scanThreads(repoPath, type)` 扫描三类条目目录
  - `scanEntities(repoPath)` 扫描角色卡 + 名册

### C4 校验规则

- [ ] C4.1 履历章节验证（spec 0.8 A3）：
  - `scanChapters` 建立章号 → 文件路径映射（Map）
  - 解析履历行的"第N章"，提取章号
  - 查 Map，章号不存在 → 记 warning（不阻断重建）
- [ ] C4.2 别名唯一性：
  - 用 Map 收集 alias → entity_id 映射
  - 发现冲突 → 记 error，`rebuildCache` 返回 `{ok: false, errors}`
- [ ] C4.3 测试 `v7/test/cache/rebuilder.test.js`：
  - 正常重建 sample-book
  - 构造履历引用不存在章节（断言 warnings 非空）
  - 构造别名冲突（断言 errors 非空、ok=false）

### C5 集成测试：删缓存重建

- [ ] C5.1 `v7/test/cache/rebuild-integration.test.js`：
  - 用 sample-book，第一次重建，查询章数
  - 删除 `.cache/index.db`
  - 第二次重建，查询章数，断言相等（AC1）
- [ ] C5.2 CI 验收项（prd AC1）在此测试覆盖

**验证 C**：`cd v7 && node --test test/cache/` 全绿

**提交 C**：`feat(v7): M1 阶段 C——.cache/index.db 五表 + 重建器（node:sqlite）`

---

## 阶段 D：41 精准读取接口 CLI（分三层）

### D0 CLI 入口扩展

- [ ] D0.1 `v7/bin/webnovel-writer.js` 增加子命令动态 import 分发（design §6.1）：
  - 读 `process.argv[2]` 为命令名
  - `await import(\`../src/commands/\${命令}.js\`)`
  - 模块不存在（ERR_MODULE_NOT_FOUND）→ 人话提示"未知命令"
  - 调用 `commandModule.execute(args, options)`
- [ ] D0.2 建 `v7/src/commands/` 目录

### D1 P0 接口（8 个，写章流程依赖）

- [ ] D1.1 `read-timeline.js`：`--current-and-prev` 选项（读当前卷+上一卷）
- [ ] D1.2 `read-thread.js`：`--fields=基本信息` / `--履历`
- [ ] D1.3 `read-chapter.js`：`--tail=N` / `--摘要`（从 `定稿/摘要/章摘要/NNNN.md` 读）
- [ ] D1.4 `read-character.js`：`--front-matter`
- [ ] D1.5 `resolve-alias.js`：输入别名，输出正名或"未找到"
- [ ] D1.6 `report-overdue-threads.js`：按类型分组返回悬了太久清单（design §6.3 查询时计算）
- [ ] D1.7 测试 `v7/test/commands/`：每个接口至少正常路径 + 边界（不存在 ID）
- [ ] D1.8 bin 入口集成：`cd v7 && node bin/webnovel-writer.js read-chapter 1 --tail=100` 可执行

**验证 D1**：P0 8 接口逐个手工冒烟 + `node --test test/commands/` P0 测试绿

**提交 D1**：`feat(v7): M1 阶段 D.1——精准读取 P0 接口（写章流程依赖 8 个）`

### D2 P1 接口（7 个，机检与全书近况）

- [ ] D2.1 `read-chapter.js` 补充 `--front-matter` 选项
- [ ] D2.2 `list-chapters.js`：`--章定位=推进` / `--卷=N` 筛选
- [ ] D2.3 `list-secrets.js`：`--reader-knows=false`
- [ ] D2.4 `grep-story.js`：`<关键词>` 全文检索（Grep 定稿/正文/*.md）
- [ ] D2.5 `report-book-stats.js`：总章数/总字数/条目数/角色数
- [ ] D2.6 `report-weak-hook-streak.js`：末尾连续弱钩章数（design §6.3，匹配"弱钩"或"-弱"）
- [ ] D2.7 测试 + 冒烟

**验证 D2**：P1 7 接口冒烟 + 测试绿

**提交 D2**：`feat(v7): M1 阶段 D.2——精准读取 P1 接口（机检与全书近况 7 个）`

### D3 P2 接口（26 个，AI 角色与自动模式优化）

- [ ] D3.1 条目读取（4 个）：read-thread 补 `--收尾计划` / `--描述`，list-threads 补 `--type` / `--strength`
- [ ] D3.2 大纲读取（5 个）：read-outline 全套（总纲/卷纲/section/结局），list-volumes
- [ ] D3.3 正文读取（4 个）：read-chapter 补 `--head=N` / 正文全文，read-chapters `--range=start-end`
- [ ] D3.4 时间线读取（3 个）：read-timeline 补 `--current-volume` / `--卷=N` / `--在场=name`
- [ ] D3.5 设定读取（4 个）：read-character 补完整 / `--section`，list-characters，read-worldview `--section`
- [ ] D3.6 信息差（1 个）：read-secret `--内容`
- [ ] D3.7 全文检索（1 个）：grep-story `--regex=pattern`
- [ ] D3.8 报表（4 个）：
  - report-secret-accumulation
  - report-thread-activity
  - report-style-drift（design §6.3：接口存在、能读已有指纹并对比基线，但不实现特征提取；表为空时返回友好错误"缺少指纹数据，请先运行体检"）
  - 测试策略：手工插入基线 + 最近数据到 fingerprints 表，测试对比逻辑
- [ ] D3.9 测试 + 冒烟（至少正常路径）

**验证 D3**：P2 26 接口批量冒烟（抽查 5 个详细测，其余正常路径测试绿）

**提交 D3**：`feat(v7): M1 阶段 D.3——精准读取 P2 接口（AI 角色优化 26 个）`

---

## 阶段 E：收尾与文档

### E1 Windows 中文路径 CI

- [ ] E1.1 `v7/test/integration/chinese-path.test.js`（design §7.2 AC5）：
  - `os.tmpdir()` 下建 `测试书仓库/定稿/正文/0001-测试.md`
  - 全链路（重建缓存 + 读取）
  - **显式 `await cache.close()` 关闭数据库连接**（避免 Windows 文件锁导致清理失败）
  - 清理临时目录
- [ ] E1.2 `.github/workflows/v7-ci.yml` 已有 Windows job，此测试自动覆盖

### E2 全量验证

- [ ] E2.1 `cd v7 && node --test` 全绿（所有测试）
- [ ] E2.2 过 prd.md AC1-AC12 验收清单（逐条检查对应测试存在）
- [ ] E2.3 过后端规范质量评审清单（零依赖/文案中文/不带栈崩/职责分界）

### E3 JSONL 清单更新

- [ ] E3.1 `implement.jsonl` 填充真实条目（移除 `_example`）：
  - `{"file": ".trellis/spec/backend/quality-guidelines.md", "reason": "零依赖、职责分界、精准读取"}`
  - `{"file": ".trellis/spec/backend/database-guidelines.md", "reason": "五表 DDL、重建器、容错读取"}`
  - `{"file": ".trellis/spec/backend/error-handling.md", "reason": "永不带栈崩、中文错误"}`
  - `{"file": "docs/architecture/story-repo-spec-2026-06-10.md", "reason": "格式法律文本（§1-6、§11）"}`
  - `{"file": "docs/architecture/cache-design-2026-06-26.md", "reason": "五表 DDL、41 接口清单、派生值策略"}`
- [ ] E3.2 `check.jsonl` 填充：
  - `{"file": ".trellis/spec/backend/quality-guidelines.md", "reason": "评审清单 §5（零依赖/术语表/错误处理/职责分界/文档先行）"}`
  - `{"file": "docs/architecture/story-repo-spec-2026-06-10.md", "reason": "不变量 2（删缓存可重建）、不变量 9（保留未知字段）、§2.3 防呆方言"}`

### E4 提交与归档

- [ ] E4.1 `task.py current` 确认任务状态
- [ ] E4.2 最终 commit（若有零散修复）：`feat(v7): M1 收尾——CI 验收项 + JSONL 清单`
- [ ] E4.3 推送 v7 分支，观察 CI 双平台（ubuntu + windows）全绿

---

## 回滚点

- **阶段 A-D 各自独立**：未提交前 `git restore v7/` 对应子目录即可
- **阶段 C 前可回退**：删除 `v7/src/cache/` 与 `v7/test/cache/`，不影响 A-B
- **阶段 D 分三层 sub-commit**：任一层出问题回退到上一 commit

## 提交计划（总 6 commits）

1. `feat(v7): M1 阶段 A——容错读写库（parser/serializer）`
2. `feat(v7): M1 阶段 B——Storage Adapter 小端口（8 Reader + Writer 占位）`
3. `feat(v7): M1 阶段 C——.cache/index.db 五表 + 重建器（node:sqlite）`
4. `feat(v7): M1 阶段 D.1——精准读取 P0 接口（写章流程依赖 8 个）`
5. `feat(v7): M1 阶段 D.2——精准读取 P1 接口（机检与全书近况 7 个）`
6. `feat(v7): M1 阶段 D.3——精准读取 P2 接口（AI 角色优化 26 个）`

收尾工作并入 commit 6 或单独 commit 7（按实际情况）。

---

## 出口判据复核（对齐 prd Acceptance）

> 重建后状态（2026-06-27，全量 `node --test` 143 绿）：

- [x] AC1：删 `.cache` 全量重建测试绿（test/cache/CacheManager.test.js「删除缓存后全量重建」+ test/cache/rebuilder.test.js）
- [x] AC2：41 接口逐条测试绿（test/commands/*.test.js，21 个命令文件覆盖全 41 接口）
- [x] AC3：容错读取保留未知字段测试绿（test/storage/parsers/yaml-safe.test.js）
- [x] AC4：防呆写出测试绿（test/storage/serializers/yaml-dialect.test.js）
- [x] AC5：中文路径全链路测试绿（test/integration/chinese-path.test.js，已改跨平台）
- [x] AC6-AC10：接口行为 + 重建校验验收（命令测试 + rebuilder.test.js 的 AC10 履历 warning/别名冲突 error）
- [x] AC11：小端口分离（storage/adapters/ 8 Reader + 2 Writer 占位，各有独立测试，可单独 import）
- [x] AC12：测试镜像 src（test/storage/{parsers,serializers,adapters}、test/cache/、test/commands/ 与 src 对应）
- [ ] CI 双平台绿（ubuntu + windows）：R5a 已修 `npm ci` 缺失 + bin `--version`，**待推送验证**
- [x] `v7/package.json` dependencies 仅 `js-yaml`（直接依赖唯一；传递依赖 argparse 同 nodeca 维护）
