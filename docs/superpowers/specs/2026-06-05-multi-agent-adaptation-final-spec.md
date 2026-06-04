# Webnovel Writer 多智能体适配最终形态 Spec

> 日期：2026-06-05
> 状态：草案 v1
> 定位：把 Webnovel Writer 从 Claude Code 专用插件演进为跨宿主、多 agent、可验证的写作插件
> 参考样本：Superpowers、PostHog AI Plugin、Shopify AI Toolkit、Compound Engineering、wshobson/agents

---

## 1. 背景与问题

### 1.1 当前状态

当前 Webnovel Writer 已具备一套完整的 Claude Code 插件形态：

```text
webnovel-writer/
├── .claude-plugin/plugin.json
├── agents/
│   ├── context-agent.md
│   ├── data-agent.md
│   ├── deconstruction-agent.md
│   └── reviewer.md
├── skills/
│   ├── webnovel-init/
│   ├── webnovel-plan/
│   ├── webnovel-write/
│   ├── webnovel-review/
│   ├── webnovel-query/
│   ├── webnovel-learn/
│   └── webnovel-dashboard/
├── scripts/
├── references/
├── templates/
├── genres/
└── dashboard/
```

核心能力已经不是问题：

- `skills/` 定义写作工作流入口
- `agents/` 承载写前组装、审查、数据提取、参考书拆解等 subagent
- `scripts/` 负责项目初始化、Story System、索引、记忆、审查落库、Dashboard
- `.story-system/` 与 `.webnovel/` 已形成主链事实源与投影层

真正的问题是：这些能力目前默认运行在 Claude Code 的插件语义里，文档和流程里存在多处 Claude Code 耦合。

### 1.2 当前 Claude 耦合点

当前 skills/agents 中主要耦合点：

| 类型 | 现状 | 问题 |
|------|------|------|
| 插件根路径 | 大量使用 `CLAUDE_PLUGIN_ROOT` | Codex、OpenCode 等宿主使用 `PLUGIN_ROOT` 或不同机制 |
| 项目根路径 | 大量使用 `CLAUDE_PROJECT_DIR` | 非 Claude 宿主未必提供该变量 |
| 工具名 | `Read` / `Write` / `Edit` / `Grep` / `Bash` / `Agent` / `AskUserQuestion` | 各宿主工具名、调用语义不同 |
| subagent 调度 | 明确写 `Agent(...)` | Codex、Gemini、OpenCode、Copilot 都有不同 subagent 入口 |
| slash 命令 | README 与 docs 默认 `/webnovel-*` | 非 Claude 宿主可能以 skill、command TOML、prompt entry 或插件命令暴露 |
| skill 体积 | 部分 `SKILL.md` 很长 | Codex 等宿主对 skill body 有更严格的有效上下文预算 |
| hooks | 当前未形成跨宿主 bootstrap | 不同宿主启动注入能力差异较大 |

### 1.3 本 spec 要解决的问题

本 spec 解决的是**多智能体适配最终形态**，包含两层含义：

1. **多宿主适配**：同一套 Webnovel Writer 能在 Claude Code、Codex、Cursor、Gemini CLI、OpenCode、GitHub Copilot CLI 等宿主中运行。
2. **多 subagent 适配**：`context-agent`、`reviewer`、`data-agent`、`deconstruction-agent` 能在不同宿主的 agent/subagent 能力中被正确调度，能力不足时有明确降级规则。

本 spec 不只是“补几个 manifest”，而是规定最终状态下：

- 哪些文件是唯一事实源
- 哪些文件是宿主适配产物
- 哪些产物必须提交
- 哪些产物由生成器生成
- 不同宿主如何加载 skill、agent、command、hook
- skill 文案如何避免 Claude Code 专用表达
- 如何验证每个宿主真的可用

---

## 2. 设计目标与非目标

### 2.1 目标

1. **一套源内容，多宿主消费**
   - `skills/`、`agents/`、`scripts/`、`references/`、`templates/`、`dashboard/` 是唯一业务事实源。
   - 不为每个宿主手写一套完整 Webnovel Writer。

2. **保留 Claude Code 现有体验**
   - 现有 Claude Code 安装路径、skill 名称、agent 名称和核心流程不破坏。
   - `/webnovel-init`、`/webnovel-plan`、`/webnovel-write`、`/webnovel-review`、`/webnovel-query`、`/webnovel-dashboard` 继续可用。

3. **Codex / Cursor 原生插件优先**
   - Codex 使用 `.codex-plugin/plugin.json` 加载 plugin root 下的 `skills/`。
   - Cursor 使用 `.cursor-plugin/plugin.json` 加载 plugin root 下的 `skills/`、`agents/`、`hooks`。

4. **Gemini / OpenCode / Copilot 使用生成适配**
   - 这些宿主能力差异更大，最终形态允许生成宿主原生产物。
   - 生成产物来自源目录，不手工维护双份。

5. **subagent 调度语义平台化**
   - skill 中只表达“调用 `context-agent`”，不写死 `Agent(...)`。
   - 平台如何调用由 `using-webnovel-writer` 与 adapter 负责。

6. **Python runtime 可移植**
   - 所有 scripts 通过统一环境变量解析插件根、项目根。
   - 不依赖 `CLAUDE_PLUGIN_ROOT` 单一变量。

7. **有验收矩阵**
   - 每个宿主必须至少通过 skill 发现、fixture 查询、章节审查、Dashboard 或写作链路中的指定 smoke test。

### 2.2 非目标

1. 不重写 Story System、RAG、memory contract、chapter commit 链。
2. 不把 Python CLI 改成 MCP server。
3. 不保证所有宿主有完全一致的 UI 入口。
4. 不要求不支持 hooks 的宿主强行注入 session bootstrap。
5. 不要求所有宿主第一阶段都支持完整 `webnovel-write` 多 agent 链。
6. 不支持复制粘贴式多份 skill 文档维护。

---

## 3. 参考项目结论

### 3.1 Superpowers 模式

Superpowers 的核心做法：

- `skills/` 是共享源
- `.claude-plugin/`、`.codex-plugin/`、`.cursor-plugin/`、`gemini-extension.json` 是薄适配层
- `using-superpowers` 作为 bootstrap skill
- 工具名差异放在 `references/*-tools.md`
- OpenCode 用 JS 插件动态注册 skills 路径并注入 bootstrap

适合 Webnovel Writer 借鉴的点：

- 共享 skills，不复制核心逻辑
- 用 bootstrap skill 解释平台工具映射
- hook 输出兼容不同宿主 JSON 字段

### 3.2 PostHog AI Plugin 模式

PostHog 的核心做法：

- Codex manifest 直接声明 `skills` 与 `.mcp.json`
- hooks 使用 `${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}` 兼容 Claude/Codex 环境变量
- commands 以 `.md` 为源，生成 Gemini TOML

适合 Webnovel Writer 借鉴的点：

- 环境变量兼容写法
- 有脚本的 skill 仍然可以跨宿主
- hook 命令必须考虑宿主变量差异

### 3.3 Shopify AI Toolkit 模式

Shopify 的核心做法：

- 大量 `skills/` + scripts + assets
- 各宿主 manifest 很薄
- skill 内可以携带压缩 schema、校验脚本、文档搜索脚本

适合 Webnovel Writer 借鉴的点：

- Webnovel Writer 同样是 scripts/assets 重型插件，不必把所有能力改成纯 prompt
- skill 只负责指导 agent 何时调用脚本
- 本地资产与脚本仍以 plugin root 相对路径解析

### 3.4 Compound Engineering 模式

Compound Engineering 的核心做法：

- Claude 是源
- Codex 原生插件先保证 skills
- 完整 agents 体验需要 companion converter
- 明确接受不同宿主能力降级

适合 Webnovel Writer 借鉴的点：

- agents 是跨宿主最难部分，可以分阶段完成
- Codex 第一阶段不必阻塞在完整 agent 原生注册上
- 文档必须说明“完整写作链需要 subagent 支持”

### 3.5 wshobson/agents 模式

wshobson/agents 的核心做法：

- `plugins/` 是唯一源
- `tools/adapters/` 生成 Codex、Gemini、OpenCode、Copilot 等宿主产物
- 对 skill body 大小、工具名、agent 名称冲突、model mapping 做静态检查
- command 在 Codex 转 skill，在 Gemini 转 TOML

适合 Webnovel Writer 借鉴的点：

- 最终形态应有 adapter + portability lint
- `SKILL.md` 应瘦身，细节移入 `references/`
- agent 名称应全局唯一，避免跨插件冲突
- 生成产物必须有 drift check

---

## 4. 核心设计原则

### 4.1 源目录唯一

以下目录是唯一业务事实源：

```text
webnovel-writer/skills/
webnovel-writer/agents/
webnovel-writer/scripts/
webnovel-writer/references/
webnovel-writer/templates/
webnovel-writer/genres/
webnovel-writer/dashboard/
```

任何宿主适配产物都不得成为新的业务事实源。

禁止：

- 为 Codex 复制一套 `skills-codex/`
- 为 Gemini 手写一套不同内容的 `agents-gemini/`
- 在 OpenCode 插件 JS 中内联完整业务 prompt
- 修改生成产物后不回写源目录

### 4.2 适配层只处理宿主差异

适配层只允许处理：

- manifest 格式
- skill/agent/command 文件位置
- frontmatter 字段转换
- 工具名映射
- model 名称映射
- hook 输出格式
- subagent 调度入口
- install / marketplace 元数据

适配层不得处理：

- 写作流程本身
- 审查标准
- Story System schema
- 章节提交逻辑
- 题材知识
- reference 内容

### 4.3 skill 写动作，不写工具

最终形态下，skill 正文应优先写动作语义：

| 不推荐 | 推荐 |
|--------|------|
| 使用 `Read` 工具读取文件 | 读取文件 |
| 使用 `Bash` 运行命令 | 运行命令 |
| 使用 `Grep` 搜索 | 搜索 |
| 使用 `Agent` 调用 `reviewer` | 调用 `reviewer` subagent |
| 使用 `AskUserQuestion` 询问用户 | 向用户确认 |

Claude Code 专用工具名只允许出现在：

- frontmatter `allowed-tools`
- `using-webnovel-writer/references/claude-tools.md`
- adapter 测试 fixture
- 必要的历史兼容说明

### 4.4 agent 调度是能力，不是工具名

`webnovel-write` 的核心规则不是“必须调用 Claude 的 `Agent` 工具”，而是：

> 必须把写前组装、审查、事实提取交给隔离上下文的专门 subagent，不得由主流程口头替代。

因此最终 skill 应表达为：

```text
调用 `context-agent` subagent 生成写作任务书。
按当前宿主的 subagent 调度方式执行；若当前宿主不支持 subagent，进入兼容模式或阻断。
```

平台如何执行由 tool mapping 决定。

### 4.5 渐进式披露优先

最终形态下，每个 `SKILL.md` 应成为入口与导航，不应承载完整长篇协议。

目标结构：

```text
skills/webnovel-write/
├── SKILL.md                 # 入口、决策树、步骤摘要、引用加载策略
└── references/
    ├── protocol.md          # 完整写章协议
    ├── agent-contracts.md   # context/reviewer/data-agent 输入输出契约
    ├── failure-recovery.md  # 失败补跑与恢复
    └── ...
```

`SKILL.md` 推荐控制在 8 KB 以内；长内容进入 `references/`。

### 4.6 能力不足必须显式降级

不同宿主能力不一致。最终形态不假装能力一致。

| 场景 | 处理 |
|------|------|
| 宿主支持 subagent | 正常多 agent 链 |
| 宿主不支持 subagent，但用户只查询/学习/启动 dashboard | 正常执行 |
| 宿主不支持 subagent，用户要 `webnovel-write` | 默认阻断，提示需要支持 subagent 的宿主；允许显式 `--single-agent` 兼容模式 |
| 宿主不支持 hooks | 不依赖 hooks 自动注入；通过 context file / command / skill 入口加载 |
| 宿主不支持 slash command | 暴露为 skill 或 command TOML |

---

## 5. 最终目录形态

### 5.1 仓库根目录

最终仓库根目录：

```text
.
├── .claude-plugin/
│   └── marketplace.json
├── .cursor-plugin/
│   └── marketplace.json
├── .agents/
│   └── plugins/
│       └── marketplace.json              # Codex marketplace registry，可选
├── docs/
├── scripts/
│   └── generate_harness_artifacts.py     # 新增：生成宿主产物
├── tests/
│   └── harness/
│       ├── test_manifests.py
│       ├── test_portability.py
│       └── test_generated_artifacts.py
├── webnovel-writer/
└── README.md
```

说明：

- Claude 现有 root marketplace 保留。
- Cursor root marketplace 新增，用于 Cursor Plugin Marketplace。
- Codex marketplace registry 可选；如果采用官方目录或本地安装，可只保留 `.codex-plugin/plugin.json`。
- 生成器放仓库根目录 `scripts/`，避免混入插件 runtime scripts。

### 5.2 插件根目录

最终 plugin root 仍然是：

```text
webnovel-writer/
```

最终结构：

```text
webnovel-writer/
├── .claude-plugin/
│   └── plugin.json
├── .codex-plugin/
│   └── plugin.json
├── .cursor-plugin/
│   └── plugin.json
├── .opencode/
│   └── plugins/
│       └── webnovel-writer.js
├── hooks/
│   ├── hooks.json
│   ├── hooks-cursor.json
│   ├── run-hook.cmd
│   └── session-start
├── skills/
│   ├── using-webnovel-writer/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── claude-tools.md
│   │       ├── codex-tools.md
│   │       ├── cursor-tools.md
│   │       ├── gemini-tools.md
│   │       ├── opencode-tools.md
│   │       └── copilot-tools.md
│   ├── webnovel-init/
│   ├── webnovel-plan/
│   ├── webnovel-write/
│   ├── webnovel-review/
│   ├── webnovel-query/
│   ├── webnovel-learn/
│   └── webnovel-dashboard/
├── agents/
│   ├── webnovel-context-agent.md
│   ├── webnovel-data-agent.md
│   ├── webnovel-deconstruction-agent.md
│   └── webnovel-reviewer.md
├── scripts/
├── references/
├── templates/
├── genres/
├── dashboard/
├── AGENTS.md
├── CLAUDE.md
├── GEMINI.md
└── README.md
```

### 5.3 agent 命名收敛

当前 agent 名称：

```text
context-agent
data-agent
deconstruction-agent
reviewer
```

最终建议改为插件作用域名称：

```text
webnovel-context-agent
webnovel-data-agent
webnovel-deconstruction-agent
webnovel-reviewer
```

原因：

- 避免与其他插件的 `reviewer`、`context-agent` 冲突
- Codex / Copilot / Cursor 多插件环境中更稳定
- 用户和日志能明确看到来源

兼容策略：

- 第一阶段保留旧文件名或旧 alias。
- skill 正文改用新名称。
- adapter 可为 Claude 生成 alias 或保留旧名一版。
- v7 后删除旧 agent 名。

---

## 6. 宿主适配最终形态

### 6.1 Claude Code

Claude Code 继续作为一级支持宿主。

源文件：

```text
.claude-plugin/marketplace.json
webnovel-writer/.claude-plugin/plugin.json
webnovel-writer/skills/
webnovel-writer/agents/
webnovel-writer/hooks/hooks.json
```

安装：

```bash
claude plugin marketplace add lingfengQAQ/webnovel-writer --scope user
claude plugin install webnovel-writer@webnovel-writer-marketplace --scope user
```

要求：

- 现有 Claude Code 使用方式不破坏。
- `allowed-tools` frontmatter 可保留。
- `Agent` 工具由 Claude Code 原生处理。
- `hooks/session-start` 注入短 bootstrap。

### 6.2 Codex CLI / Codex App

Codex 使用原生 plugin manifest。

新增：

```text
webnovel-writer/.codex-plugin/plugin.json
```

最小 manifest：

```json
{
  "name": "webnovel-writer",
  "version": "6.0.0",
  "description": "Long-form Chinese webnovel writing system with skills, agents, story state, RAG, and review workflows.",
  "author": { "name": "lingfengQAQ" },
  "homepage": "https://github.com/lingfengQAQ/webnovel-writer",
  "repository": "https://github.com/lingfengQAQ/webnovel-writer",
  "license": "GPL-3.0",
  "keywords": ["webnovel", "writing", "skills", "agents", "rag"],
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "interface": {
    "displayName": "Webnovel Writer",
    "shortDescription": "Long-form webnovel planning, writing, review, and story-state workflows",
    "longDescription": "Plan, write, review, query, and maintain long-form Chinese webnovel projects with story state, memory, RAG, and agent workflows.",
    "developerName": "lingfengQAQ",
    "category": "Writing",
    "capabilities": ["Interactive", "Read", "Write"],
    "defaultPrompt": [
      "初始化一个新的网文项目",
      "写下一章并更新故事状态",
      "查询当前项目里的角色和伏笔状态"
    ]
  }
}
```

Codex 支持级别：

| 能力 | 方式 |
|------|------|
| skills | 原生 `.codex-plugin/plugin.json` 指向 `./skills/` |
| hooks | 可选；用户需信任 hook |
| agents | 最终通过 adapter 生成 Codex agent 配置，或由 skill 以 prompt template 调度 |
| commands | 不单独维护；需要时由 skills 或 generated command-skill 暴露 |
| tool mapping | `using-webnovel-writer/references/codex-tools.md` |

Codex 多 agent 要求：

- 完整 `webnovel-write` 需要 Codex 启用 multi-agent 能力。
- 若当前 Codex 环境没有 subagent 能力：
  - `webnovel-query`、`webnovel-learn`、`webnovel-dashboard` 可执行
  - `webnovel-review` 可进入单 reviewer prompt 兼容模式
  - `webnovel-write` 默认阻断，除非用户显式选择 `--single-agent`

### 6.3 Cursor

Cursor 使用 Cursor plugin manifest。

新增：

```text
.cursor-plugin/marketplace.json
webnovel-writer/.cursor-plugin/plugin.json
webnovel-writer/hooks/hooks-cursor.json
```

Cursor plugin manifest：

```json
{
  "name": "webnovel-writer",
  "displayName": "Webnovel Writer",
  "description": "长篇网文创作系统（skills + agents + data chain + RAG）",
  "version": "6.0.0",
  "author": { "name": "lingfengQAQ" },
  "homepage": "https://github.com/lingfengQAQ/webnovel-writer",
  "repository": "https://github.com/lingfengQAQ/webnovel-writer",
  "license": "GPL-3.0",
  "keywords": ["webnovel", "cursor", "skills", "agents", "rag"],
  "skills": "./skills/",
  "agents": "./agents/",
  "hooks": "./hooks/hooks-cursor.json"
}
```

要求：

- Cursor 读取源 `skills/` 与 `agents/`，不生成复制目录。
- hook 输出使用 Cursor 需要的 `additional_context`。
- Cursor 文档中使用 `/add-plugin webnovel-writer`。

### 6.4 Gemini CLI

Gemini CLI 最终采用**生成 extension root** 方式，不直接把仓库根当 Gemini extension 根。

原因：

- 当前仓库 root 不是 plugin root。
- Gemini extension 需要 `gemini-extension.json` 与 `GEMINI.md` 在 extension root。
- Gemini 的 skills、agents、commands 发现路径更适合扁平生成。

生成产物：

```text
dist/gemini/webnovel-writer/
├── gemini-extension.json
├── GEMINI.md
├── skills/
│   ├── webnovel-writer__using-webnovel-writer/
│   ├── webnovel-writer__webnovel-init/
│   ├── webnovel-writer__webnovel-plan/
│   ├── webnovel-writer__webnovel-write/
│   ├── webnovel-writer__webnovel-review/
│   ├── webnovel-writer__webnovel-query/
│   ├── webnovel-writer__webnovel-learn/
│   └── webnovel-writer__webnovel-dashboard/
├── agents/
│   ├── webnovel-writer__webnovel-context-agent.md
│   ├── webnovel-writer__webnovel-data-agent.md
│   ├── webnovel-writer__webnovel-deconstruction-agent.md
│   └── webnovel-writer__webnovel-reviewer.md
├── commands/
│   ├── webnovel-init.toml
│   ├── webnovel-plan.toml
│   ├── webnovel-write.toml
│   ├── webnovel-review.toml
│   ├── webnovel-query.toml
│   ├── webnovel-learn.toml
│   └── webnovel-dashboard.toml
├── scripts/
├── references/
├── templates/
├── genres/
└── dashboard/
```

`gemini-extension.json`：

```json
{
  "name": "webnovel-writer",
  "description": "Long-form Chinese webnovel writing system.",
  "version": "6.0.0",
  "contextFileName": "GEMINI.md"
}
```

Gemini tool mapping：

| 源语义 | Gemini |
|--------|--------|
| 读取文件 | `read_file` |
| 写入文件 | `write_file` |
| 编辑文件 | `replace` |
| 搜索 | `grep_search` |
| 运行命令 | `run_shell_command` |
| 向用户确认 | `ask_user` 或直接提问 |
| 调用 subagent | `@webnovel-writer__agent-name` |

### 6.5 OpenCode

OpenCode 使用 JS 插件 + 生成目录。

新增：

```text
webnovel-writer/.opencode/plugins/webnovel-writer.js
```

最终行为：

1. JS 插件将 plugin root 下的 `skills/` 注册到 OpenCode config。
2. JS 插件将 bootstrap 注入第一条 user message。
3. Adapter 生成 OpenCode 原生 agents/commands/skills 到 `.opencode/` 或安装目录。

生成产物：

```text
dist/opencode/webnovel-writer/
├── .opencode/
│   ├── plugins/
│   │   └── webnovel-writer.js
│   ├── skills/
│   ├── agents/
│   └── commands/
└── opencode.json
```

OpenCode tool mapping：

| 源语义 | OpenCode |
|--------|----------|
| 读取文件 | `read` |
| 写入文件 | `write` |
| 编辑文件 | `edit` |
| 搜索 | `grep` |
| 运行命令 | `bash` |
| 任务跟踪 | `todowrite` |
| 调用 subagent | `task` 或 `@agent` |

### 6.6 GitHub Copilot CLI

Copilot CLI 第一阶段使用 Claude plugin compatibility；最终可生成 Copilot 原生产物。

最终生成产物：

```text
dist/copilot/webnovel-writer/
├── .copilot/
│   ├── skills/
│   ├── agents/
│   └── commands/
└── plugin.json
```

支持策略：

- 若 Copilot 原生插件可直接读取 Claude plugin metadata，则优先用 native plugin install。
- 若需要完整 agents/commands，则使用生成器输出 `.copilot/`。
- 不写入共享 `~/.agents/skills`，避免 shadowing 其他宿主插件。

### 6.7 Factory Droid / Qwen Code

这两类宿主如果已支持 Claude Code plugin compatibility，则使用 Claude plugin metadata 作为第一路径。

策略：

- 不第一阶段单独维护 Droid/Qwen manifest。
- 文档中说明“通过宿主的 Claude plugin compatibility 安装”。
- 发现真实兼容失败后，再新增 adapter。

---

## 7. Bootstrap 与 using-webnovel-writer

### 7.1 新增 bootstrap skill

新增：

```text
skills/using-webnovel-writer/SKILL.md
```

职责：

1. 说明 Webnovel Writer 的能力边界。
2. 告诉 agent 如何选择 `webnovel-*` skill。
3. 定义插件根、项目根、脚本根解析方式。
4. 指向各宿主 tool mapping。
5. 定义 subagent 调度规则。
6. 定义能力不足时的降级策略。

不职责：

- 不写完整写作流程。
- 不承载 Story System 细节。
- 不重复每个 skill 的协议。

### 7.2 SessionStart 注入

新增：

```text
hooks/session-start
hooks/run-hook.cmd
hooks/hooks.json
hooks/hooks-cursor.json
```

注入内容应短，不应把完整系统文档灌进上下文。

推荐注入：

```text
<important>
Webnovel Writer is installed.
When the user asks to initialize, plan, write, review, query, learn from, or inspect a Chinese webnovel project, load the relevant webnovel-* skill.
For platform-specific tool and subagent mappings, load using-webnovel-writer.
</important>
```

Claude / Cursor / Codex hook 输出格式按宿主区分：

| 宿主 | 输出字段 |
|------|----------|
| Claude Code | `hookSpecificOutput.additionalContext` |
| Cursor | `additional_context` |
| Codex / SDK 标准 | `additionalContext` |

hooks 只负责启动提示，不作为唯一入口。Gemini/OpenCode/Copilot 不能依赖 hooks 存在。

### 7.3 Context files

最终新增：

```text
webnovel-writer/AGENTS.md
webnovel-writer/CLAUDE.md
webnovel-writer/GEMINI.md
```

职责：

- 只做目录和入口说明。
- 不超过约 150 行。
- 详细规则进入 `skills/using-webnovel-writer/`。

`GEMINI.md` 应引用：

```text
@./skills/using-webnovel-writer/SKILL.md
@./skills/using-webnovel-writer/references/gemini-tools.md
```

---

## 8. Runtime 环境兼容

### 8.1 统一环境变量

最终所有 skill bash 片段必须使用统一变量：

```bash
export WEBNOVEL_PLUGIN_ROOT="${WEBNOVEL_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}}"
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-${CLAUDE_PROJECT_DIR:-$PWD}}"

if [ -z "${WEBNOVEL_PLUGIN_ROOT}" ] || [ ! -d "${WEBNOVEL_PLUGIN_ROOT}/scripts" ]; then
  echo "ERROR: 未找到 Webnovel Writer 插件根目录" >&2
  exit 1
fi

export SCRIPTS_DIR="${WEBNOVEL_PLUGIN_ROOT}/scripts"
export PROJECT_ROOT="$(python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${WORKSPACE_ROOT}" where)"
```

禁止在新增文档中继续直接使用：

```bash
${CLAUDE_PLUGIN_ROOT}/scripts
```

除非是在兼容说明或历史迁移章节。

### 8.2 Python runtime helper

最终应扩展或新增：

```text
webnovel-writer/scripts/runtime_compat.py
```

职责：

- 解析 plugin root
- 解析 workspace root
- 解析 project root
- 校验 scripts/dashboard/templates 路径存在
- 输出 JSON 供 smoke test 使用

建议 CLI：

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" runtime-info --format json
```

输出：

```json
{
  "plugin_root": ".../webnovel-writer",
  "workspace_root": "...",
  "project_root": "...",
  "scripts_dir": ".../webnovel-writer/scripts",
  "dashboard_dir": ".../webnovel-writer/dashboard",
  "platform_env": {
    "PLUGIN_ROOT": true,
    "CLAUDE_PLUGIN_ROOT": false,
    "CLAUDE_PROJECT_DIR": false
  }
}
```

### 8.3 依赖安装

跨宿主不改变 Python 依赖策略：

```bash
python -m pip install -r requirements.txt
```

但 skill 中必须把“安装依赖”写成可重复、可失败恢复的步骤：

- 依赖已存在时不视为错误。
- Dashboard 依赖与 scripts 依赖分开。
- RAG API key 缺失时只阻断需要 RAG 的操作，不阻断 query/dashboard 基础功能。

---

## 9. Skill 改造规范

### 9.1 每个 skill 的最终结构

每个 skill 最终结构：

```text
skills/<skill-name>/
├── SKILL.md
├── references/
│   ├── protocol.md
│   ├── failure-recovery.md
│   └── ...
├── scripts/            # 仅 skill 私有脚本，公共脚本仍放 plugin scripts/
└── assets/             # 可选
```

`SKILL.md` 必须包含：

1. frontmatter
2. Use when / trigger
3. 目标
4. 前置条件
5. 决策树
6. 流程摘要
7. 引用加载策略
8. 成功标准
9. 失败恢复入口

`SKILL.md` 不应包含：

- 完整长协议
- 大量示例正文
- 大段 reference 内容
- 过多 Bash 细节

### 9.2 frontmatter 规则

Claude 源 frontmatter 可保留：

```yaml
---
name: webnovel-write
description: Use when writing a publishable webnovel chapter from an existing project outline and story runtime.
allowed-tools: Read Write Edit Grep Bash Agent
---
```

要求：

- `description` 必须包含明确触发条件。
- 中文说明可以在正文，frontmatter description 优先写清楚行为。
- `allowed-tools` 视为 Claude-only 字段；adapter 对 Codex/Gemini/OpenCode 可剥离或映射。

### 9.3 webnovel-write 改造重点

`webnovel-write` 是多 agent 适配核心。

最终正文不应写：

```text
必须使用 `Agent` 工具调用 `context-agent`
```

应写：

```text
必须调用 `webnovel-context-agent` subagent 生成写作任务书。
按当前宿主的 subagent 调度方式执行；如果当前宿主不支持 subagent，见 `using-webnovel-writer` 的降级策略。
```

`Agent(...)` 示例移入：

```text
skills/using-webnovel-writer/references/claude-tools.md
```

### 9.4 webnovel-review 改造重点

`webnovel-review` 最终应支持两种模式：

| 模式 | 条件 | 行为 |
|------|------|------|
| full-agent | 宿主支持 subagent | 调用 `webnovel-reviewer`，主流程只落库和汇总 |
| compatibility | 宿主不支持 subagent | 主流程临时扮演 reviewer，但必须输出同一 JSON schema，并在报告中标记兼容模式 |

兼容模式只允许用于 review，不允许替代 `webnovel-write` 的完整多 agent 链。

### 9.5 webnovel-init 改造重点

`webnovel-init` 涉及 `deconstruction-agent`、`AskUserQuestion`、`WebSearch/WebFetch`。

最终要求：

- 用户确认类动作写成“向用户确认”，不写死 `AskUserQuestion`。
- 参考书拆解写成“调用 `webnovel-deconstruction-agent` subagent”。
- Web 搜索只在用户明确要求市场趋势/平台风向时触发。
- 不支持 WebSearch 的宿主应要求用户提供来源或跳过市场趋势核验。

### 9.6 webnovel-dashboard 改造重点

Dashboard 是最易跨宿主的 skill。

最终要求：

- 使用统一 `WEBNOVEL_PLUGIN_ROOT`。
- 启动服务时明确打印 URL。
- 不要求 GUI 自动打开浏览器。
- 只读能力必须保持。

---

## 10. Agent 改造规范

### 10.1 agent source 格式

源 agent 继续使用 Markdown + YAML frontmatter：

```yaml
---
name: webnovel-context-agent
description: Use before chapter drafting to assemble a writing brief from outline, contracts, memory, and review feedback.
tools: Read, Grep, Bash
model: inherit
---
```

正文写：

- 身份
- 输入
- 输出
- 流程
- 边界
- JSON schema / Markdown schema
- 错误处理

不写：

- 宿主专用调度方式
- `Agent(...)` 调用样例
- 与工具名强绑定的 prose

### 10.2 agent 输出契约

四个核心 agent 的输出契约必须稳定。

| Agent | 输出 |
|-------|------|
| `webnovel-context-agent` | 五段式写作任务书 |
| `webnovel-reviewer` | 严格 JSON issues 列表 |
| `webnovel-data-agent` | `fulfillment_result.json`、`disambiguation_result.json`、`extraction_result.json` 所需内容 |
| `webnovel-deconstruction-agent` | 严格 `init_reference_research` JSON |

这些输出契约写入：

```text
skills/webnovel-write/references/agent-contracts.md
skills/webnovel-init/references/agent-contracts.md
skills/webnovel-review/references/agent-contracts.md
```

### 10.3 adapter 输出

Agent adapter 负责把源 agent 转为宿主格式。

| 宿主 | 输出 |
|------|------|
| Claude Code | `agents/*.md` 原样 |
| Cursor | `agents/*.md` 原样或轻度 frontmatter 兼容 |
| Codex | `.codex/agents/webnovel-writer/<agent>.toml` 或 prompt template |
| Gemini | `agents/webnovel-writer__<agent>.md`，工具名映射 |
| OpenCode | `.opencode/agents/<agent>.md`，工具权限块映射 |
| Copilot | `.copilot/agents/<agent>.md` |

### 10.4 model mapping

源 agent 使用：

```yaml
model: inherit
```

不在源 agent 中写 `sonnet`、`opus`、`haiku` 作为强要求。

需要高能力模型的场景写在正文：

```text
该 agent 需要较强推理能力；若宿主支持选择模型，优先使用当前可用的高能力模型。
```

---

## 11. Adapter / 生成器设计

### 11.1 新增生成器

新增：

```text
scripts/generate_harness_artifacts.py
```

命令：

```bash
python -X utf8 scripts/generate_harness_artifacts.py --target codex
python -X utf8 scripts/generate_harness_artifacts.py --target gemini
python -X utf8 scripts/generate_harness_artifacts.py --target opencode
python -X utf8 scripts/generate_harness_artifacts.py --target copilot
python -X utf8 scripts/generate_harness_artifacts.py --target all
python -X utf8 scripts/generate_harness_artifacts.py --check
```

### 11.2 生成器职责

生成器负责：

- 读取 plugin root
- 解析 skill frontmatter
- 解析 agent frontmatter
- 复制 references/assets/scripts/templates/dashboard
- 生成宿主 manifest
- 转换 agent frontmatter
- 转换 command TOML
- 剥离宿主不支持字段
- 映射工具名
- 生成 drift manifest

生成器不负责：

- 修改业务源文件
- 解释写作流程
- 改写 Story System schema
- 联网下载依赖

### 11.3 输出目录

生成产物统一进入：

```text
dist/<harness>/webnovel-writer/
```

`dist/` 默认 gitignored。

需要提交的只有：

- manifest 源
- adapter 源码
- 测试 fixture
- 生成快照 hash 或 drift manifest

例外：

- `.codex-plugin/plugin.json`
- `.cursor-plugin/plugin.json`
- root marketplace json

这些小型原生 manifest 可以提交。

### 11.4 Drift 检查

CI 必须运行：

```bash
python -X utf8 scripts/generate_harness_artifacts.py --target all
python -X utf8 scripts/generate_harness_artifacts.py --check
```

若生成产物与提交的 manifest/registry 不一致，CI 失败。

---

## 12. Tool Mapping

新增：

```text
skills/using-webnovel-writer/references/
├── claude-tools.md
├── codex-tools.md
├── cursor-tools.md
├── gemini-tools.md
├── opencode-tools.md
└── copilot-tools.md
```

### 12.1 通用映射表

| 源语义 | Claude | Codex | Gemini | OpenCode | Copilot |
|--------|--------|-------|--------|----------|---------|
| 读取文件 | `Read` | native read | `read_file` | `read` | `view` |
| 写文件 | `Write` | native write | `write_file` | `write` | `create` |
| 编辑文件 | `Edit` | native edit | `replace` | `edit` | `edit` |
| 搜索文本 | `Grep` | native search | `grep_search` | `grep` | `grep` |
| 运行命令 | `Bash` | shell command | `run_shell_command` | `bash` | `bash` |
| 网页搜索 | `WebSearch` | web search if enabled | `google_web_search` | web search if enabled | no guaranteed equivalent |
| 抓取网页 | `WebFetch` | web fetch if enabled | `web_fetch` | web fetch if enabled | `web_fetch` |
| 询问用户 | `AskUserQuestion` / direct | direct / structured input if available | `ask_user` | direct | direct |
| 调用 subagent | `Agent` / `Task` | `spawn_agent` or named subagent prompt | `@agent` | `task` / `@agent` | `task` |
| 任务跟踪 | `TodoWrite` | plan/update if available | no guaranteed equivalent | `todowrite` | todos/sql if available |

### 12.2 skill 正文约束

新增或修改 skill 时：

- 不直接写工具名，写动作。
- 如果确实必须写工具名，必须放入对应 tool mapping reference。
- `rg`、`python`、`git` 这类 shell 命令可以直接写。

---

## 13. 多 agent 工作流最终状态

### 13.1 webnovel-write 工作流

最终 `webnovel-write` 编排：

```text
主流程
  1. 解析环境与项目根
  2. preflight
  3. placeholder-scan
  4. 刷新 Story System runtime contracts
  5. 调用 webnovel-context-agent
       -> 输出五段式写作任务书
  6. 主流程根据任务书起草正文
  7. 调用 webnovel-reviewer
       -> 输出 review_results.json
  8. blocking issue 修复循环
  9. 润色与排版
  10. 调用 webnovel-data-agent
       -> 输出 commit artifacts
  11. chapter-commit
  12. backup
```

核心不变：

- `context-agent` 负责写前 research 与任务书。
- `reviewer` 负责可验证问题。
- `data-agent` 负责事实提取与 artifacts。
- 主流程负责 orchestration、写正文、落库、恢复。

### 13.2 subagent 能力门槛

完整写章链要求：

- 至少支持顺序调用 subagent。
- subagent 能读取必要文件与运行必要查询命令。
- subagent 输出能返回主流程。

不要求：

- 必须并行 subagent。
- 必须独立工作目录。
- 必须持久 agent 会话。

### 13.3 single-agent 兼容模式

为低能力宿主预留 `--single-agent`，但默认不启用。

允许场景：

- 用户明确知道质量下降。
- 当前宿主不支持 subagent。
- 任务不是正式发布章节，或用户接受手动复查。

禁止场景：

- 默认 `/webnovel-write` 自动降级。
- 在未告知用户的情况下由主流程替代 reviewer/data-agent。
- 伪造 subagent 输出。

兼容模式输出必须标记：

```json
{
  "compatibility_mode": "single-agent",
  "missing_capability": "subagent",
  "requires_manual_review": true
}
```

---

## 14. 安装与发布

### 14.1 版本同步

当前 `sync_plugin_version.py` 需要扩展，覆盖：

```text
webnovel-writer/.claude-plugin/plugin.json
webnovel-writer/.codex-plugin/plugin.json
webnovel-writer/.cursor-plugin/plugin.json
.claude-plugin/marketplace.json
.cursor-plugin/marketplace.json
README.md
dist manifest templates
```

命令保持：

```bash
python -X utf8 webnovel-writer/scripts/sync_plugin_version.py --version X.Y.Z --release-notes "..."
```

### 14.2 发布文档

新增：

```text
docs/operations/multi-harness-release.md
docs/guides/install-codex.md
docs/guides/install-cursor.md
docs/guides/install-gemini.md
docs/guides/install-opencode.md
docs/guides/install-copilot.md
```

README 快速开始保留 Claude Code 作为推荐路径，但增加：

```text
其他宿主安装：Codex / Cursor / Gemini CLI / OpenCode / Copilot
```

### 14.3 官方 marketplace 策略

优先级：

1. Claude Code marketplace：保持现状。
2. Codex plugin：补 `.codex-plugin/plugin.json`，后续申请目录。
3. Cursor plugin：补 `.cursor-plugin` marketplace。
4. Gemini/OpenCode/Copilot：先提供生成安装路径，成熟后再考虑原生发布。

---

## 15. 测试与验收

### 15.1 静态测试

新增测试：

```text
tests/harness/test_manifest_validity.py
tests/harness/test_skill_frontmatter.py
tests/harness/test_agent_frontmatter.py
tests/harness/test_portability_lint.py
tests/harness/test_generated_artifacts.py
```

检查：

- 所有 manifest JSON 合法。
- 所有 manifest 版本一致。
- 所有 `SKILL.md` 有 `name` / `description`。
- 所有 agent 有 `name` / `description` / `model`。
- agent 名称全局唯一。
- 新增 skill 不直接引用 `CLAUDE_PLUGIN_ROOT`。
- 新增 skill 不出现未解释的 Claude-only tool prose。
- `SKILL.md` 超过阈值时必须有 `references/`。

### 15.2 CLI 测试

新增：

```bash
python -X utf8 webnovel-writer/scripts/webnovel.py runtime-info --format json
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root <fixture> preflight --format json
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root <fixture> where
```

### 15.3 Harness smoke matrix

| 宿主 | 最低验收 |
|------|----------|
| Claude Code | 安装插件；`/webnovel-query` 查询 fixture；`/webnovel-review` 审查 fixture；`/webnovel-dashboard` 启动 |
| Codex | plugin 可读；skills 可列出；`webnovel-query` fixture 通过；`webnovel-review` full/compat 其中一种通过 |
| Cursor | plugin 可安装；skills/agents 可发现；`webnovel-query` 与 `webnovel-review` 通过 |
| Gemini | 生成 extension；`gemini extensions install <dist>` 成功；`/webnovel-query` 或 command TOML 通过 |
| OpenCode | JS plugin 加载；skills 注册；`webnovel-dashboard` 或 query 通过 |
| Copilot | 生成 `.copilot` artifacts；skill/agent 可发现；query smoke 通过 |

### 15.4 写章验收

完整写章验收只要求在支持 subagent 的宿主上通过：

输入：

```text
使用 Webnovel Writer 写第 4 章。项目在 agents/evals/files/test-project/。
```

通过条件：

- 调用 `webnovel-context-agent`。
- 生成五段式写作任务书。
- 生成正文文件。
- 调用 `webnovel-reviewer`。
- `review_results.json` 存在且合法。
- 调用 `webnovel-data-agent`。
- 三份 commit artifacts 存在且合法。
- `chapter-commit` 成功。
- 不伪造 subagent 输出。

### 15.5 兼容模式验收

在不支持 subagent 的宿主：

输入：

```text
使用 Webnovel Writer 审查第 4 章。项目在 agents/evals/files/test-project/。
```

通过条件：

- 明确标记 compatibility mode。
- 输出同一 review JSON schema。
- 不声称调用了 subagent。
- 可落库或明确说明落库跳过原因。

---

## 16. 迁移计划

### Phase 1：原生 manifest 与环境变量兼容

目标：不改变业务流程，先让 Codex/Cursor 能发现 plugin。

改动：

- 新增 `.codex-plugin/plugin.json`
- 新增 `.cursor-plugin/plugin.json`
- 新增 `.cursor-plugin/marketplace.json`
- 新增 `hooks/session-start`
- 新增 `using-webnovel-writer`
- skill bash 片段开始迁移到 `WEBNOVEL_PLUGIN_ROOT`

验收：

- Claude Code 现有安装不破坏。
- Codex 能列出 skills。
- Cursor 能安装 plugin。

### Phase 2：Skill 瘦身与 Claude-only prose 清理

目标：让 skills 成为跨宿主入口。

改动：

- 拆分过长 `SKILL.md` 到 `references/protocol.md`
- 清理正文中的 `Read tool` / `Bash tool` / `Agent tool`
- 把 `Agent(...)` 示例移入 `claude-tools.md`
- 补 `codex-tools.md`、`gemini-tools.md`、`opencode-tools.md`

验收：

- portability lint 通过。
- 每个 skill 仍能在 Claude Code 中触发。

### Phase 3：Agent 命名与调度抽象

目标：agent 名称全局唯一，调度语义平台化。

改动：

- `context-agent` -> `webnovel-context-agent`
- `data-agent` -> `webnovel-data-agent`
- `deconstruction-agent` -> `webnovel-deconstruction-agent`
- `reviewer` -> `webnovel-reviewer`
- skill 正文使用“调用 subagent”语义
- adapter 支持旧名 alias

验收：

- Claude Code 中旧项目不破坏。
- 新 skill 全部使用新 agent 名。
- agent 名称无冲突。

### Phase 4：生成器与 Gemini/OpenCode/Copilot 产物

目标：生成宿主原生产物。

改动：

- 新增 `scripts/generate_harness_artifacts.py`
- 生成 Gemini extension root
- 生成 OpenCode `.opencode`
- 生成 Copilot `.copilot`
- CI 加 drift check

验收：

- `--target all` 成功。
- 生成产物可安装 smoke。

### Phase 5：端到端 harness 验收

目标：用真实宿主跑通核心任务。

验收顺序：

1. Claude Code：完整 init/query/review/write。
2. Codex：skills + query + review。
3. Cursor：skills/agents + query + review。
4. Gemini：generated extension + query。
5. OpenCode：plugin JS + dashboard/query。
6. Copilot：generated skills/agents + query。

---

## 17. 风险与决策

### 17.1 主要风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| skill 过长导致宿主截断 | Codex/Gemini 行为不稳定 | `SKILL.md` 瘦身，references 渐进加载 |
| agent 调度语义不一致 | `webnovel-write` 链路断裂 | 平台 tool mapping + adapter + compatibility mode |
| hooks 需要用户信任 | bootstrap 不一定生效 | 不依赖 hooks 作为唯一入口 |
| plugin root 嵌套 | Gemini/OpenCode 安装复杂 | 生成 dist extension root |
| Python 依赖缺失 | scripts 失败 | preflight 明确诊断 |
| RAG API key 缺失 | init/write 部分能力不可用 | 按功能阻断，不影响 query/dashboard |
| 多份 manifest 版本漂移 | 发布混乱 | 扩展 version sync + CI |
| 旧 agent 名 shadowing | 调用错误 agent | 命名空间化 + alias 迁移 |

### 17.2 明确决策

1. Webnovel Writer 不把 Python CLI 改成 MCP。
2. Claude Code 仍是最佳体验路径。
3. Codex/Cursor 走原生 plugin manifest。
4. Gemini/OpenCode/Copilot 最终走生成产物。
5. `webnovel-write` 默认不在无 subagent 宿主自动降级。
6. `webnovel-review` 可以有 compatibility mode。
7. 所有新 agent 名必须带 `webnovel-` 前缀。
8. `CLAUDE_PLUGIN_ROOT` 不再作为新文档主变量。

---

## 18. 验收清单

最终完成时，必须满足：

- [ ] Claude Code 原安装流程不破坏。
- [ ] Codex manifest 存在且能加载 `skills/`。
- [ ] Cursor manifest 存在且能加载 `skills/` / `agents/`。
- [ ] Gemini dist 可生成并安装。
- [ ] OpenCode dist 可生成并加载 JS plugin。
- [ ] Copilot dist 可生成。
- [ ] `using-webnovel-writer` 存在并包含所有宿主 tool mapping。
- [ ] 所有 skill 使用 `WEBNOVEL_PLUGIN_ROOT` 兼容变量。
- [ ] 新增/改造后的 skill 正文不写死 Claude-only 工具名。
- [ ] 核心 agent 名称带 `webnovel-` 前缀。
- [ ] adapter 可生成 Codex/Gemini/OpenCode/Copilot 产物。
- [ ] CI 检查 manifest 版本一致。
- [ ] CI 检查生成产物 drift。
- [ ] fixture query 在至少 Claude、Codex、Cursor 三个宿主通过。
- [ ] fixture review 在至少 Claude、Codex/Cursor 其中一个非 Claude 宿主通过。
- [ ] 完整 write 多 agent 链在至少一个非 Claude 宿主通过，或明确标记为下一里程碑阻断项。

---

## 19. 后续可选方向

本 spec 完成后，可以继续评估：

1. 把 `webnovel.py` 暴露为 MCP server。
2. 为 Dashboard 增加 MCP / app connector。
3. 发布独立 Gemini extension 分支。
4. 发布 OpenCode npm plugin。
5. 增加 agent eval：同一 fixture 在 Claude/Codex/Gemini 输出结构一致性对比。
6. 增加写作质量跨模型 benchmark。

这些都不是本 spec 的前置条件。
