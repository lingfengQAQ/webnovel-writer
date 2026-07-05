# M7 导出与 v6 迁移：干净导出、/migrate 一次性脚本、beta 入口

## Goal

v7 最后一个功能里程碑（实施计划 §M7）：作者发布用的**干净导出**（单章/范围/全书，去 front matter）+ v6 老用户的 **/migrate 一次性迁移**（映射表、迁移报告、整体回退）。出口 = 进入 beta（用 v7 真实写一本书到 50 章是 beta 期活动，不在本任务内；`/migrate` ≥3 真实 v6 项目跑通是 7.0.0 判据，beta 期内完成）。

## Background（已确认事实，均有出处）

- **导出定义**（spec 0.12 §4.7）：一键导出去 front matter 纯正文，单章/章范围/全书，落 `工作区/导出/`（不进 git）；发布到起点/番茄用。零 token 脚本。
- **迁移映射表**（PRD 1.2 §10.3 = spec §12，两处一致）：正文/→定稿/正文/（补 front matter，"要写到的事"标"迁移"）；设定集/→定稿/设定/；大纲/→总纲+卷纲；foreshadowing→大纲/伏笔/ 逐条成文件；plot_threads→并入卷纲正文（不设条目）；chase_debt/reading_power→知识层与章属性（不设条目）；.webnovel/state.json→一次性展开进 定稿/设定/；summaries/→定稿/摘要/；project_memory patterns/scratchpad→文风/文风铁律.md（**人工过一遍再入**）；.story-system/ 提交链→压成初始 commit、原目录只读归档；index.db/vectors.db/projection_log→删除。
- **迁移体验底线**（PRD §2.2 旅程二）：迁移不丢任何一个字；v6 的伏笔/剧情线/追读账本全部有去处；失败可整体回退。迁移报告人话列出：迁了什么、哪些条目标了"迁移待校对"、建议先看哪。迁移引导首先处理市场版插件卸载 + npx 重装。
- **v6 数据面关键事实**：v6 5.4 起 `migrate_state_to_sqlite.py` 把 entities_v3/alias_index/state_changes/structured_relationships 迁入 `.webnovel/index.db`，state.json 只留精简键（progress/protagonist_state/strand_tracker/plot_threads/world_settings 骨架等）——**真实 v6 项目的实体真源可能在 db 里**。映射表"index.db 删除"只能理解为"不带入 v7"，/migrate 必须兼容两种形态：老 state.json 全量、新 state.json+db 分置（详细清单见 research/v6-data-inventory.md）。
- **v6 样本**：`webnovel-writer/agents/evals/files/test-project/`（v6 源码在工作树可直接研究）。
- **发布判据关联**（PRD §7 / 实施计划 §4）：7.0.0 = `/migrate` ≥3 真实 v6 项目 + beta 期无数据丢失级 bug + **迁移指引文档齐**。beta = 真写一本书到 50 章（M7 出口后启动，用户手测）。
- **既有可复用件**：ChapterReader（front matter 剥离）、`resolveRunContext`（定位）、writeAtomicBatch（原子写）、git.js（commit 单点）、CacheManager.rebuildFromSource（迁移后建缓存）、persistCreateBook（建书 git init + 初始 commit 先例）、防呆序列化器（迁移产物 front matter 写出）。

## Requirements

### A. 干净导出
- A1 `export` 命令三形态：`export <章号>`（单章）/ `export --range=a-b`（范围）/ `export --all`（全书）；只导**定稿区**正文（工作区草稿/待定稿批次不可发布，宪法级），去 front matter，落 `工作区/导出/`
- A2 文件形态（默认方案，beta 期可按作者反馈调）：`.txt` 纯文本；单章 `第0152章-标题.txt`，正文体不带标题行（发布界面标题另填，文件名已含）；范围/全书合并单文件（`第0006-0012章.txt` / `全书-<书名>.txt`），每章前加「第N章 标题」行 + 空行分隔（批量导入工具可解析）
- A3 边界：范围越界/空定稿区人话报错；重复导出覆盖旧文件（导出是派生物）

### B. /migrate
- B1 `migrate <v6项目路径>` 一次性脚本：按 §10.3 映射表全量迁移，产出 v7 书仓库并登记 books.jsonl；迁移后 `next` 直接可用（衔接主旅程 ④）
- B2 双形态输入：老 state.json 全量 / 5.4+ state.json+index.db 分置，同一映射结果
- B3 迁移报告（人话，落工作区）：迁了什么（逐映射行计数）、"迁移待校对"清单、建议先看哪
- B4 整体回退：任何失败不留半成品（目标目录整体删除或不落地；源 v6 项目**永远只读**）
- B5 不丢字：v6 全部文本内容在 v7 有去处；"人工过一遍再入"类（project_memory patterns/scratchpad、plot_threads 等）落**迁移待校对区**，不静默丢弃
- B6 迁移指引文档（v6 用户操作步骤：卸载市场版 → npx 装 → migrate → 校对清单）

### C. beta 入口
- C1 M7 出口自检：AC 全绿 + CI 双平台绿 → 实施计划 §M7 标注出口达成、进入 beta

## Acceptance Criteria

- [x] AC1 导出三形态：单章/范围/全书各有测试——去 front matter 逐字节断言、文件名与标题行格式、范围边界与空区人话报错、落点 `工作区/导出/`（`test/export/index.test.js` + `test/commands/export.test.js`）
- [x] AC2 migrate 端到端（合成 fixture 覆盖全映射表）：老/新两种 v6 形态各一 fixture → 迁移后 v7 仓库结构合规（章 front matter 补齐且"要写到的事"标"迁移"、伏笔逐条成文件、名册/角色卡、摘要、卷纲）→ `next` 判定进正常写章流程（序 6 起草第 4 章）→ 删缓存重建一致（`test/migrate/` 三文件）
- [x] AC3 不丢字演练：fixture 内每一段 v6 文本在 v7 产物或待校对区可 grep 到（14 类文本逐映射行抽样，`e2e.test.js`）
- [x] AC4 回退演练：注入中途失败 → 目标目录无半成品残留、源 v6 项目未被改动（逐文件指纹断言）；残留临时目录幂等清扫
- [x] AC5 迁移报告内容断言：计数、待校对清单、如实丢弃三节齐；books.jsonl 登记 + 设当前书；目标目录已存在拒绝
- [x] AC6 全量测试绿 + CI 双平台绿（Windows 中文路径含 v6 fixture）——本机 429 绿 + drift 绿；CI run 28736268905 六 job 全绿（ubuntu/windows × node 22.13.0/lts + install-e2e 双平台）
- [x] AC7 迁移指引文档存在且步骤与实现一致（`v7/docs/migration-guide.md`：卸载市场版→npx init→migrate→校对，命令名/参数与实现逐一核对）

## Out of Scope

- ❌ beta 真写 50 章（用户手测活动，M7 出口后启动）
- ❌ /migrate ≥3 真实 v6 项目验证（7.0.0 判据，beta 期内完成；M7 用合成 fixture，用户后续提供真实项目可加手测）
- ❌ npm 真发布与版本号提升（M5 已决策：推迟 beta）
- ❌ vectors.db / projection_log 内容转换（确认为派生物即直接不迁移）
- ❌ v6 市场版插件的卸载自动化（指引文档写清步骤即可，卸载动作归宿主/用户）

## 决策记录（规划期）

- **D1 测试输入=合成 fixture 为主**：从 v6 源码 schema + evals test-project 构造覆盖全映射表的两形态 fixture（老 state.json 全量 / 新 db 分置）；M7 验收不依赖真实数据，真实项目验证按发布判据留 beta 期。（用户暂离未答，采推荐项；若用户提供真实 v6 项目则追加开发期手测，不入库。）
- **D2 导出文件形态采 A2 默认方案**：产品细节低风险可逆，beta 期按作者反馈调整；不为此阻塞规划。
- **D3 M7 纯代码不发版**：M5 已决策 npm 发布/升 7.0.0/README 同步推迟 beta；beta 手测继续用 pack 产物。
- **D4 migrate 读取面兼容 v6 双形态**：5.4 迁移脚本证实实体真源可能在 index.db（`webnovel-writer/scripts/data_modules/migrate_state_to_sqlite.py` 文档串），"index.db 删除"语义修正为"读完不带入 v7"。若与 research 结论冲突，回改本节。

## Open Questions

（无阻塞项——D1/D2 为默认决策，用户可回来推翻；推翻 D1 影响 AC2 输入面，推翻 D2 只改 A2 文案与测试断言。）
