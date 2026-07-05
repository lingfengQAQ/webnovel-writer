# Research: C 区审查——写章流程脚本面（prep / mechanical-check / review / finalize / dto）

- **Query**: v7 第三轮全量 review 的 C 区（写章流程），聚焦 M6 threadCreates/staging 接缝、workspaceFiles 清理、机检阻断语义、两审 schema、备料降级、回滚边界、DTO 路径泄漏
- **Scope**: internal（v7/src + v7/test 精读）
- **Date**: 2026-07-05

## 候选清单

格式：`[severity] file:line 一句话问题 | 怀疑理由 | 建议探针 | 置信`

### C1 [P2] v7/src/finalize/index.js:142-144 —— 提交后清工作区的 `fs.rm` 无 try/catch，可把已成功的定稿误报为失败
- 问题：commit（127）与缓存刷新（139）之后的 `for (wf of workspaceFiles) fs.rm(join(repoPath,'工作区',wf),{force:true})` 既无 try/catch 也无 `recursive:true`；一旦某 `wf` 是目录或文件被占用，rm 抛错会冒泡到外层 catch（147），走回滚分支并返回 `{ok:false, error:'定稿中断，已回滚…'}`——但本章其实已 commit、缓存已刷。
- 怀疑理由：①同函数 129-135 的备份删除**有** try/catch 兜底（注释"备份残留不影响已完成 commit"），139 的 cacheRefresh 也内部吞错永不抛（cache/index.js:14-21 已核）——唯独 142-144 裸奔，防御姿态自相矛盾；②`fs.rm({force:true})` 只吞 ENOENT，不吞 EISDIR/EBUSY/EPERM；③review 流程确实产出 `工作区/评审报告/` 目录（review/index.js:245-250），SKILL.md:39 又要求宿主把"本章用过的工作区文件全列进 workspaceFiles"，宿主列进目录名即触发 EISDIR；④Windows 文件锁（历史 bug #6）同样触发。finalizeBatch 因 staging/index.js:542 置空 workspaceFiles 而免疫，故仅**手动单章 finalize** 暴露。
- 建议探针：finalizeChapter 传 `workspaceFiles:['评审报告']`（真造该目录）或占用文件，断言仍返回 `ok:true` 且 commit 数 +1（即提交后清理失败绝不能反转成功结果）。
- 置信：中

### C2 [P2] v7/src/finalize/index.js:142（对比 staging/index.js:330、commands/finalize.js:21、commands/stage-chapter.js:18）—— finalizeChapter 本体不剥 `工作区/` 前缀也不防 `..`，非命令直调即静默漏清
- 问题：finalizeChapter 直接 `path.join(repoPath,'工作区',wf)`。若 `wf` 带前缀（`工作区/细纲.md`），拼成 `repoPath/工作区/工作区/细纲.md` → 不存在 → force 静默 no-op → **漏清**（历史 bug #4 原型）。
- 怀疑理由：stageChapter（330-331）与两个命令壳（finalize.js:21、stage-chapter.js:18）都做 `String(f).replace(/^工作区[\\/]/,'')`（+ stageChapter 还加 `..` 防护），唯独 finalizeChapter 无归一；命令层两处口径一致（无双源漂移），但 finalizeChapter 的安全**完全寄生**于调用方归一——防御深度不对称，任何新增直调点（或测试脚手架）传前缀名即复发。现网被 commands/finalize.js 掩盖故非活跃 bug。
- 建议探针：直接 `finalizeChapter(ctx,{...,workspaceFiles:['工作区/细纲.md']})`，断言 `工作区/细纲.md` 仍在（复现漏清）；对照走 `finalize` 命令则被清。
- 置信：中（潜伏/防御缺口，非活跃断裂）

### C3 [P2] v7/src/storage/adapters/ThreadLedgerWriter.js:99 与 ThreadLedgerReader.js:213 —— `_findThreadFile` 宽松 `startsWith(threadId)` 与 createThread 精确匹配口径不一致，非填充 id 会解析到错条目
- 问题：两处 `_findThreadFile` 均 `files.find(f=>f.startsWith(threadId))`；而 createThread:41 用精确 `f===`${id}.md` || f.startsWith(`${id}-`)`。`伏笔-1` 会 startsWith 命中 `伏笔-10-xx.md`。
- 怀疑理由：createThread 正则 `/^\S+-\d+$/`（:26）**不强制** 3 位零填充，宿主可传 `伏笔-1`；updateThread/appendHistory（:61/:81）、finalize threadUpdates（index.js:82）、retcon（flows/retcon.js:34）、review 履历尾部（review/index.js:160 经 ThreadLedgerReader）全部过 `_findThreadFile` → 命中错文件即**改到/读到别的条目**（串写、履历错栏）。现网 id 经 migrate/transform.js:86 与约定统一 3 位填充（伏笔-001…999，互不为前缀），故不撞；但校验层没兜住非常规 id。
- 建议探针：createThread 造 `伏笔-1` 与 `伏笔-10`，再 `updateThread('伏笔-1',{状态:'放弃'})`，断言被改的是 伏笔-1 文件而非 伏笔-10。
- 置信：低-中（需非填充 id，现网填充纪律掩盖）

### C4 [S] v7/src/staging/index.js:331 —— `..` 防护用 `!name.includes('..')`，误伤合法双点文件名
- 问题：stageChapter 清工作区时 `if (!name.includes('..')) clears.add(name)`，会把 `a..b.md` 之类合法名整条排除 → 该文件漏清。
- 怀疑理由：本意防路径穿越，但 `includes('..')` 过宽；影响面是漏清而非越权删，方向安全但语义过严。
- 建议探针：payload.workspaceFiles 含 `笔记..草稿.md`，断言是否被清（确认过宽拦截边界）。
- 置信：低

### C5 [S] v7/src/mechanical-check/index.js:130 —— 新专名启发式正则 `[一-龥]{2,3}` 仅覆盖 BMP 基本汉字区，漏扩展区/生僻姓氏
- 问题：`/([一-龥]{2,3})(冷笑道|笑道|…|道|说|喊|问)/` 的姓名捕获用 `[一-龥]`（U+4E00–U+9FA5），扩展 A/B 区生僻字姓名进不了候选 → 漏报"疑似新专名"。
- 怀疑理由：纯提醒项（candidates，PRD 明确非阻断），仅弱化提醒完整度，不构成流程断裂；但属机检覆盖边界，记以备裁。
- 建议探针：正文写"生僻字姓名+道"，断言是否进 `candidates`（确认漏报边界）。
- 置信：低（advisory-only）

## 历轮修复在位复查（逐条确认在位）

| 修复点 | 位置 | 结论 |
|---|---|---|
| P0-1 定稿后同步刷缓存（防 next 读旧章号重抄） | finalize/index.js:139 + refreshCacheAfterSourceChange 内部吞错 | ✓ 在位，不抛 |
| P1-7 回滚收窄到本次 written 集合（不整棵子树） | finalize:150-156，逐文件 restore + scoped clean；test finalize.test.js:106 真 git 验证不误伤他章手改 | ✓ 在位有测 |
| threadCreates 原子边界（进同一 stage/rollback） | finalize:67-72（created 文件推入 stage+rollback，clean 只删未跟踪→既有条目安全） | ✓ 逻辑正确 |
| threadCreates 撞号/非法类型校验 | ThreadLedgerWriter.createThread:26（类型+格式）、41（重号）；test finalize.test.js:214 撞号整体失败干净回滚、236 断电新条目不残留 | ✓ 在位有测 |
| workspaceFiles 前缀归一 + finalize-batch 置空约定 | commands/finalize.js:21、stage-chapter.js:18 归一；staging:542 置空（转正时不塞回） | ✓ 在位（但本体缺兜底=C2） |
| 机检 pass=issues.length===0；候选不进 issues 不阻断 | mechanical:49；test check.test.js:307 显式"句式偏离只进候选不进 issues"、259/275 高频意象命中仍 pass=true | ✓ 在位有测 |
| 两审 schema：严格布尔/critical 强制/unregistered_thread 恒非阻断/坏输入不抛/计数复算 | schema:53,65,66,67,71；test schema.test.js:23/29/70/81 全覆盖 | ✓ 在位有测 |
| 备料八组件缺数据降级人话 | prep/index.js（无细纲/时间线/文风/未体检均中文占位，全 try 兜）；test prepare.test.js:35 未体检占位 | ✓ 在位（缺细纲/时间线/文风分支未直测，仅代码在位） |
| DTO 不泄漏文件路径 | dto/character-context.js 只回领域字段；review 相关条目显式不含 file_path（review:117/124） | ✓ 在位 |

## 已核清白（怀疑点排除，附理由）

- **"known 集合并入 staged 把提醒变阻断"**：REFUTED。staged 只影响候选（checkNewProperNouns:127-128 把 staged 新实体加进 known → **抑制**新专名候选；checkSecretKeywords:152 增加信息差候选，均非阻断）与条目变动形式检查（本就阻断，staged 感知反而**避免**K+1 推进 K 章新开条目的假阻断）；不存在提醒→阻断的错误转化。mechanical:36 与 prep:22/review:30 均 `{before:chapterNum}`、stagedFacts:131 严格 `<` 过滤，无后章倒灌。
- **finalize-batch 复用 workspaceFiles 语义**：staging:542 显式 `payload.workspaceFiles=[]`（注释"批次目录由本函数自管，防误删他章工件"），即便 定稿包.json 里带 workspaceFiles 也被归零；批次路径不重塞。
- **回滚误删既有条目**：手工推演 threadCreates（新，未跟踪）+ threadUpdates（旧，已跟踪）混合场景——catch 里 `git.restore` 复原已跟踪旧条目、`git.clean -fd`（storage/finalize/git.js:52）只删未跟踪→旧条目安全、新条目被清。既有条目不会被误删。
- **同章重写旧文件备份**：ChapterWriter.backupOldChapterFiles 备份名 `.wnwbackup.PID.N` 不以 .md 结尾（不进缓存扫描，finalize:133 注释依赖此）；回滚 157-160 rm+rename 复原；test finalize.test.js:125 真 git 验证旧章净恢复、新章不残留。
- **角色/名册回滚路径漂移**：finalize:93/100 构造的 `${name}.md`、`名册.md` 路径与 EntityWriter.updateCharacter:26 / upsertRosterRow:45 **完全一致**，无路径双源。
- **批内条目 type 与 DB 不一致**：review:144 `类型英文[t.type]` 把 staged 中文类型（伏笔）转英文（foreshadow），恰好对齐 cache（rebuilder.js:120-122 存英文），同一"相关条目"清单里 DB 行（:126 `r.type`）与批内行 type 值一致，非 bug。

## 测试脚手架掩盖审计

- finalize.test.js 全程 `gitBookCtx()`（_helper.js:77 真 `git init`+config+add+commit）+ `createGit` 真跑 git，断言真实路径（0003-初露.md / `ch(3):` commit / revCount / execFileAsync git status）——**非脚手架掩盖**，是真实定稿流程。唯 gitBookCtx 把种子章打成单个 `init` commit（非逐章 `ch(N):`），故依赖 `findChapterCommit --grep=ch(N):` 的流程（retcon/relink，D 区）在此 fixture 下抓不到章 commit，C 区 finalize 测试不依赖，不影响本区结论。
- mechanical-check/check.test.js、review/schema.test.js、prep/prepare.test.js 断言口径与实现一致，无文案级漂移。
- **覆盖缺口**（非 bug，供 backlog）：①机检 staged 叠加（checkThreadDeclarations/新专名/信息差 with staged）无直测，仅经 finalize.test.js:169 走"定稿→缓存→下一章"间接验证 threadCreates 接力；②备料缺细纲/缺时间线/缺文风分支未直测（fixture 全量齐备）；③C1 的 workspaceFiles 目录/占用场景、C2 的直调前缀场景均无测。
