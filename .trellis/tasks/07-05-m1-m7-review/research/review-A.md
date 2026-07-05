# Review A 区（存储层）候选清单

- **分区**：`v7/src/storage/{adapters,parsers,serializers,atomic.js}` + `v7/src/util/`
- **日期**：2026-07-05
- **审查员**：Research Agent A（只审不修）
- **格式**：`[severity file:line 一句话问题 | 怀疑理由 | 建议探针 | 置信]`
- **已现场探针**：yaml 方言往返、markdown 表格往返、别名分隔、_findThreadFile 前缀命中、js-yaml 类型强转（脚本未落盘，见各条"探针已跑"）。

统计：**P1 × 6、P2 × 7、S × 4，共 17 条**。其中 6 条已现场复现（CONFIRMED），余为审读推断待主会话探针。

---

## P1（数据丢 / 整文件读失败 / 作者界面漂移）

### 1. [P1] `serializers/yaml-dialect.js:79-121` `needsQuoting` 漏判大量会被 YAML 误判类型的字符串 → 往返损坏
- **怀疑理由**：§4.3 要求"凡可能被 YAML 误判类型的字符串值必须加引号"。现仅覆盖 纯数字/浮点/true-false/null/含冒号/#开头/-开头/换行。漏：空串、前后空格、`0x1F`(hex)、`1e3`(科学计数)、`+5`、`~`、`.inf/.nan`、前导 YAML 指示符 `* & [ { ! ? | > @ %` 反引号 单双引号 逗号。
- **探针已跑（真项目模块 serialize→parse）**：`""→null`、`"  甲  "→"甲"`、`"0x1F"→31`、`"1e3"→1000`、`"+5"→5`、`"~"→null` 全部 DRIFT。空串→null 与空格被裁最普遍（可选 front matter 字段留空即变 null）。
- **建议探针**：对每个可选章/卡字段写空串或前后带空格值，`writeChapter`→`readFrontMatter` 比对；断言 `data.某字段===''`。
- **置信**：高（已复现）。

### 2. [P1] `serializers/yaml-dialect.js:65-71` 双引号分支只转义 `"` 不转义反斜杠 → 触发引号的值含 `\` 时整份 front matter 解析失败
- **怀疑理由**：`value.replace(/"/g,'\\"')` 未处理 `\`。当值同时触发加引号（如含冒号）且含反斜杠（Windows 路径/注释），产出 `"C:\Users\x"`，js-yaml 见 `\U` 当非法转义 → 抛错 → `parseFrontMatter` 整文件 `ok:false`，适配器返回"解析失败"。`\ `（反斜杠+空格）则被静默吞掉。
- **探针已跑**：`"C:\Users\x"` → 序列化 `f: "C:\Users\x"` → parse **PARSEFAIL**(expected hexadecimal character)。同类：值以 `*ptr`/`&a`/`[TBD` 开头 → 分别 PARSEFAIL/→null。
- **建议探针**：角色卡/条目某字段写 `路径:C:\a\b` 或以 `[` `*` 开头的短题，写盘后 `readCharacterFrontMatter` 断言 `ok`。
- **置信**：高（已复现，属整文件读失败，比 #1 更重）。

### 3. [P1] `atomic.js:27-51,60-66` 出错回滚会删掉尚未备份的原文件 → 覆盖写失败即丢原文
- **怀疑理由**：`plan.existed` 仅在 `fs.rename(full→backup)` 成功后(line 33)才置 true。若 `writeFile(tmp)`(line 27) 或 `rename(full→backup)`(line 32) 先失败，`existed` 仍为 false，`restorePlan`(line 64) 走 `fs.rm(plan.final)` 把**从未动过的原文件**删掉。多文件批次里靠后文件失败时，其原文无备份即被删。Windows 触发面：`full+.wnwtmp.pid.n` 超 MAX_PATH 260 → tmp 写 ENAMETOOLONG；或原文件被编辑器/杀软占用 → rename EPERM。消费方 `state-machine/persist.js:100/129`、`review/index.js:254` 会覆盖既有 大纲/细纲 源文件。
- **建议探针**：mock `fs.writeFile` 对第 2 个文件抛错，`writeAtomicBatch(repo,[已存在A,已存在B])`，断言 B 原文仍在；或构造接近 260 字符的 repoPath 触发 tmp 超长。
- **置信**：中（逻辑清晰，需故障注入复现；与 bug 模式 #6/#8 吻合）。

### 4. [P1] `serializers/markdown-table.js:10` 序列化不转义单元格内 `|` 与换行 → 名册/时间线单元格数据丢失
- **怀疑理由**：`String(r[h]??'')` 直接拼进 `| ... |`。值含 `|` 会在读回时被 `split('|')` 切成多格 → 列数不匹配 → 补齐/截断 → 尾部内容丢。含 `\n` 则整表错行。
- **探针已跑**：别名 `"刀疤|老王"` 序列化 `| 甲 | 刀疤|老王 |` → 读回 `别名:"刀疤"`（"老王"丢）。
- **建议探针**：`upsertRosterRow({正名:'甲',别名:'刀疤|老王'})` → `resolveAlias('老王')` 断言命中；应 MISS 复现。
- **置信**：高（已复现）。

### 5. [P1] `adapters/EntityReader.js:87` + `cache/rebuilder.js:262` 别名按 ASCII `,` 拆，`staging/index.js:220` 按 `[,，、]` 拆 → 三源分裂，中文分隔的别名解析失败
- **怀疑理由**：中文作者惯用全角逗号 `，` 或顿号 `、` 分隔别名。EntityReader（文件降级）与 rebuilder（entity_aliases 真源）只切 ASCII 逗号 → 整串当一个别名；resolveAlias MISS、别名唯一性校验漏冲突；而 staging `splitAliases` 三种都切 → 叠加视图与真源对不上（bug 模式 #7 双源 + #6 中文）。migrate 写 `join(', ')`(transform.js:117) 是 ASCII，迁移书暂安全；手改/AI 写的名册中招。
- **探针已跑**：名册 `别名: 阿晚，晚儿、小晚` → `resolveAlias('阿晚'/'晚儿'/'小晚')` 全部 MISS。
- **建议探针**：同上；再删缓存重建后查 `entity_aliases` 表，断言只有 1 行 bogus 别名。
- **置信**：高（已复现）。B 区 rebuilder 同病，接缝一并记。

### 6. [P1] `adapters/ChapterReader.js:19-32` 与 `ThreadLedgerReader.js:19-33` 命中缓存返回英文列名、降级读文件返回中文键 → 精准读接口形状随缓存冷热漂移
- **怀疑理由**：缓存命中 `return rows[0]`（`chapter_num/title/word_count`…英文 snake_case）；文件降级 `return parsed.data`（`章号/标题/字数`…中文）。`read-chapter.js:15/19` 与 `read-thread.js:13/32` 都传 `ctx.cache` 且 `JSON.stringify(r.data)` → 作者/AI 看到的键名随缓存是否命中而变；暖缓存下输出机器味英文列（bug 模式 #10 + #7）。schema.js 列名与 fixture `0001-开局.md` 中文键已证形状不同；现有测试仅覆盖冷缓存路径（`ChapterReader.test.js` 无 cache 实参）。
- **建议探针**：同一 repo，先 `readFrontMatter(1)` 无缓存记键集，再建缓存后重调，断言键集一致；预期出现 `chapter_num` vs `章号` 差异。
- **置信**：高（漂移确凿）/ 中（对 AI 消费的实际危害取决于下游是否读中文键）。

---

## P2（支路错 / 稳健性 / 幂等）

### 7. [P2] `parsers/markdown-table.js:29-36,100-105` 全角管道符 `｜` 表格整表解析失败 → 名册/时间线静默变空
- **怀疑理由**：只认 ASCII `|` 作围栏。作者用中文输入法打出 `｜ 正名 ｜…` 整行不以 ASCII `|` 起止 → 表头判失败 → `ok:false` → resolveAlias/TimelineReader 拿空。
- **探针已跑**：`｜ 正名 ｜ 别名 ｜\n｜---｜---｜\n…` → `parseMarkdownTable.ok=false, rows=0`。
- **建议探针**：写全角管道名册，`resolveAlias` 任意别名断言 MISS 且无报错日志。
- **置信**：高（行为）/ 中（严重度：仅手改触发）。

### 8. [P2] `parsers/markdown-table.js:67-79` 不识别 GFM `\|` 转义、且列数不符时静默截断多余列 → 作者额外列在改写时被丢
- **怀疑理由**：`\|`（GFM 单元格内字面竖线）被当分隔切开；行 cell 多于表头时 `splice(headers.length)` 丢尾列。名册/时间线若被作者加了额外列（如 备注），writer 全表重写会丢。
- **探针已跑**：`| 甲 | a\|b |` → 读回 `别名:"a"`（headers 仍 2）。
- **建议探针**：给名册加第 5 列 `备注`，`upsertRosterRow` 改一行后读回，断言 备注 列还在（预期丢）。
- **置信**：中。

### 9. [P2] `adapters/ThreadLedgerReader.js:213`、`ThreadLedgerWriter.js:99`、`SecretReader.js:115` `startsWith(id)` 无界前缀命中 → 查不存在的短号命中长号条目
- **怀疑理由**：`files.find(f=>f.startsWith(threadId))` 无尾分隔符。查 `伏笔-1`（无此文件）会命中 `伏笔-10-x.md` → 读/改到错条目，`appendHistory` 追到错文件。createThread 去重用 `${idStr}-`（有界，line 41）、_find 用无界（双源不一致 #7）。id 宽度未强制（createThread 只校验 `\S+-\d+`，migrate 补 3 位但 AI/手动可给非补零）。
- **探针已跑**：建 `伏笔-1-断剑.md` 与 `伏笔-10-血书.md`，`_findThreadFile('伏笔-1')` 本次返回正确（因 readdir 序 `伏笔-1-` < `伏笔-10`）；最坏例为**目标不存在、长号存在**时返回长号。
- **建议探针**：只建 `伏笔-10-x.md`，`readBasicInfo('伏笔-1')` 断言应"不存在"，预期错误命中 伏笔-10。
- **置信**：中（机制确凿，危害依赖非补零 id 出现）。

### 10. [P2] `adapters/EntityWriter.js:26` 与 `EntityReader.js:21` 角色卡文件名用未净化 `${name}.md`，`migrate/transform.js:142` 却用 `sanitizeFileName(e.name)` → 名字含可净化字符时 migrate 写的卡 updateCharacter/reader 找不到
- **怀疑理由**：ChapterWriter/ThreadLedgerWriter 都过 `sanitizeFileName`，角色卡读写两处不过（问题 #4 同源）。名字含 Windows 非法字符或前后空格/多空格时，migrate 落盘在净化名、updateCharacter 按原名找 → 返回"角色不存在" → finalize `characterUpdates` 中断。且名字含 `:`/`?` 时 updateCharacter 直接写失败。
- **建议探针**：`migrate` 一个含空格或 `:` 的角色名，随后 `updateCharacter(原名,…)` 断言 `ok`；预期 MISS。
- **置信**：中（触发面窄但确有分裂）。

### 11. [P2] `adapters/EntityWriter.js:58-60` upsert 名册用 `rows[idx]=row` 整行替换 → 丢该行作者额外列
- **怀疑理由**：只带 `正名/别名/类型/首现章` 的新 `row` 覆盖旧整行对象；旧行的额外列（如 备注）随之丢，其它行保留 → 同表内不一致。
- **建议探针**：名册某行带 备注 列，`upsertRosterRow` 同正名后读回该行，断言 备注 保留（预期丢）。
- **置信**：中。

### 12. [P2] `adapters/TimelineWriter.js:41` `appendRow` 恒追加不按 `章` 去重 → finalize 重跑/批次重处理同章 → 时间线重复行累积
- **怀疑理由**：与 `EntityWriter.upsertRosterRow`（按正名去重）相反，无幂等。定稿失败重试或 goto/relink 后重定稿同章会叠行（bug 模式 #2）。
- **建议探针**：同 `volumeNum` 同 `章` 调 `appendRow` 两次，读回断言 1 行（预期 2 行）。
- **置信**：中。

### 13. [P2] `adapters/EntityReader.js:87` `row.别名.split` 在名册缺 `别名` 列时对 undefined 调用 → 抛 JS TypeError 泄漏到作者域
- **怀疑理由**：表头无 别名 列时 `row.别名` 为 undefined，`.split` 抛 `Cannot read properties of undefined`，被 catch 原样回传（line 95）→ 作者看到英文 JS 栈味错误（bug 模式 #10）。
- **建议探针**：名册表头去掉 别名 列，`resolveAlias('x')` 看 error 文案是否为 JS 原生报错。
- **置信**：中。

---

## S（spec 漂移 / 死代码 / 低危稳健性）

### 14. [S] `serializers/front-matter.js:31-69` `extractUnknownFields` 为死代码（无人传第 3 参 `originalYAML`），内含 latent bug
- **怀疑理由**：全部 `serializeFrontMatter(` 调用点（ChapterWriter/EntityWriter/ThreadLedgerWriter/SecretWriter/migrate/staging）都只传两参。§4.5"未知字段保留"实际靠 `{...parsed.data,...updates}` 展开达成（`parseFrontMatter` 把全部键放进 data）。此函数 line 48 `^([^:]+):` 还会把含冒号的已知列表项误判成未知键重复追加——但因死代码未触发。
- **建议探针**：无（记为清理项/latent）。**注**：靠 data 展开保留意味着作者写的**嵌套映射**未知字段会让 `serializeYAML` 抛错（line 20-22）→ updateThread/updateCharacter 返回 ok:false，符合 §4.5"嵌套走修复确认"但错误文案是机器味。
- **置信**：高（死代码确凿）。

### 15. [S] `adapters/ChapterReader.js:127-144` `readRange` 无外部调用者，且默认 `fields=['摘要']` 既不在章 front matter 也不在 chapters 表 → 两条路径都返回空摘要
- **怀疑理由**：全仓 `readRange(` 仅定义处与自身。摘要真源在 `定稿/摘要/章摘要/NNNN.md`（SummaryWriter），front matter 无 摘要 键（见 fixture）。即便有人调，命中缓存/降级都取不到摘要。
- **建议探针**：无（死代码 + 契约错位，记清理/修契约）。
- **置信**：中。

### 16. [S] `parsers/book-config.js:20-22` `requiredFields`/`missingFields` 计算后从不使用 → 死校验；缺必需字段静默套默认
- **怀疑理由**：line 21 算出 missingFields 后无分支消费，恒 `ok:true`。缺 书名 也返回默认"未命名"。若这是有意"永远给默认"，则校验代码应删；若是漏接，则缺字段该报。
- **建议探针**：无（读代码即证）。相关：line 43 `{...defaults,...data}` 会把全部默认灌进返回对象；当前无 BookConfigWriter 回写故不落盘，若日后加 writer 需防默认污染 book.yaml。
- **置信**：高（死校验）/ 低（危害）。

### 17. [S] `util/markdown.js:31-57`/`util/thread-declarations.js:33` 段匹配与声明解析偏脆
- **怀疑理由**：`appendUnderSection` 用 `includes(sectionTitle)` 子串匹配 ## 段——两个标题都含关键词（如"履历"与"补充履历"）会追到先出现的错段；`parseThreadDeclarations` 用 `^(\S+)\s+(\S+)$` 单空格两段式，动词或 id 含空格即判 malformed。均属低频。
- **建议探针**：条目正文放两个含"履历"的 ##，`appendHistory` 看落点；低优先。
- **置信**：低。

---

## 已核对无问题 / 无漂移（缩小复查面）
- `EntityReader.resolveAlias` 返回值两路径一致（缓存 `entity_id` / 文件 `正名` 都是正名），无形状漂移；漂移只在 `readFrontMatter`/`readBasicInfo` 返回整行处（#6）。
- `SecretReader.readBasicInfo` 不走缓存（只 `_findSecretFile` 读文件），无 #6 式中英漂移；但 `_findSecretFile` 有 #9 前缀命中问题。
- `ChapterReader._findChapterFile`(line 156) 与 `ChapterWriter.backupOldChapterFiles`(line 24) 均用 4 位补零 + 尾 `-` 有界前缀，无 #9 式碰撞；章号文件名同源用 `sanitizeFileName`（ChapterWriter:69），与 staging 草稿标题取值同经 `parsed.data.标题`——章文件净化同源，仅角色卡不同源（#10）。
- `2026-07-05`/`yes-no-on-off`/`010`/`1_000` 经 js-yaml 5.2.0 DEFAULT 仍为字符串（`010` 因 `^\d+$` 已被 needsQuoting 引住）——日期/YAML1.1 布尔**不**构成 #1 漏引项，已排除。

## Caveats
- 现场探针脚本用 `node --input-type=module -e` 即时跑，未落盘（遵守"只写 review-A.md"）；主会话复核可复用各条"探针已跑/建议探针"。
- rebuilder.js/staging/index.js/finalize/index.js 属 B/C/E 区，仅在接缝处（别名分隔 #5、名册缺列致整次重建 ROLLBACK 见下）点到即止。
- **接缝附记（B 区）**：`cache/rebuilder.js:262` 名册缺 别名 列时 `undefined.split` 抛错 → line 276 catch 返回 `ok:false` → 整次重建 ROLLBACK；违反 §5.2"名册格式问题应软跳过、只有别名冲突才硬错"。建议 B 区探针：名册去 别名 列后 `rebuildFromSource`，断言 chapters/threads 仍入库、仅 warning。
