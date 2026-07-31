# 实施计划：OpenCode 宿主适配（F7）

前置：v7 分支 4c13f6c 之后；704 测试绿基线。分工沿用：kimi 实施 / claude 检查；**S0 由 kimi 执行**（宿主即 OpenCode，实测零成本——作者指定）。

- [x] **S0 OpenCode 能力实测核验（kimi，硬前置）**：16 条全实测填「实测结果」+ 证据原文。关键裁决点全部落地：C2 permission 实形（**deny = 工具从可见集消失**，两审只读硬约束成立，含 webfetch/task 外溢边界）、D4 hasHooks=true（plugin 注入生产 live evidence，非虚标）。另外抓两坑留档（subagent 不能直跑 / 加载需重启）。产出待 claude 复核（review gate 1 待过）。
- [x] **S1 registry 条目**：`adapters/registry.json` 加 opencode（tier 1 / agentCapable:true / hasHooks:true 按 S0 结论 / detect_bin:"opencode" / install_dir:".opencode" / smoke deferred-beta 同口径）。
- [x] **S2 壳渲染**：`roleToOpenCodeMd` 分形（frontmatter = name/description/mode:subagent/permission 四 deny 键）+ SKILL 条件块按 hasHooks/agentCapable 双真支路（dist 产物逐字验证：SessionStart 注入段在、兼容模式段不在、独立 subagent 段在）+ drift check 纳管。
- [x] **S3 installer 落位**：detect 按 A1 实测 shim 形态（units 测试 no-ext/cmd 双形态断言）→ 壳文件进 `.opencode/`（buildShellFiles 平移零改动）→ 会话注入插件 `templates/opencode-session-hook.js`（chat.message 钩 session-context 输出 prepend 持久化 + 实例/历史双重幂等 + fail-open 总兜底）→ manifest 三态幂等（install.test.js 含幂等重跑断言）→ 报告补「重启后生效」人话提示。
- [x] **S4 `adapters/opencode/support.md`**：逐项能力 + 「验证于 1.18.4（2026-07-30）」+ 版本兼容线历史语义点 + 降级策略 + smoke 推迟 beta 如实标注。
- [x] **S5 测试**：generate 2 例 + installer 2 例（落位/权限/manifest/幂等/重启提示）+ units detect 1 例 + install-e2e 加 opencode 目标（断言落位四文件 + mode/permission 字段 + 报告列名），e2e 本机全过（输出留档 `install-e2e-output.txt`）；全量 708/708 绿。
- [x] **S6 全量回归 + drift 绿 + spec 回填**（multi-agent spec 升 v3.12：registry 示例加 opencode、§7.1 一级清单含 OpenCode 及三特征说明；story-repo 不动——本任务不改书仓格式）+ 提交（待作者确认分层提交）。

Review gates：S0 清单复核（claude）；S6 前 install-e2e 输出贴任务目录。

回滚点：每步独立；S3 installer 若 plugin 路线实测翻车，按 PRD Notes 回退 AGENTS.md 兜底 + registry hasHooks 改 false（不算失败，算诚实收口）。

## 复核整改（2026-07-30，claude review 退回后的四项补证）

- [x] **R1 高优（一级↔smoke 矛盾）**：spec v3.12 新增 §7.1.1「分级（结构/能力就绪度）与 smoke_status（发布门槛）两轴独立」——`deferred-beta` 合法存在；npm 正式发版前 tier 1 必须全转 passed。矛盾在规范层根除。
- [x] **R2 中优（S0 全绿/hasHooks 表述过强 + 插件形态未实测）**：**OpenCode 1.18.4 真产物最小 smoke 四轮全过**：A 插件注入回文引 `「尚未选择当前书…」`、B skill 发现确认、C 事实审查派发+创建 PWNED.txt 行为级失败（`Test-Path=False`）、D 编辑审派发。留档 `research/opencode-real-smoke.md`。措辞已降实（registry.verified / support.md / 父 prd）。
- [x] **R3 中优（插件无行为回归测试）**：`test/host-shells/opencode-session-hook.test.js` 8 例——成功注入/内存去重/历史标记去重/裸数组形状/无 text part/CLI 缺失 fail-open/历史 API 抛错不阻塞/缺 sessionID 早退。
- [x] **R4 低优（e2e 留档乱码）**：改用 Python subprocess utf8 解码重生成 `install-e2e-output.txt`（win 控制台显示乱码与文件内容无关，read 工具验证干净）。全量 716/716 绿 + drift check 绿。
