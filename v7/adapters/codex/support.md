# Codex 宿主支持核验

- 官方文档：https://developers.openai.com/codex （skills / agents）
- 核验日期：2026-06-27（结构核验；官方文档复核 + 真模型 smoke 推迟 beta）
- skill：支持，SKILL.md；`description` 受约 8k 字符预算
- subagent：实验性支持，TOML agents
- hook：不支持
- 降级策略：无 hook → 生成的 SKILL 启动步显式运行 `session-context` 注入当前书/书单/近况入口；subagent 实验性 → 两审优先完整，不稳时降级兼容模式并声明
- smoke：`node scripts/smoke.mjs --host codex`（推迟 beta 手测：建书→写1章→两审→定稿）
