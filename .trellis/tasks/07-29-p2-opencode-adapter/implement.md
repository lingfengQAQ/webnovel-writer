# 实施计划：OpenCode 宿主适配（F7）

前置：v7 分支 4c13f6c 之后；704 测试绿基线。分工沿用：kimi 实施 / claude 检查；**S0 由 kimi 执行**（宿主即 OpenCode，实测零成本——作者指定）。

- [ ] **S0 OpenCode 能力实测核验（kimi，硬前置）**：按 `research/opencode-capability-checklist.md` 逐条实测填「实测结果」+ 证据原文。关键裁决点：C2 permission 实形（两审只读能否宿主硬约束）、D4 hasHooks 结论（plugin 注入可靠性，诚实优先）。产出交 claude 复核（review gate 1），复核通过后 claude 按实测定稿 design.md。
- [ ] **S1 registry 条目**：`adapters/registry.json` 加 opencode（tier 1 / agentCapable / hasHooks 按 S0 结论 / detect_bin / install_dir / smoke deferred-beta 同口径）；registry 相关测试与报告断言同步。
- [ ] **S2 壳渲染**：`host-shells/generate.js` 加 opencode 目标——SKILL 条件块按 S0 的 hasHooks/agentCapable 定值渲染；两审 agents markdown frontmatter 按 C1/C2 实测 schema（mode + permission 实形）；drift check 纳入 opencode 壳。
- [ ] **S3 installer 落位**：detect（A1 实测的探测方式，含 Windows shim 形态）→ 壳文件进 `.opencode/`（E2 清单）→ 会话注入按 D4 结论（plugin 写入 或 AGENTS.md 块兜底）→ manifest 三态 + 幂等合并（E1）。失败路径 fail-open：注入脚本坏不阻塞会话。
- [ ] **S4 `adapters/opencode/support.md`**：参照 codex/support.md 形状；逐能力写「验证于 vX.Y.Z + 证据」（F1）；smoke 推迟 beta 如实标注。
- [ ] **S5 测试**：registry/generate/installer 单测 + install-e2e 增加 opencode 目标（双平台）；渲染产物断言含 mode/permission 字段。
- [ ] **S6 全量回归 + drift 绿 + spec 回填**（multi-agent spec §7 registry 示例/宿主清单同步升版；story-repo 如涉决策补条目）+ 提交（分层：实现+测试一 commit、任务工件一 commit）。

Review gates：S0 清单复核（claude）；S6 前 install-e2e 输出贴任务目录。

回滚点：每步独立；S3 installer 若 plugin 路线实测翻车，按 PRD Notes 回退 AGENTS.md 兜底 + registry hasHooks 改 false（不算失败，算诚实收口）。
