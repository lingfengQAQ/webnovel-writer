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
启动先取会话上下文：读工作目录 `.webnovel/books.jsonl`，报「当前在写哪本 / 共几本」；登记缺失则扫描含 `book.yaml` 的子目录重建书单，请作者选当前书。
{{/unless}}

## 单入口：判定下一步
作者说「继续」，运行 `webnovel-writer next`（git 健康检查先行），按返回的序执行：
- 序0 修复确认 / 序1 建书 / 序4 卷复盘 / 序6 起草细纲：吃返回的 DTO 产结构化产物，交脚本落盘。
- 序2 手改补登 / 序3 断点续跑 / 序5 体检：按返回指引执行。

## 写章流程
1. 备料：`webnovel-writer prepare-chapter <章号>`，读 `工作区/本章写作材料.md` 写草稿到 `工作区/草稿.md`。
2. 机检：`webnovel-writer mechanical-check <章号>`，按清单修可计数项。
3. 两审同一份 ReviewInput：
{{#if agentCapable}}
   完整模式——派两个独立 subagent，分别按 `事实审查`、`编辑审` 任务书审，各自新鲜上下文。
{{/if}}
{{#unless agentCapable}}
   兼容模式——按 `事实审查`、`编辑审` 两份任务书顺序自审；审稿单声明「兼容模式（单上下文顺序审稿），隔离度低于完整两审」。
{{/unless}}
   审稿单落 `工作区/审稿.md`，作者：接受 / 改完接受 / 打回。
4. 定稿：作者敲定后由脚本原子 commit（正文入定稿、条目与设定与时间线更新、章摘要入档、工作区清空）。

## 例外流程
- 回到第N章：`webnovel-writer goto-chapter <章号>`，先备份再回滚。
- 影响分析：`webnovel-writer impact <关键词>`。
- 吃书：按状态机指引改设定与条目，retcon commit。

## 铁律
- 事实变更只经定稿流程入 git。
- 能数的交脚本，要判断的交两审。
- 只吃整理好的 DTO，按提供的上下文工作。
