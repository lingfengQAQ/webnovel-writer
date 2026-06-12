# 文档中心

`docs/` 目录按功能分区整理，方便查阅。

> 本分支（`v7`）是 v7 的主开发分支：运行时架构推翻重来，文档只保留 v7 规格与仍有效的资产/研究。v6 的全部文档与代码保留在 `master` 分支。

## 目录索引

### 架构（v7 规格）

- [`architecture/v7-prd.md`](./architecture/v7-prd.md)：**v7 产品需求文档（PRD 1.0，产品法律文本）**——作者旅程、功能需求全集、范围切分、发布判据、术语表，含对两份 spec 的修订指令
- [`architecture/story-repo-spec-2026-06-10.md`](./architecture/story-repo-spec-2026-06-10.md)：v7 story repo 格式规格（0.5，冻结已解除，待按 PRD §10 修订为 0.6）
- [`architecture/multi-agent-adaptation-spec-2026-06-05.md`](./architecture/multi-agent-adaptation-spec-2026-06-05.md)：多宿主与多智能体适配 spec（v3.1，待按 PRD §10 修订为 v3.2）
- [`architecture/v7-design-discussion-notes-2026-06-11.md`](./architecture/v7-design-discussion-notes-2026-06-11.md)：v7 设计讨论纪要（v6 病根诊断、问题空间 16 项、多平台调研）
- [`architecture/story-repo-spec-feedback-2026-06-11.md`](./architecture/story-repo-spec-feedback-2026-06-11.md)：另一线对 story repo spec 0.4 的差异意见（已在 0.5 吸收，留档）

### 继承资产

- [`guides/genres.md`](./guides/genres.md)：37 个题材模板与复合题材规则（v7 继承）

### 运维

- [`operations/plugin-release.md`](./operations/plugin-release.md)：插件发版流程与版本同步

### 研究与外部方案

- [`research/long-term-memory-research-report.md`](./research/long-term-memory-research-report.md)：长期记忆论文与开源方案调研
- [`research/storyteller-paper-summary.md`](./research/storyteller-paper-summary.md)：STORYTELLER 论文总结
- [`research/2026-04-14-ui-ux-pro-max-skill-architecture-research.md`](./research/2026-04-14-ui-ux-pro-max-skill-architecture-research.md)：skill 架构调研

## 分类原则

- `architecture/`：v7 规格与设计讨论
- `guides/`：使用者需要查阅的题材说明（v7 实现落地后补命令/配置指南）
- `operations/`：运维与发版
- `research/`：论文总结与外部方案调研
- v6 历史文档：见 `master` 分支的 `docs/`（含 `archive/`）

## 推荐阅读顺序

1. 先看 [`architecture/v7-prd.md`](./architecture/v7-prd.md)——v7 是什么、给谁用、做到什么程度
2. 再看 [`architecture/story-repo-spec-2026-06-10.md`](./architecture/story-repo-spec-2026-06-10.md)——格式层怎么落（注意以 PRD §10 修订指令为准）
3. 想知道为什么这样设计看 [`architecture/v7-design-discussion-notes-2026-06-11.md`](./architecture/v7-design-discussion-notes-2026-06-11.md)
4. 关心多平台支持看 [`architecture/multi-agent-adaptation-spec-2026-06-05.md`](./architecture/multi-agent-adaptation-spec-2026-06-05.md)
