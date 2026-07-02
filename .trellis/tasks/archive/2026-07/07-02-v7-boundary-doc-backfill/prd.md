# v7 边界回顾文档回填：格式裁决与里程碑认领

> 来源：2026-07-02 设计边界回顾（对话裁决，作者已逐项确认）。13 项发现中的文档类修订全部归本任务；代码类修订归后续「边界收口」任务，以本任务落定的文本为依据。

## Goal

把边界回顾中拍板的裁决写进四份法律/规划文本（story-repo-spec、v7-prd、multi-agent-spec、实施计划）与 backend 规范，消除"法律文本 ↔ 参考实现"漂移中**该改文档的一侧**，并给无主事项（体检、F1 CLI 缝）指定宿主里程碑。

## Requirements

### A. `docs/architecture/story-repo-spec-2026-06-10.md`（0.8 → 0.9）

- A1 §3 book.yaml 增字段 `体检周期: 50`（注释口径：手动模式每 N 章体检；连写时体检随批次）。现状代码已读此字段（`state-machine/index.js`），属规范缺位。
- A2 **收卷声明制**（消解"卷末章如何判定"的规范真空，替代代码现行的 `章号 % 卷规模` 整除启发式）：
  - §4.1 章 front matter 增可选字段 `收卷: 是`（仅卷末章写；由定稿步骤写出）。
  - §7 细纲"本章提案"段说明：AI 可依据卷纲进度与卷规模参考值提议收卷，作者确认细纲即生效。
  - §10 序 4 判定改为"最新定稿章声明了收卷 → 卷复盘"；明确 `卷规模` 仅用于全书近况提示与 AI 提议参考，不参与状态机判定。
- A3 §10 序 0 钉死"源文件"清单：定稿/正文、三类条目、角色卡、信息差 的 front matter + `book.yaml` + 文风铁律 front matter + 名册表 + 时间线表。超出清单的文件不属序 0 扫描范围。
- A4 §10 序 3：`细纲.md` 计入"未完成流程"；补续跑映射表——仅细纲 → 出示细纲请作者过目后备料；+写作材料 → 写稿；+草稿 → 机检/两审；+审稿 → 等作者裁决。
- A5 §11 表清单五张 → 六张（补 `entity_aliases`），与 `cache-design-2026-06-26.md`、backend `database-guidelines.md` §2.4 对齐。
- A6 §2.2 依赖口径改为：**运行时直接依赖仅 `js-yaml`**（YAML 解析；序列化手写防呆；决策记录：M1 任务 design §8.1），其余零依赖，缓存用内置 `node:sqlite`。
- A7 §14 决策记录补 0.8 → 0.9 表（来源：2026-07-02 边界回顾），每条注明落点小节。
- A8 版本头与变更摘要更新为 0.9。

### B. `docs/architecture/v7-prd.md`（1.0 → 1.1）

- B1 §5 非功能需求"零第三方依赖（`node:sqlite`）"改为与 A6 同口径。
- B2 文档头标注 1.1 修订（日期 + 一句修订说明），其余内容不动。

### C. `docs/architecture/multi-agent-adaptation-spec-2026-06-05.md`（v3.4 → v3.5）

- C1 §6.1 目录图 `roles/` 由三审（读者审/编辑审/设定校对）改为两审（事实审查/编辑审），与 §5.4 及 `v7/roles/` 实态一致。
- C2 版本头更新 v3.5。

### D. `.trellis/spec/backend/`

- D1 `quality-guidelines.md` §1.1 补"现行唯一例外：`js-yaml`（解析用；序列化手写），已经 PRD 1.1 修订确认"。
- D2 `directory-structure.md` §3.2 同步同一口径。

### E. `docs/architecture/v7-implementation-plan.md`

- E1 新增**体检里程碑**（编号 M5.5，位于 M5 与 M6 之间，可与 M5 并行）：跨章高频意象统计、句式体检（句长方差/段落分布/高频开头）、文体指纹提取与基线对比（激活 `report-style-drift`）、状态机序 5 接通、备料"反复读清单"接通（吃高频意象 top-N）。出口判据：PRD §4 #9/#11 的验收方式可跑。注明硬依赖：**M6 停止条件"体检不过线"依赖本里程碑**。
- E2 M5 范围补 **F1 CLI 缝清单**：`next --json`（输出完整 DTO；人读 message 保留）、`review-input <章号>`、`save-review <章号> --file=`、`persist-outline` / `persist-book` / `persist-volume-review` / `persist-repair`、`finalize <章号> --payload=`。JSON 一律走 `--file` 不走 stdin（Windows 中文管道编码雷区）。注明"next 不输出 DTO"属 F1 范围。
- E3 §0 现状盘点补一行：2026-07-02 边界回顾 13 项——文档侧本任务收口，代码侧另立「边界收口」任务（M5 前置）。

## Constraints

- 全中文；作者界面词汇遵守 PRD §8 命名四原则，不引入新机器味。
- 每处修订标注决策出处（2026-07-02 边界回顾）。
- 收卷声明制是**补未定义机制**（spec §10 原文"刚定稿的章是卷末章"未定义判定方式），不推翻 RFC 公示结论。
- 不动任何代码与测试（`v7/` 目录零改动）；不动 README。

## Acceptance Criteria

- [x] AC1 五组文件（A–E）逐项修订到位，版本号与变更记录同步更新。
- [x] AC2 收卷声明制在 spec 内自洽：§4.1 字段、§7 细纲、§10 序 4 三处口径一致、互相引用。
- [x] AC3 js-yaml 口径三处（story-spec §2.2 / PRD §5 / backend §1.1+§3.2）同口径："运行时直接依赖仅 js-yaml"。
- [x] AC4 spec §11 表清单与 cache-design、database-guidelines 一致（六表）。
- [x] AC5 `git diff --stat` 确认改动仅落在 `docs/architecture/` 与 `.trellis/spec/backend/`。

## Out of Scope

- 全部代码改动（格式对齐、状态机判定、机检/备料/ReviewInput 补料）→ 后续「边界收口」任务。
- 体检本身与 F1 CLI 命令的实现（分别归 M5.5 / M5）。
