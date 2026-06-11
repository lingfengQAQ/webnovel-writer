# 文档中心

`docs/` 目录按功能分区整理，方便查阅。

## 目录索引

### 架构

- [`architecture/overview.md`](./architecture/overview.md)：系统架构、Agent 分工、Story System 设计
- [`architecture/story-repo-spec-2026-06-10.md`](./architecture/story-repo-spec-2026-06-10.md)：v7 story repo 格式规格（法律文本，0.5 冻结）
- [`architecture/v7-design-discussion-notes-2026-06-11.md`](./architecture/v7-design-discussion-notes-2026-06-11.md)：v7 设计讨论纪要（v6 病根诊断、问题空间、多平台调研）
- [`architecture/story-repo-spec-feedback-2026-06-11.md`](./architecture/story-repo-spec-feedback-2026-06-11.md)：另一线对 story repo spec 0.4 的差异意见（已在 0.5 吸收）
- [`architecture/plugin-runtime-hardening-spec-2026-06-04.md`](./architecture/plugin-runtime-hardening-spec-2026-06-04.md)：基于优秀 Claude Code 插件调研的运行时可靠性重构 spec
- [`architecture/plugin-runtime-hardening-plan-2026-06-04.md`](./architecture/plugin-runtime-hardening-plan-2026-06-04.md)：运行时可靠性重构实施计划、修改范围与影响分析
- [`architecture/multi-agent-adaptation-spec-2026-06-05.md`](./architecture/multi-agent-adaptation-spec-2026-06-05.md)：多宿主与多智能体适配 spec（v3，已反转到 v7 story repo 基线）
- [`architecture/context-minimal-writing-flow-plan-2026-06-05.md`](./architecture/context-minimal-writing-flow-plan-2026-06-05.md)：Skills / Agents / References 上下文减负、读取方式与 token 优化重构计划（v3）
- [`archive/architecture/current-system-diagnosis.md`](./archive/architecture/current-system-diagnosis.md)：历史系统状态诊断

### 使用指南

- [`guides/commands.md`](./guides/commands.md)：Skill 命令与 CLI 子命令速查
- [`guides/rag-and-config.md`](./guides/rag-and-config.md)：RAG 检索链路、环境变量与配置
- [`guides/genres.md`](./guides/genres.md)：37 个题材模板与复合题材规则

### 运维

- [`operations/operations.md`](./operations/operations.md)：项目目录结构、运维命令、备份恢复
- [`operations/plugin-release.md`](./operations/plugin-release.md)：插件发版流程与版本同步

### 记忆系统

- [`memory/long-term-memory-architecture-v2.md`](./memory/long-term-memory-architecture-v2.md)：长期记忆架构说明

### 研究与外部方案

- [`research/long-term-memory-research-report.md`](./research/long-term-memory-research-report.md)：长期记忆论文与开源方案调研
- [`research/storyteller-paper-summary.md`](./research/storyteller-paper-summary.md)：STORYTELLER 论文总结

### 归档

- [`archive/superpowers/README.md`](./archive/superpowers/README.md)：历史架构 spec 与设计文档导航

## 分类原则

- `architecture/`：系统结构与技术架构
- `guides/`：使用者需要查阅的命令、配置、题材说明
- `operations/`：运维、发版、备份与恢复
- `memory/`：长期记忆架构说明
- `research/`：论文总结与外部方案调研
- `archive/`：历史架构快照、spec 与设计计划

## 推荐阅读顺序

1. 先看 [`../README.md`](../README.md) 了解安装与基本使用
2. 再看 [`architecture/overview.md`](./architecture/overview.md) 了解整体架构
3. 需要配置检索时看 [`guides/rag-and-config.md`](./guides/rag-and-config.md)
4. 需要使用命令时看 [`guides/commands.md`](./guides/commands.md)
5. 排查运行问题时看 [`operations/operations.md`](./operations/operations.md)
