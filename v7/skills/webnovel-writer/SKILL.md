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
- 序1 建书：问答收集书名、类型、主角、金手指、结局，产出 `{"book","总纲","卷纲"}`，运行 `{{cmd}} persist-book --file=<json路径>`。
- 序2 手改补登 / 序3 断点续跑 / 序5 体检：按返回的 `message` 指引执行。
- 序4 卷复盘：吃 DTO 与作者对谈，产出 `{"卷号","卷摘要","下卷卷纲","伏笔条目"}`，运行 `{{cmd}} persist-volume-review --file=<json路径>`。
- 序6 起草细纲：吃 DTO 拟细纲提案（本章定位声明 + 本章要写到的事 + 备选），作者确认后产出 `{"细纲"}`，运行 `{{cmd}} persist-outline --file=<json路径>`。

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
4. 定稿：作者敲定后组定稿包（`frontMatter`、`body`、`summary`、`threadUpdates`、`characterUpdates`、`rosterUpserts`、`timelineRows`、`secretWrites`、`commitLines`、`workspaceFiles`——本章用过的工作区文件全列进 `workspaceFiles`），运行 `{{cmd}} finalize <章号> --payload=<json路径>`，再运行 `{{cmd}} next --json` 进下一步。

## 例外流程
- 回到第N章：`{{cmd}} goto-chapter <章号>`，先备份再回滚。
- 影响分析：`{{cmd}} impact <关键词>`。
- 吃书：按状态机指引改设定与条目，retcon commit。

## 铁律
- 事实变更只经定稿流程入 git。
- 能数的交脚本，要判断的交两审。
- 只吃整理好的 DTO，按提供的上下文工作。
- 传给命令的 JSON 一律先写成文件再走 `--file`/`--payload`（临时 JSON 放 `工作区/`；建书时放工作目录根）。
