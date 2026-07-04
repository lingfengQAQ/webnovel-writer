# M1–M5 全量 Review 报告（2026-07-03）

> 方法：沿 06-29 深审路数——重装 spec §8/§9/§10 与两份既往 review 作基线，逐文件精读（重点 M5 新面 94 源文件中的新增/改动 + 跨里程碑接缝），再用真 CLI 子进程探针（`review-probe.mjs`，本目录）实跑边角流程验证。全量 335 测试绿、drift 绿、CI run 28663338317 六 job 绿为前提。

## 结论速览

M1-M4 上两轮 review 修掉的 P0/P1/P2 全部仍在位（重建事务 BEGIN/ROLLBACK、文件名净化、同章去重、goto 脏树拒绝、finalize 回滚收窄、条目形式检查——逐条复核过）。M5 的安装器/多本书/F1 主链路（init→建书→写章→定稿→next）经双平台 CI 与本地 e2e 验证成立。

**但「主循环之外的三条支路」存在成环缺口**，全部行为级复现确认：卷复盘与手改补登两个态走完会把作者困在序 2 死胡同；四个改源文件的流程不刷缓存，其中 goto 回退后 next 会**起草错误章号**。性质与上轮 review 的 P0-1/P0-2 同族——测试只测了每个流程自身，没测「流程走完之后 next 还对不对」。

---

## P1（成环缺口，建议本任务内修）

### P1-1　卷复盘产物不 commit → `next` 误触序 2（spec §9 违约）
- spec §9 明文：卷复盘产出走 **`vol(05): 复盘与下卷规划`** commit。`persistVolumeReview`（`src/state-machine/persist.js:62`）只 `writeAtomicBatch`，不 add/commit。
- 探针 1 复现：`persist-volume-review` 成功 → `next --json` → **序 2 relink-manual-edits**（卷摘要/下卷卷纲/新伏笔被当成手改）。
- 与 M5 修过的「建书不 commit 误触序 2」完全同族——当时只修了序 1，序 4 漏了。
- 修法：`persistVolumeReview` 落盘后 `ensureIdentity → add(written) → commit('vol(N): 卷复盘')`（书仓库此时必已是 git 仓库）。

### P1-2　改源文件的流程不刷缓存 → 陈旧数据驱动后续判定
`ensureReady`（`src/cache/index.js:23`）只在 db 缺失/空表/schema 不匹配时重建——**正确前提是"所有改源的路径自己负责刷新"**，目前只有 `finalizeChapter` 做到。四个缺口，两条已探针确认：

| 流程 | 改了什么 | 陈旧后果 | 探针 |
|---|---|---|---|
| `goto-chapter --confirm`（`flows/goto-chapter.js`） | 工作树回退到旧 commit | **`next` 用旧 maxChapter 起草错章**（回到第 1 章后报「起草第 3 章」）；精准读取读幽灵章 | 探针 2 确认 |
| `persistVolumeReview` | 新增伏笔条目文件 | 新伏笔在 `list-threads`/备料/两审里**不可见**，直到下次定稿 | 探针 1b 确认 |
| `persistRepair` | 修复解析失败的源文件 | 修复件本就因解析失败不在缓存，修完仍不进——报表/备料继续缺数据 | 代码级确认 |
| `retcon`（`flows/retcon.js`） | 改角色/条目文件并 commit | threads/entities 陈旧 | 代码级确认 |

- 修法：四处成功路径尾部统一 `cache.rebuildFromSource(repoPath, { keepExistingOnFailure: false })`，与 finalize 同法（ctx.cache 四处都已可得；goto/retcon 在 flow 层收 ctx）。

### P1-3　序 2 手改补登无执行通道（死胡同）
- spec §9：手改检测后「细纲前问一句『补登吗』，确认后 **`fix(设定): …` 入档**」。
- 现状：序 2 返回 `needsAI=false, dto={}`（探针 3），既无补登 CLI，AI 又被铁律禁止直接跑 git——**作者确认补登后系统无事可做**。persist-repair 修复完（P1-2 之外）也落进同一死胡同：修复件永远躺在未提交区，每次 `next` 都报序 2。
- 修法：新命令 `relink --message=<说明>`（scope=book）：`add(定稿/, 大纲/) → commit('fix(手改): <说明>') → rebuildFromSource`；`next` 序 2 的 dto 附变更文件清单（`git status` 已扫过，白给）；SKILL 序 2 行接上该命令。

## P2（不阻断，修则更稳）

- **P2-1　`--file`/`--payload` 相对路径基准反直觉且两套**：书级命令按 repoPath 解析、persist-book 按 workdir——宿主在启动目录写临时 JSON 传相对名必 ENOENT（探针初版亲历踩坑）。修：`json-input.js` 先按 cwd 解析，不存在再按 repoPath，错误信息列出两处找过的路径。
- **P2-2　`--draft` 传绝对路径会拼坏**：`save-review` 用 `path.join(ctx.repoPath, draftRel)`、`assembleReviewInput` 同（`review/index.js:27`）；`path.join` 遇绝对路径产出垃圾路径。mechanical-check 用的 `path.resolve` 是对的。修：统一 `path.resolve`。
- **P2-3　安装器 manifest 丢「本轮未涉及宿主」的旧记录**（`installer/index.js:70` 起 newFiles 只收本轮文件集）：`init --hosts=codex` 之后 `update --hosts=claude-code` 会把 .codex 记录从清单剔除；用户此后手改 .codex 文件，再来一次全量 update 时被判 `new` **静默覆盖**，违反「不静默覆盖手改」。修：`newFiles` 以旧 manifest.files 为底再覆盖本轮。
- **P2-4　persist-book 书名即目录名未净化**：书名含 Windows 非法字符（`:?"*<>|`）时 mkdir 深处报错，人话但不指路。修：复用 `ChapterWriter.sanitizeFileName` 的净化思路或前置校验给指引。另：书仓库直启模式对同内容二次 persist-book 会因 `nothing to commit` 报「建书落盘失败」（开发/测试路径，低害）。
- **P2-5　序 3 resume 的 dto 为空对象**：宿主只能靠一句 message 猜断点在哪。工作区文件存在性（细纲/草稿/审稿单/待定稿）检测时已扫，附进 dto 即可。
- **P2-6　`prep/index.js:97` 注释「随 M3+ 体检补」已过时**（应为 M5.5）；同类：`session-context` 后 books.jsonl 的自愈回写在每个书级命令都可能发生（loadBooks），并发跑两条命令理论上有 last-write-wins——登记可重建（spec 可再生），接受现状，注明即可。

## S（spec/文档层）

- **S-1**　P1-1/P1-3 修复后，story-repo spec §10 状态表应注明序 2/序 4 的**执行责任落点**（脚本 commit：`fix(手改)`/`vol(N)`），与序 8 定稿同格式——两轮 review 都在这类「执行体归属」上抓到漏洞，值得钉死。
- **S-2**　多宿主 spec §7.1 registry 示例未含 M5 新字段 `detect_bin`/`install_dir`（validator 已强制）——示例是说明性的，但下次照抄示例造 registry 会被 validator 打回，建议顺手补。

## 测试盲区分析（为什么这轮还有漏）

上轮教训是「测试脚手架替生产代码干活」；这轮的形态是**「流程自身绿，流程间的接力没人测」**——e2e 只走了 建书→写章→定稿→next 主环，序 0/2/4 与 goto/retcon 走完后的 `next` 从未被断言。修复时应各补一条「流程完→next 判定正确」的接力测试（P1-1/2/3 各一），并把探针 2 的 goto 场景固化进 m3-flows 测试。

## 各里程碑健康度

| 里程碑 | 状态 | 备注 |
|---|---|---|
| M1 格式层/缓存 | 健康 | 事务、容错、41 接口无回归；`ensureReady` 语义正确但依赖"改源者自刷"约定——P1-2 是违约方不是它 |
| M2 脚本面 | 健康 | 备料/机检/定稿无新发现；机检条目形式检查（边界任务补）在位 |
| M3 状态机/git 隐身 | **两处成环缺口** | P1-2（goto/retcon 缓存）、P1-3（序 2 死胡同）都源出 M3 范围，被 F1 缺 CLI 掩盖至今 |
| M4 AI 层/壳 | 健康 | schema 单源、降级诚实、drift 在位；ReviewInput 别名命中（P1-1 修）在位 |
| M5 安装器/F1 | 主链健康，**接力缺口** | P1-1（卷复盘 commit 漏做）、P2-1/2/3/4 均属 M5 新面自身 |

---

## 修复记录（2026-07-04，本任务内收口）

全部发现已修复并验证（346 测试绿 = 335 基线 + 11 新增；真 CLI 探针复跑三条 P1 全闭合）：

- **P1-1/P1-2/P1-3**：`persistVolumeReview` 补 `vol(NN)` commit + 刷缓存；`refreshCacheAfterSourceChange` 统一助手接入 finalize/goto/retcon/卷复盘/修复回写五处；新增 `relink --message` 补登命令，序 2 的 message/dto 带变更清单并指路，SKILL 序 2/序 3 行接通 dto。
- **P2-1**：json-input 相对路径先 cwd 再书仓库，报错列出两处候选。**P2-2**：save-review/review-input 的 `--draft` 改 `path.resolve`。**P2-3**：安装器新清单以旧清单为底，未涉及宿主记录不再丢。**P2-4**：persist-book 书名非法字符前置拦截指路 `--dir`；建书/卷复盘 commit 前查 staged，二次运行幂等。**P2-5**：序 3 dto 带 `工作区现存`/`从哪继续`。**P2-6**：注释修正 + loadBooks 并发 last-write-wins 注明接受。
- **S-1**：story-repo spec 0.10（决策 33/34：序 2/序 4 执行责任落点、改源自刷缓存公约）。**S-2**：多宿主 spec v3.6（§7.1 registry 示例补 `detect_bin`/`install_dir` 等 M5 实态字段）。
- **接力测试**：`test/state-machine/relay.test.js` 六条「流程完 → next 判定正确」用例固化（含探针 2 goto 场景）；探针 1b 的「list-threads 不可见」复跑证实是探针裸调用报错，非缓存陈旧——带 `--type=foreshadow` 立即可见。
