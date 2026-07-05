# M7 design：干净导出 + /migrate

## 1. 总体结构：两个独立模块，migrate 是一次性脚本不进状态机

```
src/export/index.js          导出纯函数层（读定稿 → 组文本）
src/commands/export.js       薄壳（scope: book）

src/migrate/
  ├─ read-v6.js              v6 归一读取层：双形态 state + index.db + 文件树 → V6Facts
  ├─ transform.js            纯映射层（零 IO）：V6Facts → { files: [{path, content}], report }
  └─ index.js                编排：读取 → 映射 → 临时目录物化 → git 初始 commit → 缓存重建 →
                             rename 落位 → books.jsonl 登记 → 迁移报告落工作区
src/commands/migrate.js      薄壳（scope: workdir，同 init/list-books 先例）
docs/migration-guide.md      迁移指引（v6 用户操作步骤，B6）
```

- 导出与迁移零耦合；两者都不动状态机/写章流程（例外流程命令，SKILL「例外流程」段各加一行）。
- migrate 不复用 v6 Python 代码（v7 零 python 铁律）；v6 语义按 research（`research/v6-data-inventory.md`）的 file:line 证据用 JS 重写，兼容口径以该文件 Q13 十条为准。

## 2. 导出契约（spec §4.7）

- `export <章号>` / `export --range=a-b` / `export --all`：只读**定稿区**（ChapterReader.readBody 已剥 front matter；标题取 readFrontMatter）。
- 落点 `工作区/导出/`（书仓 .gitignore 已含 工作区/，天然不入 git）；重复导出覆盖。
- 文件形态（PRD A2 默认）：
  - 单章 `第0152章-标题.txt`：正文体，无标题行。
  - 范围 `第0006-0012章.txt` / 全书 `全书-<书名>.txt`（书名取 BookConfigReader）：每章「第N章 标题」行 + 空行 + 正文，章间空两行——批量导入工具可按标题行分章。
- 边界：章号不存在/范围含空洞→人话报错并列缺章；定稿区空→人话报错。范围端点自动夹取（a>b 报错）。
- 零 token、同步纯读；不碰缓存（直读文件，章数即使 2000 也只是顺序读）。

## 3. migrate 数据流

### 3.1 read-v6.js → V6Facts（归一层，只读源）

```js
V6Facts = {
  form: 'inline' | 'sqlite' | 'mixed',      // 形态探测结果（报告用）
  project: {title, genre, author},           // project|project_info 双键名兼容
  progress, protagonistState, strandTracker,
  chapters: [{num, title, body, sourcePath}],// 三种命名形态归一（Q13-1）
  entities: [{id, type, name, aliases[], tier, isProtagonist, current{}, desc,
              firstAppearance, lastAppearance}],
  stateChanges: [...], relationships: [...],
  foreshadowing: [{content, status, tier, plantedChapter, targetChapter,
                   resolvedChapter, urgency}],   // 规范化别名（Q13-5）
  activeThreads: [...],                      // plot_threads.active_threads
  chapterMeta: Map<num, {hook, ...}>,        // "0003"|"3" 键归一（Q13-6）
  readingPower: Map<num, {hookType, hookStrength, coolpointPatterns}>,
  summaries: Map<num, {frontMatter, body}>,  // chNNNN.md
  outlines: {master, volumes: [{n, 详细大纲, 时间线, 拆分章纲[]}]},
  settingFiles: [{name, content}],           // 设定集/*.md 原文
  scratchpad: {7桶原文},  patterns: [...],   // 两个独立文件（Q6）
  warnings: [...]                            // 每条容错决定的如实记录
}
```

- **形态探测**：state.json 有 `entities_v3` → inline；有 `_migrated_to_sqlite` 或 index.db 存在 → 读 db（node:sqlite 只读打开）；两边都有 → db 优先、state 内联残留仅补缺（mixed，报告注明）。
- **db 容错**：逐表 `SELECT` 包 try——表/列缺失（Q13-10 增量 schema）按空处理并记 warning，不炸。
- **state.json 空/损坏**（Q13-9）：整体按缺失处理，正文/大纲/设定集纯文件面照迁，报告醒目说明"运行态数据不可读，仅迁移了文件"。
- 源 v6 项目**全程零写入**（AC4 只读断言）。

### 3.2 transform.js → 文件计划（纯函数，逐 §10.3 映射行）

| v6 | v7 产物 | 细则 |
|---|---|---|
| 正文 | `定稿/正文/NNNN-标题.md` | 补 front matter：章号/标题（无标题章名"第N章"）/卷（卷布局取卷号，平坦按详细大纲卷界推断，兜底 1）/字数（现算）/章定位 `迁移`/钩子（chapter_meta.hook 或 reading_power：type+strength→`危机钩-强` 式；无数据省略字段）/情绪定位（无源省略）/`本章要写到的事: ["迁移"]`（映射表明文）；书内时间无源→省略，报告提示体检会列缺锚点属预期 |
| summaries | `定稿/摘要/章摘要/NNNN.md` | 三源优先级：chNNNN.md 剧情摘要节 > chapters 表 summary 列 > 无（报告计数） |
| entities(角色) | `定稿/设定/角色/<正名>.md` + 名册行 | current{}/desc→设定节；protagonist_state 并入主角卡设定节 |
| entities(非角色)+aliases | `定稿/设定/名册.md` | `\| 正名 \| 别名 \| 类型 \| 首现章 \|`；alias_index/aliases 表双源归一 |
| state_changes/relationships | 角色卡「关系」节 + `定稿/设定/迁移待校对-实体变更史.md` | 关系当前值进卡；历史流水不丢字入待校对 |
| foreshadowing | `大纲/伏笔/伏笔-NNN-<短题>.md` | status 未回收→`进行`、已回收→`已收尾`；tier 核心/支线/装饰→强度 高/中/低；planted→开启章+履历首行；target→预计收尾；content→描述；收尾计划缺→`迁移待补`（报告列为建议先看） |
| plot_threads.active_threads | 卷纲尾「迁移的剧情线」节 | 映射表明文"并入卷纲正文（不设条目）" |
| scratchpad.open_loops | `定稿/设定/迁移待校对-记忆清单.md` open_loops 节 | **不并入伏笔条目**（与 foreshadowing 双存，防重复污染账本；作者裁决后手动登记，见权衡 4.1） |
| scratchpad 其余 6 桶 | 同上文件分节 | 每条 MemoryItem 原文格式化，不丢字 |
| patterns(project_memory) | `文风/迁移待校对-文风候选.md` | "人工过一遍再入"：作者过完并入文风铁律后删除该文件 |
| 大纲/总纲.md | `大纲/总纲.md` | 原样 |
| 第N卷-详细大纲.md | `大纲/卷纲/第NN卷.md` | 更名归位；拆分章纲/总纲内联章纲附录并入对应卷纲尾 |
| 第N卷-时间线.md | `定稿/设定/时间线/第NN卷.md` | 表列映射 `章节\|时间\|事件`→`章\|书内时间\|一句话事件\|在场(空)` |
| 设定集/*.md | `定稿/设定/<原名>.md` | 自由 md 原样搬（不强行结构化，不丢字优先）；世界观.md 恰与 v7 同名同位 |
| project/genre | `book.yaml` | title→书名；genre 小码表（xianxia→仙侠 等常见项）映射，未知原值+报告提示；每章目标字数等取 v7 默认 |
| chase_debt/override_contracts/debt_events | 丢弃 | 债务台账 v7 无对应体系；报告如实列计数（Q5 结论） |
| .story-system/、vectors.db、rag.db、projection_log、context_cache、observability、backups、archive、locks | 跳过 | 全部派生可重建（Q8/Q12）；报告列跳过清单 |

- 待校对文件统一 `迁移待校对-` 前缀（可 grep）；报告「建议先看哪」按固定优先级：书名/类型 → 伏笔收尾计划 → 记忆清单 → 文风候选。

### 3.3 index.js 物化与原子性

1. 目标目录名 = 净化书名（ChapterWriter 同源 sanitize），已存在→人话拒绝（`--dir` 可指定）。
2. 工作目录内建临时目录 `.migrate-tmp-<pid>`：写全部文件（防呆序列化器出 front matter）→ `git init` + `.gitignore`（persistCreateBook 先例）→ **单个初始 commit**（`init: 迁移自 v6（原 <路径>）`，即"提交链压成初始 commit"）→ CacheManager 全量重建（同时验证格式自洽——重建器即参考实现）。
3. 全部成功 → 同盘 `rename` 到最终目录 → books.jsonl 登记（M5 写侧）→ 迁移报告写入 `<书>/工作区/迁移报告.md`。
4. 任一步失败 → 删临时目录整树，工作目录零残留（AC4）；源 v6 项目本就只读。

### 3.4 迁移报告（人话）

三节：**迁了什么**（逐映射行计数表：N 章正文、N 条伏笔、N 个角色卡…）｜**待校对清单**（每个 `迁移待校对-` 文件一行 + 建议先看优先级）｜**如实丢弃**（债务台账 N 条、派生库清单、每条 warning）。

## 4. 权衡记录

- 4.1 **open_loops 不自动并入伏笔条目**：foreshadowing 与 scratchpad.open_loops 双存语义相近（research Q4 附注），自动合并会产重复条目污染"悬了太久"账本；宁可待校对区多一步人工。
- 4.2 **摘要三源取最富**（summaries 文件 > db summary 列 > 无）：人写的 summaries 信息最全；research caveat"三处每章元数据重叠"以此定序。
- 4.3 **缺书内时间/情绪定位等字段省略而非编造**：迁移章 front matter 只写有据字段；体检"缺时间锚点"全列属预期，报告先说破——诚实优于好看。
- 4.4 **设定集自由 md 不强行结构化**：主角卡/反派设计等是自由格式，硬拆 front matter 必然臆断；原样搬 + 实体数据另生成角色卡，两者并存交作者收敛。
- 4.5 **临时目录在工作目录内**：保证与最终位置同盘，Windows rename 原子且不跨卷；不用系统 tmp。
- 4.6 **fixture 内建 db**：测试用 node:sqlite 现场建最小 index.db（DDL 摘 research Q3 关键表），不提交二进制文件。

## 5. 回滚与安全

- 导出：纯派生输出，无回滚问题。
- 迁移：源只读 + 临时目录构建 + 失败整删——"整体回退"即"没发生"；成功后不满意=删新书目录（未污染任何既有书）。
- migrate/export 均为新增命令，revert 单 commit 可退，零既有行为变更。
