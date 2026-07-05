# Research: v6 数据存储面盘点（供 v7 `/migrate` 设计）

- **Query**: 盘点 v6 书项目的数据存储面（目录布局、state.json、index.db、伏笔/追读力/记忆/摘要/大纲/设定/story-system/向量），为 v7 一次性迁移脚本提供事实依据
- **Scope**: internal（v6 源码在工作树 `webnovel-writer/`，Python）
- **Date**: 2026-07-05
- **代码真源**: `webnovel-writer/scripts/`（多为软链/可执行脚本），核心在 `webnovel-writer/scripts/data_modules/`
- **样本项目（on-disk 真形态）**: `webnovel-writer/agents/evals/files/test-project/`

> 路径锚点均以仓库根为基准。`.py:行号` 为证据。凡"未确认"处已显式标注。

---

## Findings

### Q1. 书项目根目录完整布局

单一真源是 `DataModulesConfig`（`webnovel-writer/scripts/data_modules/config.py:90-141, 333-343`）。一个 v6 项目 = 项目根目录下：

| 路径 | 类型 | 内容 | 证据 |
|---|---|---|---|
| `.webnovel/` | 目录 | 运行态数据根 | `config.py:98-99` |
| `.webnovel/state.json` | JSON | 精简运行态（进度/主角/伏笔/节奏…） | `config.py:102-103` |
| `.webnovel/index.db` | SQLite | 实体/别名/状态变化/关系/追读力/审查等 | `config.py:110-111` |
| `.webnovel/vectors.db` | SQLite | RAG 向量 + BM25（可重建） | `config.py:337-339` |
| `.webnovel/rag.db` | SQLite | 见 Q12（疑似历史遗留，运行时用 vectors.db） | `config.py:333-335` |
| `.webnovel/memory_scratchpad.json` | JSON | 长期记忆 scratchpad（7 桶） | `config.py:106-107` |
| `.webnovel/project_memory.json` | JSON | `/webnovel-learn` 学到的 patterns（**独立文件**） | `project_memory.py:59` |
| `.webnovel/summaries/` | 目录 | 章摘要 `chNNNN.md`（YAML 头 + 正文） | `config.py`（无常量，见 Q7）/ `init_project.py:284` |
| `.webnovel/backups/` | 目录 | 备份 | `init_project.py:282`, `backup_manager.py:190` |
| `.webnovel/archive/` | 目录 | 归档（旧章节/实体） | `init_project.py:283`, `archive_manager.py:75` |
| `.webnovel/observability/` | 目录 | 可观测性日志 | `observability.py:65` |
| `.webnovel/projection_log.jsonl` | JSONL | 读模型投影运行日志（可重建） | `projection_log.py:14` |
| `.webnovel/context_cache.json` | JSON | 上下文缓存（gitignore，可重建） | `init_project.py:665`, `backup_manager.py:125` |
| `.webnovel/*.lock` / `*.bak` | 锁/备份 | 原子写临时物（gitignore） | `init_project.py:666-667` |
| `正文/` | 目录 | 章节正文，纯正文无头部（见 Q10） | `config.py:116-117` |
| `设定集/` | 目录 | 世界观/力量体系/角色卡等 md（见 Q11） | `config.py:120-121` |
| `大纲/` | 目录 | 总纲/卷详细大纲/时间线（见 Q9） | `config.py:124-125` |
| `.story-system/` | 目录 | 题材契约产物（见 Q8），**init 不生成，按需生成** | `config.py:128-141` |

**正文章节文件命名**（`chapter_paths.py`，明确支持两种历史布局，见文件头 `chapter_paths.py:4-9`）：
- 平坦（init 默认）：`正文/第0004章-标题.md`，章号 **4 位零填充**，标题来自详细大纲（有则拼，无则 `第0004章.md`）—— `chapter_paths.py:101-106, 138-155`
- 卷布局：`正文/第1卷/第007章-标题.md`，章号 **3 位零填充**，每卷默认 50 章 —— `chapter_paths.py:24-27, 122-124, 150-152`
- 遗留纯章号：`正文/第0007章.md`（无标题） —— `chapter_paths.py:118`
- 查找兜底会 `rglob 第{n:03d}章*.md` / `第{n:04d}章*.md` 全 `正文/` 递归 —— `chapter_paths.py:130`

---

### Q2. `.webnovel/state.json` 完整键清单

state.json 有**多种历史形态**，migrate 必须都能读。三条证据链：

**(A) 迁移前「全量」形态**（v5.1 之前，或未迁移的老项目）
`migrate_state_to_sqlite.py:5-22` 头注 + 读取逻辑列明会被迁走的大字段：
- `entities_v3`：`{实体类型: {entity_id: {name, canonical_name, tier, aliases[], is_protagonist, first_appearance, last_appearance, current{...}, desc}}}` —— `migrate_state_to_sqlite.py:91-116`；样本 `test-project/.webnovel/state.json:24-64`
- `alias_index`：`{别名: [{id, type}, ...]}`（一对多） —— `migrate_state_to_sqlite.py:134-155`
- `state_changes`：`[{entity_id, field, old/old_value, new/new_value, reason, chapter}]` —— `migrate_state_to_sqlite.py:167-190`
- `structured_relationships`：`[{from/from_entity, to/to_entity, type, description, chapter}]` —— `migrate_state_to_sqlite.py:202-225`

**(B) 迁移后「精简」形态（< 5KB）**（v5.4）—— `migrate_state_to_sqlite.py:245-259` 保留顶层键：
`project_info`、`progress`、`protagonist_state`、`strand_tracker`、`world_settings`（骨架）、`plot_threads`、`relationships`（简化 dict）、`review_checkpoints`（末 10）、`disambiguation_warnings`（末 20）、`disambiguation_pending`（末 10）、`_migrated_to_sqlite: true`、`_migration_timestamp`。

**(C) 运行时 `_ensure_state_schema` 补齐的键**（权威默认结构）
两处一致：`state_manager.py:165-219` 与 `init_project.py:133-181`。顶层键 + 结构概要：

| 顶层键 | 结构 | 证据 |
|---|---|---|
| `project_info` | `{}`（题材/标题/作者等）；**注意样本用的是 `project` 而非 `project_info`** | `state_manager.py:170`；样本 `state.json:7-11` |
| `progress` | `{current_chapter, total_words, last_updated, volumes_completed[], current_volume, volumes_planned[], chapter_status{}}` | `init_project.py:166-171`, `state_manager.py:215-217, 678` |
| `protagonist_state` | `{name, power{realm,layer,bottleneck}, location{current,last_chapter}, golden_finger{name,level,cooldown,skills[]}, attributes{}}` | `init_project.py:174-179`；样本 `state.json:12-23` |
| `relationships` | v5.0+ 为 **dict**（人物/重要关系）；旧版可能是 **list**（会被搬进 `structured_relationships` 并清空为 `{}`） | `state_manager.py:174-182` |
| `structured_relationships` | list（实体关系，迁往 db） | `state_manager.py:177-179` |
| `world_settings` | `{power_system[], factions[], locations[]}`（精简后各元素退化为 name 或 `{name,type}`） | `state_manager.py:184`, `migrate_state_to_sqlite.py:283-315` |
| `plot_threads` | `{active_threads[], foreshadowing[]}` —— 伏笔在此，见 Q4 | `state_manager.py:185` |
| `review_checkpoints` | list | `state_manager.py:186` |
| `chapter_meta` | `{"NNNN": {hook{type,content,strength}, pattern{...}, ending{...}, coolpoint_patterns[], plot_structure{cbn,cen,cpns[],mandatory_nodes[],prohibitions[]}}}`，键为 4 位零填充或纯数字 | `state_manager.py:187`；样本 `state.json:72-91`；`state_validator.py:214-273` |
| `strand_tracker` | `{last_quest_chapter, last_fire_chapter, last_constellation_chapter, current_dominant, chapters_since_switch, history[{chapter,strand}]}` | `state_manager.py:188-198`；样本 `state.json:65-71` |
| `disambiguation_warnings` | list（截断上限 `max_disambiguation_warnings=500`） | `state_manager.py:204-205`, `config.py:203` |
| `disambiguation_pending` | list（上限 1000） | `state_manager.py:207-208`, `config.py:204` |
| `entities_v3` / `alias_index` | v5.1 后**不再初始化/维护**，但老项目仍可能残留（migrate 读它） | `state_manager.py:200-202` |

> **重要 gotcha**：样本 `test-project/.webnovel/state.json` 是"全量/手写 fixture"形态——顶层用 `project`（非 `project_info`）、`entities_v3` 内联、伏笔 `status` 为 `"active"`（非规范 `"未回收"`）、`chapter_meta` 用 `hook/pattern/ending` 子结构。真实 init/迁移后的项目则是 `project_info` + 精简。migrate 需同时容忍两套键名。

---

### Q3. `.webnovel/index.db`（SQLite）表清单与列

**建表 DDL 单一真源**：`webnovel-writer/scripts/data_modules/index_manager.py:246-622`（`SQLStateManager` 复用同一 db，`sql_state_manager.py` 只做读写不建表）。事件表另在 `event_log_store.py`。

| 表 | 列（关键） | 引入 | 证据 |
|---|---|---|---|
| `chapters` | chapter(PK), title, location, word_count, characters, summary, created_at | 基础 | `index_manager.py:247-255` |
| `scenes` | id, chapter, scene_index, start_line, end_line, location, summary, characters, UNIQUE(chapter,scene_index) | 基础 | `index_manager.py:260-270` |
| `appearances` | id, entity_id, chapter, mentions, confidence, UNIQUE(entity_id,chapter) | 基础 | `index_manager.py:275-282` |
| `entities` | id(PK), type, canonical_name, tier(默认'装饰'), desc, current_json, first_appearance, last_appearance, is_protagonist, is_archived, created_at, updated_at | v5.1（替代 entities_v3） | `index_manager.py:300-313` |
| `aliases` | alias, entity_id, entity_type, created_at, PK(alias,entity_id,entity_type) | v5.1（替代 alias_index） | `index_manager.py:318-324` |
| `state_changes` | id, entity_id, field, old_value, new_value, reason, chapter, created_at | v5.1 | `index_manager.py:329-338` |
| `relationships` | id, from_entity, to_entity, type, description, chapter, created_at, UNIQUE(from,to,type) | v5.1 | `index_manager.py:343-352` |
| `relationship_events` | id, from_entity, to_entity, type, action, polarity, strength, description, chapter, scene_index, evidence, confidence, created_at | v5.5 | `index_manager.py:389-403` |
| `override_contracts` | id, chapter, constraint_type, constraint_id, rationale_type, rationale_text, payback_plan, due_chapter, status, created_at, fulfilled_at, `record_type`(补列) | v5.3 | `index_manager.py:422-435`, `override_ledger_service.py:45` |
| `chase_debt` | id, debt_type, original_amount, current_amount, interest_rate, source_chapter, due_chapter, override_contract_id(FK), status, created_at, updated_at | v5.3 | `index_manager.py:440-453` |
| `debt_events` | id, debt_id(FK), event_type, amount, chapter, note, created_at | v5.3 | `index_manager.py:458-467` |
| `chapter_reading_power` | chapter(PK), hook_type, hook_strength, coolpoint_patterns, micropayoffs, hard_violations, soft_suggestions, is_transition, override_count, debt_balance, created_at, updated_at | v5.3 | `index_manager.py:472-485` |
| `invalid_facts` | id, source_type, source_id, reason, status, marked_by, marked_at, confirmed_at, chapter_discovered | v5.4 | `index_manager.py:519-529` |
| `review_metrics` | start_chapter, end_chapter, overall_score, dimension_scores, severity_counts, critical_issues, report_file, notes, created_at, updated_at, PK(start,end) | v5.4 | `index_manager.py:541-553` |
| `rag_query_log` | id, query, query_type, results_count, hit_sources, latency_ms, chapter, created_at | v5.4 | `index_manager.py:561-570` |
| `tool_call_stats` | id, tool_name, success, retry_count, error_code, error_message, chapter, created_at | v5.4 | `index_manager.py:581-590` |
| `writing_checklist_scores` | chapter(PK), template, total_items, required_items, completed_items, completed_required, total_weight, completed_weight, completion_rate, score, score_breakdown, pending_items, source, notes, created_at, updated_at | Phase F | `index_manager.py:601-618` |
| `story_events` | id, event_id, chapter, event_type, subject, payload_json, created_at | 事件溯源 | `event_log_store.py:113-124` |

> `style_sampler.py:63` 另建 `samples` 表，但落在**独立 db**（非 index.db，见 `style_sampler` 自己的路径，未确认具体文件名）。

---

### Q4. 伏笔（foreshadowing）存哪

**存 `state.json` 的 `plot_threads.foreshadowing`（list），无独立 db 表、无独立文件。** 证据：`state_manager.py:185`、`state_validator.py:276-284`（运行时规范化）。

单条伏笔字段（规范化后，`state_validator.py:178-200`）：
- `content`（内容）
- `status`：规范值 `未回收` / `已回收`（`FORESHADOWING_STATUS_*`，`state_validator.py:13-14`；容忍 `active/pending/已解决/...` 等别名，`:36-37`）
- `tier`：`核心` / `支线` / `装饰`（`state_validator.py:16-18`；默认 `支线`）
- `planted_chapter`（埋设章，从 `planted_chapter/added_chapter/source_chapter/start_chapter/chapter` 任一解析，`:20-26`）
- `target_chapter`（目标回收章，从 `target_chapter/due_chapter/deadline_chapter/resolve_by_chapter/target`，`:28-34`）
- `resolved_chapter`（实际回收章，可为 null，从 `resolved_chapter/resolved_at_chapter/resolved`）
- `urgency`（紧急度数值，样本 `state.json:100`，如 80/30）

> 另有"开放线索"的**第二处**存法：记忆 scratchpad 的 `open_loops` 桶（见 Q6），语义相近但独立（`test-project/.webnovel/memory_scratchpad.json:20-34`）。二者并存，migrate 需决定合并策略。

---

### Q5. chase_debt / reading_power 语义与结构

均为 **index.db 表**（DDL 见 Q3）。原始字段（决定 v7 丢弃/转换用）：

**追读力债务体系（v5.3）** —— 把"欠读者的爽点/悬念"建模成带利息的债：
- `chase_debt`：`debt_type`（债务类型）、`original_amount`/`current_amount`（本金/当前额，默认 1.0）、`interest_rate`（利率 0.1）、`source_chapter`→`due_chapter`（欠下→到期章）、`override_contract_id`（关联合约）、`status`（默认 `active`） —— `index_manager.py:440-453`
- `override_contracts`：为"违反约束"记账的合约——`constraint_type/constraint_id`（违反了什么）、`rationale_type/rationale_text`（理由）、`payback_plan`（还债计划）、`due_chapter`、`status`（默认 `pending`，终态 `fulfilled/cancelled` 冻结） —— `index_manager.py:422-435`, `index_debt_mixin.py:15-55`
- `debt_events`：债务流水账——`event_type, amount, chapter, note` —— `index_manager.py:458-467`

**章追读力元数据（reading_power）** —— 每章一行：
- `chapter_reading_power`：`hook_type`（钩子类型）、`hook_strength`（默认 `medium`）、`coolpoint_patterns`（爽点套路，JSON list）、`micropayoffs`（微爽点，JSON list）、`hard_violations`（硬伤，JSON list）、`soft_suggestions`（软建议，JSON list）、`is_transition`（过渡章 0/1）、`override_count`、`debt_balance`（债务余额） —— `index_manager.py:472-485`；写入 `index_reading_mixin.py:16-40`（4 个 list 字段 `json.dumps` 存储）

> 对照 v7 映射"知识层与章属性（不设条目）"：`coolpoint_patterns/hook_type` 属**章属性**可保留；`chase_debt/override_contracts/debt_events` 是**债务台账**，v7 若不设条目体系则整体丢弃。

---

### Q6. project_memory：patterns / scratchpad 存哪

**两个独立文件，别混淆：**

1. `.webnovel/memory_scratchpad.json` —— 长期记忆 scratchpad。结构 = `ScratchpadData`（`data_modules/memory/schema.py:103-159`），**7 个桶** + `meta`：
   `character_state[]`, `story_facts[]`, `world_rules[]`, `timeline[]`, `open_loops[]`, `reader_promises[]`, `relationships[]`, `meta{version, last_updated, total_items}`。
   每条 = `MemoryItem`（`schema.py:50-100`）：`{id, layer(semantic|episodic), category, subject, field, value, payload{}, status(active|outdated|contradicted|tentative), source_chapter, evidence[], updated_at}`。
   样本：`test-project/.webnovel/memory_scratchpad.json:1-42`。

2. `.webnovel/project_memory.json` —— `/webnovel-learn` 学到的 patterns。结构（`project_memory.py:49-92`）：`{patterns: [{pattern_type, description, source_chapter, learned_at, updated_at, category?, importance?}]}`。被 `context_manager.py:229` 读入上下文。

> 命名易混：模块名叫 `project_memory.py`，但它写的是 `project_memory.json`（patterns）；scratchpad（7 桶）是另一套（`memory/` 子包 + `memory_cli.py`）。

---

### Q7. `.webnovel/summaries/` 命名与格式

- 命名：`chNNNN.md`，**ch + 4 位零填充章号**。样本：`summaries/ch0003.md`。
- 格式：**YAML front matter + markdown 正文**。头部字段（样本 `summaries/ch0003.md:1-9`）：`chapter`（"0003"）、`time`、`location`、`characters[]`、`state_changes[]`、`hook_type`、`hook_strength`。
- 正文分节（`:11-19`）：`## 剧情摘要`、`## 伏笔`（`- [推进]/[埋设] ...`）、`## 承接点`。
- 目录由 `init_project.py:284` 创建；`chapters` 表也存 summary 列（Q3），二者可能并存。

---

### Q8. `.story-system/` 是什么、内含什么

题材"契约"（contract）产物目录，由 story-system 阶段按需生成（`init_project.py` **不创建**它）。内容（`config.py:128-141`, `projection_log.py:51`, `runtime_contract_builder.py:51-55`）：
- `.story-system/MASTER_SETTING.json` —— 题材主契约。结构（`story_system_engine.py:113-132`）：`{meta{schema_version:"story-system/v1", contract_type:"MASTER_SETTING"}, route, master_constraints{core_tone, pacing_strategy}, base_context[], source_trace[], override_policy{locked[], append_only[], override_allowed[]}}`。
- `.story-system/anti_patterns.json` —— 毒点/反模式清单（list，元素含 `text`），源自 CSV `毒点` 字段。`runtime_contract_builder.py:54-55`, `story_system_engine.py:21-30`
- `.story-system/chapters/` —— 章级 brief 契约（CHAPTER_BRIEF，`config.py:132-133`, `story_system_engine.py:133-146`）。
- `.story-system/commits/chapter_NNN.commit.json` —— 章提交事件载荷（3 位零填充），投影读模型的来源。`projection_log.py:51`

**非 git 历史/提交链**：名字里的 "commits" 是章级 JSON 快照，不是 git。整个 `.story-system/` 由 CSV 知识 + 大纲**可再生**，属派生产物。

---

### Q9. `大纲/` 文件命名惯例

样本 `test-project/大纲/` 三件套 + init 生成：
- `大纲/总纲.md` —— 全书骨架（基本信息/卷目录/章纲）。`init_project.py:605`；样本 `大纲/总纲.md`
- `大纲/第N卷-详细大纲.md` —— 卷级详细大纲，内含 `### 第N章：标题` + 目标/阻力/代价/核心冲突/反派层级/本章变化/未闭合问题/钩子。样本 `大纲/第1卷-详细大纲.md`
- `大纲/第N卷-时间线.md` —— markdown 表格（章节|时间|事件）。样本 `大纲/第1卷-时间线.md`
- **可选：拆分式章纲** `大纲/第NNN章-标题.md`（每章一文件）—— `chapter_paths.py:21, 62-79`（`_SPLIT_OUTLINE_FILENAME_RE` 匹配 `第0*N章[-—_ ]标题.md`）
- 章纲加载器还认总纲内 `## 第N卷章纲` / `### 第N章：标题` 内联段落 —— `chapter_paths.py:20`, `chapter_outline_loader.py`

---

### Q10. 正文章节文件有无结构化头部

**纯正文，无 front matter / 无注释块。** 样本 `正文/第0004章-迦南学院的考验.md` 全文即小说正文（`:1-36`），首行直接是"晨光从窗缝…"。结构化元数据（钩子/摘要/角色）在别处（summaries 头部、chapter_meta、index.db chapters 表），不在正文文件里。

---

### Q11. `设定集/` 典型文件与格式

init 生成的 canonical 集合（`init_project.py:448-598`），均为**自由格式 markdown**：
- `设定集/世界观.md`（样本存在，`:1-13`：力量体系/地点/关键设定）
- `设定集/力量体系.md`
- `设定集/主角卡.md`
- `设定集/女主卡.md`（可选，`init_project.py:537`）
- `设定集/主角组.md`
- `设定集/反派设计.md`

模板源在 `webnovel-writer/scripts/`（或 skill）的 `output_templates_dir` 下 `设定集-*.md`（`init_project.py:391-396`）。

---

### Q12. vectors.db / projection_log 是什么、可否安全丢弃

- `.webnovel/vectors.db` —— **RAG 活跃向量库**。`RAGAdapter` 全程用 `config.vector_db`（`rag_adapter.py:140,151,249`），建表 `vectors / bm25_index / doc_stats / rag_schema_meta`（`rag_adapter.py:189-244`）。从正文/设定 embedding 而来，**可重建 → 可丢弃**（`doctor.py:257` 视其缺失为"退化为关键词召回"，非致命）。
- `.webnovel/rag.db` —— config 里另有 `rag_db` 属性（`config.py:333-335`），但运行时 RAG 走 vectors.db；rag.db **疑似历史遗留/未使用**（未确认有代码写它）。
- `.webnovel/projection_log.jsonl` —— 读模型投影运行日志（`projection_log.py:14, 41-60`：schema_version/run_id/chapter/commit_hash/writers/status）。派生自 commit + 投影，`doctor.py:340` 明言"旧项目可暂时忽略"，**可丢弃**。

结论：vectors.db、rag.db、projection_log.jsonl、context_cache.json、observability/、backups/、*.lock/*.bak 均为派生/缓存，migrate 可安全跳过。

---

### Q13. 历史形态兼容清单（migrate 必须覆盖）

1. **正文命名 3 种**：平坦 `第NNNN章-标题.md`(4 位) / 卷 `第N卷/第NNN章-标题.md`(3 位) / 遗留 `第NNNN章.md`(无标题)。`chapter_paths.py:4-9, 118-135`
2. **state.json 大字段内联 vs 迁移**：v5.1 前 `entities_v3/alias_index/state_changes/structured_relationships` 内联 state.json；v5.1+ 迁往 index.db；v5.4 精简加 `_migrated_to_sqlite/_migration_timestamp` 标记。`state_manager.py:200-202`, `migrate_state_to_sqlite.py:5-22, 256-259`
3. **relationships 类型漂移**：老版 list（实体关系）↔ v5.0+ dict（人物关系）；list 会被搬进 `structured_relationships`。`state_manager.py:174-182`
4. **顶层键名漂移**：`project`（fixture）vs `project_info`（init/运行时）。样本 `state.json:7` vs `state_manager.py:170`
5. **伏笔 status 值漂移**：`active/pending/已解决/...` → 规范 `未回收/已回收`；tier 别名 → `核心/支线/装饰`。`state_validator.py:36-40`
6. **chapter_meta 键格式**：`"0003"`（4 位）或纯数字字符串；子结构 `hook/pattern/ending`（fixture）vs `coolpoint_patterns/plot_structure`（规范化）。`state_validator.py:259-273`
7. **别名旧存储**：`alias_index_file` 已于 v5.1 废弃（改 index.db aliases 表）；老项目别名内联在 state.json `alias_index`。`config.py:113`
8. **可选目录/文件按需生成**：`.story-system/`、`summaries/`、`memory_scratchpad.json`、`project_memory.json`、`index.db`、`vectors.db` 在最简项目里可能**全部缺失**（init 只保证 `.webnovel/{backups,archive,summaries}` + `设定集/大纲/正文` + state.json）。`init_project.py:281-291`
9. **空/损坏 state.json**：`.tmp/manual/*/book/.webnovel/state.json` 实测为 2 字节 `{}`；init 有"原 state.json 损坏 → 另存 corrupt 备份"分支。`init_project.py:302`
10. **index.db schema 逐版本增量**：表随 v5.1/v5.3/v5.4/v5.5/PhaseF 累加（Q3 列的"引入"列）；`CREATE TABLE IF NOT EXISTS` 使老 db 缺新表/新列——迁移读取需容忍表/列缺失。`index_manager.py:296, 418, 515`

---

## Caveats / 未确认

- `style_sampler.py` 的 `samples` 表落在哪个 db 文件名——未逐行确认（不在 index.db 建表流里，疑似独立 `.webnovel/style_samples.db` 或复用 vectors.db，需读 `style_sampler.py` __init__）。
- `.webnovel/rag.db`（`config.rag_db`）是否有任何写入者——未找到，疑似遗留常量；运行时 RAG 一致走 `vectors.db`。
- 真实"满血"项目（含 index.db + 多章 + .story-system）在工作树内**没有 on-disk 样本**；`.tmp/manual/*` 均为空 stub，`test-project` 是手写 fixture（全量内联形态）。state.json 的"真实 5.4 精简形态"仅由 `migrate_state_to_sqlite.py:245-259` 代码推断，非 on-disk 实物。
- `chapter_meta` / summaries / chapters 表三处都存"每章元数据"，字段有重叠但不完全一致；migrate 选哪个为真源需 v7 决策（本研究只列存在，不给建议）。
- 伏笔（plot_threads.foreshadowing）与 scratchpad.open_loops 双存，合并策略待 v7 定。
