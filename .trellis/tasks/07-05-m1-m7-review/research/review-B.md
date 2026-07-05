# Review B 区：缓存与统计（cache / style-stats / health-check）

- **审查范围**：`v7/src/cache/`（index/rebuilder/schema）、`v7/src/style-stats/index.js`、`v7/src/health-check/index.js`，及其跨缝：staging、migrate、finalize、persist、goto/retcon/relink
- **依据**：`.trellis/spec/backend/database-guidelines.md`（§2.2/2.5/5.1/5.3/7.2）、PRD 历史 bug 闻味清单（尤其 #2 改源不刷、#9 缓存当真源/staged 入表）
- **口径**：候选格式 `[severity] file:line 问题 | 怀疑理由 | 建议探针 | 置信`。severity：P0 主循环断/数据丢；P1 支路断/污染；P2 稳健性；S spec 漂移。宁可多报。
- **Date**: 2026-07-05

---

## 焦点 1：删缓存重建一致 / 扫描面覆盖 / 单事务边界

> 结论：扫描面本身覆盖全部**需要入缓存**的源类型（章/条目/信息差/名册/角色卡；摘要·时间线·卷纲·总纲无缓存表、按需读文件，非缺口）。migrate 产物落标准目录（`定稿/正文`、`大纲/伏笔`、`定稿/设定/名册·角色`），rebuild 能扫到。M6 threadCreates 落 `大纲/{类型}/`，scanThreads 覆盖。**真正的坑在事务/错误处理边界。**

- `[P1] rebuilder.js:68-113 (scanChapters) 过宽 try/catch 把 readFile/解析/INSERT 失败一律当「目录不存在，跳过」，静默截断章扫描后仍 COMMIT ok:true | 章号最新的一章若解析失败/读失败/主键撞车会从 chapters 表消失；state-machine/index.js:50 读 MAX(chapter_num) 得到偏小值，序6 起草 maxChapter+1 = 已存在章号 → 重抄本章（正是 §5.3 要防的场景） | 建 3 定稿章，把最新章 front matter 改成坏 YAML（或再放一个同 章号 的 .md），rebuildFromSource 后断言 result.ok===false 或 warnings 非空，且 MAX(chapter_num) 仍为 3 | 中高（catch 过宽确定，触发概率中）`

- `[P1] rebuilder.js:118-175 (scanThreads) 每类目录的 try/catch 同样吞掉 INSERT UNIQUE 违反，静默丢该目录后续条目并 COMMIT ok | threads.id 是主键；persist.js:98 卷复盘写 `大纲/伏笔/${e.id}.md` 未经 createThread 的重号校验，若与 finalize 建的 `伏笔-001-短题.md` 撞同 id，第二条 INSERT 抛错被吞 | 放 `大纲/伏笔/伏笔-001-a.md` 与 `伏笔-001-b.md` 两文件（都映射 伏笔-001），rebuild 后断言不是「静默丢一条 + ok:true」，而是报冲突或至少 warning | 中`

- `[S] rebuilder.js:16-52 内层各 scan 的 try/catch 架空了外层 BEGIN/COMMIT 的「完整性违反必回滚」意图 | §5.1 要求「中途任何失败（含数据完整性违反）必须 ROLLBACK」，但只有 scanEntities:264-272 别名冲突走了 ok:false→ROLLBACK；chapters/threads/secrets/characters 的完整性错误被内层吞掉后照常 COMMIT | 对比 scanEntities 与其余四个 scan 的错误传播路径即可确认 | 高（结构性）`

- `[P2] rebuilder.js:86/143/198/312 parseFrontMatter 失败分支静默跳过、不 push warning | §5.2 要求 best-effort 跳过要记 warning；当前坏 front matter 的章/条目/信息差从缓存凭空消失、零信号，作者与后续报表都看不到 | 喂一章坏 YAML front matter，rebuild 后断言 warnings 里有该文件的提示 | 高（代码明显未 push warning）`

- `[P2] rebuilder.js:161 threads.short_title 被塞成 id（如 伏笔-001），丢弃文件名里的短题 | short_title NOT NULL 但语义写错；list-threads/审稿输入拿到的是 id 而非人读短题 | 建 `伏笔-001-灭门线索.md`，rebuild 后查 threads.short_title 是否 = 「灭门线索」而非 「伏笔-001」 | 高（必现），影响低`

## 焦点 2：确定性（§2.5）

> 结论：**确定性守住**。grep 全 `v7/src` 确认 `localeCompare`/`Math.random`/`Date.now`/`new Date`/`toISOString` 均不在 cache|style-stats|health-check（Date/random 只在 session 书单时间戳、git-health/goto 的 rescue ref，均不碰 fingerprints/imagery/缓存表）。排序一律 `cmp`（码元序）。对象键序由固定构造顺序保证（common_phrase_frequency 按已排序 imagery 插入、段落分布按固定 短/中/长/超长）。

- `[CLEAN] style-stats/index.js 全模块纯计数 + 固定遍历 + cmp 排序，无时间戳/随机/locale | — | 删缓存跑两次 health-check，逐字段 diff fingerprints 与 meta.imagery_top | 高`

- `[CLEAN] health-check/index.js:214 「基线与近段重合只落基线行」守恒 | fingerprints 主键 (start,end)：基线 PK=(基线起,基线终)、近段 PK=(近段起,maxChapter)，仅当 基线起===近段起 且 基线终===maxChapter 时同 PK，guard 精确覆盖该条件后 return，不再 upsert 近段；upsertFingerprint 是**唯一** is_baseline 写入点（rebuilder.js:49 明确不填 fingerprints） | 造「全书仍在基线区间内」的书跑 health-check，断言 fingerprints 只有一行且 is_baseline=1 | 高`

## 焦点 3：staged/迁移不入缓存表与 meta（§7.2）

> 结论：**未泄漏**。staging/index.js 只 `SELECT`（MAX(chapter_num)、is_baseline 基线行），无任何写缓存表/meta；叠加视图 stagedFacts/overlayBookStatus 全从批次文件现读。migrate 写缓存（migrate/index.js:68 rebuildFromSource）但那是**已转正的迁移定稿内容**，本就该入表，非 staged 泄漏。

- `[CLEAN] staging/index.js 无 cache.run(INSERT/UPDATE)；judgeStop:386 readBaselineFingerprint 只读 | — | grep staging 全文只有两处 cache.query（读），无写 | 高`

- `[P2] cache/index.js:104 rebuild 用 preservedMeta 保留 imagery_top 跨重建，但改源刷缓存后不重算它，只在 health-check 才重算 | retcon/手改改了正文后，refreshCacheAfterSourceChange→rebuild 会把**旧** imagery_top 原样带过来；prep/index.js:108 与 mechanical-check/index.js:236 读 meta.imagery_top，在下次体检前拿到陈旧高频意象（提醒性、不拦截） | retcon 删掉某高频短语所在章，刷缓存后立即读 meta.imagery_top，看是否仍含该短语 | 高（必陈旧），影响低`

- `[P2] rebuilder.js:26 vs cache/index.js:104 处理不对称：rebuild DELETE fingerprints 且不回填，却 preserve imagery_top | 裸 rebuild 后 fingerprints 空表，staging judgeStop:393/report-style-drift 读基线得空 → 句式漂移闸门在下次体检前静默跳过 | 删 .cache 后直接 rebuild、不跑体检，查 fingerprints 行数=0 并确认 judgeBatchQuality 走了 baselineFp=null 分支 | 高（必现），影响低（by-design「丢失重测无害」）`

## 焦点 4：改源自刷缓存公约（§决策 34）

> 结论：**六处改源流程全刷**。finalize/index.js:139、goto-chapter.js:59、retcon.js:44、persist.js:107(卷复盘)、persist.js:135(修复回写)、relink.js:25(手改补登) 都尾调 refreshCacheAfterSourceChange；finalizeBatch 逐章走 finalizeChapter 各刷一次；migrate 用 rebuildFromSource。仅 finalize.js 与 retcon.js 直接 new 源写入器，均刷；persistCreateBook 不刷但只写 总纲/卷纲/book.yaml（无缓存表源）且建书时缓存尚未建立，非缺口。**未发现漏刷的新改源点。**

- `[CLEAN] 六改源流程 + finalizeBatch + migrate 均刷缓存 | — | grep `new (Chapter|Thread|Entity|Timeline|Secret|Summary)Writer` 只落 finalize/retcon，二者都刷；persist/relink 走 writeAtomicBatch 后都刷 | 高`

- `[P2] refreshCacheAfterSourceChange 软失败（keepExistingOnFailure:false）删库 + this.db=null 后，同命令内后续 cache.query 会抛「数据库未初始化」 | 已核查六流程都把刷缓存放在尾部即 return；finalizeBatch 尾部 runHealthCheck 有 try/catch 兜底、批内下一章 finalizeChapter 不读缓存并会自愈重建，故当前无未捕获的刷后查询 | 若日后有流程在刷缓存后再 cache.query，需补 this.db 为空的判定 | 中（现状 OK，属回归防线）`

## 焦点 5：体检只算定稿

> 结论：**只吃定稿**。runHealthCheck→loadCorpus:181 从 chapters 表（`定稿/正文` 的 file_path）逐章读；调 assembleBookStatus（本体只查缓存定稿），**不是** overlayBookStatus（叠加 staged 的版本）；findMissingTimeAnchors 用 chapters + TimelineReader（读 `定稿/设定/时间线` 文件）；readExcludeNames 读 entities/aliases（定稿）。finalizeBatch:560-562 先删批次目录再跑体检。无 工作区/待定稿 入口。

- `[CLEAN] health-check 输入面全为定稿；overlay 只在备料/审稿消费点、不进体检 | — | 造进行中批次（工作区/待定稿 有章）跑 health-check，断言报告章数=定稿数、不含 staged 章 | 高`

## 焦点 6：node:sqlite 使用

> 结论：注入面干净；连接生命周期基本安全；错误人话化有个别机器味泄漏点。

- `[CLEAN] 注入面全参数化 | cache.query/run(sql, params)→prepare(sql).all/run(...params)；动态 SQL（EntityReader.js:107-115、ThreadLedgerReader.js:186-194、list-chapters/read-chapters）只拼静态片段 + 绑定 ? 参数，无数据插值 | 通读上述四处确认 filter 值走 params.push 而非字符串拼接 | 高`

- `[P2] cache/index.js:141-142 fs.rm(旧库,force) + fs.rename(临时→正式) 在 Windows 文件锁下 | force 只吞 ENOENT、不吞 EBUSY/EPERM；若有残留句柄持有 index.db，rm 抛错→外层 catch→_handleFailedRebuild→ok:false（临时库已 close，无损坏，仅重建失败）。单进程内只 this.db 持句柄且 :115-118 已 close，无 WAL 边车（无 PRAGMA WAL），风险低 | Windows 上开一个额外 DatabaseSync(index.db) 不 close，再 rebuildFromSource，看是否 EBUSY | 低`

- `[P2] cache/index.js:74 ensureReady 抛 `缓存重建失败：${errors.join}`，errors 可能携带 node:sqlite 原文（如 "UNIQUE constraint failed: threads.id"，英文机器味） | §6 要求错误路径人话化；其余刷缓存调用方（goto/relink）只显示固定中文提示、不回显 err.message，泄漏仅限 ensureReady 这条 throw | 触发一次 rebuild 硬错（造别名冲突），看冒泡到宿主的文案是否夹英文 | 中（英文确在），低频`

---

## 复查历轮修复在位（B 区相关）

- P0-1 定稿后自刷缓存：finalize/index.js:137-139 在位 ✓
- P0-3/P1-1 重建单事务 + 别名冲突 ROLLBACK：rebuilder.js:17/40-44 在位（但见焦点 1 的内层 catch 架空问题）✓/⚠
- §5.3 临时库替换、刷新失败作废旧缓存：cache/index.js:123-142/159-170 在位 ✓
- M5.5 统计确定性：焦点 2 复验守住 ✓

## Caveats / 未覆盖

- EntityReader/ThreadLedgerReader/list-chapters 的动态 SQL 属 A 区（storage/adapters、commands），此处仅确认它们消费缓存时参数化安全，未逐行审 A 区。
- migrate 的 transform 产物完整性（是否漏迁 悬念/感情线/信息差 → 这些缓存表在迁移后为空）属 F 区；本区只确认「migrate 写到的目录 rebuild 能扫到」。
- 焦点 1 各候选是「主会话真 CLI/库探针复现」的重点对象，尤其 scanChapters 静默截断 → next 重抄本章这条链。
