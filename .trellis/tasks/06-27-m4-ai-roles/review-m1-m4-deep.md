# M1–M4 深入 Review 报告（2026-06-29）

> 方法：逐文件精读 73 源文件（非上一份的 grep + 架构断言），交叉 spec 后端规范，跑全量 246 测试复现（绿）。
> 上一份 review（06-27）的结论（v6 清洁 / 架构自洽 / 246 绿）成立，但**漏掉了核心写章循环里的两个 P0**——它们正好落在 F1（后半段无 CLI 缝）与测试盲区里。

## 结论速览

代码风格、v6 清洁、DTO 隔离、确定性生成（drift）这些都没问题。**但「备料→机检→两审→定稿→next」这条主循环在真实环境下跑不起来**：定稿后缓存不重建且无 rebuild CLI，状态机会重抄最新章；建书流程不 git-init 书仓库。两者都被测试脚手架（预 init git、预落章、手动 rebuild）掩盖。spec 层有 1 处硬矛盾、多处「待增量补充」未闭环。

---

## P0（阻断核心循环）

### P0-1　定稿后缓存不重建 + 无 rebuild CLI → `next` 无限重抄最新章
- `finalizeChapter`（`src/finalize/index.js:21`）写章、commit、清工作区，**全程不碰 cache**（ctx 收了 `cache?` 却从不引用）。定稿后磁盘多了 `定稿/正文/0003-...`，但 `.cache/index.db` 里 `MAX(chapter_num)` 还是上一章。
- `bin/webnovel-writer.js:85` 每条命令只调 `cache.ensureReady`，而 `ensureReady`（`src/cache/index.js:21`）**仅在 db 缺失/损坏/空表时重建**——db 存在且有非空表就直接复用，**无任何陈旧检测**。
- 全树 grep：生产路径里**没有任何地方在定稿后或磁盘变更后调 `rebuildFromSource`**（只有测试调）。
- `src/commands/` 下**没有 rebuild/refresh-cache 命令**——宿主连「刷新缓存」的 CLI 都没有，唯一刷新手段是作者手动删 `.cache/`。
- 后果：定稿第 3 章 → 跑 `webnovel-writer next` → 缓存仍说 maxChapter=2 → 序6「起草第 3 章细纲」。第 3 章已在定稿里。**主循环卡死，每章都要作者手动删缓存。**
- **为何上一份漏了**：`test/finalize/finalize.test.js:96` 在定稿后**手动** `ctx.cache.rebuildFromSource(...)`——测试作者知道要重建，所以断言绿；`test/state-machine/router.test.js` 在 `ensureReady` 之前就把章文件落盘，从不测「定稿后 next」。F1（无定稿 CLI）使整条 finalize→next 从没被端到端测过。

### P0-2　建书流程不 git-init 书仓库 / 不设 core.quotepath / 不写 .gitignore
- `persistCreateBook`（`src/state-machine/persist.js:29`）只写 `book.yaml` + `总纲.md` + `第01卷.md`，**不 `git init`、不 `git config core.quotepath false`、不写 `.gitignore`**。
- 后果链：
  - 新书目录不是 git 仓库 → `finalizeChapter` 的 `git.add/commit` 直接失败 → 每次定稿都回滚报「定稿中断」。
  - `.cache/index.db` 被当普通文件跟踪/提交，违反 spec database §2.1/2.2（缓存必须 gitignored）。
  - `工作区/` 不在 `v7/.gitignore`（只 ignore `.cache/ node_modules/ dist/`）→ 草稿/审稿被跟踪，定稿清工作区后留下「已删除未暂存」脏状态。
- spec `quality-guidelines §3.3` 明确「书仓库初始化必须设 `git config core.quotepath false`」是 CI 硬约束——**目前无任何代码落地**，归属也不清（建书流程？M5 安装器？）。
- **为何漏了**：`router.test.js:17-29` 的 `makeGitBook` 手动 `git init` + `git config` + 写 `.gitignore('.cache/\n工作区/\n')`，把这三件事全替生产代码做了。测试绿，生产裸。

> P0-1/P0-2 都不是「与 smoke 一起推迟」能解释的——它们是脚本面（M1-M4 范围内）的真实缺口，只是因为 smoke 推迟、没有端到端测试而没暴露。建议进 M5 前**先补上**，否则 M5 安装器接一个跑不通的循环。

---

## P1（数据完整性 / 安全）

### P1-1　缓存重建无事务 → 中途失败留半库
`rebuildCache`（`src/cache/rebuilder.js:12`）DELETE 6 表后逐表 INSERT，**无 `BEGIN/COMMIT`**。`scanEntities` 在别名冲突时 `return {ok:false}`（`:241`），此时 chapters/threads/secrets 已写入、entities/aliases/characters 空——**返回失败但库已半填**，`CacheManager` 不在失败时重建。与上一份「数据完整性 SOUND」断言冲突。注：注释说「DELETE 五表」实际删 6 表。

### P1-2　`goto-chapter --confirm` 不 stash 未提交改动 → `reset --hard` 丢手改
`src/state-machine/flows/goto-chapter.js:33` 先 `createBackupRef`（只存 HEAD 指针）再 `resetHard(hash)`。`git reset --hard` 丢弃**所有已跟踪文件的未提交改动**，rescue ref 不含工作树。若作者有序 2 式未登记手改（定稿/大纲已跟踪且改了），改动被静默抹掉、无法从 rescue ref 找回。该 flow 也不跑 `checkGitHealth`。应：reset 前先 `git stash` 或拒绝脏树。

### P1-3　finalize 回滚是 tree-scoped 非 write-scoped + `clean` 未包 try
`src/finalize/index.js:112-113` 回滚用 `git.restore(['定稿/','大纲/'])` + `git.clean(['定稿/','大纲/'])`：
- 范围是**整棵 定稿/大纲 子树**，不是本次 `written` 集合。若本次只写第 5 章、但第 4 章有未提交手改，回滚会把第 4 章手改一起抹掉。注释自称「仅 定稿/大纲」是树级不是文件级。
- `git.clean`（`src/finalize/git.js:33`）**没有 try/catch**（`restore` 有）。Windows 文件锁使 clean 抛错时，错误逃出 `finalizeChapter` 的 catch，破坏 `{ok,error}` 契约，调用方拿到 throw 而非结构化失败。

---

## P2（健壮性 / 正确性，不阻断）

- **P2-1　章标题未做文件名净化**：`ChapterWriter.writeChapter`（`src/storage/adapters/ChapterWriter.js:24`）直接 `${NNNN}-${标题}.md`。标题含 `? * " < > |` 或半角冒号时 Windows 写盘失败 → finalize 回滚。标题是 AI DTO，无 sanitize。
- **P2-2　重写同章不同标题留旧文件**：`writeChapter` 用 writeFile 覆盖同文件名，标题变了文件名就变，旧文件残留 → `scanChapters` 两条同 `chapter_num` → `INSERT ... PRIMARY KEY` 冲突 → 重建失败。
- **P2-3　`updateFrontMatter` throw / `installer` 占位**：已知 F3，无人依赖，诚实占位，留未来。
- **P2-4　`yaml-dialect.needsQuoting` 不全**（`src/storage/serializers/yaml-dialect.js:79`）：只查数字/布尔/null/冒号/`#`/`-`/换行。漏 `[` `{` `&` `*` `!` `|` `>` `%` `@` 等首字符 → 值如 `[弱钩]`、`{x}` 会被 YAML 误判为数组/映射。当前数据形状碰不到，潜伏坑。
- **P2-5　线程更新遇嵌套未知字段必崩**：`ThreadLedgerWriter.updateThread`（`src/storage/adapters/ThreadLedgerWriter.js:29`）调 `serializeFrontMatter(merged, parsed.body)` 不传 `originalYAML`。merged 含全部原字段，平铺字段能保留；但若作者加了**嵌套映射**自定义字段，`serializeYAML` 抛「防呆方言禁止嵌套」→ updateThread 返回 ok:false → finalize 回滚。与 spec §4.5「未知字段必须保留原样写回」**直接冲突**（见 S2）。
- **P2-6　机检复读仅报首条 + 阈值偏低**：`checkRepetition`（`src/mechanical-check/index.js:100`）`break` 在首条命中，漏报其余；L=6/阈值 3 对常见六字短语易误报。`checkNewProperNouns` 正则 `([一-龥]{2,3})(…|道|说|…)` 对「他便笑道」类产生大量非阻断候选噪声（不拦截，仅噪）。
- **P2-7　两审「相关角色」按正名匹配漏别名**：`assembleReviewInput`（`src/review/index.js:43`）用 `草稿全文.includes(name)`（name=文件名=正名）。草稿只用别名「大师兄」、文件名「林晚」时漏纳入，审查上下文缺失。
- **P2-8　`session.assembleSessionContext` 自愈不回写**（`src/session/index.js:57`）：books.jsonl 损坏时只扫描重建到内存返回，**不写回 books.jsonl**，下个会话再扫一遍。函数名/注释「自愈」名不副实（spec 说本层只读、M5 写侧——但「自愈」措辞误导，建议改名或 spec 注明）。
- **P2-9　`findChapterCommit` 依赖 git 默认 BRE**：`git.js:93` `--grep=ch(${n}):` 能匹配字面 `ch(3):` 仅因 git 默认 BRE 里 `()` 是字面。一旦 `grep.extendedRegex` 配置开启即失效。脆弱但当前正确。
- **P2-10　宿主壳生成器字符串拼接**：`roleToToml`/`roleToMarkdown`（`src/host-shells/generate.js:42-47`）直接拼 `description = "${role.description}"`。description 含 `"` 或换行即破 TOML/YAML frontmatter。`validator` 只查源 roles 的 ABS_PATH，**不校验生成物格式**，drift check 也只比字节相等不比合法。
- **P2-11　`validator.ABS_PATH` 漏路径**（`src/host-shells/validator.js:9`）：只匹配 `[A-Za-z]:\\` 和 `/(Users|home)/`。`/root/`、`/mnt/`、裸 `/etc/x` 都漏。便携性校验有洞。

---

## Spec 层问题

- **S1　表数不符**：`database-guidelines §2.4` 列五表（chapters/threads/secrets/entities/fingerprints），实现六表（多了 `entity_aliases`）。spec 漏列 `entity_aliases`，文档与代码不一致。
- **S2　硬矛盾：保留未知字段 vs 禁止嵌套**：§4.5「未知字段必须保留原样写回」与 §4.1「禁止嵌套映射」+ 防呆序列化器拒嵌套（P2-5）冲突。作者加嵌套自定义字段时无法两全。spec 需明确：未知字段仅限平铺标量/列表，嵌套字段如何处置（拒绝？降级为正文？）。
- **S3　core.quotepath 落地无归属**：`quality §3.3` 要求书仓库初始化设 `core.quotepath false`，但未指定由哪一步负责（建书流程？安装器？），导致无人实现（P0-2）。spec 应钉死责任方。
- **S4　AI 预算上限 pending**：`quality §2.2`「AI 调用每章预算上限（实现时定数）」M4 已过仍未定数，`runReviews` 固定 2 次调用无上限约束。应在 M4 收口或显式推迟到 beta。
- **S5　多文件原子性豁免缺失**：`error-handling §3.1`「所有多文件写入操作必须原子」，但 `persistReviewReport`（`src/review/index.js:104`）写 3 个文件非原子无回滚。spec 未给「工作区多文件写入」豁免边界，要么补豁免、要么补实现。
- **S6　「待增量补充」大量未闭环**：database §5（表列定义/增量更新策略）、error §5（错误类型与退出码、git 异常清单）、quality §6（lint 选型、测试覆盖率、退出码约定）自基线 1.0（06-12）至今未填。M1-M4 已落地，这些空白该回填，否则后续任务无据。
- **S7　书仓库工程文件边界含糊**：`directory-structure §3.3`「书仓库内零工程文件（唯一例外 AGENTS.md）」未说明 `.gitignore` 归位，而 `.cache/` 必须被 ignore——存在规范真空，导致 P0-2 里 `.cache` 被跟踪无人挡。
- **S8　版本号未对齐**：README 版本徽章 6.2.0（v6/master），`v7/package.json` 是 `0.0.0`。发布前须设版本；README 版本表是 CI 硬约束，M5 发版前要对齐。

---

## 测试盲区（解释为何 246 绿却藏 P0/P1）

1. 无 finalize→next 端到端（F1 无定稿 CLI）→ 主循环从未被测。
2. `router.test` 在 `ensureReady` 前已落章 → 不测「定稿后 next 陈旧」。
3. `finalize.test` 手动 `rebuildFromSource` → 掩盖「无自动重建」。
4. `makeGitBook` 手动 `git init`+`config`+`.gitignore` → 掩盖「建书不 init git」。
5. `goto-chapter.test` 未构造「脏工作树 + confirm」用例 → P1-2 不触发。

建议补一条端到端集成：`init 书 → 备料 → 机检 → runReviews(桩) → finalize → next`，期望 `next` 报序6 且 nextChapter = 已定稿章 +1。这条一加，P0-1 立刻红。

---

## 优先级建议

1. 先修 P0-1（定稿后重建缓存 + 补 rebuild CLI 或在 `next`/`finalize` 入口刷新）+ P0-2（建书流程 git init + .gitignore + core.quotepath）——这是让主循环跑通的前提。
2. 再补上面那条端到端集成测试，把 P0 锁死。
3. P1（事务、goto stash、回滚范围+clean try）在 M5 接线前修。
4. P2 与 S1-S8 可在 M5 期间或单独一个 spec 回填任务里清。
