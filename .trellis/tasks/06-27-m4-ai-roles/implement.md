# 执行计划：M4 AI 角色层与一级宿主壳

> 前置:已读 prd.md / design.md。落点 `v7/{roles,skills,references,adapters,templates,scripts,src/{review,dto,session,host-shells,state-machine}}`。
> 本机:`cd v7 && PYTHONUTF8=1 node --test`;零依赖延续;命令走 `run(args,options,ctx)` 契约。
> 工作方式:不开子代理;TDD(先红后绿);诚实分期 commit;**真模型 smoke 推迟**(R6)。

## 分期（M4 不拆,一任务 P0-P5）

```
P0 两审编排子层(R1)+ DTO 组装器(src/dto/)           ← 确定性核心,DI 注入,零真 AI
   ↓
P1 AI 态落盘契约(R2)+ SessionStart 注入(R3)
   ↓
P2 角色单源 roles/ + skills/SKILL.md + AGENTS.md + support.md(R4 撰写面,重构非拷贝)
   ↓
P3 生成器 + drift check + registry + validator(R4 JS 面,吃 P2 源)
   ↓
P4 知识层平移(R5,逐文件审查清 v6 遗毒 + 迁移报告)
   ↓
P5 AC 复核 + CI 双平台;真模型 smoke 推迟文档
```

## P0 两审编排子层 + DTO 组装器（R1）

- [x] P0.1 `src/dto/character-context.js`:从 M1 EntityReader 组装,DTO 无文件路径。测试断言字段齐全 + 无路径泄漏 + 角色不存在不抛(3 绿)。(`ChapterBrief` 不另造:M2 本章写作材料.md 即 chapter brief)
- [ ] P0.2 `src/review/schema.js`:`validateReviewIssue` + 阻断规则(critical→blocking;unregistered_thread→恒非阻断;category 分域越界拒)。先红:构造越界/critical/unregistered_thread 样例。
- [ ] P0.3 `src/review/index.js`:`assembleReviewInput`(ReviewInput DTO)、`mergeReviews`(合并 + counts + 模式声明)、`persistReviewReport`(落盘 `工作区/审稿.md` + `评审报告/`)。
- [ ] P0.4 `runReviews(ctx,{chapterNum,draftPath,mode,reviewers})`:DI 注入 reviewers;`mode='degraded'` 输出含兼容声明。测试注入假 reviewers(零真 AI)。
- [ ] P0.5 `test/review/`:完整/降级双模式、schema 阻断规则、D3 候选非阻断、落盘内容、DTO 无路径。

**验证 P0**:`node --test test/review/ test/dto/` 全绿
**提交 P0**:`feat(v7): M4 P0——两审编排子层 + ReviewInput/ReviewIssue DTO(DI 隔离 AI)`

## P1 AI 态落盘契约 + SessionStart（R2/R3）

- [x] P1.1 `src/state-machine/persist.js`:`persistRepair/persistCreateBook/persistVolumeReview/persistDraftOutline`——吃 AI 结构化 DTO 落盘。序0 安全网:只写失败清单内文件 + 修复内容须能解析。(book.yaml/总纲/卷纲/卷摘要无对应 Writer,用 serializeYAML/fs;伏笔条目用 serializeFrontMatter)
- [x] P1.2 `src/session/index.js`:`readBooksRegistry`(损坏行跳过计数)、`scanRebuildBooks`(扫 book.yaml 重建,需作者选当前书)、`assembleSessionContext`(注入文本,缺登记自动重建)。
- [x] P1.3 无 hook 等价:两入口调同一 `assembleSessionContext` → 注入逐字一致(测试断言)。实际 hook/CLI 接线属 M5 安装器。
- [x] P1.4 `test/state-machine/persist.test.js`(6)、`test/session/session.test.js`(6):各 AI 态落盘 + 安全网、books.jsonl 读/重建/等价。全量 229 绿。

**验证 P1**:`node --test test/state-machine/ test/session/` 全绿
**提交 P1**:`feat(v7): M4 P1——AI 态产物落盘契约 + SessionStart 注入与书单自愈`

## P2 角色单源 + 宿主壳源（R4 撰写面）

- [x] P2.1 `roles/事实审查.md`:吃 ReviewInput,五维 + v7 四项(requirement/leak/evidence/unregistered_thread),输出 §8 schema;category/severity/schema 用占位符 `{{categories.factCheck}}`/`{{severities}}`/`{{schema.example}}`(P3 从 schema.js 注入,单源不双表)。grep 确认无 python/路径。
- [x] P2.2 `roles/编辑审.md`:structure/pacing/commercial/motivation;评结构与商业性不替作者重写。
- [x] P2.3 `skills/webnovel-writer/SKILL.md`:状态机单入口 + `{{#if agentCapable}}`/`{{#if hasHooks}}` 条件块(两审完整/兼容、SessionStart 有无)+ 降级声明;description 精简。
- [x] P2.4 `templates/AGENTS.md`(标记块)、`adapters/registry.json`(三级 + agentCapable/hasHooks/smoke_status)、`adapters/{claude-code,codex}/support.md`(诚实标注 smoke 推迟 beta)。

**验证 P2**:人工评审 + grep 断言(roles 无 `python`/路径);留给 P3 生成器/validator 机检
**提交 P2**:`feat(v7): M4 P2——两审角色单源(DTO 化重构)+ SKILL.md 单入口 + registry/support`

## P3 生成器 + drift check + validator（R4 JS 面）

- [x] P3.1 `src/host-shells/generate.js`:零依赖条件块渲染器(`{{#if}}`/`{{#unless}}`/`{{a.b}}`)+ 多平台壳(codex→TOML,余→md)+ schema 从 schema.js 单源注入。
- [x] P3.2 drift check:`driftCheck` 同输入连跑两次逐字节一致 + validator 通过。
- [x] P3.3 `src/host-shells/validator.js`:registry schema / 一级宿主 support.md 存在 / SKILL description ≤ 8k / 角色 frontmatter / 无本机绝对路径(源 + 生成物)。
- [x] P3.4 `scripts/build-host-shells.mjs`:薄 CLI(`--target all|<host>`、`--check`);dist/ 入 .gitignore。
- [x] P3.5 `test/host-shells/{generate,validator}.test.js`(12):条件块、TOML、占位符注入、drift 确定性、validator 各拒绝项 + 真实资产过。
- [x] P3.6 CI:`v7-ci.yml` 加「drift check」步骤(双平台)。全量 241 绿;CLI 冒烟 4 平台壳生成、codex TOML、dist 被忽略。

**验证 P3**:`node --test test/host-shells/` + `node scripts/build-host-shells.mjs --check` 全绿
**提交 P3**:`feat(v7): M4 P3——宿主壳生成器 + drift check(确定性)+ package validator + CI`

## P4 知识层平移（R5,真源选定 + 逐文件审查）

- [x] P4.1 **真源选定表**（写入 `references/迁移报告.md`）:题材取 `genre-index.csv`+`题材与调性推理.csv`+`genres/*.md`、爽点节奏取 `爽点与节奏.csv`、追读力取 `reading-power-taxonomy.md`;弃 `genre-profiles.md`/`genre-tropes.md`/`anti-trope-*` 双表。
- [x] P4.2 **逐源清洗**(`scripts/migrate-v6-knowledge.mjs` 确定性转换):CSV 删 适用技能/推荐检索表 列;37 模板全剥创意约束(Pack)段、系统流.md 修 `/webnovel-write`;reading-power 删 v6 skill 头。
- [x] P4.3 `template_file` 引用:37 模板已全迁入 `genres/`,引用解析无悬空。
- [x] P4.4 `test/references/migration.test.js`(5):全树 grep 零 v6 遗毒(报告除外)、题材单源无双表、CSV 删列、模板剥段、报告含真源选定表。全量 246 绿。

**验证 P4**:`node --test test/references/` 全绿 + 人工复读迁入文件
**提交 P4**:`feat(v7): M4 P4——知识层平移(题材CSV单源/追读力/爽点节奏,清 v6 遗毒+消双表)`

## P5 AC 复核 + CI（R6）

- [x] P5.1 全量 `node --test` 246 绿;过 prd AC1-AC8(自审通过)。
- [x] P5.2 不变量回归:M1-M3 测试(删缓存重建/定稿原子/git 隐身)在全量套内仍绿。
- [x] P5.3 推送验证 CI 双平台:run 28292073367，4 job 全绿，drift check + validator 在 Windows 跑通。
- [x] P5.4 真模型 smoke **推迟**:`adapters/*/support.md` 标 smoke 命令 + `smoke_status: deferred-beta`;不阻断本任务。

**提交 P5**:`feat(v7): M4 P5——AC 复核 + CI 双平台(真模型 smoke 推迟 beta)`

## 出口判据（对齐 prd Acceptance）

- [x] AC1-AC8 全绿(两审编排/schema 阻断/AI 态落盘+安全网/SessionStart 等价/生成器 drift/角色 DTO 化/知识净化消双表/M1-M3 零回归)
- [x] CI 双平台绿:run 28292073367(含两个 windows-latest)
- [x] 真模型 smoke 推迟项已文档化(support.md + registry smoke_status)

## 后续（M4 完成后,单独任务）

**M1-M4 全量 review**:通审四个里程碑代码 + 全部迁移产物("不带 v6 问题进 v7"复查);用户明确要求。  
下面这份是从两篇 review 合并出来的修复 backlog，按“先救主流程、再补稳健性、最后回填 spec”排。
merged 收敛版之外的 deep 报告独有项（作者手改丢失、回滚范围、重建冲突、版本对齐）补在对应段末,标 `(deep)`,避免被合并版吞掉。

### P0 主流程先打通

- [x] P0-1 `src/finalize/index.js` + `src/state-machine/index.js`:定稿后同步刷新缓存,避免 `next` 继续读旧章号。✅ finalize 提交后调 `cache.rebuildFromSource`;端到端测试 `test/integration/main-loop.test.js` 锁定(定稿第1章→next 起草第2章)。
- [x] P0-2 `src/state-machine/persist.js`:建书时补 git init、`.gitignore`、`core.quotepath false`。✅ `persistCreateBook` 调 `git.init()`+`setQuotepathFalse()`+`buildGitignore`;单测验证三件套。
- [x] P0-3 `src/state-machine/persist.js` + `src/review/index.js`:多文件写入改成原子落盘,中途失败不留半成品。✅ 新增 `src/storage/atomic.js`(`writeAtomicBatch` 先 .tmp 再 rename);persist 全家 + `persistReviewReport` 接入;`rebuildCache` 包 BEGIN/COMMIT/ROLLBACK 事务。
- [x] P0-3a (deep) `src/storage/adapters/ChapterWriter.js` + `src/cache/rebuilder.js`:重写同章改标题时旧文件残留 → `scanChapters` 两条同 `chapter_num` → 重建 `PRIMARY KEY` 冲突。✅ `writeChapter` 写盘前 `removeOldChapterFiles` 清同章旧文件 + `sanitizeFileName` 净化 Windows 非法字符(顺带修 P2-1)。

> 附带修:`scanEntities` 名册缺失/解析失败从硬错降为软跳过(warning),避免事务回滚把 chapters/threads/secrets 一起清了——这是事务化后暴露的过度严格。`parseMarkdownTable` 拒单字符分隔符 `|--|--|--|--|`(GFM 合法)是潜伏 parser bug,留作 follow-up(非报告项)。

### P1 两审 / 会话 / 校验

- [ ] P1-1 `src/review/index.js` + `src/dto/character-context.js`:补全 ReviewInput,把相关条目、新专名、别名命中的角色都带进去。
- [ ] P1-2 `src/review/schema.js`:坏输入先判类型,`blocking` 只收明确布尔,别靠真值强转。
- [ ] P1-3 `src/review/index.js`:原始审稿结果和归一化结果分开保存,方便回溯模型原话。
- [ ] P1-4 `src/session/index.js`:`books.jsonl` 部分损坏也触发自愈,必要时回写修复结果。
- [ ] P1-5 `src/host-shells/validator.js`:扩展绝对路径检测,把常见 Windows / Linux / UNC 形式都算进去。
- [ ] P1-6 (deep) `src/state-machine/flows/goto-chapter.js`:`--confirm` 走 `reset --hard` 前先 `git stash` 或拒绝脏树;现有 rescue ref 只存 HEAD 指针不含工作树,作者未登记手改会被静默抹掉且无法找回。该 flow 也不跑 `checkGitHealth`。
- [ ] P1-7 (deep) `src/finalize/index.js` + `src/finalize/git.js`:回滚范围从 `定稿/`+`大纲/` 整棵子树收窄到本次 `written` 文件集合,避免误伤同子树其他章的手改;`git.clean` 包 try/catch(Windows 文件锁抛错会逃出 catch 破坏 `{ok,error}` 契约,`restore` 已有 try)。

### P2 spec 回填

- [ ] P2-1 `.trellis/spec/backend/database-guidelines.md`:补 `entity_aliases` 和表定义边界。
- [ ] P2-2 `.trellis/spec/backend/error-handling.md`:补多文件原子性边界,以及未知字段保留和嵌套字段处理边界。
- [ ] P2-3 `.trellis/spec/backend/quality-guidelines.md`:钉死 `core.quotepath` 责任方、AI 调用预算、退出码约定。
- [ ] P2-4 (deep) 版本号对齐:README 版本徽章 6.2.0(v6/master)与 `v7/package.json` `0.0.0` 不一致;README 版本表是 CI 硬约束(Plugin Version Check),M5 发版前必须对齐,否则 CI 红。

### P3 保留项

- [ ] P3-1 `review-m1-m4.md` / `review-m1-m4-deep.md`:宿主 CLI 缝保留为后续接线项,不作为当前 blocker。

## 回滚点

- 各 P 独立、几乎全为新增目录;对 M1-M3 唯一改动 `state-machine/persist.js`(新增)。
- 未提交前 `git restore v7/<子目录>`;知识迁移纯新增,删 `references/` 即净。
