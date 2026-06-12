# v7 spec 修订：story-repo 0.6 + 多宿主 v3.2

> 需求真源：`docs/architecture/v7-prd.md` §10（spec 修订指令清单，作者已确认 1.0）
> 本任务是执行性任务：把 PRD 的 18 条下行指令落进两份 spec，不引入 PRD 之外的新设计。

## Goal

- `story-repo-spec-2026-06-10.md` 0.5 → 0.6：13 条指令（PRD §10.1）
- `multi-agent-adaptation-spec-2026-06-05.md` v3.1 → v3.2：5 条指令（PRD §10.2）

## Requirements

- PRD §10.1 / §10.2 逐条落实；术语表（PRD §8）全文贯彻。
- 决策记录补 0.5→0.6 / v3.1→v3.2 表，逐条指向 PRD ADR。
- 开放问题就地敲定并在交付报告中向作者标明：O2 开关名（候选：自动确认细纲 / 连写批次大小）、O3 灵感池落点（候选：`大纲/灵感池.md`）、O4 精准读取接口初版清单。

## Acceptance Criteria

- [ ] 两份 spec 无任何 PRD §8 废止术语残留（作者可见域）
- [ ] PRD §10 的 18 条指令每条可在 spec 中找到对应落点
- [ ] 决策记录表完整

## Definition of Done

- PR 进 v7 分支，作者 review 合并

## Out of Scope

- 实施计划与代码（spec 定稿后另立任务）
- RFC 裁剪（独立任务）
