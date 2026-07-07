# 技术设计：第三轮 review 修复

真源：`.trellis/tasks/07-05-m1-m7-review/review-m1-m7.md`（汇总）+ `research/review-{A..G}.md`（细节与行号）。本文按修复批次给出每条的技术方案与关键决策；实现时以分区报告的 file:line 为准。

## 关键决策（呈用户裁决过的行为决策）

| # | 决策 | 内容 |
|---|------|------|
| D1 | 实体类型值规范（G-3/R5） | **名册文件（作者域）写中文**（角色/地点/组织/物品），**缓存 entities.type（机器域）存英文 machine 值**。入库点做归一映射 `normalizeEntityType()`：角色→character、地点→location、组织/势力→organization、物品→item；英文值恒等收纳（character→character）；未知值原样保留+warning。fixture 名册的 `character` 改中文「角色」（消除 G-2 掩盖源）。 |
| D2 | 一对多别名降级（R10） | 迁移时同一别名指向多实体 → 按 facts.entities 数组序**首实体保留**该别名，其余实体剥离；剥离明细写 `定稿/设定/迁移待校对-别名歧义.md` 并进迁移报告待校对清单。整体迁移不再硬回滚。 |
| D3 | finalize-batch 幂等重跑（E3 尾链） | 转正循环顺序改为「先更新批次.json（移除该章行）再删章目录」；目录删除失败 → 人话错误 + 指引重跑；finalizeBatch 开头对目标章做已定稿检测（定稿文件已存在且章号 ≤ 缓存 maxChapter → 跳过转正、只清目录），重跑不会二次定稿撞「已存在」。 |
| D4 | 源只读硬承诺（F-6） | openReadOnly 的可写回退分支删除；readOnly 打开失败直接人话报错（"源数据库无法只读打开（可能被占用），关闭占用程序后重试"）。 |
| D5 | imagery_top 陈旧（B） | rebuild 加 `preserveDerived` 选项：删缓存裸重建=保留（丢失重测无害的对称面），改源刷新（refreshCacheAfterSourceChange）=作废 imagery_top（宁可无提醒不给陈旧提醒）。 |
| D6 | 序2/relink/goto 脏树范围（D3 区） | `定稿/大纲` 前缀集合扩为 `定稿/大纲/文风/book.yaml`，抽单一常量 `TRACKED_SOURCE_PREFIXES` 供 detectors.listManualEdits、relink、goto dirtyScoped 三处共用（防双写）。修复后的文风铁律/book.yaml 由此走序2 补登入档。 |

## 批 0：测试基建（G-1）

`test/commands/_helper.js` gitBookCtx 对齐 `persistCreateBook`（state-machine/persist.js:58-78）：写 `.gitignore`（`.cache/`、`工作区/`）、`git config core.quotepath false`、只 add 跟踪面（不 `add -A`）。存量测试若依赖"工作区被跟踪"的断言，按真实形态修正断言（测试是探针不是约束）。

## 批 1：数据安全 + 互斥守卫

### R1/R2 批次互斥守卫（E1/E2）
- `state-machine/flows/goto-chapter.js`：入口（needsConfirm 判定前）`readBatch(repoPath)`，`exists` → `{ok:false}` 人话："有进行中的待定稿批次（第 X-Y 章）。先 `finalize-batch` 转正或 `batch-discard` 丢弃，再回退。" 附 gitHealth 照常返回。
- `commands/finalize.js`：同守卫。文案区分两种情况：目标章在批内（"第 N 章已在待定稿批次中，用 finalize-batch 转正"）/ 批次存在但目标章不在批内（"有进行中批次，手动定稿会造成章号错位"）。
- 守卫加在命令/flow 层，不加 finalizeChapter 本体（finalizeBatch 内部要调它）。
- 回归测试用批 0 修正后的 gitBookCtx（工作区未跟踪，批次目录可如实存活）。

### R3 persistRepair 分派校验（D1 区）
`state-machine/persist.js:118-127`：新增 `validateRepairContent(file, content)` 按路径分派——`book.yaml` → parseBookConfig；`定稿/设定/名册.md`、`定稿/设定/时间线/` 前缀 → parseMarkdownTable；其余 → parseFrontMatter。分派规则与 detectors.js 检测器选型对齐（同一映射，注释互指）。

### R4 finalize 清理不谎报（C1/C2/G-4/C4）
`finalize/index.js:141-144`：
- 清理循环搬进独立 try/catch，`fs.rm(..., { recursive: true, force: true })`；失败只收集 warning，**不改写 ok**（commit 已发生），返回 `{ok:true, commitHash, warnings}`。
- 本体归一防御下沉：抽 `util/workspace-path.js` `normalizeWorkspaceRel(name)`——剥 `工作区/` 前缀 + 按路径段拒绝 `..`（`split(/[\\/]/).includes('..')`，替换 stageChapter 的 `includes('..')` 过宽判定=C4）。finalizeChapter、stageChapter、commands/finalize.js、commands/stage-chapter.js 四处共用（消除双源）。

### R7/R8 yaml-dialect 补漏（A1/A2/F-2）
`storage/serializers/yaml-dialect.js`：
- `needsQuoting` 补：空串；`value !== value.trim()`；带符号/十六进制/科学计数数字形态（`/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/`、`/^0[xXoObB]/` 且后随合法数字）；`~`、`.inf/.nan` 变体；起首 YAML 指示符 `[ ] { } * & ! | > @ % \` " ' ,`；`? ` 起首；含 ` #`（行内注释）。
- 双引号分支完整转义：`\` → `\\`（先做）、`"` → `\"`、`\n` → `\n`、`\r`、`\t`、其余 C0 控制字符 → `\xXX`。
- 验收=往返 property 测试：review 列的全部 DRIFT/PARSEFAIL 值（`""`、`"  甲  "`、`0x1F`、`1e3`、`+5`、`~`、`[快穿]反派`、`*追读`、`"引号"书`、`- 开局`、`C:\Users\x`、`*ptr`、`&a`、`[TBD`）serialize→parse 逐一断言相等。

### R12 atomic 回滚时序（A3）
`storage/atomic.js`：plan 增加 `renamedIn` 标志（第二循环 `rename(tmp→final)` 成功后置 true）。restorePlan 改为：rm(tmp) → `if (renamedIn) rm(final)` → `if (existed) rename(backup→final)`。existed=false 且 renamedIn=false 时**绝不碰 final**（本 bug 场景：原文件未动过）。附故障注入测试：mock writeFile 对第 2 个文件抛错，断言已存在的 B 原文完好。

## 批 2：迁移链

### R5 类型值归一（G-2 + 决策 D1）
- `cache/rebuilder.js:257`（scanEntities）与 `storage/adapters/EntityReader.js` 文件降级路径：经 `util/entity-type.js` `normalizeEntityType()` 入库/过滤。
- scanCharacters ON CONFLICT 补 type 更新（角色卡路径 'character' 可覆盖名册行）。
- `test/fixtures/sample-book/定稿/设定/名册.md` 类型列改中文；migrate/transform 名册照写中文（现状已对）。
- SKILL.md rosterUpserts 说明 + spec §4 名册条款补「类型」值域（中文词表）。

### R6 别名分隔单源（A5/A13）
staging 的 `splitAliases`（切 `[,，、]`、容 undefined/数组）抽到 `util/aliases.js`；`EntityReader.js:87`、`cache/rebuilder.js:262`、staging 三处共用。A13（名册缺「别名」列 undefined.split 抛错→整次重建 ROLLBACK）由 splitAliases 的 undefined 容错顺带修掉。

### R9 book.yaml 走序列化器（F-1）
`migrate/transform.js:41-48` 手写拼接改 `serializeYAML({ spec_version:'7.0', 书名, 类型, 每章目标字数:3000, 卷规模:40 })`。前置依赖 R7（`[`/`*` 起首书名先由 needsQuoting 兜住）。

### R10 一对多别名降级（F-3 + 决策 D2）
`migrate/transform.js` 名册生成前全实体扫别名：`Map<别名, 首实体>`，重复别名从后续实体剥离，剥离清单写 `迁移待校对-别名歧义.md` + report.待校对。

### R11 表格读写对称（A4/A7/A8/A11）
- `serializers/markdown-table.js`：单元格 `|` → `\|`，换行 → 空格（+warning 语义：表格单元格不含换行）。
- `parsers/markdown-table.js`：识别 `\|` 转义（先占位替换再 split 再还原）；行首为全角 `｜` 时整行归一为 `|`（救"整表全角"场景）；行 cell 多于表头时不再静默截断——保留进行对象（headers 并集），或至少 push warning。
- `EntityWriter.upsertRosterRow`：`rows[idx] = { ...旧行, ...新行 }` 合并（保作者额外列）；serializeMarkdownTable 的 headers 取传入 headers ∪ 行内额外键（额外列追加在尾），全表重写不再丢列。

## 批 3：P2/S 清扫（按模块分组）

**storage/adapters**
- A6：ChapterReader/ThreadLedgerReader 缓存命中路径把行映射回中文键（与文件降级一致，接口形状统一为作者域中文）；read-chapter/read-thread 输出随之稳定。
- A9/C3：`_findThreadFile`（ThreadLedgerReader:213、ThreadLedgerWriter:99）与 SecretReader:115 改有界匹配 `f === id+'.md' || f.startsWith(id+'-')`（与 createThread 同口径）。
- A10/F-7：EntityWriter.updateCharacter / EntityReader 读卡文件名统一过 `sanitizeFileName(name)`；finalize/index.js:93 的角色卡路径改用 EntityWriter 返回的 filePath（消除路径双源）。
- A12：TimelineWriter.appendRow 按（卷,章）替换既有行（重定稿同章不叠行）；迁移路径批量写不受影响（transform 直接 serializeMarkdownTable）。
- A14：删 extractUnknownFields 死代码；A15：删 readRange 死代码；A16：删 book-config 死校验（requiredFields/missingFields）；A17：appendUnderSection `includes` 改精确标题匹配（`^##\s*标题\s*$`）。

**cache**
- B1/B-P2：rebuilder 各 scan 的 parseFrontMatter 失败分支 push warning；readdir 的 catch 收窄为仅 ENOENT 当"目录不存在"。
- B2/B-S：INSERT 完整性错误（UNIQUE）不再吞——冒泡触发外层 ROLLBACK + 人话错误（源有重号该修源）；persist.js:96-99 卷复盘伏笔条目写前做有界查重（同 createThread 口径），撞号返回人话错误。
- B(imagery)：决策 D5，rebuild 加 preserveDerived 参数。

**staging / dto**
- E3：决策 D3（先 meta 后 rm + 幂等重跑 + 循环 try/catch 防裸栈）。
- E4：stageChapter 落盘后的旧目录/工作区清理单独 try/catch，失败记 warning 不改写 ok。
- E5：dto batchDetail——`--until` 后剩余章全为待审收时，建议改为「finalize-batch 转正剩余 X 章」。
- E6：readBatch 重建时目录内三件套全缺 → 状态标「打回」（可 stage-chapter 覆盖恢复）而非死「受影响」。
- E8：弱钩谓词抽 `isWeakHook()`（落 style-stats 或 util），staging×2、book-status、report-weak-hook-streak 四处共用。
- D5 区：readBatch 加 `heal=false` 参数，dto 读路径不落盘自愈；D6：detectors.js:129 待定稿现存判定改用 readBatch().exists 口径。

**state-machine / flows**
- D3 区：决策 D6（TRACKED_SOURCE_PREFIXES 三处同源）。
- D4：retcon 失败回滚收窄为逐文件（记录本次写入集合，对齐 finalize 模式）。
- D7/G-7：determineNextState 章号查询包 try/catch；next.js 非 json 路径 `r.gitHealth?.fixed?.length` 防御。

**migrate / export**
- F-4：短题截断改按码点 `Array.from(s).slice(0,9).join('')`。
- F-5：sweepStaleTmp 只删 mtime 超过 24h 的 `.migrate-tmp-*`（并行进程的活跃 tmp 不误删）。
- F-6：决策 D4（删可写回退）。
- F-8：migrate/index.js:86、read-v6.js:292/305、bin:147、cache/index.js:74（ensureReady）错误文案人话化——中文为主、原始 err.message 括号附注。
- F-9：scanChapters 深层嵌套跳过时 push warning；transform 角色卡类型判定复用 normalizeEntityType（`character` 等英文类型也出卡）。
- F-10：sanitizeFileName 处理 Windows 保留设备名（CON/NUL/PRN/AUX/COM1-9/LPT1-9 → 前置 `_`）。

**bin / docs**
- G-9：bin 命令名白名单 `/^[a-z0-9-]+$/`，不匹配走「未知命令」。
- G-8：--help 删「41 个」硬编码计数。
- G-5：package.json files 白名单加 `docs/`（migration-guide 随 npm 可达），迁移报告尾部指路一句。
- G-6：bin spawn 冒烟测试 ×2——export（scope=book）+ migrate（scope=workdir），验参数解析/exitCode/cache.close。

**spec / 文档（AC4）**
- story-repo-spec：G-3 名册类型值域条款（§4 名册）、E7 批次.json 字段口径改为「章列表（起章/连续计数为派生量）」、E9 附注「停止判据以 front matter 声明为准，宿主须保证 payload 与声明一致」；决策表新增行（spec 0.14）。
- database-guidelines：B-S 事务边界条款——解析失败=跳过+warning；完整性违反=硬错+ROLLBACK。
- SKILL.md：rosterUpserts.类型 值域说明（只写指令，无注释噪音）。

## 兼容性与回滚

- 序列化器改动只影响**写路径**（新写文件引号覆盖变宽）；读路径（js-yaml/parse）不变，存量文件全部照读。表格 `\|` 转义读写同批落地，旧表无 `\|` 不受影响。
- normalizeEntityType 对英文值恒等，存量英文名册/缓存无破坏；缓存下次重建自动归一。
- gitBookCtx 改动可能翻出依赖失真形态的存量断言——逐条按真实形态修正，不回避。
- 回滚点：每批一个 commit，任一批出问题可独立 revert。
