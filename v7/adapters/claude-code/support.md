# Claude Code 宿主支持核验

- 官方文档：https://docs.claude.com/en/docs/claude-code （skills / subagents / hooks）
- 核验日期：2026-06-27（结构核验；官方文档复核 + 真模型 smoke 推迟 beta）
- skill：支持，SKILL.md 开放标准，发现路径 `.claude/skills/`
- subagent：支持，`.claude/agents/` markdown + frontmatter
- hook：支持，SessionStart 注入 books.jsonl 上下文
- 降级策略：完整两审（事实审查/编辑审各独立 subagent）
- smoke：`node scripts/smoke.mjs --host claude-code`（推迟 beta 手测：建书→写1章→两审→定稿）
