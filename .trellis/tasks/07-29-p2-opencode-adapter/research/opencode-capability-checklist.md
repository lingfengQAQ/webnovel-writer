# S0 核验清单：OpenCode 宿主能力实测（kimi 执行）

> 执行人：kimi（宿主即 OpenCode，实测零成本）。产出写回本文件各条「实测结果」，作为 design.md 定稿的唯一依据——**registry/壳/installer 的每个字段都必须能指到本文件的一条实测证据**，不接受经验性描述。
> 每条附证据方式：命令输出原文 / 配置文件片段 / 官方文档链接（注明版本）。

**实测环境**：OpenCode 1.18.4（Windows 11，npm-global 安装），会话宿主 modal/kimi-k3；实测日期 2026-07-30。隔离测试仓：`C:\Users\lcy\AppData\Local\Temp\opencode-tests\ro-probe`（全新初始化，与本仓库无配置继承关系）。

## A. 基础探测

- [x] **A1 版本与探测命令**：`opencode --version` 输出原文；`detect_bin` 用 `opencode` 是否在 PATH 稳定可探测（Windows 下是 .ps1/.cmd shim 还是 exe，影响 installer 探测方式）。
  - 实测结果：**可用，无 exe，三 shim 并存**。`opencode --version` 原文输出 `1.18.4`。`(Get-Command opencode).CommandType` = `ExternalScript`，`(Get-Command opencode).Source` = `C:\Users\lcy\.npm-global\opencode.ps1`。`$HOME\.npm-global` 下并存三份 shim：`opencode`（610B，bash 脚本）、`opencode.cmd`（148B）、`opencode.ps1`（496B）。`npm config get prefix` = `C:\Users\lcy\.npm-global`（空输出时即默认前缀）。
  - 结论：`detect_bin: "opencode"` 在 PATH 稳定可探测；Windows 下探测到的是 **shim 而非 exe**——installer 探测方式应对 shim 也成立（exec `opencode --version` 成功即判在，不要按扩展名过滤）。
- [x] **A2 安装目录约定**：项目级配置根是否确为 `.opencode/`；是否存在全局目录（如 `~/.config/opencode/`）且项目级优先；大小写/命名有无坑。
  - 实测结果：**项目级=`.opencode/`，全局级=`~/.config/opencode/`，项目优先 deep-merge**（官方 config schema 结论："Configs from each scope are deep-merged. Project overrides global."）。本仓库 `.opencode/` 实含 `skills/ agents/ plugins/ commands/ lib/ node_modules/ package.json .gitignore`；`Test-Path .opencode/opencode.json` = False（配置文件可选，发现制文件不依赖它）。全局 `~/.config/opencode/opencode.json` 存在（含 provider 配置，已脱敏核实可读）。
  - 结论：installer 落位面对 `.opencode/` 下的**文件发现制**目录（skills/agents/plugins/commands），**无需任何 JSON 配置合并**（对应 claude-code 的 settings.json 合并在 OpenCode 侧无对应物）。

## B. Skills（SKILL.md 单入口）

- [x] **B1 发现规则**：`.opencode/skills/<name>/SKILL.md` 是否为确切约定（目录名=技能名？frontmatter name 优先？）；发现是否自动、需否重启会话。
  - 实测结果：**`.opencode/skills/<name>/SKILL.md` 是确切约定，自动发现，添加/修改需重启 opencode**。本会话（本仓库）`available_skills` 实列 9 个 trellis-* 技能，全部来自 `.opencode/skills/trellis-*/SKILL.md`，无手工注册步骤。官方约定：目录名与 frontmatter `name` 必须一致（"matches the folder name"）、小写连字符 ≤64 字符；全局路径还有 `~/.config/opencode/skills/`、外部自动扫描 `~/.claude/skills/` 与 `~/.agents/skills/`（本会话 ima-skill、find-skills、ui-ux-pro-max 等即来自外部扫描）。加载时机："config is loaded once when opencode starts and is not hot-reloaded"——installer 落位后须提示用户重启。
  - 实测结果（附带）：`~/.agents/skills/` 与 `~/.claude/skills/` 的自动挂载可用环境变量关闭（`OPENCODE_DISABLE_EXTERNAL_SKILLS=1` 等）——与本任务无关但记录在案。
- [x] **B2 frontmatter 兼容**：v7 SKILL.md 的 `name`/`description` frontmatter 与条件块渲染产物（`{{#if agentCapable}}` 已渲染定值）能否原样落位；有无 OpenCode 特有必填字段。
  - 实测结果：**兼容**。OpenCode skill frontmatter 必填=`name`（小写连字符 ≤64、与目录同名）、实际必需=`description`（无 description 的技能会被过滤掉永不上架）；可选 `license/compatibility/metadata`。v7 SKILL.md 现含 `name: webnovel-writer`、`description: ……`，完全命中。`{{#if}}`/`{{#unless}}` 条件块是 **v7 自家生成器**（`host-shells/generate.js`）的模板语法，构建时渲染成纯静态 markdown 后落位，OpenCode 不感知模板语法——渲染产物无兼容问题。无 OpenCode 特有必填字段。

## C. Agents / 两审 subagent（agentCapable 判定核心）

- [x] **C1 agents 目录与 frontmatter 确切 schema**：`.opencode/agents/*.md` 是否现行约定；`mode: subagent` 字段名与取值原文；除 name/description/mode 外的必填项。
  - 实测结果：**现行约定**。本仓库 `.opencode/agents/` 实存 `trellis-check.md / trellis-implement.md / trellis-research.md`，本会话可经 task 工具按 `trellis-implement` 等名派发。frontmatter 合法键全集（官方 schema）：`name, model, variant, description, mode, hidden, color, steps, options, permission, disable, temperature, top_p`；**mode 取值 `primary | subagent | all`**；body 即 agent prompt（不要在 frontmatter 写 `prompt:`）；**无额外必填**（description 建议有，name 缺省取文件名）。trellis-implement.md 原文实证：`mode: subagent` + `permission:` 键。
- [x] **C2 permission 字段实形**：只读约束的确切写法（`permission: { edit: deny }`？`tools:` 白名单？两者关系）；对 Bash/网络工具能否 deny；**用一个最小 agent 实测**：给 edit deny 的 subagent 让它尝试写文件，贴拒绝行为原文。
  - 实测结果：**写法 `permission: { <tool>: allow|ask|deny }`（键=已知工具名，值=动作；也支持 pattern 表）**。隔离实仓最小 agent（`.opencode/agents/readonly-probe.md`，`mode: all` 仅为可被 `--agent` 直跑；frontmatter `permission: { edit: deny, bash: deny }`）与对照组（无 permission）实测：
    - 对照组（control-probe）自述工具集：`todowrite, read, write, edit, glob, grep, bash, webfetch, skill, task`。
    - 只读探针（readonly-probe）自述工具集：`glob, grep, read, skill, task, todowrite, webfetch`——**write/edit/bash 三个工具从可用工具列表中整体消失**，agent 原文："没有 write、edit、create 之类的函数……不是一条被权限拦截后返回的错误，而是工具本身不可用"。
    - 结论：permission deny 是**比运行时拒绝更强的约束——工具直接不注册进模型可见集**（模型连调用入口都看不到）。奖励级证据：C2 红利成立。
  - 实测结果（边界，design 定稿必须消化）：
    1. `edit: deny` 连带消除了独立 `write` 工具（工具集里 write/edit 同时消失）。
    2. 只读探针仍保有 **`webfetch`（可联网）与 `task`（可再派发）**——两审「只读输入、不碰外部」若要闭环，permission 还应含 `webfetch: deny`、`task: deny`（两者都是合法 permission 键；已知键全集：`read, edit, glob, grep, list, bash, task, external_directory, todowrite, question, webfetch, websearch, lsp, doom_loop, skill`）。`skill` 键不属于 known keys——可用性未验证，design 中两审 permission 只写已验证过的键。
  - 实测结果（坑）：`opencode run --agent <name>` **不能直接跑 `mode: subagent` 的 agent**（报 `agent "readonly-probe" is a subagent, not a primary agent. Falling back to default agent`）；subagent 只能由主 agent 经 task 工具派发——这恰是两审所需形态，不阻断。
- [x] **C3 独立上下文核验**：task 工具派发的 subagent 是否新鲜上下文（不继承主会话历史）——两审独立性的根据。实测：主会话塞一个标记词，subagent 内询问是否可见。
  - 实测结果：**新鲜上下文确认**。主会话先前轮次植入标记词 `ZORPA_MAGENTA_8834`（故意无意义、全大写、唯一形态）；随后向 explore subagent 派发不含该词的探针提问（不向它提供标记词本身），要求它原样引用对话上下文中任何该形态标记词。subagent 回答："上下文中没有此类标记。"——主会话历史对它不可见。
  - 实测结果（伴随事实，两审需知晓）：subagent 仍收到 **Trellis SessionStart 注入**（其回答开头自述" Trellis SessionStart 上下文已加载"）——注入的是项目工作流上下文（经 `inject-subagent-context.js`），不是主会话对话史。v7 两审在 Trellis 仓库内运行时同样会携带项目 SessionStart，角色提示词对此无冲突。
- [x] **C4 并发派发**：能否一次派两个 subagent 并行（两审同时跑）；不能则串行是否可接受（记录，不阻断）。
  - 实测结果：**可并发**。本会话早前同一消息内一次派发 3 个 explore subagent（架构/代码质量安全/交互文档三个），全部并行返回结果——两审并行形态实证可用。

## D. 会话启动注入（hasHooks 判定核心）

- [x] **D1 plugins 加载约定**：`.opencode/plugins/*.js` 是否自动发现；模块格式（ESM/CJS）、导出形状、hook 名称原文（`chat.message`？有无更贴切的 session-start 等价 hook）。
  - 实测结果：**`.opencode/plugin(s)/*.ts|js` 自动发现，无需任何配置登记**（官方 + 本仓库实证：`.opencode/plugins/` 下 `session-start.js / inject-subagent-context.js / inject-workflow-state.js` 三个均无登记在跑）。模块=ESM，导出=工厂函数 `export default async ({ directory, client, project, $ }) => ({ ...hooks })`（OpenCode 1.2.x 起要求 factory function，见 session-start.js 注释）。hook 名称含 `chat.message`（首条用户消息可改写入历史并持久化）、`event`（全事件总线，含 `session.compacted` 等）、`tool.execute.before/after`、`config`、`shell.env` 等。本任务的「会话启动注入」最贴切挂点就是 **chat.message**（Trellis 现行做法，久经考验）。
- [x] **D2 注入可行性**：plugin 能否在会话首条消息注入动态内容（书籍状态 = 运行 `webnovel-writer session-context` 的输出）并持久化进历史；注入失败/脚本报错时会话是否仍可用（fail-open 要求）。
  - 实测结果：**可行且 fail-open 已被生产验证**。本仓库 `session-start.js` 于每次会话首条用户消息运行，把 `buildSessionContext()`（含运行期动态判定）前置进消息 text part 并 `markContextInjected` 持久化（后续轮次经 `hasPersistedInjectedContext` 跳过重注入）。失败面：整个钩体裹 try/catch + debugLog，异常吞掉不影响会话；动态内容构建同理带兜底。本会话开头的 workflow-state/SessionStart 注入块即其运行产物（live evidence）。plugin 入参含 `$`（shell），`session-context` 这类「跑一次 CLI 取输出再注入」的形态可直接经 `$` 或 `node:child_process` 实现。
- [x] **D3 AGENTS.md 兜底**：OpenCode 对项目根 AGENTS.md 的自动加载行为（Trellis 本仓库即活证据，确认版本行为一致）；v7 installer 的 AGENTS.md 标记块机制可否直接复用。
  - 实测结果：**项目根 `AGENTS.md` 自动注入系统上下文**（本会话系统提示内即含本仓库 AGENTS.md 全文 + `<!-- TRELLIS:START/END -->` 标记块）。v7 installer 的 `templates/AGENTS.md` 标记块机制（块内归安装器、块外归用户）可原样复用；作为 plugin 路线的伴随面（静态指引），不作为替代——D4 结论已支持 plugin 路线。
- [x] **D4 hasHooks 结论**：综合 D1-D3 给结论——`hasHooks: true`（plugin 注入可靠）或 `false`（AGENTS.md 静态 + SKILL 引导手动 session-context）。**诚实优先，宁可 false 不虚标**。
  - 实测结果：**`hasHooks: true` 成立**。理由：D1 自动发现免配置、D2 注入+持久化+fail-open 已在本仓库生产运行（唯一 caveat：注入点是「会话首条用户消息」而非进程启动瞬间，对 session-context 语义无影响——作者看到的效果与 claude-code SessionStart 一致）。非虚标依据：以上全部为本会话/本仓库 live evidence + 一次隔离实仓运行。

## E. 配置合并与卸载面（installer 需要）

- [x] **E1 项目级配置文件**：`.opencode/` 下有无 settings/config 类文件需要 installer 幂等合并（对应 claude-code 的 settings.json 合并逻辑）；无则记「无需合并」。
  - 实测结果：**无需合并**。OpenCode 的 skills/agents/plugins/commands 全是**文件发现制**，installer 只需写文件；配置文件本身可选（`opencode.json` / `opencode.jsonc` / `.opencode/opencode.json` 三种形态，本仓库一个都不存在）。若用户已有自己的 opencode.json，installer **不碰它**（manifest 三态按文件粒度管理，本就与配置无涉）。
- [x] **E2 文件清单**：完整列出 installer 需落位的文件集（skills/agents/plugins/AGENTS.md 块），与 manifest 三态机制的对接点。
  - 实测结果（待 design 核对的目标文件集）：
    1. `.opencode/skills/webnovel-writer/SKILL.md`（1 份，渲染后）。
    2. `.opencode/agents/事实审查.md` + `.opencode/agents/编辑审.md`（2 份，`mode: subagent`，frontmatter 含 `permission`——按 C2 边界结论写法待 design：既定方向 `edit/webfetch/task` deny 全家桶，保留 read/glob/grep）。
    3. `.opencode/plugins/webnovel-session.js`（1 份，chat.message 注入 `session-context` 输出，整钩 try/catch fail-open）。
    4. 项目根（工作目录）`AGENTS.md` 标记块（复用现有块机制，OpenCode 自动加载）。
  - manifest 三态（new/changed/user-modified）按文件逐条登记即可，无 JSON 合并点；卸载 = 反向删文件 + 移除 AGENTS.md 标记块。

## F. 版本兼容线

- [x] **F1**：以上各能力的最低可用版本（support.md 需要写「验证于 vX.Y.Z」）；OpenCode 近期有无 breaking 变更预告影响上述约定。
  - 实测结果：**全部验证于 `1.18.4`（2026-07-30）**。已知历史 breaking/语义点（写进 support.md 防读者踩坑）：plugins 自 OpenCode **1.2.x** 起须为工厂函数（session-start.js 内注释实证）；`--agent` 直跑仅接受 primary/all，subagent 只能被主 agent 派发（1.18.4 实测报文见 C2 坑）；skills/agents/plugins 改动**需重启**（config 一次性加载）。未发现 1.18.x 在上述 API 面的 breaking 预告（离线环境未能核官方 changelog，support.md 应如实写「验证于 1.18.4，未滚动跟踪」）。

---

## 产出要求复核

1. ✅ 全部条目填「实测结果」+ 证据原文（命令输出/文件路径/官方 schema 结论），本文件即 research 留档。
2. ✅ C2 permission 实形与 PRD 预期基本相符，且实测比预期更强（工具从可见集消失）；webfetch/task 两个外溢键已在 C2 边界标注待 design 消化。
3. ✅ D4 结论 `hasHooks: true`（非虚标：D2 为本仓库生产 live evidence + 隔离实仓一次运行）。
4. 待办：交 claude 复核（review gate 1），复核通过后 claude 按本清单定稿 design.md，再进 S1。

## 复核备注（给 claude 的三个诚实提醒）

- C2 的工具消失结论由「agent 自述工具集」得出，未构造逐工具调用探针（成本原因）；若 design 需要字节级严格性，可补一个写文件调用直跑探针（预期报错/无工具）。
- readonly-probe 用 `mode: all` 仅为可直跑；两审壳仍应用 `mode: subagent`（直跑限制见 C2 坑，互不影响）。
- D2 的「跑 CLI 取输出」注入形态在本任务尚未实际写过 plugin 代码验证（Trellis 插件是读文件非跑 CLI）；若 S3 实现时 `$`/child_process 在 plugin 沙箱内有坑，按 PRD Notes 回退 AGENTS.md 兜底 + hasHooks 改 false——那不算失败。
