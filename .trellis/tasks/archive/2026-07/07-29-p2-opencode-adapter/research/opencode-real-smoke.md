# OpenCode 1.18.4 真实 smoke 记录（F7 复核整改）

> 触发：claude 复核意见 #1/#2——「一级宿主 smoke 推迟」与「S0 全绿/hasHooks 非虚标」表述过强，要求补 OpenCode 1.18.4 内的最终安装产物实跑证据。
> 执行：kimi，2026-07-30。环境：OpenCode 1.18.4（npm-global）+ modal/kimi-k3，沙箱 `C:\Users\lcy\AppData\Local\Temp\opencode-tests\smoke`（真 `init --hosts=opencode` 产物装机后真跑宿主）。
> 性质：**安装产物在真实宿主内的端到端跑通**，不是单元测试、不是 Node 层插件探针、不是 agent 自述。

## 实测轮次与证据

### smoke A：插件动态注入（chat.message hook）

命令：`opencode run "...你可见的上下文开头部分（webnovel-writer 插件注入的内容）说了什么？原样引用它的第一行..."`（沙箱内）

宿主回文：

> "尚未选择当前书；共 0 本；请选择要写哪本书。"

——即 `session-context` 真实输出（空书态），**plugin 在 OpenCode 宿主内完成「跑 CLI 取输出 → prepend 进首条消息」链路**（正是评审所谓"未实测的插件形态"缺口，此轮补上）。

### smoke B：skill 发现

同一轮回文：

> "能看到名为 webnovel-writer 的技能（SKILL.md）在可用技能列表里。"

——`.opencode/skills/webnovel-writer/SKILL.md` 被宿主自动发现并加载。

### smoke C：两审 subagent 派发（事实审查）+ permission 行为级验证

命令：`opencode run "...调用 task 工具 subagent_type=事实审查，让它尝试创建 PWNED.txt 并如实报告..."`（沙箱内）

- 宿主日志出现 `测试子代理文件创建 · 事实审查 Agent` 两行（派发真实发生，任务书身份被宿主识别）。
- 子代理回文（转述）：

  > 结论：不能。原因：当前可用工具列表中没有 `write`、`edit`、`bash` 或任何可创建/写入文件的工具；只有 `glob`、`grep`、`read`、`skill` 等只读及技能加载工具。因此无法真正在 …/smoke 创建 `PWNED.txt`。我没有实际创建任何文件。

- **外部行为核验（非自述）**：主代理 `Glob "PWNED.txt" in . · 0 matches`；外层 `Test-Path PWNED.txt` = **False**。permission deny 的工具消失结论从「agent 自述」升级为「写入确未发生」的行为级证据。

### smoke D：两审 subagent 派发（编辑审）

命令：`opencode run "...调用 task 工具 subagent_type=编辑审..."`（沙箱内）

- 宿主日志出现 `确认编辑审身份能力 · 编辑审 Agent` 两行（第二个两审角色同样被宿主识别派发）。
- 子代理回文（转述）：

  > 1. 当前以「编辑审稿员」身份工作。2. 可以读贴在对话里的草稿评估；不主动读文件。3. 不能改文件：环境没有提供写文件/直接修改文件的工具权限。

——两角色派发链全通，只读约束一致。

## 边界与诚实说明（不夸大）

1. **本 smoke 覆盖**：skill 发现、插件动态注入、两审 subagent 派发、permission 行为级生效——对应评审 #1 要求的「至少覆盖」四项，全过。
2. **本 smoke 未覆盖**：完整写章闭环（建书→写1章→两审→定稿）。该门与 claude-code/codex 同口径统一推迟 beta（`smoke_status: deferred-beta`），npm 发版前必过；不在本任务范围。
3. 插件「跨进程幂等」分支（历史标记去重）由 `test/host-shells/opencode-session-hook.test.js` 的 mock 单测覆盖，本实跑未单设场景验证（单次 `opencode run` 新会话只产生一次注入）。
4. 沙箱已按一次性环境处理；本记录与轮次回文为可复核证据。

## 结论调整（relates 评审 #2 措辞裁决）

将 registry.verified 与 support.md 措辞从「S0 清单全绿 / 能力实测通过」******降实******为：

> 机制实测通过（S0 十六项清单）+ 宿主最小 smoke 通过（OpenCode 1.18.4 真跑：skill 发现 / 插件注入 / 两审派发 / permission 行为级）；完整写章 smoke 推迟 beta。

「S0 全绿」「hasHooks 非虚标」不再单用：前者保留为 S0 清单内部判定，对外一律以「实测清单 + 上述 smoke 轮次」为证据链引用。
