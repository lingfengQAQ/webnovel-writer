# M6 自动模式（按批次定稿）：待定稿批次、叠加视图、停止条件、批量定稿

## Goal

自动模式落地为"控制上移到大纲层"的连写流程：批内每章走完写章八阶段的 1-6 步后**不定稿**，草稿/审稿单/预登记数据攒进 `工作区/待定稿/`；写后续章的材料从"定稿 + 待定稿批次"叠加组装（支持批次内依赖）；停止条件命中即停转人工；作者批量过审稿单后**逐章按序原子定稿**。**定稿永远需要作者敲定——没有任何不经作者确认写入定稿区的路径**（PRD §2.3 宪法级）。

对应实施计划 §M6（`docs/architecture/v7-implementation-plan.md:168`），上游依据：`v7-prd.md` §2.3（旅程三）/§4 #14（控制点滑杆）/#15（连写质量漂移）、`story-repo-spec` 0.11 §8.1（自动模式整节）/§7（工作区）/§10 序 3（含待定稿批次）、M5.5 交付的 `runHealthCheck` 结构化 data 与 style-stats（"体检不过线"数据面）。

**里程碑定位**：M5 F1 后主循环全程 CLI 已通，M5.5 体检数据面已备——M6 是最后一块核心功能拼图（其后 M7 导出/migrate → beta）。

## Background（已确认事实）

- **序 3 已探测待定稿**：`detectors.js:129` 待定稿目录非空 → resume「待定稿批次续跑」；但批次结构、明细 dto、续跑指引都是空的。
- **【实施期发现 07-04】新开条目无入档通道（M2 起潜伏缺口）**：`thread-declarations.js:7` 注释称"条目文件由定稿创建"，但 `finalizeChapter` 的 `threadUpdates` 只能 update/appendHistory 既有文件——手动模式「埋下 伏笔-X」定稿后条目文件不存在，下一章「推进 伏笔-X」被机检阻断。既有测试从未串"埋下→定稿→推进"接力所以没炸。M6 批内依赖（AC2）踩在此缝上，作为 P1.0 先修：payload 增 `threadCreates:[{id, frontMatter, body, 短题?}]`（文件格式沿卷复盘伏笔条目先例），手动/批次两模式共用。
- **finalize payload 即预登记形态**：`finalizeChapter(ctx, payload)`（`v7/src/finalize/index.js`）吃 `{frontMatter, body, summary, threadUpdates, characterUpdates, rosterUpserts, timelineRows, secretWrites, commitLines, workspaceFiles}`，原子 commit + 缓存刷新。spec §8.1"预登记数据……定稿时原样转正"可字面实现：暂存的就是 payload。
- **叠加视图的三个消费点**：备料 `prep/index.js`（八组件）、审稿输入 `review/index.js assembleReviewInput`（相关条目/名册/时间线/信息差/近况）、机检 `mechanical-check/index.js`（threads 表查条目声明——staged 新开条目会被误判"不存在"阻断，必须叠加）。三者的数据源=缓存（定稿派生）+源文件。
- **缓存不变量**：`.cache` 只派生自定稿源文件，任何时刻可删重建（backend/database 规范 §2/§2.5）。staged 数据**不得**进缓存表（会破坏"删缓存重建一致"）。
- **体检语义（M5.5）**：`runHealthCheck` 只算定稿正文；fingerprints/meta `imagery_top` 是确定性派生物。批次判定不得把 staged 草稿写进这两处。
- **book.yaml 既有键**：`自动确认细纲: false`、`连写批次大小: 8`（BookConfigReader 有默认值）；`连续弱钩上限: 3`。spec §8.1"连续 3 章（可配）无条目变动"的"可配"尚无键。
- **卷纲**：`大纲/卷纲/第NN卷.md`（OutlineReader.readVolumeOutline）；建书产第一卷卷纲，卷复盘产下卷卷纲。"绝不让模型裸奔编纲"。
- **宿主驱动模型（M4/M5 定式）**：宿主 AI 调 CLI 循环，脚本判定下一步（`next --json` 单入口 + F1 缝命令，JSON 走 `--file`）；SKILL.md 单源渲染三平台壳，drift check 进 CI。
- **章文件命名**：`NNNN-标题.md`（ChapterWriter，标题净化 Windows 非法字符）。待定稿目录名沿用同规则。
- **"整批不要"**：批次是工作区文件（`.gitignore` 含 `工作区/`），未入 git——丢弃=删工作区批次目录；`goto-chapter`（M3）管的是已定稿回退，两者不混。

## Requirements

### A. 待定稿批次结构（spec §8.1/§7）

- A1 `工作区/待定稿/NNNN-标题/` 每章一目录：`草稿.md`（front matter+正文终稿）、`定稿包.json`（完整 finalize payload）、`审稿单.md`（该章两审产物，批量审稿时给作者看）
- A2 `工作区/待定稿/批次.json` 批次元数据：起章、各章 `{章号, 标题, 状态}`（状态 ∈ 待审收/打回/受影响）、连续无条目变动计数；机器域 JSON
- A3 `stage-chapter <章号> --payload=<json>` 暂存一章：校验（章号连续、payload 完整性同 finalize 前置校验）→ 落批次目录（草稿/定稿包从 payload 生成，审稿单从 `工作区/审稿.md` 搬入）→ 清本章工作区单章文件（细纲/材料/草稿/审稿）→ 返回停止条件判定
- A4 断点续跑：批次进行中任何时刻中断，`next` 序 3 能报批次明细（几章已暂存、各章状态、从哪继续）

### B. 叠加视图（支持批次内依赖，RFC 决策 A1）

- B1 staging 读取模块：从批次目录读 staged 事实（新开/推进条目、名册/角色变更、时间线行、信息差写入、staged 章 front matter 与正文），**只读工作区文件，不依赖也不写缓存**
- B2 备料叠加：全书近况（总章数/字数/写到/连续弱钩/悬了太久计入 staged）、时间线片段（+staged 行）、信息差边界（+staged 写入）、近章结尾（staged 末两章草稿尾部优先）
- B3 审稿输入叠加：相关条目（含 staged 新开/推进后的状态）、名册（+staged upsert）、相关角色（角色卡合并 staged 变更）、时间线片段、信息差候选、全书近况——批内第 K+1 章审稿能看到第 K 章预登记事实
- B4 机检叠加：条目声明检查把 staged 条目并入已知集合（K 章「埋下 伏笔-003」后 K+1 章「推进 伏笔-003」不得误判阻断）；新专名/信息差候选并入 staged 名册与秘密
- B5 缓存不变量保持：批次进行中删缓存全量重建，叠加视图输出不变；fingerprints 表与 meta `imagery_top` 永不含 staged 数据

### C. 停止条件四件套（PRD #15，命中即停转人工）

- C1 批次写满：staged 章数 ≥ `连写批次大小`
- C2 卷纲耗尽：下一章所属卷无卷纲文件（绝不裸奔编纲）；staged 章声明 `收卷: 是` 同样终止批次（后续归序 4 卷复盘）
- C3 连续 N 章无条目变动：staged 章 front matter 三数组声明连续为空 ≥ N（`连写无条目变动上限`，book.yaml 新键，默认 3）
- C4 批次质检不过线（"体检不过线"的批次落点）：对 staged 章跑零 token 判据——连续弱钩 ≥ `连续弱钩上限`、缺「书内时间」、句式 vs 基线指纹超容差（复用机检 30%/50% 口径）；判据纯函数化供批内批末复用
- C5 判定内聚：`stage-chapter` 返回与 `batch-status` 都输出「继续 / 停（原因）」；判定零 token 纯脚本

### D. 批量审稿、污染传播与批量定稿（spec §8.1 版本链）

- D1 `batch-status [--json]`：批次明细（各章状态、审稿单要点、停止判定、批次质检结论）——作者批量过稿的呈报数据面
- D2 `batch-reject <章号>`：打回第 K 章 → K 状态=打回，K+1..N 全部标记=受影响（工件保留）；重写 K（重走写章 1-6 步 + `stage-chapter` 覆盖）、受影响章重审（重跑两审 + `save-review` 后经 stage 通道更新回待审收）
- D3 `finalize-batch`：全部章状态=待审收才可执行；按章号升序逐章 `finalizeChapter`（每章独立原子 commit，中途失败停在该章、已入档的保留——"原子性按章保留"）；全部成功后清批次目录；打回章的旧预登记数据不得出现在任何 commit（批内污染不出批次）
- D4 `batch-discard`：整批丢弃——删待定稿目录与批次元数据，定稿零变化，`next` 回到序 6
- D5 作者裁决三形态可走通：整批接受（D3）/ 改某几章（宿主改批次内文件 → 重审 → D3）/ 从某章起打回（D2）

### E. 状态机与宿主接线（PRD #14 开关矩阵）

- E1 序 6 dto 增自动模式提示：`自动确认细纲` 开 → 期望产物注明"提案直接生效不问作者"；连写由作者一句话开启，宿主按批次流走 stage-chapter。两开关全关 = 现行为零变化
- E2 序 3 dto 充实：待定稿存在时带批次明细（A4）
- E3 SKILL.md 增「自动模式（连写）」流程段（批次循环：细纲→写→机检→两审→stage→按返回判停；批末呈报→作者裁决→finalize-batch）；三平台壳重渲染、drift check 绿
- E4 例行体检衔接：批末（finalize-batch 成功尾部）如实提示体检状态；序 5 既有触发不变

## Acceptance Criteria

- [x] AC1 批次端到端：批次大小 3 的书，stage×3（每章草稿/定稿包/审稿单落位、工作区单章文件清干净）→ 停止=写满 → `finalize-batch` → 三个 `ch(N)` commit 按序、条目/时间线/摘要入档与手动模式逐字段一致、批次目录清空 → `next` 报下一章（`test/staging/finalize-batch.test.js` AC1）
- [x] AC2 批次内依赖：第 K 章预登记「埋下 伏笔-X + 名册新角色 + 时间线行」→ 第 K+1 章备料材料含全部三者且近章结尾=K 章草稿尾部；审稿输入相关条目含伏笔-X；机检对「推进 伏笔-X」零误报（`test/staging/overlay.test.js` 三面用例）
- [x] AC3 注入错误恢复演练（PRD #15 验收）：打回第 2 章 → 第 3..N 章自动标记受影响 → `finalize-batch` 拒绝执行并人话说明 → 重写第 2 章重 stage、受影响章重审回待审收 → `finalize-batch` 成功；打回章的旧预登记内容不出现在任何 commit（`test/staging/finalize-batch.test.js` AC3，grep 全部 commit）
- [x] AC4 停止条件四件套各有测试：写满 / 卷纲耗尽（含收卷声明）/ 连续 3 章无条目变动 / 批次质检不过线（弱钩连发、缺书内时间、句式偏离三判据各验）（`test/staging/index.test.js` 停止条件 4 例 + 质检 3 例）
- [x] AC5 开关矩阵（PRD #14 验收）：`自动确认细纲`×连写四组合——全关时既有全量测试零改动仍绿（407 绿，router.test.js 未动）；单开细纲自动确认序 6 dto 有标志；连写走批次通道（序 3 批次明细）；全开端到端即 AC1（`test/state-machine/auto-mode.test.js`）
- [x] AC6 整批丢弃：`batch-discard` 后定稿零变化、工作区干净、`next` 回序 6（`test/staging/finalize-batch.test.js` AC6）
- [x] AC7 缓存不变量：批次进行中删 `.cache` 全量重建，备料/审稿输入/机检叠加输出不变（`test/staging/overlay.test.js`）；`fingerprints` 与 meta `imagery_top` 全程无 staged 数据（finalize-batch.test.js AC1 内断言）
- [x] AC8 全量测试绿 + CI 双平台绿（drift check 含 SKILL 壳重渲染）——本机 407 绿 + drift check 绿；CI run 28732587038 六 job 全绿（ubuntu/windows × node 22.13.0/lts + install-e2e 双平台）

## Out of Scope

- ❌ 真模型连写 smoke（beta 手测门，同 M4/M5 先例）
- ❌ 已发布错误的顺势圆（M3 impact 已有影响分析；顺势圆方案生成是 AI 语义，走既有吃书流程）
- ❌ 批次质检阈值 book.yaml 参数化（复用既有 `连续弱钩上限` 与机检容差常量；新键仅 `连写无条目变动上限`——spec 原文明说"可配"）
- ❌ 批内并行写章（批内依赖决定顺序写；并行是 7.x 优化）
- ❌ 停止条件"体检不过线"之外的例行体检改动（M5.5 语义不动）

## 决策记录（规划期，依据法律文本推导；实施中发现冲突回改本节）

- **D1 宿主驱动、脚本判定**：不新增状态机状态——自动模式=序 6/序 3 的批次感知 + 批次 CLI 五件套（stage-chapter/batch-status/finalize-batch/batch-reject/batch-discard）。依据：PRD §2.3"自动与手动的差异只是确认粒度"、spec §8.1"状态机与八阶段零改动"。
- **D2 定稿包.json 即预登记**：暂存的就是完整 finalize payload，批量定稿逐章原样喂 `finalizeChapter`——"原样转正"字面实现，无第二套入档路径（宪法级"定稿永远经作者敲定"由 finalize-batch 的作者触发保证）。
- **D3 叠加视图=staging 只读模块+三消费点合并，不碰缓存**：缓存永远只派生自定稿（不变量 2/"删缓存重建一致"CI 项）；staged 事实从工作区文件现读，批内章数 ≤ 批次大小，全量读代价可忽略。
- **D4 "体检不过线"落为批次质检纯函数**（含 staged 章），例行体检仍只算定稿：fingerprints/meta 是确定性派生物，staged 草稿可能被打回，入表会破坏重算一致性。批次质检判据=连续弱钩/缺书内时间/句式 vs 基线（全部零 token 可数项，数据面来自 M5.5）。
- **D5 污染传播=批次元数据状态机**：待审收/打回/受影响三态；finalize-batch 只转正"待审收"，存在其他状态即整批拒绝——"批内污染不出批次"由入口硬校验保证，不靠宿主自觉。
- **D6 "整批不要"=删工作区批次**：批次未入 git，丢弃即删文件；`goto-chapter` 保留给已定稿回退，职责不混。
- **D7（实施期 07-04）finalize payload 增 `threadCreates`**：新开条目的入档通道缺失是 M2 起的真缺口（见 Background），修在 `finalizeChapter`（手动/批次共用、同一原子边界与回滚集合），不在 staging 层单修——"事实变更只经定稿流程入 git"不开第二条路。spec §8 第 8 步与 SKILL 定稿包字段随 3.3 回填。

## Open Questions

（无——若实施中发现 spec §8.1 与代码既有约定冲突，先回本节记录再动代码）
