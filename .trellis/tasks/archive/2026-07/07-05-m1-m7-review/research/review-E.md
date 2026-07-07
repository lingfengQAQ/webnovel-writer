# Review E 区：M6 staging 与三消费点叠加 + 批次×手动流程交叉

- **审查员**：Research Agent（E 区）
- **范围**：v7/src/staging/、prep/review/mechanical-check 叠加分支、6 个 batch 命令、dto.batchDetail、goto/relink/finalize/retcon/impact/export 交叉接缝
- **日期**：2026-07-05
- **对照**：spec §8.1（decisions #36/#20）、§9/§10、PRD「本轮新增关注」
- **方式**：只读精读 + 代码在位性核销（无 CLI 探针，标注建议探针供主会话复现）

候选计数：**P1×2 / P2×4 / S×3**；另核销「在位正确」7 项（见末节）。

---

## P1（支路断 / 数据丢）

### E1. goto-chapter 回退定稿到批次起章之下 → 孤儿批次 + 定稿章号静默缺口

`[P1] v7/src/state-machine/flows/goto-chapter.js:36-69 + v7/src/finalize/index.js:40-42`

- **问题**：goto-chapter 全流程零批次感知，回退 `定稿/` 到 active 批次 `起章` 之下后，`工作区/待定稿/` 批次原样残留，随后 finalize-batch 把 staged 章按原章号写回 `定稿/`，中间缺口静默丢失。
- **怀疑理由**：
  - `grep batch|待定稿|readBatch` 在 goto-chapter.js / finalize.js / finalize/index.js **零命中**（本轮实测 exit 1）——无任何批次守卫。
  - goto 的脏树检查（goto-chapter.js:40-52）只看 `定稿/大纲` 前缀，`工作区/待定稿/` 不在检查内；`git reset --hard`（:57）只动 git 跟踪文件，批次目录（工作区，未入 git）存活。
  - 场景：定稿到 100 章，批次 stage 101-105（预登记事实建立在 96-100 上）。作者 `goto-chapter 95 --confirm` → 定稿回到 95，批次 101-105 仍在。`next` → 序 3（待定稿/ 存在）→ 批次续跑，建议照给。finalize-batch → finalizeChapter 无连续性校验（:40-42 只校验 `Number.isInteger` 与 `标题`），ChapterWriter 按号写 `0101-*.md` → 定稿变 [1..95, 101..105]，**96-100 静默缺口**，且 threadUpdates 履历从 ch95 跳到 ch101。
  - spec §8.1「goto 只管已定稿回退、丢弃批次管未定稿，两者职责不混」——设计意图是互斥，但**无代码强制**。
- **建议探针**：脚本建 book 定稿到 ch5，stage 6-8，`goto-chapter 3 --confirm`，再 finalizeBatch，断言 `定稿/正文` 出现 [1,2,3,6,7,8] 缺口 / 或期望的拒绝。
- **置信**：HIGH（守卫缺失可证；缺口后果为代码路径直接推导）。

### E2. 批次进行中手动 finalize 单章 → 章号双计 + finalize-batch 卡死

`[P1] v7/src/commands/finalize.js:26 + v7/src/finalize/index.js:22-42`

- **问题**：手动 `finalize <章号>` 命令对 active 批次无守卫、无连续性校验；定稿一个已在批次内暂存的章号，会在叠加视图双计，并使 finalize-batch 卡死。
- **怀疑理由**：
  - finalize.js 全文无批次检查；finalizeChapter 校验仅 `Number.isInteger(chapterNum)` 与 `frontMatter.标题`（:41-42），不比对定稿最大章号 / 批次起章。
  - 双计：批次 stage 101-105，手动 finalize 101 后缓存含 101。`overlayBookStatus`（staging/index.js:235）`总章数 = 定稿总章数(含101) + staged.length(含101)`、`卷内进度`（:240-246）同样把 101 计两次。
  - 卡死：随后 finalize-batch 再定稿 101 → finalizeChapter 跑 threadCreates → `ThreadLedgerWriter.createThread` 对已存在条目返回 `{ok:false, '条目 … 已存在'}`（ThreadLedgerWriter.js:42）→ finalizeChapter 回滚失败 → finalize-batch 停在 101，批次卡住。
  - PRD 本轮新增关注点名此场景「手动 finalize 单章（绕过批次直接定稿下一章→章号连续性与批次起章错位）」。
- **建议探针**：stage 3-5 后 `finalizeChapter(ctx, chapterPayload(3))`，再 `finalizeBatch(ctx)`，断言卡在第 3 章「已存在」；另断言 overlayBookStatus 总章数把 3 计两次。
- **置信**：HIGH（守卫缺失可证）；卡死链路 PLAUSIBLE（依赖 createThread 已存在语义，建议探针坐实）。

---

## P2（稳健性）

### E3. finalizeBatch 循环无 try-catch：转正后清目录 / 写 meta 失败会抛裸栈且留状态不一致

`[P2] v7/src/staging/index.js:529-556`

- **问题**：per-章循环无 try-catch。finalizeChapter 已 commit 后，`fs.rm(dirP)`（:553）或 `writeAtomicBatch(metaFile(remaining))`（:555）抛错会裸栈冒泡（作者直面堆栈，违不变量 8），且批次.json 仍把已定稿章列为「待审收」。
- **怀疑理由**：
  - finalizeBatch（:508-566）无外层 try-catch；finalize-batch.js:15 直接 `await finalizeBatch` 也无兜底 → 抛到 CLI dispatcher。
  - 顺序是 finalizeChapter(已 commit + 刷缓存) → rm 目录 → 更新 meta。若 rm/meta 在中途抛（Windows 文件锁/权限），该章已入档但 meta 未更新；重跑 finalize-batch 会对该章再定稿 → createThread「已存在」→ 卡死（同 E2 尾链）。
  - 对比：stageChapter（:274-341）与 finalizeChapter（:47-172）都有外层 try-catch，finalizeBatch 独缺。
- **建议探针**：mock `fs.rm` 在第 2 章抛 EPERM，跑 finalizeBatch，断言是否裸抛 / 批次.json 与磁盘失步。
- **置信**：MEDIUM（触发需 fs 错误，PLAUSIBLE）。

### E4. stageChapter 覆盖重暂存：writeAtomicBatch 成功后清旧目录/工作区抛错 → 报失败但批次已写

`[P2] v7/src/staging/index.js:315-338`

- **问题**：`writeAtomicBatch`（:315）已落新批次文件后，旧目录清理（:324）或工作区清理（:333-335）抛错，会走外层 catch 返回 `ok:false`，但批次实际已写入。
- **怀疑理由**：
  - 「零写入承诺」对**校验失败**成立（:277-306 所有校验都在 writeAtomicBatch 之前，审稿单缺失等分支零副作用，在位正确）。
  - 但覆盖重暂存改标题清旧目录 `fs.rm`（:324）、工作区 `fs.rm`（:334）在 writeAtomicBatch 之后；抛错 → catch 返回 `ok:false`（:339-341），宿主视作未暂存重试。重试再 stage 覆盖（幂等性尚可），但「失败=零副作用」的直觉在此不成立。
  - 旧目录若清理失败残留：readBatch 的 `seen.has(num)` 按章号去重（:69）会跳过同章号旧目录 → 逻辑无害，但磁盘孤儿目录永久残留（次要泄漏）。
- **建议探针**：改标题重 stage 时 mock 旧目录 rm 抛错，断言返回值与批次落盘是否矛盾。
- **置信**：MEDIUM。

### E5. finalize-batch --until「前几章先发」后，剩余待审收章的续跑建议指向「继续写下一章」而非「转正剩余」

`[P2] v7/src/state-machine/dto.js:80-88`

- **问题**：`--until` 只转正前段后，剩余章全为「待审收」，batchDetail 建议落到 else 分支「继续批内下一章（第 N+1 章）」，而非提示「剩余 X 章已就绪，可 finalize-batch 转正」。
- **怀疑理由**：
  - batchDetail 建议优先级（:80-88）：打回 > 受影响 > 停止 > else「继续下一章」。剩余章非打回非受影响；原停止因（写满）在移除前段后已不成立（judgeStop 只数当前 staged 数），故 `停止.stop=false` → else 分支。
  - finalize-batch.test.js:246-247 已断言此路径回序 3，但未校验建议文案的合理性；spec §8.1「支持只转正前段（前几章先发）→ 下一批次」，就绪的剩余章应被指向转正而非继续堆章。
  - 后果：作者跟着建议写 106，批次又长回去，原写满停止语义丢失（可无限增长）。
- **建议探针**：stage 3-5，finalizeBatch --until=4，取 buildDto(序3)，断言 `批次.建议` 是否误导为「继续下一章」。
- **置信**：MEDIUM（文案完整性，非数据错，经 --until 测试路径确认）。

### E6. 批次.json 损坏重建把已打回空目录降级为不可操作的「受影响」行

`[P2] v7/src/staging/index.js:74-78 + 452-475`

- **问题**：批次.json 丢失时全量按目录重建、一律标「受影响」（保守，:75 注释在理）；但 rejectFrom 保留的空目录（清了草稿/定稿包/审稿单）会重建成一条「受影响」行，其草稿/定稿包已不存在 → 既不能 finalize（读定稿包失败）也不能 restage（无审稿）。
- **怀疑理由**：
  - rejectFrom（:469-472）删 3 件套但保留目录 + 元数据行（状态=打回）。批次.json 损坏后走重建分支，`rowFromDir`（:85-97）读不到草稿 → warn + 仍建行、状态硬编码「受影响」（:96）。
  - 该行 finalizeBatch 时读 `定稿包.json` 失败（:533-540）→ 整批停；batch-restage 读 `工作区/审稿.md` 也无（且它本是打回章，restageReview:485-487 会拒）。→ 死行，须作者手动 rewrite。
  - 「起章/连续计数怎么恢复」子问：起章 = 目录最小号（:82，无损）；连续无变动 = judgeStop 从 front matter 现算（:378，无损）——二者派生、重建无损。**唯一丢失是「打回 vs 待审收」状态区分**，且打回空目录退化为死「受影响」行。
- **建议探针**：stage 3-5、reject 4、删批次.json、readBatch，断言第 4 章行状态与可操作性。
- **置信**：MEDIUM。

---

## S（spec 漂移 / 低风险双写）

### E7. 批次.json 持久形态与 spec §8.1 声明字段漂移（起章/连续计数未落盘，靠派生）

`[S] v7/src/staging/index.js:99-104`

- **问题**：spec §8.1 称批次.json 存「起章、各章{章号,标题,状态}、连续无条目变动计数」；`metaFile` 只持久 `{章列表}`。
- **怀疑理由**：起章（rows[0].章号）与连续计数（judgeStop 现算）均为派生量，落盘缺失不致数据丢（重建无损，见 E6），但持久 schema 与 spec 文本不符——属实现口径回填时的文档漂移。
- **建议探针**：无需运行；文档核对即可。
- **置信**：HIGH（漂移属实，影响近零）。

### E8. 弱钩判据 `includes('弱钩')||endsWith('-弱')` 四处双写

`[S/low] v7/src/staging/index.js:252、419；v7/src/prep/book-status.js:34；v7/src/commands/report-weak-hook-streak.js:14`

- **问题**：弱钩识别谓词在 4 处逐字复制（staging 内叠加显示:252 与停止判据:419 各一份，另 book-status、report-weak-hook-streak 各一份）。
- **怀疑理由**：钩子格式若变（如新增「弱钩」写法），4 处须同步改，漏一处即判据漂移。历史 bug 模式 #7（常量双写）同类。风险低（当前格式稳定、逻辑简单）。
- **建议探针**：无需运行；建议抽 `isWeakHook()` 单点。
- **置信**：HIGH（双写属实，风险低）。

### E9. 停止「连续无条目变动」只读 front matter 声明，与 stagedFacts 的 payload 条目来源可分叉

`[S] v7/src/staging/index.js:377-384 vs 152-193`

- **问题**：judgeStop 连续无变动计数只看 `parseThreadDeclarations(frontMatter)`（:379），而 stagedFacts.threads 还从 `payload.threadCreates/threadUpdates`（:178-193）派生。若宿主直接构造 payload 带条目变动但 front matter 三数组为空，会被判「无变动」。
- **怀疑理由**：spec §8.1 明写停止判据 =「front matter 三数组声明全空」，故以 front matter 为准属**故意**；但 front matter 与 payload 由宿主分别提供、可分叉，属契约脆弱点（正常流程二者一致，机检/审稿也都读 front matter，在位一致）。
- **建议探针**：stage 一章 front matter 空三数组但 payload 有 threadCreates，看是否误触连续无变动停止。
- **置信**：MEDIUM（契约提示，非缺陷）。

---

## 在位正确 / 复查通过（探针核销，非候选）

1. **before 过滤三消费点全传对**：prep/index.js:22、review/index.js:30、mechanical-check/index.js:36 均 `stagedFacts(repoPath,{before:chapterNum})`——重审受影响章不倒灌后章事实。✓
2. **容差常量同源不双写**：`AVG_SENTENCE_LEN_TOLERANCE`/`SENTENCE_VARIANCE_TOLERANCE` 唯一定义在 style-stats/index.js:12-13，staging（:11-14）与 mechanical-check（:6）均从该处 import，spec §8.1「口径同机检」达成。✓
3. **parseThreadDeclarations 共用解析器**：staging:152、review:37、mechanical-check:193 共用 util/thread-declarations.js，条目声明解析不双写。✓
4. **无批次零行为变化**：stagedFacts 无批次返回 `exists:false` + 空集合；overlayBookStatus 早退（:231）；三消费点对空集合/空 Map/空 Set 循环即无操作；readBatch().exists 各消费点均有防护。✓
5. **staged 数据不入缓存/指纹/意象**：cache/rebuilder.js 只读 定稿；finalize-batch.test.js:92-100（AC7）断言批内 fingerprints=0、imagery_top=0。✓
6. **收卷→序4 接得上**：is_volume_end 由 rebuilder.js:100 从 front matter `收卷` 派生；批次活动期 序3（待定稿/）优先于序4，不会 mid-batch 误触；finalize-batch 清空待定稿/后，收卷章入缓存 → 序4 卷复盘触发。链路通。✓
7. **export 批次章导不到（符合预期）**：export/index.js:79 只扫 定稿/正文；批次章在 工作区/待定稿/，不导出——设计如此。✓
8. **finalize-batch 入口硬校验 / 升序原子 / 中途失败停该章保留**：staging/index.js:517-556 + finalize-batch.test.js 全覆盖（AC1 逐字段一致、AC3 打回传染拒绝、中途坏包停该章、AC6 丢弃、--until）。✓

---

## 主靶小结（批次×手动流程交叉）

| 手动例外流程 | 批次感知 | 结论 |
|---|---|---|
| goto-chapter 回退定稿 | **无** | E1：回退到起章下 → 孤儿批次 + 定稿缺口 |
| 手动 finalize 单章 | **无** | E2：双计 + finalize-batch 卡死 |
| relink 补登手改 | N/A | 只 add 定稿/大纲（detectors.js:99），不碰工作区批次，安全 |
| retcon 吃书 | **无**（宽回滚） | 批次外，overlay 每次重读定稿，低风险；retcon 宽 restore/clean 属 C/D 区 |
| impact 影响分析 | N/A | 只读 定稿/大纲，不涉批次，安全 |
| 卷复盘（序4） | 序3 优先 | 在位正确（见核销 6） |
| 体检 | 随 finalize-batch 尾跑 | staging/index.js:558-564，失败不阻断，在位 |

根因收敛：**E1/E2 同源**——goto-chapter 与手动 finalize 命令缺「active 批次」互斥守卫；spec §8.1 假设二者职责不混但无强制。建议主会话优先探针这两条。
