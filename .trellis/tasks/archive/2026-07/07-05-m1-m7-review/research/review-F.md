# Review-F：M7 导出与迁移（export/migrate）

- **审查区**: F 区（v7/src/export、v7/src/migrate、v7/src/commands/{export,migrate}、v7/docs/migration-guide.md）
- **真源**: prd.md（本任务）、archive/2026-07/07-05-m7-export-migrate/design.md、research/v6-data-inventory.md
- **Date**: 2026-07-05
- **方式**: 逐文件精读 + 现场 node 探针复现（探针见下「探针记录」，用真 parser/serializer/rebuilder，非臆断）

---

## 探针记录（已复现，供主会话复核）

**A 组 — book.yaml 手写拼接过真 parser（parseBookConfig=js-yaml）**

| 书名输入 | 手写拼接 `书名: ${t}` 解析结果 |
|---|---|
| `Re:从零开始` / `诡秘之主：序曲` / `我的#笔记` / `我，钢铁侠` | ok（冒号不跟空格、`#`不跟空格、全角冒号都安全） |
| `[快穿]反派` | **解析失败**：bad indentation of a mapping entry |
| `*追读` | **解析失败**：unidentified alias |
| `"引号"书` | **解析失败** |
| `- 开局`（`-`+空格起首） | **解析失败** |
| `诡秘：序曲 篇`（冒号+空格） | 手写=保留但语义危险；serializeYAML=修好 |
| `12345` / `true` | 手写 → 漂移成数字 12345 / 布尔 true（类型错） |

对照：把同样输入过 `serializeYAML`（防呆序列化器）：`诡秘：序曲 篇`/`- 开局`/`12345`/`true` 全部 round-trip 正确；**但 `[快穿]反派`/`*追读` 仍失败**——见 F-2（序列化器本身缺口）。

**B 组 — v6 一对多别名 → transform 名册 → rebuildCache**

两实体 `张三`/`李四` 共享别名「小明」（v6 合法一对多消歧）→ transform 名册产出两行都带「小明」→ `rebuildCache` 返回 `ok=false errors=["别名冲突：「小明」同时指向「张三」和「李四」"]`。migrate index.js 据此 throw → **整迁移回滚**。

**C 组 — 迁移章 front matter round-trip**

`serializeFrontMatter({标题:'[番外]归乡'...})` → `parseFrontMatter` → **ok=false**（bad indentation）；`标题:'*秘辛'` → **ok=false**（alias）；`正常标题`/`危机：降临`（全角冒号）→ ok=true。

**D 组 — 伏笔短题 slice(0,9) 截代理对**

生僻字（U+20000 起，代理对）开头内容 `slice(0,9)` 末字符 = 孤高代理 `U+D840`；emoji 开头 = `U+D83D`。半个代理对进文件名。

**RO-db 探针**：Node 24 下 `new DatabaseSync(dbPath,{readOnly:true})` 写被拦、无 -wal/-journal 残留（主路径干净）；但 `{readonly:true}`（小写）不报错被静默忽略 → 说明未知 option 不校验，回退分支风险成立（F-6）。

---

## 候选清单（[severity] file:line 问题 | 怀疑理由 | 建议探针 | 置信）

**F-1 [P1] transform.js:41-48｜book.yaml 手写模板拼接，书名/类型未过防呆序列化器**
问题：book.yaml 由数组 join 手写（`书名: ${bookName}`、`类型: ${类型}`），值直取 v6 project.title/genre，绕开 serializeYAML。｜怀疑理由：A 组已证——书名以 `[ * " -空格` 起首 → parseBookConfig 失败；纯数字/`true` → 类型漂移。各书内读取皆 `config.ok?…:默认` 优雅降级不崩，但后果=(a)自定义 book.yaml 设置静默回落默认、书名/类型在书内视图变默认；(b)session/index.js:57 scanRebuildBooks 只 push `cfg.ok` 的书 → books.jsonl 一旦扫描重建，这本书从书单消失。design §3.3 本要求「全部文件走防呆序列化器」，此处是唯一例外。｜建议探针：全 migrate（书名`[快穿]反派`）后删 books.jsonl → loadBooks → 观察书消失。｜置信：高（已探针）

**F-2 [P1] storage/serializers/yaml-dialect.js:79-121｜needsQuoting 不覆盖 YAML 指示符起首字符 → 迁移章/角色卡 front matter 解析炸**
问题：needsQuoting 只处理数字/bool/null/含冒号/`#`起首/`-`起首/换行；漏掉以 `[ ] { } * & ! | > @ % 反引号 " '`（及 `?`+空格）起首的串。迁移章 `标题`、角色卡 `姓名`、含此类字符的值 serializeFrontMatter 后读不回。｜怀疑理由：C 组已证。后果=rebuildCache scanChapters `parsed.ok` false → 该章静默不入缓存（migrate 仍报成功）、ChapterReader 读该章失败、export 该章/含该章范围失败、next 章号少计——静默部分内容丢失。根因在共享序列化器，亦波及 finalize 写章，建议与 A 区串审。｜建议探针：已复现（C 组）。｜置信：高（已探针）

**F-3 [P1] read-v6.js:72-77,121-123 + transform.js:113-119｜v6 一对多别名被复制到多实体 → migrate 整体硬失败**
问题：v6 alias_index/aliases 支持一对多（同别名指多实体做消歧，inventory Q2）。read-v6 把该别名加到每个匹配实体，transform 名册各行都列该别名，rebuildCache scanEntities 第二次遇同别名即判「别名冲突」→ ROLLBACK → migrate index.js:69 throw → 整迁移回滚。｜怀疑理由：B 组已证。含歧义别名的合法 v6 项目无法迁移且无绕过 flag；失败虽响亮且干净回滚（不腐坏），但整体阻断功能。｜建议探针：已复现（B 组）。｜置信：高（已探针）

**F-4 [P2] transform.js:87｜伏笔短题 slice(0,9) 截断代理对 → 文件名含孤代理**
问题：`sanitizeFileName(fb.content).slice(0,9)` 按 UTF-16 码元切，前 9 位落在 emoji/生僻字(U+20000+)代理对中间时切出半个代理。｜怀疑理由：D 组已证末字符为孤高代理 U+D840/U+D83D；写文件名时 Node/Windows 编码成 U+FFFD/WTF-8，产损坏或错配名。不崩，属保真/稳健性。｜建议探针：fs.writeFile 该名后 readdir 比对。｜置信：高（已探针）

**F-5 [P2] migrate/index.js:138-148｜sweepStaleTmp 会误删并行 migrate 的临时目录**
问题：sweep 删所有 `.migrate-tmp-*` 前缀，不分 pid。两 migrate 并行同工作目录时，进程2 的 sweep 会 rm 进程1 正在写的 `.migrate-tmp-<pid1>`。｜怀疑理由：进程1 文件被删 → git/rebuild 报错 → 失败回滚。单作者单 CLI 并发罕见但真实。｜建议探针：两 node 进程近乎同时同目录跑 migrate。｜置信：中（逻辑清晰、概率低）

**F-6 [P2] read-v6.js:297-308｜openReadOnly 回退到可写打开 → 违反 design §3.1「源零写入」/AC4**
问题：`{readOnly:true}` 打开失败即 catch 回退 `new DatabaseSync(dbPath)`（可写）。源 db 被锁 / Node 版本不支持 readOnly 时以可写打开源 index.db，遇热日志会触发对源的恢复写入。｜怀疑理由：RO 探针证主路径干净，但回退分支确可写。｜建议探针：构造锁定/损坏 db 触发回退，查源目录 mtime/新增 -journal。｜置信：中

**F-7 [P2] transform.js:66,142,114-119｜角色卡文件名 sanitize 但名册正名/关系用原名 → 缓存实体分裂或覆盖**
问题：角色卡名 `sanitizeFileName(e.name).md`，名册正名列与关系用未净化 e.name。名字含 `<>:"/\|?*` 时：(a)缓存 scanEntities 用原名当 id、scanCharacters 用净化名当 id → 同角色两条实体；(b)两原名净化后相同(`甲:乙`/`甲/乙`→`甲_乙`)→ 后卡覆盖前卡；EntityWriter.updateCharacter 也会文件名与 name 不符找不到卡。｜怀疑理由：逻辑推断，名字含非法字符才触发。｜建议探针：两实体名 `甲:乙`/`甲/乙` 过 transform+rebuildCache 看 entities.id。｜置信：中低（边缘输入）

**F-8 [P2] migrate/index.js:86；read-v6.js:292,305；bin/webnovel-writer.js:147｜报告/输出内插 err.message → 英文/机器码泄漏作者面**
问题：失败信息内插 `${err.message}`，git/fs 错误多英文（ENOENT/EEXIST/git stderr），落进迁移错误行与报告 warning。｜怀疑理由：logging 规范 §1.1 要求全中文人话无堆栈英文；属软违反（已知取舍非崩栈）。｜建议探针：rename 目标被占触发 EEXIST 看文案。｜置信：中（规范对照）

**F-9 [P3] read-v6.js:184-208 + transform.js:122｜卷目录嵌套超一层的章静默漏；自定义/英文实体类型键不出角色卡**
问题：(a)scanChapters 只递归 `正文/第N卷/` 一层，`正文/第N卷/子目录/第NNN章.md` 静默跳过（无 warning）。(b)transform `if (e.type !== '角色') continue` 只给类型恰为「角色」的实体出卡；v6 用英文/自定义类型键(`character`/`组织`)时真角色只进名册不出卡。｜怀疑理由：均非 v6 文档化常见布局；(a)静默无 warning、(b)保真缺口非崩。｜建议探针：造两层嵌套正文 / entities_v3 用 `character` 键。｜置信：中

**F-10 [P3] util/filename.js:2-5｜sanitizeFileName 不处理 Windows 保留设备名（CON/NUL/PRN/AUX/COM1-9/LPT1-9）**
问题：书名/实体名恰为保留名时，migrate 目标目录(index.js:30-31)、角色卡(transform.js:142 → `CON.md`)在 Windows 上创建失败；角色卡写失败 → migrate throw → 整迁移回滚。export 文件名恒有 `第..章-`/`全书-` 前缀，碰撞低。｜怀疑理由：Windows 保留名语义确定，输入边缘。｜建议探针：Windows 上书名/实体名 `CON` 跑 migrate。｜置信：中

---

## Export 侧核对（结论：多为 OK/REFUTED）

- **范围有洞（goto 回退后重号）**：export/index.js:36-39 range/single 命中缺章 → 人话报错并列缺章号 + 提示当前定稿到第几章；`--all` 用 existing 只导已存在章（跳过洞，合理）。**OK**。
- **2000 章全书导出内存**：parts 数组 + 全量 join，~十几 MB 字符串，远低于 V8 上限，顺序读无缓存。**REFUTED（非问题）**。
- **单章文件名 double-sanitize**：title 取自 listFinalizedChapters 的磁盘文件名（已净化），再 sanitize 一次幂等无害。**OK**。
- **--range 参数解析**：`/^(\d+)-(\d+)$/`，非法格式/布尔 flag 均落人话报错；起>止 报错。**OK**。
- **保留名**：export 前缀恒定，风险归 migrate（见 F-10）。

## migration-guide.md 逐条核对

命令 `migrate <v6项目路径> [--dir=<目录名>]`、`--dir` 语义、目录已存在提示、state.json 坏/丢照迁文件面、失败自动回退、丢弃清单（债务台账/向量库）——均与实现一致。**细微**：guide 用 `npx webnovel-writer init` 与裸 `webnovel-writer migrate` 调用风格不一（皆装后可用，cosmetic）；未提示 book.yaml 书名含 YAML 危险字符的注意事项（属 F-1 缺陷，非文档问题）。

## 接力面核对（concern #2，结论：格式基本对得上）

- 迁移时间线表头 `章|书内时间|一句话事件|在场` == TimelineWriter.TIMELINE_HEADERS；`第NN卷.md` pad2 一致。**OK**。
- 迁移名册表头 `正名|别名|类型|首现章` == EntityWriter.ROSTER_HEADERS；upsert 按正名。**OK**。
- 迁移伏笔 fm `强度/状态/开启章/预计收尾/最后推进章` + 正文 `## 描述/## 收尾计划/## 履历` == rebuildCache.scanThreads 与 ThreadLedgerWriter.appendHistory 读取假设；`_findThreadFile('伏笔-001').startsWith` 命中 `伏笔-001-短题.md`。**OK**。
- 迁移章摘要为纯文本无 front matter == SummaryWriter 写法一致。**OK**。
- 唯一接力风险来自 F-2/F-7：若章标题或实体名含 YAML 指示符/非法字符，缓存重建静默漏该章/分裂实体，后续 finalize 对该章的时间线追加/名册 upsert 不受影响，但该章/该实体在缓存视图缺失。

---

## Caveats / 未探针

- F-5/F-6/F-7/F-9/F-10 未跑端到端 migrate 复现（逻辑级判定 + 部分组件探针）；主会话可按「建议探针」补 CLI 复现定 CONFIRMED/PLAUSIBLE。
- 未审 rebuildCache/finalize 全量正确性（属 A/B/C 区）；F-2 根因在共享序列化器，跨区，已注明。
- 真实「满血」v6 项目（含 index.db + .story-system）工作树内无 on-disk 样本，read-v6 的 db 分支仅逻辑级 + B 组最小 db 探针覆盖。
