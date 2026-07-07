---
name: webnovel-writer
description: 中文长篇网文写作单入口。说「继续/写下一章/建书/回到第N章/吃书」即进状态机，自动判定下一步并走写章流程；事实只经定稿流程入 git。
---
# webnovel-writer

中文长篇网文写作系统的单一入口。能数的交脚本，要判断的交两审，事实只经定稿流程入 git。

## 启动
{{#if hasHooks}}
SessionStart 已注入「当前在写哪本 / 共几本 / 全书近况入口」。
{{/if}}
{{#unless hasHooks}}
启动先运行 `{{cmd}} session-context`，向作者报「当前在写哪本 / 共几本」。
{{/unless}}
换书说一声即可：`{{cmd}} switch-book <书名>`；看书单：`{{cmd}} list-books`。

## 单入口：判定下一步
作者说「继续」，运行 `{{cmd}} next --json`（git 健康检查先行），按返回的 `序` 执行：
- 序0 修复确认：对 `dto.failures` 逐个给「保留作者意图」的修复方案，作者确认后写 `{"repairs":[{"file","content"}]}`，运行 `{{cmd}} persist-repair --file=<json路径>`。
- 序1 建书：问答收集书名、类型、流派、主角、金手指、结局（类型/流派按 `dto.知识路由` 菜单归一）；运行 `{{cmd}} knowledge-pack --类型=<题材> --流派=<a,b>` 取蒸馏材料，与作者逐节对撞（库怎么说 → 作者怎么定）产出题材流派指导（front matter：题材/流派/恩怨清算/来源；四节：骨架约定/差异化点≥3/本书专属毒点/节奏参数），产出 `{"book","总纲","卷纲","题材流派指导"}`，运行 `{{cmd}} persist-book --file=<json路径>`。
- 序2 手改补登：向作者出示 `dto.变更文件` 问「补登吗」，确认后运行 `{{cmd}} relink --message=<一句话说明>`。
- 序3 断点续跑：按 `dto.从哪继续` 回到写章流程对应步骤。
- 序5 体检：按返回的 `message` 指引执行。
- 序4 卷复盘：吃 DTO 与作者对谈，产出 `{"卷号","卷摘要","下卷卷纲","伏笔条目"}`，运行 `{{cmd}} persist-volume-review --file=<json路径>`。
- 序6 起草细纲：吃 DTO 拟细纲提案（本章定位声明 + 本章要写到的事 + 备选；本章提案段内按需从 `dto.节拍索引/钩子清单/场景索引/场景候选` 点选或自定义，写成标签行 `本章节拍：`/`章尾钩子：`/`本章场景：`，皆可空），作者确认后产出 `{"细纲"}`，运行 `{{cmd}} persist-outline --file=<json路径>`。

## 写章流程
1. 备料：`{{cmd}} prepare-chapter <章号>`，读 `工作区/本章写作材料.md` 写草稿到 `工作区/草稿-A.md`。
2. 机检：`{{cmd}} mechanical-check <章号>`，修可计数项后重跑至过线。
3. 两审：`{{cmd}} review-input <章号>` 生成 `工作区/审稿输入.json`。
{{#if agentCapable}}
   派两个独立 subagent 按 `事实审查`、`编辑审` 任务书各读同一份审稿输入，各自新鲜上下文出报告。
{{/if}}
{{#unless agentCapable}}
   兼容模式——按 `事实审查`、`编辑审` 两份任务书顺序自审，`mode` 填 `degraded`。
{{/unless}}
   两份报告合成 `{"事实审查","编辑审","mode","待确认新专名","章摘要"}`，运行 `{{cmd}} save-review <章号> --file=<json路径>`；审稿单落 `工作区/审稿.md`，交作者：接受 / 改完接受 / 打回。
4. 定稿：作者敲定后组定稿包（`frontMatter`、`body`、`summary`、`threadCreates`（本章「埋下/设下/开启」的新条目，`{id, 短题, frontMatter, body}`）、`threadUpdates`、`characterUpdates`、`rosterUpserts`（`类型` 用中文：`角色`/`地点`/`组织`/`物品`）、`timelineRows`、`secretWrites`、`commitLines`、`workspaceFiles`——本章用过的工作区文件全列进 `workspaceFiles`），运行 `{{cmd}} finalize <章号> --payload=<json路径>`，再运行 `{{cmd}} next --json` 进下一步。

## 自动模式（连写，作者说「连写/挂机写一批」才进入）
1. 批内每章走写章流程 1-3；`next --json` 返回 `dto.自动确认细纲 = true` 时细纲提案直接 `{{cmd}} persist-outline` 生效，不问作者。
2. 每章两审 save-review 后不 finalize：组同样的定稿包运行 `{{cmd}} stage-chapter <章号> --payload=<json路径>` 暂存（批内材料/审稿/机检自动叠加「定稿+批内预登记」，后章可用前章事实）。
3. 按 stage-chapter 返回走：停止条件未命中 → `{{cmd}} next --json` 继续下一章；命中（写满/收卷/卷纲耗尽/连续无条目变动/批次质检不过线）→ 停止连写。
4. 停止后运行 `{{cmd}} batch-status` 向作者呈报，按作者裁决执行：
   - 整批接受 → `{{cmd}} finalize-batch`（逐章按序原子入档；`--until=<章号>` 只转正前段）。
   - 改某几章 → 改完重跑两审与 `{{cmd}} stage-chapter` 覆盖，再 finalize-batch。
   - 从第 K 章起打回 → `{{cmd}} batch-reject <K>`；重写 K 后 stage-chapter 覆盖，受影响章重跑两审后 `{{cmd}} batch-restage <章号>`，全部回「待审收」再 finalize-batch。
5. 作者明确说整批不要 → 再次确认后 `{{cmd}} batch-discard`（未入档，定稿零变化）。
6. 中断后作者说「继续」：`next` 序 3 返回 `dto.批次`，按其 `建议` 字段续跑。

## 例外流程
- 回到第N章：`{{cmd}} goto-chapter <章号>`，先备份再回滚。
- 影响分析：`{{cmd}} impact <关键词>`。
- 吃书：按状态机指引改设定与条目，retcon commit。
- 导出发布：`{{cmd}} export <章号>`（或 `--range=起-止` / `--all`），纯正文落 `工作区/导出/`，作者直接粘贴平台。
- v6 迁移：作者说「迁移我的书」→ `{{cmd}} migrate <v6项目路径>`（源只读，失败自动回退）；完成后读 `工作区/迁移报告.md` 向作者报要点，按「待校对」清单引导过一遍。

## 铁律
- 事实变更只经定稿流程入 git。
- 能数的交脚本，要判断的交两审。
- 只吃整理好的 DTO，按提供的上下文工作。
- 传给命令的 JSON 一律先写成文件再走 `--file`/`--payload`（临时 JSON 放 `工作区/`；建书时放工作目录根）。
