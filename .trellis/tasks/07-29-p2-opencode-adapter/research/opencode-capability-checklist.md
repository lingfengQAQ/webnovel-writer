# S0 核验清单：OpenCode 宿主能力实测（kimi 执行）

> 执行人：kimi（宿主即 OpenCode，实测零成本）。产出写回本文件各条「实测结果」，作为 design.md 定稿的唯一依据——**registry/壳/installer 的每个字段都必须能指到本文件的一条实测证据**，不接受经验性描述。
> 每条附证据方式：命令输出原文 / 配置文件片段 / 官方文档链接（注明版本）。

## A. 基础探测

- [ ] **A1 版本与探测命令**：`opencode --version` 输出原文；`detect_bin` 用 `opencode` 是否在 PATH 稳定可探测（Windows 下是 .ps1/.cmd shim 还是 exe，影响 installer 探测方式）。
  - 实测结果：
- [ ] **A2 安装目录约定**：项目级配置根是否确为 `.opencode/`；是否存在全局目录（如 `~/.config/opencode/`）且项目级优先；大小写/命名有无坑。
  - 实测结果：

## B. Skills（SKILL.md 单入口）

- [ ] **B1 发现规则**：`.opencode/skills/<name>/SKILL.md` 是否为确切约定（目录名=技能名？frontmatter name 优先？）；发现是否自动、需否重启会话。
  - 实测结果：
- [ ] **B2 frontmatter 兼容**：v7 SKILL.md 的 `name`/`description` frontmatter 与条件块渲染产物（`{{#if agentCapable}}` 已渲染定值）能否原样落位；有无 OpenCode 特有必填字段。
  - 实测结果：

## C. Agents / 两审 subagent（agentCapable 判定核心）

- [ ] **C1 agents 目录与 frontmatter 确切 schema**：`.opencode/agents/*.md` 是否现行约定；`mode: subagent` 字段名与取值原文；除 name/description/mode 外的必填项。
  - 实测结果：
- [ ] **C2 permission 字段实形**：只读约束的确切写法（`permission: { edit: deny }`？`tools:` 白名单？两者关系）；对 Bash/网络工具能否 deny；**用一个最小 agent 实测**：给 edit deny 的 subagent 让它尝试写文件，贴拒绝行为原文。
  - 实测结果：
- [ ] **C3 独立上下文核验**：task 工具派发的 subagent 是否新鲜上下文（不继承主会话历史）——两审独立性的根据。实测：主会话塞一个标记词，subagent 内询问是否可见。
  - 实测结果：
- [ ] **C4 并发派发**：能否一次派两个 subagent 并行（两审同时跑）；不能则串行是否可接受（记录，不阻断）。
  - 实测结果：

## D. 会话启动注入（hasHooks 判定核心）

- [ ] **D1 plugins 加载约定**：`.opencode/plugins/*.js` 是否自动发现；模块格式（ESM/CJS）、导出形状、hook 名称原文（`chat.message`？有无更贴切的 session-start 等价 hook）。
  - 实测结果：
- [ ] **D2 注入可行性**：plugin 能否在会话首条消息注入动态内容（书籍状态 = 运行 `webnovel-writer session-context` 的输出）并持久化进历史；注入失败/脚本报错时会话是否仍可用（fail-open 要求）。
  - 实测结果：
- [ ] **D3 AGENTS.md 兜底**：OpenCode 对项目根 AGENTS.md 的自动加载行为（Trellis 本仓库即活证据，确认版本行为一致）；v7 installer 的 AGENTS.md 标记块机制可否直接复用。
  - 实测结果：
- [ ] **D4 hasHooks 结论**：综合 D1-D3 给结论——`hasHooks: true`（plugin 注入可靠）或 `false`（AGENTS.md 静态 + SKILL 引导手动 session-context）。**诚实优先，宁可 false 不虚标**。
  - 实测结果：

## E. 配置合并与卸载面（installer 需要）

- [ ] **E1 项目级配置文件**：`.opencode/` 下有无 settings/config 类文件需要 installer 幂等合并（对应 claude-code 的 settings.json 合并逻辑）；无则记「无需合并」。
  - 实测结果：
- [ ] **E2 文件清单**：完整列出 installer 需落位的文件集（skills/agents/plugins/AGENTS.md 块），与 manifest 三态机制的对接点。
  - 实测结果：

## F. 版本兼容线

- [ ] **F1**：以上各能力的最低可用版本（support.md 需要写「验证于 vX.Y.Z」）；OpenCode 近期有无 breaking 变更预告影响上述约定。
  - 实测结果：

---

## 产出要求

1. 全部条目填「实测结果」+ 证据原文，本文件即 research 留档。
2. 若 C2 permission 实形与 PRD 预期不符（例如无法 deny 写入），在 D4 同款位置给诚实结论——两审仍可跑（提示词约束），只是「权限硬约束」红利降级，registry 备注如实写。
3. 完成后交 claude 复核，随后由 claude 按实测结果定稿 design.md，再进 S1 实施。
