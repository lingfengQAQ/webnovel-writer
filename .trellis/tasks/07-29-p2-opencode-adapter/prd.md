# P2 OpenCode 宿主适配（F7）

## Goal

把 OpenCode 补进 v7 宿主花名册（tier 1），使其两审跑独立 subagent 而非 `_default`（tier 3）的同上下文自审降级。经核实这是**适配清单遗漏而非能力缺口**（父任务 prd F7 + research 文档 §4 有 tier-1 逐项对照表与活证据）。

## Background

- 现状 registry（`webnovel-host-registry/v2`）只有 claude-code / codex / gemini-cli / cursor / `_default`。
- OpenCode 能力已核实：`.opencode/skills/<name>/SKILL.md` 原生支持；`.opencode/agents/*.md` + `mode: subagent` 独立上下文；会话启动注入走 `.opencode/plugins/` 的 `chat.message` hook（本仓库 Trellis 即活证据）；`opencode` 在 PATH。
- 独有红利：subagent frontmatter 支持 `permission`（如 `edit: deny`）——两审「只读 ReviewInput、不碰文件」可从提示词约束升级为**宿主权限硬约束**。

## Requirements

- [x] **R1**：`adapters/registry.json` 加 `opencode` 条目：tier 1、`agentCapable: true`、`hasHooks: true`、`detect_bin: "opencode"`、`install_dir: ".opencode"`、smoke 沿用 `deferred-beta` 口径（与 claude-code/codex 一致，诚实不夸大）。
- [x] **R2**：`host-shells/generate.js` 渲染 opencode 壳：SKILL 走 `hasHooks:true` 条件块；两审 agents 为 markdown，frontmatter 含 `mode: subagent` + 只读 permission（`edit: deny` 及等值项，以 OpenCode 实际 schema 为准）。（四 deny 键：edit/bash/webfetch/task，均 S0 实测验证；edit:deny 连带消除 write 工具）
- [x] **R3**：installer 支持 opencode 落位：壳文件进 `.opencode/`；会话启动注入写 `.opencode/plugins/webnovel-session.js`（`chat.message` hook 注入书籍状态）；静态部分沿用现有 AGENTS.md 标记块机制（OpenCode 自动加载 AGENTS.md）。manifest 三态与幂等合并沿用现有机制。（安装报告补「重启后生效」提示——OpenCode 配置一次性加载实测）
- [x] **R4**：`adapters/opencode/support.md` 支持核验记录（参照 codex/support.md 形状，写明证据与 smoke 推迟）。（逐项能力 + 验证于 1.18.4 + 三 caveat）
- [x] **R5**：drift check 覆盖 opencode 壳（生成器确定性 + validator）。

## Acceptance Criteria

- [x] `node scripts/build-host-shells.mjs` 产出 `dist/opencode/`，drift check 绿。
- [x] install-e2e 增加 opencode 目标（或至少单测覆盖 detect/落位/manifest 幂等），双平台 CI 绿。（e2e 全过含 opencode 落位+permission+报告断言，输入出经 Python utf8 解码留档至 `install-e2e-output.txt`——win 控制台显示乱码与文件内容无关）
- [x] 渲染出的两审 agent frontmatter 含 `mode: subagent` + 只读 permission；SKILL 条件块按 `agentCapable:true`/`hasHooks:true` 展开（两审派 subagent 段生效、启动段走 hook 注入分支）。（dist 产物逐字验证：SessionStart 注入段在/兼容模式段不在/独立 subagent 段在）
- [x] registry 报告/安装报告如实显示 opencode 支持等级（沿用「直引 registry.verified 不夸大」决策）。（复核整改后 verified 降为诚实口径：`机制实测通过（S0 十六项能力清单）+ 宿主最小 smoke 通过…；完整写章 smoke 推迟 beta`）
- [x] 全量测试绿。（708/708）
- [x] 复核整改（claude review #1-#4）：插件行为自动化测试 8 例（注入/双去重/无 text part/失败 fail-open/形状兼容/`s-nobin`/`s-apidown`）；OpenCode 1.18.4 真产物最小 smoke 四轮全过（skill 发现/插件注入回文/两审派发/PWNED.txt 行为级不存在）；spec v3.12 补 §7.1.1「分级与 smoke 门槛的关系」消除一级/推迟矛盾；UTF-8 留档重生成。

## Non-Goals

- 真模型 smoke（统一 beta 手测门，四宿主同口径）。
- 不碰核心 `src/`（状态机/存储/编排零改动；只动 adapters/host-shells/installer/registry）。

## Notes

- **S0 硬前置（作者指定，2026-07-30）**：kimi 的宿主就是 OpenCode，由 kimi 先按 `research/opencode-capability-checklist.md` 逐条实测（A 探测 / B skills / C agents+permission / D plugins 注入 / E 配置合并 / F 版本线），填实测结果 + 证据原文；claude 复核后按实测定稿 design.md，再进 S1。registry/壳/installer 每个字段都必须指到清单里的一条实测证据。
- plugin 注入若实测有坑，回退方案：AGENTS.md 标记块承载静态指引 + 启动时 SKILL 引导手动 `session-context`（即 `hasHooks:false` 降级），registry 相应改 false——诚实标注优于虚标。
- 工作量参照 codex adapter；分工沿用 kimi 实施 / claude 检查。
