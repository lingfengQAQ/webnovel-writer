# M4 AI 角色层与一级宿主壳

## Goal

让 v7 第一次"能被 AI 宿主端到端跑起来":落地状态机单入口 SKILL.md、两审角色单源、宿主壳生成器,把 M1-M3 已备好的脚本面与 DTO 缝接上 AI 协作层。**AI 永远只吃 DTO、只吐结构化输出,永不接触文件结构**(实施计划 §1.5 核心原则 1)。

用户决策(2026-06-27):
- **M4 不拆**,一个任务分期做。
- **真模型 smoke 先不管**——推迟为后续手测门,不阻断 M4 任务完成。
- **知识层迁移逐文件审查**——v6 可能带的问题绝不带进 v7。
- M4 做完**对 M1-M4 全量 review**(单独后续任务)。

## Background（confirmed facts）

- 范围权威:实施计划 §M4 + 多智能体适配 spec v3.4 + story-repo-spec 0.8 §8(两审/D3)/§2.0(工作目录/books.jsonl)/§10(状态机)。
- v7 现状:`v7/src/{storage,cache,commands,state-machine,prep,mechanical-check,finalize}` 已成型;**无** `roles/`、`skills/`、`references/`、`adapters/`(全绿地);`v7/src/installer/` 是占位(安装器属 M5)。
- M2/M3 已留缝:`finalize` 定稿原子 commit、`state-machine/dto.js`(序0/1/4/6 DTO);两审编排在 v7 是绿地,`ReviewInput` 无现成缝。
- **两审权威定义**(spec §8 第6步):
  - 事实审查 category:`setting/timeline/continuity/character/logic/requirement/leak/evidence/unregistered_thread`
  - 编辑审 category:`structure/pacing/commercial/motivation`
  - severity:`critical/high/medium/low`;`critical` 自动 `blocking=true`;`unregistered_thread`(D3)**恒 `blocking=false`**
  - 第7步审稿单 = 草稿 + 两审意见 + 待确认新专名 + 章摘要;作者:接受 / 改完接受 / 打回
- **v6 reviewer.md 是关键"遗毒"样本**:只有事实审查 5 维、且直接 `python webnovel.py ... state get-entity` 调 v6 runtime + 直接读文件——违反 v7 铁律。v7 两审角色是**重构,不是拷贝**。
- **知识迁移范围**(spec §11 平移表 + line 499):只有 **题材模板 / 追读力分类 / 爽点与节奏知识库** 平移继承(喂细纲与两审);其余 v6 references 不在 M4 范围。
- 知识"遗毒"已抽样确认:`genre-hook-payoff-library.md` craft 内容架构无关可留,但带 v6 skill 名"webnovel-write Step 1 内置合同"需清。
- SessionStart 缝:`工作目录/.webnovel/books.jsonl`(机器域,作者不手编);有 hook 宿主自动注入,无 hook 宿主由状态机入口读同一文件行为等价;书单可由扫描含 `book.yaml` 子目录重建(spec §0/§2.0)。

## Requirements

### R1 两审编排脚本子层（确定性核心,零真 AI）
- `assembleReviewInput(ctx, {chapterNum, draftPath})`:从 M1 读接口 + M2 备料 + 细纲组装两审共享的 `ReviewInput` DTO(AI 不见文件路径)。
- `runReviews(ctx, reviewInput, {mode})`:`mode='complete'`(独立 subagent,各自新鲜上下文)/`'degraded'`(单上下文顺序);输出**必须**含诚实模式声明(降级时"审稿隔离度低于完整两审模式")。
- 审稿单 schema 校验器:`ReviewIssue`(severity/category/location/description/evidence/fix_hint/blocking)+ 阻断规则(critical→blocking;unregistered_thread→恒非阻断;category 取值受两审分域约束)。
- 合并两审输出 + 落盘:`工作区/审稿.md`(草稿 + 两审意见 + 待确认新专名 + 章摘要)+ `工作区/评审报告/` 原始输出。
- D3 未登记伏笔候选检测缝(`unregistered_thread`,恒非阻断,只出候选)。

### R2 AI 态 DTO 与落盘契约（AI 永不碰文件）
- 扩 `state-machine/dto.js`:为 AI 态(序0/1/4/6)补**产物回流落盘**函数——建书(book.yaml+总纲+卷纲)、修复确认(写回)、卷复盘(卷摘要+下卷卷纲+伏笔机会)、细纲(工作区/细纲.md)。
- 补 `CharacterContext` DTO 组装器(供两审/写章消费,无路径)。`ChapterBrief` **不另造**:M2 备料产物 `工作区/本章写作材料.md` 即 chapter brief,再建独立 DTO 是冗余(无消费者)。
- 落盘一律走 M2 Writer 小端口,DTO 进 / 结构化出,M4 落盘、AI 不碰文件。

### R3 SessionStart 注入与书单自愈
- `readBooksRegistry(workdir)`:读 `.webnovel/books.jsonl`;损坏/缺失 → 扫描含 `book.yaml` 子目录重建书单。
- `assembleSessionContext(workdir)`:组装"当前在写哪本 / 共几本 / 全书近况入口"注入文本。
- 无 hook 等价路径:状态机入口可调同一函数,行为与 hook 注入一致。

### R4 角色单源 + 宿主壳生成器 + drift check
- `roles/事实审查.md` + `roles/编辑审.md`:单源任务书,**吃 ReviewInput DTO**(不调脚本、不读文件),输出 §8 schema;维度对齐 spec(事实审查含 v7 新增四项,编辑审四维)。
- `skills/<状态机入口>/SKILL.md`:状态机单入口,平台条件块(有无 subagent/hook);**降级路径编译进生成物**(无 subagent 平台生成顺序执行版 + 兼容声明)。
- `scripts/build-host-shells`(Node ≥22):读 `roles/`+`skills/`+`adapters/registry.json` → 各平台壳;`--check` = drift check(同输入必同输出),进 CI。
- `adapters/registry.json`(三级分级)+ package validator(registry schema / 逐宿主 support.md 存在 / description ≤ Codex 8k 预算 / 生成物无本机绝对路径)。
- `AGENTS.md` 公约数层(`<!-- WEBNOVEL:START/END -->` 标记块)+ `adapters/{claude-code,codex}/support.md`(官方链接+核验日期+支持情况+降级策略+smoke 命令)。

### R5 知识层平移（逐文件审查,清 v6 遗毒,单一真源不维护双表）
- 迁移 **题材模板 / 追读力分类 / 爽点与节奏知识库** 至 v7 `references/`。
- **真源选定优先(用户指令 2026-06-27:题材以 CSV 最新版为准,不要像 v6 维护两张表)**——迁移前先为每个知识体定**唯一真源**,识别 v6 双表/多表只留最新那份:
  - 题材 → `references/taxonomy/genre-index.csv` + `references/csv/题材与调性推理.csv`(**CSV 权威**);v6 重复的 `references/genre-profiles.md`、老 `skills/.../genre-tropes.md`、`anti-trope-*.md` **不作为并行表迁入**——独有内容折叠进 CSV,否则丢弃。
  - 爽点与节奏 → `references/csv/爽点与节奏.csv`(CSV 权威);老 markdown(`genre-hook-payoff-library.md`、`pacing-control.md`)重复部分不并行迁。
  - 追读力分类 → `references/reading-power-taxonomy.md`(唯一源)。
  - **v7 每个知识体只有一份真源**,杜绝 CSV+markdown 双表漂移。
- **每份真源逐条审查**,清除 v6 问题后才入 v7:
  - v6 旧路径(`设定集/`→`定稿/设定/`、`正文/`→`定稿/正文/`、`.webnovel/state.json` 等)
  - 退场术语(spec 术语表:"卡""棘轮"退场;统一"定稿/写章流程/全书近况/两审/细纲/审稿/吃书"等)
  - v6 机制引用(state.json/doctor/dashboard/v6 skill 名/`python webnovel.py`/CSV 的 `适用技能`、`大模型指令`、跨 CSV `推荐检索表` 等 v6 运行时列)
  - 反模式("自由评文笔好坏"——两审职责明确排除)
- 产出 `references/迁移报告.md`:先列**真源选定表**(每个知识体:选了谁/弃了谁/为什么),再逐文件记"改了什么 + 为什么"。

### R6 出口与验证
- 全量 `node --test` 绿;drift check + package validator + 两审编排 + DTO/落盘 + SessionStart 全有测试。
- CI 双平台绿(含 Windows;drift check 与 validator 在 Windows 跑)。
- **真模型 smoke 推迟**:文档标注为 M4→beta 的手测门(Claude Code + Codex 建书→写1章→两审→定稿),不阻断本任务。

## Acceptance Criteria

- [ ] AC1 两审编排:伪造草稿 → `assembleReviewInput` 产 DTO → `runReviews` 完整/降级双模式,降级模式输出含兼容声明;审稿单落盘 `工作区/审稿.md` + `评审报告/`(测试覆盖)。
- [ ] AC2 schema 与阻断规则:`critical`→`blocking=true`;`unregistered_thread`→恒 `blocking=false`;事实审查/编辑审 category 越界被拒(测试覆盖)。
- [ ] AC3 AI 态落盘:序0/1/4/6 各有"DTO 进 → 结构化产物 → M4 落盘"测试,落盘只经 Writer 小端口,过程零文件路径泄漏给 AI(测试覆盖)。
- [ ] AC4 SessionStart:`books.jsonl` 正常读注入;损坏/缺失时扫描重建;无 hook 等价路径产出同一注入文本(测试覆盖)。
- [ ] AC5 生成器与 drift:`build-host-shells --target all` 产三平台壳;`--check` 同输入同输出(CI 必跑);validator 校验 registry/support.md/description 长度/无绝对路径(测试覆盖)。
- [ ] AC6 角色单源 DTO 化:`roles/*.md` 不含任何 `python`/脚本调用/文件路径读取,只声明吃 ReviewInput DTO + 输出 §8 schema(评审 + grep 断言)。
- [ ] AC7 知识迁移净化与单一真源:每个知识体在 v7 只有一份真源(题材=CSV,无并行 markdown 题材表);迁移文件零 v6 旧路径/退场术语/v6 机制引用(含 CSV `适用技能`/`大模型指令` 列)/"自由评文笔"反模式;`迁移报告.md` 含真源选定表 + 逐文件变更(评审 + grep 断言)。
- [ ] AC8 不破坏 M1/M2/M3 不变量:删缓存重建、定稿原子、git 隐身仍全绿;CI 双平台绿。

## Out of Scope

- 真模型 smoke(推迟为 beta 手测门,R6)。
- npx 安装器 `init`/`update`、`books.jsonl` 写入/换书对话、模板哈希追踪(全属 **M5**;M4 只做 books.jsonl **读侧** + 扫描重建)。
- 自动模式/按批次定稿(M6)。
- 导出/`/migrate`(M7)。
- 二/三级宿主(Gemini/Cursor)亲测(M4 只做一级 Claude Code + Codex 单源 + support.md,真测在 smoke 推迟段)。

## Open Questions

- 无阻断性问题。知识迁移范围若需扩到其余 v6 references,由后续任务追加(本任务严守 spec 平移表三项)。
