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

- [ ] P3.1 `src/host-shells/generate.js`:读 roles/skills/registry → 各平台壳;手写条件块渲染器(零依赖)。先红:fixture 源 → 期望产物。
- [ ] P3.2 drift check:`--check` 同输入连跑两次逐字节一致 + 生成物过 validator。
- [ ] P3.3 `src/host-shells/validator.js`:registry schema / support.md 存在 / description 长度 / 无绝对路径 / roles frontmatter。
- [ ] P3.4 `scripts/build-host-shells.mjs`:薄 CLI(`--target all|<host>`、`--check`)。
- [ ] P3.5 `test/host-shells/`:生成 Claude Code/Codex 壳、降级编译、drift 确定性、validator 各拒绝项。
- [ ] P3.6 CI:`.github/workflows/v7-ci.yml` 加 `build-host-shells --check` + validator 步骤(双平台)。

**验证 P3**:`node --test test/host-shells/` + `node scripts/build-host-shells.mjs --check` 全绿
**提交 P3**:`feat(v7): M4 P3——宿主壳生成器 + drift check(确定性)+ package validator + CI`

## P4 知识层平移（R5,真源选定 + 逐文件审查）

- [ ] P4.1 **真源选定表**(design §6):为题材/爽点节奏/追读力各定唯一真源——题材取 `genre-index.csv`+`题材与调性推理.csv`(弃 `genre-profiles.md`/老 `genre-tropes.md`/`anti-trope-*.md`),爽点节奏取 `爽点与节奏.csv`,追读力取 `reading-power-taxonomy.md`;写进 `references/迁移报告.md`(选谁/弃谁/为什么)。
- [ ] P4.2 **逐份真源**:清 v6 双表/旧路径/退场术语/v6 机制(含 CSV `适用技能`/`大模型指令`/`推荐检索表` 列)/反模式(design §6 表),markdown 独有内容折叠进 CSV → 入 `v7/references/<分类>/` → 报告记"改了什么+为什么"。
- [ ] P4.3 核对 `genre-index.csv` 的 `template_file` 引用:引用的 `templates/genres/*.md` 要么迁入要么清列,不留悬空。
- [ ] P4.4 `test/references/migration.test.js`:grep 断言迁移文件零 `python webnovel.py`/`设定集/`/`state.json`/v6 skill 名/"评文笔"/CSV v6 运行时列;**断言题材在 v7 仅一份真源(无并行 markdown 题材表)**;迁移报告覆盖每个迁入文件 + 含真源选定表。

**验证 P4**:`node --test test/references/` 全绿 + 人工复读迁入文件
**提交 P4**:`feat(v7): M4 P4——知识层平移(题材CSV单源/追读力/爽点节奏,清 v6 遗毒+消双表)`

## P5 AC 复核 + CI（R6）

- [ ] P5.1 全量 `node --test` 绿;过 prd AC1-AC8。
- [ ] P5.2 不变量回归:删缓存重建、定稿原子、git 隐身仍绿。
- [ ] P5.3 推送验证 CI 双平台(drift check + validator 在 Windows 跑)。
- [ ] P5.4 真模型 smoke **推迟**:在 `adapters/*/support.md` 标注 smoke 命令 + 在 prd/memory 记为 beta 手测门(Claude Code + Codex 建书→写1章→两审→定稿),不阻断本任务。

**提交 P5**:`feat(v7): M4 P5——AC 复核 + CI 双平台(真模型 smoke 推迟 beta)`

## 出口判据（对齐 prd Acceptance）

- [ ] AC1-AC8 全绿(两审编排/schema 阻断/AI 态落盘/SessionStart/生成器 drift/角色 DTO 化/知识净化/不破坏 M1-M3)
- [ ] CI 双平台绿
- [ ] 真模型 smoke 推迟项已文档化

## 后续（M4 完成后,单独任务）

- **M1-M4 全量 review**:通审四个里程碑代码 + 全部迁移产物("不带 v6 问题进 v7"复查);用户明确要求。

## 回滚点

- 各 P 独立、几乎全为新增目录;对 M1-M3 唯一改动 `state-machine/persist.js`(新增)。
- 未提交前 `git restore v7/<子目录>`;知识迁移纯新增,删 `references/` 即净。
