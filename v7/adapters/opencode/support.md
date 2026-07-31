# OpenCode 宿主支持核验

- 官方文档：https://opencode.ai/docs （config schema https://opencode.ai/config.json）
- 核验日期：2026-07-30（**机制实测**：能力清单 16 条全绿；**宿主最小 smoke**（OpenCode 1.18.4 真跑：skill 发现/插件注入/两审派发/permission 行为级）全过；完整写章 smoke 统一推迟 beta——与全部宿主同口径）
- 实测环境：OpenCode **1.18.4**（Windows 11，npm-global 安装；`.ps1/.cmd/.sh` 三 shim 无 exe——探测按「`opencode --version` 可跑」判在，不按扩展名过滤）
- 证据真源：`.trellis/tasks/07-29-p2-opencode-adapter/research/opencode-capability-checklist.md`（S0 逐条附命令输出/文件原文）+ `research/opencode-real-smoke.md`（宿主真跑四轮证据 + 边界声明）

## 能力逐项

- **skill**：支持。`.opencode/skills/<name>/SKILL.md` 自动发现；frontmatter 必填 `name`（与目录同名）+ `description`；B2 实测 v7 SKILL.md 原样兼容。改动或新增**须重启 opencode**（配置一次性加载，B1 实测）。
- **subagent**：支持。`.opencode/agents/*.md` + `mode: subagent`（C1）；task 工具派发、新鲜上下文（C3 实测：主会话埋标记词，subagent 不可见）、可并行派发（C4 实测）；**`--agent` 直跑拒绝 subagent**（只能被主 agent 派发，C2 实测坑，不影响两审形态）。
- **只读 permission（v7 独有红利）**：agent frontmatter `permission: { edit/bash/webfetch/task: deny }` ——C2 对照实测（agent 自述工具集差集）+ 宿主真跑 smoke C（事实审查创建 PWNED.txt 被拒且文件证不存在，非自述）：deny 键使对应工具**从模型可见工具集整体消失**（强于运行时拒绝）；`edit: deny` 连带消除独立 `write` 工具。两审「只读 ReviewInput、不碰外部」由提示词约束升级为宿主硬约束。保留 read/glob/grep 默认 allow（精读输入用）。
- **hook（会话启动注入）**：支持。`.opencode/plugins/*.js` 自动发现（零配置、无 settings 类合并点——E1 实测 OpenCode 全文件发现制）；`chat.message` 钩可改写首条用户消息并持久化进历史（注入点=首条消息非进程启动瞬间，与 claude-code SessionStart 体验一致）；`webnovel-session.js` 全钩 fail-open（脚本缺失/失败静默）。证据三层：OpenCode/Trellis 同类机制生产 live evidence → Node 层插件行为探针 → **宿主真跑 smoke A 最终安装产物注入**（回文引 `「尚未选择当前书…」` 原文）。
- **兜底**：项目根 `AGENTS.md` 自动注入（D3 实测）；plugin 路线翻车时的降级预案=AGENTS.md 静态指引 + SKILL 引导手动 `session-context`（registry `hasHooks` 相应改 false，诚实收口）。

## 版本兼容线（F1）

- 全部结论验证于 **1.18.4（2026-07-30）**，未滚动跟踪更高版本。
- 已知历史语义点：plugins 自 OpenCode 1.2.x 起须为**工厂函数**导出（`export default async (...) => ({...hooks})`）。
- C2 「工具消失」结论源自 agent 自述工具集对照（非逐工具调用探针），design/实施以此为依据；若需字节级严格性可补调用探针（预期报错/无工具）。

## 降级策略

- 两审派发形态与 claude-code 完全一致（独立 subagent、各自新鲜上下文）。
- 会话注入失败（node 不在 PATH / 脚本报错 / 超时 8s）静默不阻塞会话，作者手动 `session-context` 可补。
- 安装器报告会提示重启生效。

## smoke

`node scripts/smoke.mjs --host opencode`（推迟 beta 手测：建书→写1章→两审 subagent→定稿；真模型链路与 claude-code/codex 同一验证门）

已过最小 smoke（2026-07-30，OpenCode 1.18.4 真跑）：skill 发现 / 插件动态注入 / 两审 subagent 派发 / permission 行为级生效——证据 `../.trellis/tasks/07-29-p2-opencode-adapter/research/opencode-real-smoke.md`。
