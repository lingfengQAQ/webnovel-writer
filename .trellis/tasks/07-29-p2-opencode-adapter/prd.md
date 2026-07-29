# P2 OpenCode 宿主适配（F7）

## Goal

把 OpenCode 补进 v7 宿主花名册（tier 1），使其两审跑独立 subagent 而非 `_default`（tier 3）的同上下文自审降级。经核实这是**适配清单遗漏而非能力缺口**（父任务 prd F7 + research 文档 §4 有 tier-1 逐项对照表与活证据）。

## Background

- 现状 registry（`webnovel-host-registry/v2`）只有 claude-code / codex / gemini-cli / cursor / `_default`。
- OpenCode 能力已核实：`.opencode/skills/<name>/SKILL.md` 原生支持；`.opencode/agents/*.md` + `mode: subagent` 独立上下文；会话启动注入走 `.opencode/plugins/` 的 `chat.message` hook（本仓库 Trellis 即活证据）；`opencode` 在 PATH。
- 独有红利：subagent frontmatter 支持 `permission`（如 `edit: deny`）——两审「只读 ReviewInput、不碰文件」可从提示词约束升级为**宿主权限硬约束**。

## Requirements

- [ ] **R1**：`adapters/registry.json` 加 `opencode` 条目：tier 1、`agentCapable: true`、`hasHooks: true`、`detect_bin: "opencode"`、`install_dir: ".opencode"`、smoke 沿用 `deferred-beta` 口径（与 claude-code/codex 一致，诚实不夸大）。
- [ ] **R2**：`host-shells/generate.js` 渲染 opencode 壳：SKILL 走 `hasHooks:true` 条件块；两审 agents 为 markdown，frontmatter 含 `mode: subagent` + 只读 permission（`edit: deny` 及等值项，以 OpenCode 实际 schema 为准）。
- [ ] **R3**：installer 支持 opencode 落位：壳文件进 `.opencode/`；会话启动注入写 `.opencode/plugins/webnovel-session.js`（`chat.message` hook 注入书籍状态）；静态部分沿用现有 AGENTS.md 标记块机制（OpenCode 自动加载 AGENTS.md）。manifest 三态与幂等合并沿用现有机制。
- [ ] **R4**：`adapters/opencode/support.md` 支持核验记录（参照 codex/support.md 形状，写明证据与 smoke 推迟）。
- [ ] **R5**：drift check 覆盖 opencode 壳（生成器确定性 + validator）。

## Acceptance Criteria

- [ ] `node scripts/build-host-shells.mjs` 产出 `dist/opencode/`，drift check 绿。
- [ ] install-e2e 增加 opencode 目标（或至少单测覆盖 detect/落位/manifest 幂等），双平台 CI 绿。
- [ ] 渲染出的两审 agent frontmatter 含 `mode: subagent` + 只读 permission；SKILL 条件块按 `agentCapable:true`/`hasHooks:true` 展开（两审派 subagent 段生效、启动段走 hook 注入分支）。
- [ ] registry 报告/安装报告如实显示 opencode 支持等级（沿用「直引 registry.verified 不夸大」决策）。
- [ ] 全量测试绿。

## Non-Goals

- 真模型 smoke（统一 beta 手测门，四宿主同口径）。
- 不碰核心 `src/`（状态机/存储/编排零改动；只动 adapters/host-shells/installer/registry）。

## Notes

- 实施前需用本机 `opencode`（1.18.4 已装）核对 agents frontmatter 的 permission 字段实际 schema——kimi 的对照表基于其宿主经验，落地时以官方文档/实测为准，写进 support.md。
- plugin 注入若实测有坑，回退方案：AGENTS.md 标记块承载静态指引 + 启动时 SKILL 引导手动 `session-context`（即 `hasHooks:false` 降级），registry 相应改 false——诚实标注优于虚标。
- 工作量参照 codex adapter；中等复杂度，design 细节可在实施首步以 spike 形式验证 plugin 机制后再定稿（PRD+本 Notes 即启动依据，design.md 可实施期补）。
