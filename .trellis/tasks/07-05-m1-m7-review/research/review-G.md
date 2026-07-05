# Research: review-G（命令壳 / bin / installer / host-shells + 测试脚手架掩盖审计）

- **Query**: G 区审查——45+ 薄壳契约、bin 动态派发、installer/host-shells、测试脚手架掩盖
- **Scope**: internal
- **Date**: 2026-07-05
- **审查范围**: v7/bin/webnovel-writer.js、v7/src/commands/（48 个文件）、v7/src/installer/、v7/src/host-shells/、v7/skills/webnovel-writer/SKILL.md、v7/roles/、v7/test/commands/_helper.js、test/fixtures/、scripts/pack-install-e2e.mjs

每条格式：`[severity] file:line 一句话问题 | 怀疑理由 | 建议探针 | 置信`

---

## 候选清单（9 条）

### G-2 [P1] migrate 名册类型「角色」vs 系统过滤「character」——迁移书角色实体全不可见
`src/migrate/transform.js:117` + `src/cache/rebuilder.js:257`

- **问题**: migrate 把 v6 的 `e.type`（中文「角色」）原样写进名册「类型」列；rebuilder `const type = row.类型 || 'character'` 原样入 `entities.type`，而 review 名册 / list-characters / report-book-stats / book-status 全部按 `WHERE type = 'character'`（英文）过滤 → 迁移书的角色以 `type='角色'` 入库，对上述四处全部不可见。
- **怀疑理由**: `read-v6.js:85` `type: r.type || '角色'`、`transform.js:123` `if (e.type !== '角色') continue`、测试 `_v6.js:51` `INSERT entities VALUES('jiangyao','角色',...)` 三处确证 migrate 子系统用「角色」；消费端 `review/index.js:56`、`storage/adapters/EntityReader.js:107`、`commands/report-book-stats.js:10`、`prep/book-status.js:25` 全按 `'character'`；`rebuilder.js:38` scanEntities（plain INSERT，type=角色）先于 `:47` scanCharacters，后者 `:291` `ON CONFLICT(id) DO UPDATE` **未含 type** → 角色卡的 'character' 不会覆盖已入库的「角色」。sample-book fixture 用英文 `character` 恰好掩盖此漂移；`test/migrate/e2e.test.js` 只查 `COUNT(*) FROM chapters` 与 next 序号，从不查 entities.type / list-characters。
- **建议探针**: 迁移 `tempV6Sqlite` 后 `SELECT type FROM entities WHERE id='江遥'`（预期 '角色'）；再进程内跑 list-characters（预期空数组）、report-book-stats（预期角色数 0）。
- **置信**: 高

### G-1 [P2/掩盖] gitBookCtx 建的仓库与真实建书结构不同（无 .gitignore / 未设 core.quotepath / 工作区被 git 跟踪）
`test/commands/_helper.js:77-86`

- **问题**: gitBookCtx = tempBookCtx（整拷 fixture，**无 .gitignore**）+ `git init` + `git add -A` + commit。真实建书 `persistCreateBook`（`state-machine/persist.js:60,66`）写 `.gitignore`（含 `.cache/`、`工作区/`）、`git.setQuotepathFalse()`、只 `git.add(written)`（仅 book.yaml/大纲/AGENTS/.gitignore）。→ 测试仓库把 `工作区/细纲.md` 纳入 git 跟踪、无 core.quotepath；真实仓库 工作区/ 未跟踪。
- **怀疑理由**: 历史 P0「手动 git init 掩盖真实路径」同型。`goto-chapter` 的 `reset --hard`（`state-machine/flows/goto-chapter.js:57`）回退全部**已跟踪**文件——测试仓库（工作区被跟踪）会删/回退 工作区草稿，真实仓库（工作区未跟踪）保留，行为相反；M6「批次进行中 × goto-chapter」交叉的关键不变量（待定稿批次在 工作区/ 应免于 reset）无法用此脚手架如实验证。finalize 工作区清理、relink 的 status 前缀过滤在两种仓库形态语义不同。
- **建议探针**: persistCreateBook 真实建书 vs gitBookCtx 各建一仓，`git ls-files | grep 工作区` 对比；在两种仓库跑 `goto-chapter --confirm` 后查 `工作区/细纲.md` 是否仍在。
- **置信**: 高（结构差异已确证；对具体断言的掩盖需探针）

### G-6 [P2] M6 六命令 + M7 export/migrate 无 spawn-bin 覆盖，只有进程内调用
`test/integration/cli-main-loop.test.js:19` + `scripts/pack-install-e2e.mjs`

- **问题**: stage-chapter / batch-status / finalize-batch / batch-reject / batch-restage / batch-discard / export / migrate 全部只有「进程内 run()/模块函数」测试，无一经真 bin 子进程 spawn → bin 层的 scope 解析、参数解析、`cache.close()` finally、exitCode 约定对这 8 命令未端到端验证。
- **怀疑理由**: grep `spawn|execFile.*webnovel-writer|bin/webnovel-writer` 仅命中 finalize(git)/installer/cli-main-loop；`test/migrate/e2e.test.js:8-9` 走 `migrateV6`/`migrateCmd` 进程内；cli-main-loop 只覆盖 M2-M5 主循环（next/persist-book/list-books/prepare/mechanical-check/review-input/save-review/finalize/switch-book）；pack-install-e2e 只覆盖 init/persist-book/next/update。
- **建议探针**: 给某个 M6/M7 命令加一条 `execFile(BIN,[...])` 冒烟，验 scope='book'（export/batch）与 scope='workdir'（migrate）在真实 cwd 下解析 + exitCode。
- **置信**: 高

### G-4 [P2] finalize 工作区清理对 workspaceFiles 不挡 `..`，与 stage-chapter 守卫不一致
`src/finalize/index.js:142-144` + `src/commands/finalize.js:20-24`

- **问题**: finalize 只剥 `工作区/` 前缀（`finalize.js:21` `replace(/^工作区[\\/]/,'')`），不挡 `..`；`finalizeChapter` 直接 `fs.rm(path.join(repoPath,'工作区',wf))`，`wf='../定稿/正文/0001-x.md'` 会逃逸删到工作区外。stage-chapter（`staging/index.js:331` `if (!name.includes('..'))`）对同类清理有守卫，两路不一致。
- **怀疑理由**: 清理在 commit 后跑，逃逸删定稿文件会被 git 记为 deleted（可 checkout 恢复），但属越界删除；payload 为作者/AI 可控。
- **建议探针**: finalize payload 传 `workspaceFiles:['../定稿/正文/0001-...md']`，观察该定稿文件是否被删（`git status` 出现 deleted）。
- **置信**: 中

### G-3 [S] 名册「类型」列约定缺失——fixture 用英文 character、无角色/SKILL 指引规定该填什么
`test/fixtures/sample-book/定稿/设定/名册.md:3-4` + `SKILL.md:39`

- **问题**: fixture 名册 类型列填英文 `character`（作者面向中文文件里的机器味，历史模式10），系统内部 `entities.type` 词表确为英文 'character'；但 grep roles/ 无名册类型指引、SKILL.md rosterUpserts 未定义「类型」取值 → 手写书由 AI 自由填，若循全中文基调填「角色」则同样触发 G-2 的不可见问题。EntityWriter.upsertRosterRow 原样写入不校验。
- **怀疑理由**: `EntityWriter.js:8` ROSTER_HEADERS 含「类型」但无值域约束；消费端硬编码 'character'。
- **建议探针**: 核对是否存在约束 rosterUpserts.类型 的 spec/schema；构造 类型='角色' 的手写名册跑 list-characters 看是否空。
- **置信**: 中高

### G-5 [S/P2] docs/migration-guide.md 既不发布也不 vendored，用户不可达（非断链）
`v7/docs/migration-guide.md` + `package.json:12-19` + `src/installer/vendor.js:11`

- **问题**: 面向作者的 v6→v7 迁移指引不在 npm `files` 白名单（['bin/','src/','roles/','skills/','adapters/','templates/']，无 docs/），也不在 vendored `RUNTIME_ENTRIES`（['bin','src','roles','package.json']）→ npx 装完、工作目录都拿不到；且 grep `migration-guide` 仅命中文件自身，无 SKILL/roles/migrate 输出引用（非断链）。migrate 输出指向的是 `工作区/迁移报告.md`（另一份，正常）。
- **怀疑理由**: 内容明确面向终端作者（「给用过 v6 的作者」、逐步操作），但产品内不可交付。
- **建议探针**: `npm pack` 解包看 docs/ 是否在 tar；确认该指引是否本就仅供仓库 README 引流。
- **置信**: 高（不发布已确证；是否算问题取决于设计意图）

### G-9 [P2] bin 命令名直接拼路径 import，`../` 可派发到 commands 目录外、报错人话降级
`bin/webnovel-writer.js:106-108`

- **问题**: `commandPath = path.join(__dirname,'../src/commands',`${command}.js`)` 后 import，command 含 `../` 经 path.join 归一后会 import 到 commands 外模块（如 `../runtime/locate` → src/runtime/locate.js）；因目标无 `.run` 导出，落到 catch 的「执行命令时出错：mod.run is not a function」而非「未知命令」，人话降级。
- **怀疑理由**: 无命令名白名单/正则校验。属操作者=用户本人的 CLI，非安全面；仅错误文案质量。
- **建议探针**: `webnovel-writer ../runtime/locate` 看报错文案与 exitCode（预期非「未知命令」）。
- **置信**: 中

### G-7 [P2/低置信·跨D区] next 非 --json 路径直读 r.gitHealth.length，序1 可能未定义
`src/commands/next.js:16`

- **问题**: 非 `--json` 路径直接 `r.gitHealth.fixed.length`；若 `determineNextState` 在序1（空工作目录/无 book，allowNoBook 下 ctx.repoPath=null）返回不含 gitHealth 的对象，`next`（无 --json）会抛 "Cannot read length of undefined"。cli-main-loop 只测了空工作目录的 `--json` 路径（不碰 gitHealth）。
- **怀疑理由**: shell 无防御；序1 是否恒设 gitHealth 属状态机（D 区）职责。
- **建议探针**: 空 `.webnovel/` 工作目录里跑 `next`（不带 --json），看是否抛未定义。
- **置信**: 低（取决于 determineNextState 返回形状）

### G-8 [S/低] --help 硬编码「41 个读接口」计数无守卫，易漂移
`bin/webnovel-writer.js:31`

- **问题**: `精准读取接口（41 个，分布于 21 个命令）` 是硬编码文案，与实际读接口数无测试绑定（历史模式7 双源）。命令清单本身三方无漂移（48 个命令文件全部在 --help；SKILL 引用为合理子集）；「21 个命令」已核对准确（read/list/report 类命令恰 21）。
- **怀疑理由**: 数字硬编码。
- **建议探针**: 数 read/list/report 命令的 --flag 组合是否=41。
- **置信**: 低（仅文案）

---

## 复查在位（无新发现，历轮修复仍守）

| 项 | 位置 | 结论 |
|---|---|---|
| bin cache.close() finally 覆盖 | `bin:150-152` | cache 仅在 book/workdir-book 分支赋值，ensureReady 抛错前已赋值，finally 恒关；workdir/anywhere/no-book 分支不建 cache。**在位** |
| installer 新清单以旧为底防丢 | `installer/index.js:71` `newFiles={...manifest.files}` | **在位** |
| persistCreateBook git init+quotepath+ensureIdentity+随手 commit | `state-machine/persist.js:68-77` | **在位**（P0-2） |
| 薄壳契约「不碰 console/process」 | grep commands/ `console.|process.(exit\|argv\|cwd\|stdout\|stderr)` | 零命中，**全部合规** |
| init/update 将 report 映射为 output | `init.js:13`/`update.js:13` | 正确映射，报告可打印。**无 G-hypothesis 的静默 bug** |
| vendored 运行时含 migrate/export 新模块 | `vendor.js:11` RUNTIME_ENTRIES 含 'src' 整目录拷 | **天然含**，migrate/export/staging 均在 .webnovel/src/ |
| host-shells drift/条件块渲染 | `host-shells/generate.js:26-34` | renderTemplate 处理 {{#if}}/{{#unless}}/{{var}}；SKILL 新增自动模式/例外段无条件块（纯 {{cmd}} 插值），driftCheck 双跑字节比对确定性守住。**无漂移** |
| scope 分级逐命令 | 见下 | 无「该 workdir 却缺省成 book」误判 |

### scope 核对（显式导出 8 个，其余缺省 'book'）
- `anywhere`: init（装 .webnovel/ 前要能跑）✓
- `workdir`: list-books / update / switch-book / session-context / **migrate**（建新书，用 ctx.workdir）✓
- `workdir-or-book`: persist-book（建书时书目录还不存在）✓
- `allowNoBook=true`: next（空工作目录报序1）✓
- 缺省 'book'（含 export / 全部 batch 命令 / finalize / goto-chapter / relink / health-check / impact / 全部 read/list/report）——均需书仓库；从工作目录启动经 resolveRunContext 解析当前书（mode='workdir-book' 带 repoPath+cache），从书仓库根启动 mode='book'，两处皆可跑。**无缺省成 book 却应 workdir 的命令**

## Caveats / Not Found

- G-2 的实际用户影响面取决于 v6 数据的 entity type 取值，但 migrate 子系统（read-v6/transform/_v6 fixture）与缓存层的 '角色' vs 'character' 契约错配是**代码级确定**，非依赖数据。scanCharacters ON CONFLICT 不改 type 已在 `rebuilder.js:289-298` 逐行确认。
- G-1 的「掩盖」需探针确认具体哪些断言被误绿；结构差异本身已确证。goto-chapter × 批次的深层语义正确性（批次建立在被 reset 章之上）属 E 区（staging/state-machine），此处只报脚手架无法如实建模。
- G-7 属 D 区（determineNextState 返回形状），仅从 G 区薄壳视角标出，未深入状态机。
- 未发现空壳/占位实现；未发现薄壳越权碰缓存生命周期；bin `--version`/`--help`/未知命令三路 exitCode 与错误人话（不带栈）均合规。
