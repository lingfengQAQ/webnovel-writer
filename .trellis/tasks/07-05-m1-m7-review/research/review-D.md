# Review D 区：状态机与外环（state-machine / session / runtime）

- **范围**：v7/src/state-machine/（index/detectors/dto/persist/git-health/flows）、v7/src/session/、v7/src/runtime/
- **对照**：story-repo-spec 0.13 §10（序 0-6）、§9、M1-M5 review 三条 P1
- **日期**：2026-07-05
- **性质**：只审不修。候选格式 `[severity] file:line 问题 | 怀疑理由 | 建议探针 | 置信`

---

## 一、候选清单（按严重度）

### P1-D1　persistRepair 校验用错解析器，序0 修复对 book.yaml / 名册 / 时间线 三类必然失败

`[P1] v7/src/state-machine/persist.js:123 | 置信=CONFIRMED（静态链路 + 测试空白已复核，未跑 CLI 探针）`

- **问题**：`persistRepair` 对**每一条**修复内容都用 `parseFrontMatter(r.content)` 校验（persist.js:118-127）。但序0 源文件清单里有 3 类不是 front-matter markdown：
  - `book.yaml`：纯 YAML，`serializeYAML` 输出 `key: value` 无 `---` 围栏（yaml-dialect.js:39；detectors.js:39-45 经 BookConfigReader 检测）
  - `定稿/设定/名册.md`：纯表格，`serializeMarkdownTable` 输出（EntityWriter.js:63；detectors.js:57-63 用 parseMarkdownTable 检测）
  - `定稿/设定/时间线/第NN卷.md`：纯表格（TimelineWriter.js:42；detectors.js:66-75）
- **怀疑理由**：这三类的正确修复内容首个非空行不是 `---`，`parseFrontMatter` 直接返回 `ok:false，缺少 front matter 分隔符`（front-matter.js:30-39）。于是 persistRepair 在 :124 判定「修复内容仍解析失败」拒写。**序0 在状态机最前（index.js:23-26），命中即停**——一旦 book.yaml/名册/时间线 表损坏，序0 每次都触发，而唯一出口 persist-repair 又拒收合法修复 → 书被锁死在序0，作者无法在工具内自愈（违背序0「永不带堆栈崩溃/AI 提议作者确认」承诺）。检测侧用对了解析器（parseFrontMatter vs parseMarkdownTable），只有修复回写侧校验一刀切，是读写不对称。
- **测试为何漏**：persist.test.js:89-127 三个 persistRepair 用例全用 `定稿/正文/0001-起.md`（front-matter 文件），从未覆盖 book.yaml/名册/时间线，正是「流程自身绿、边角没人测」。
- **建议探针**：`persistRepair(ctx, {repairs:[{file:'定稿/设定/名册.md', content:'| 正名 | 别名 |\n|---|---|\n| 林晚 |  |\n'}]}, {allowedFiles:['定稿/设定/名册.md']})` → 预期错返 `修复内容仍解析失败（定稿/设定/名册.md）：缺少 front matter 分隔符`。book.yaml 同理。

### P1-D2　goto-chapter 回退不识别进行中批次 → 批次孤儿 + 定稿章号断档

`[P1] v7/src/state-machine/flows/goto-chapter.js:38-57 | 置信=CONFIRMED（静态推演；建议 CLI 探针坐实）`

- **问题**：`工作区/待定稿/` 批次被 gitignore（persist.js:60 建书 / migrate:50 迁移都 ignore `工作区/`），是**未跟踪**文件。goto-chapter 只 `createBackupRef + resetHard`（:54-57），不带 `git clean`，故 `reset --hard` **不删批次**；脏树检查 `dirtyScoped` 只看 `定稿/大纲`（:41-44），gitignore 文件不进 porcelain，**批次在场也不拦回退**。
- **怀疑理由**：设 ch1-10 已定稿、批次暂存 ch11-18，作者「回到第8章」：reset 把 HEAD 退到 ch8（ch9/10 退出工作树，仅存 rescue ref），缓存重建后 maxChapter=8；批次 ch11-18 原样存活但**基线已从 ch10 变 ch8**。随后 next 命中序3 批次续跑（序3 优先于序4/5，批次期这些例外反而进不来，唯 goto 是绕过序路由的直呼命令）；finalize-batch 逐章转正会写出 0011…，得到 1-8、11-18、**缺 9-10 的定稿断档**，且 staged 正文引用的是已被退掉的 ch9/10 世界态。全程无一处告警把「回退」和「在场批次」联系起来。stage-chapter 连续性校验（staging/index.js:289-295）在 batch.exists 时只对批尾续号，也不校 HEAD 断层。
- **非「误删」澄清**：批次文件不会被删（gitignore + 无 clean），风险是**孤儿 + 章号断档 + 悬空引用**，任务问的两种里前者不成立、后者成立。
- **测试为何漏**：grep 无 goto×待定稿 交叉用例（auto-mode.test.js:88 只测 next 命中批次续跑）。
- **建议探针**：sample-book 里 stage ch3 批次 → `goto-chapter 1 --confirm` → `next --json`，看是否仍出序3 批次续跑且批次起章 > maxChapter+1（断档），且无任何冲突提示。

### P2-D3　文风铁律 修复回写后永不入档（序2/relink 范围仅 定稿/大纲）

`[P2] v7/src/state-machine/persist.js:134 与 detectors.js:99 | 置信=PLAUSIBLE`

- **问题**：persistRepair 注释明写「修复本身不 commit：入档走序2 手改补登（relink）」（persist.js:134）。但序2 检测 `listManualEdits` 只收 `定稿/大纲` 前缀路径（detectors.js:99），relink 也据此圈范围（relink.js:16）。`文风/文风铁律.md`（front-matter 文件，能被 persistRepair 写成功）落在 定稿/大纲 之外 → 序2 永远看不见 → relink 不会提交它。
- **怀疑理由**：修复后的文风铁律长期停在未提交区，作者无从经 relink 入档；且后续任一 goto-chapter 的 `reset --hard`（dirtyScoped 同样只看 定稿/大纲，:41-44）会静默抹掉这个已跟踪文件的改动。book.yaml 同类，但它更早卡在 P1-D1 写不进来。
- **建议探针**：修好 `文风/文风铁律.md` 走 persistRepair → `next --json` 看是否出序2；`git status` 看 文风/ 是否长期 dirty；relink 后确认文风铁律仍未被提交。

### P2-D4　retcon 失败回滚过宽，可误伤并发未提交手改（bug 模式#8）

`[P2] v7/src/state-machine/flows/retcon.js:48-49 | 置信=PLAUSIBLE`

- **问题**：retcon 失败分支执行 `git.restore(['定稿/','大纲/'])` + `git.clean(['定稿/','大纲/'])`——整棵子树回滚。finalize 早已刻意改为逐文件回滚，并在注释里点名「非整棵 定稿/大纲 子树，避免误伤同子树其他章手改」（finalize/index.js:148-149）。retcon 仍是宽版。
- **怀疑理由**：retcon 是直呼命令，若作者本有 定稿/大纲 未登记手改（正处序2 态）时吃书中途失败，宽版 restore 会把无关手改一起还原、clean 会删掉无关未跟踪新文件。回滚边界过宽正是 PRD 闻味#8。
- **建议探针**：定稿/ 放一处未提交手改 + 一个未跟踪新角色卡 → 触发一个中途失败的 retcon（thread 更新指向不存在条目）→ 看手改被 restore、新文件被 clean。

### P3-D5　序3 DTO 组装走读路径却可能写 批次.json（readBatch 自愈副作用）

`[P3] v7/src/state-machine/dto.js:75 → staging/index.js:74-78 | 置信=PLAUSIBLE`

- **问题**：`next` 路由组 DTO 时 dto.js:75 调 `readBatch`；readBatch 在「批次.json 缺失/损坏但有章目录」时会 `writeAtomicBatch` 重建元数据（staging:74-78）。即状态机的读路径隐含一次落盘。
- **怀疑理由**：自愈本身合理，但发生在名义只读的路由组包里，且同一次 DTO 内 readBatch 被多次调用（dto.js:75 一次、judgeStop→stagedFacts 再各一次 staging:114/357），重建会重复写。属稳健性/意外副作用，非数据错。
- **建议探针**：删 `工作区/待定稿/批次.json` 保留章目录 → `next --json`，看是否静默重写出 批次.json。

### P3-D6　「待定稿/」现存判定与 readBatch.exists 口径不一致

`[P3] v7/src/state-machine/detectors.js:129 vs v7/src/staging/index.js:80 | 置信=PLAUSIBLE`

- **问题**：序3 现存把 `待定稿/` 只按 `readdir(...).length>0` 计入（detectors.js:129）；readBatch 则要求有 `^\d{4}-` 章目录或有效 meta 才 `exists:true`（staging:42-82）。当 待定稿/ 只含杂项文件时，现存含「待定稿/」但 batchDetail 因 exists=false 返回 `{}`（dto.js:76）。
- **怀疑理由**：DTO 会出 `从哪继续='待定稿批次续跑'` 却无 `批次` 明细字段，AI 拿到「续跑」却无可跑内容。非崩溃，属边角不一致。
- **建议探针**：`工作区/待定稿/` 放一个非章目录杂文件 → `next --json` 看 从哪继续 与是否缺 批次 字段。

### P3-D7　序4/5/6 前的章号查询未加 try/catch

`[P3] v7/src/state-machine/index.js:46-48 | 置信=Low`

- **问题**：`cache.query('SELECT ... FROM chapters ...')`（:46-48）无 try/catch，而同文件 readLastHealthCheck（:78-83）有。缓存查询若在路由中途抛错，determineNextState 直接抛。
- **怀疑理由**：调用方（next 命令）通常已 ensureReady，实际触发面窄，故 Low。仅口径不一致提示。
- **建议探针**：注入一个 query 抛错的 cache 跑 determineNextState，看是否冒泡未捕获。

---

## 二、历轮修复在位复查（M1-M5 三条 P1）

| 项 | 结论 | 证据 |
|---|---|---|
| **P1-1 卷复盘 commit `vol(NN)`** | ✅ 在位 | persist.js:104 `commit(`vol(${nn}): 复盘与下卷规划`)`，有 ensureIdentity + hasStagedChanges 守卫（:102-105） |
| **P1-2 五处改源自刷缓存** | ✅ 全在位 | finalize/index.js:139、goto-chapter.js:59、retcon.js:44、persist.js:107（卷复盘）、persist.js:135（修复回写），均调 `refreshCacheAfterSourceChange` |
| **P1-3 relink 执行通道** | ✅ 在位 | v7/src/commands/relink.js（add+`fix(手改)` commit+刷缓存，与 listManualEdits 同源圈范围）；dto.js:33 序2 期望产物指向 relink；detectors.js:36 message 带补登命令。**但见 P2-D3：文风/book.yaml 不在 relink 覆盖面** |

## 三、序 0-6 与 spec 0.13 §10 逐条对照

- **序0**：detectors.js:13-77 八类清单与 §10「源文件清单」逐条一致（正文/伏笔/悬念/感情线/角色/信息差 front matter + book.yaml + 文风铁律 + 名册表 + 时间线表），钉死范围未自行增减，缺失跳过、存在才校。**检测侧正确**；修复回写侧见 P1-D1。
- **序1**：detectors.js:81-88 无 book.yaml 判定；「当前书不存在」子情形在 locate 层 workdir-no-book（locate.js:44-57）分担，index.js:16 `!repoPath` 兜空目录。范围一致。
- **序2**：detectors.js:92-106 定稿/大纲 未提交改动，与 §10 一致（检测=执行同源，不双写）。
- **序3**：detectors.js:117-145 续跑映射与 §10 映射表一致（待定稿 > 审稿 > 草稿 > 材料 > 细纲，最深优先；细纲计入不被序6覆盖）。dto batchDetail 建议命令（stage-chapter/save-review+batch-restage/batch-status+finalize-batch）均对应真实命令，文案与可跑命令一致。
- **序4**：收卷声明制到位——rebuilder.js:100 `收卷:是→is_volume_end`，index.js:55 读 is_volume_end + volumeReviewDone 防重复触发（detectors.js:153-161 以卷摘要存在为准），与 §10 序4/§4.1/§7 一致，未用章号整除。
- **序5**：index.js:63 `maxChapter-lastCheck >= 体检周期`，默认 50（index.js:52 / book.yaml），与 §10「距上次体检已满周期」一致；记录存 meta，丢失重测无害（readLastHealthCheck 容错）。
- **序6**：默认分支，自动确认细纲标志经 book.yaml 读入 dto（dto.js:56-65），与 §10 一致。

## 四、其余专项（无新候选）

- **git 健康检查**（git-health.js）：锁文件/损坏/网盘副本/合并/半提交五类各有中文 fixed/guidance/rescued，损坏只指引不动仓库（:36-41），救援写 工作区/.救援/修复日志.md（:115-124），「作者永不直面 git 报错」守住。
- **persist 落盘**：序0 安全网「只写 allowedFiles 内 + 内容须解析」在位（persist.js:118-127，唯解析器选型是 P1-D1）；建书 git init 幂等 + ensureIdentity 身份兜底 + hasStagedChanges 守卫（persist.js:69-77）；bookAgentsMd 被 migrate 复用（migrate:7,49），文案「本目录是《书名》的书仓库」对迁移语义仍成立。
- **books.jsonl 自愈**（session/index.js）：坏行跳过计数、missing/空→扫描重建回写、部分损坏→留好行回写（:70-96），登记/换书各保证唯一「当前」；并发 last-write-wins 有注释认账。
- **locate 三分支**（locate.js）：book/workdir/workdir-or-book/anywhere 四 scope 齐；workdir-no-book 覆盖「当前书未选」与「登记书目录缺 book.yaml」两支，人话提示。
- **批次期其余例外**：卷复盘（序4）/体检（序5）在批次期被序3优先拦截，不冲突；relink 在批次期只碰 定稿/大纲、不动 工作区批次；手动 finalize 单章不经序路由，正常流程不会在批次期触发。唯 goto-chapter 是绕过序路由的直呼命令，故成 P1-D2 的唯一交叉风险点。
