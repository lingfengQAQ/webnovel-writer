# Webnovel Writer 多宿主与多智能体适配 Spec

> 日期：2026-06-05（v3 修订：2026-06-11；v3.1：同日，hook 语义 deny → ask，依据 #113；v3.2：2026-06-12，按 PRD 1.0 §10.2 修订——安装器重写为工作目录布局、AGENTS.md 公约数层、SessionStart 注入、模板条件块、放弃插件市场）
> 状态：草案 v3.2
> 基线：**v7 story repo**（`story-repo-spec-2026-06-10.md` 0.6）+ **PRD**（`v7-prd.md` 1.0，产品法律文本，冲突时以 PRD 为准）。v2 的基线是 v6.1.0 Python runtime，该架构已被 v7 推翻；本版继承 v2 的元层纪律，重写全部基座层。
> 来源：v2（基于 PR #110 review 重写）+ 2026-06 多平台调研核验 + Trellis 多宿主机制调研（2026-06-11）+ PRD 1.0
> 定位：把 v7 的格式层（story repo）原封不动地暴露给多个 agent 宿主——格式平台无关，本 spec 只管入口怎么落、角色怎么生成、安装怎么零门槛、支持等级怎么诚实。

---

## 1. 相对 v2 的处置（审计表）

| v2 内容 | 处置 | 说明 |
|---|---|---|
| §5.4 不相信手写矩阵 / `support.md` 纪律 | **继承** | 官方链接 + 核验日期 + smoke 命令，原样保留（§7） |
| §12.1 adapter registry 分级 | **继承并具体化** | 分级标准定为：一级亲测 / 二级社区反馈 / 三级理论可用（§7.1） |
| §12.3 生成器 + §13.3 drift check | **继承** | 单源生成多宿主壳，提交物必须过 drift check（§6.3、§9） |
| §9.3 降级诚实条款 | **继承** | 不允许声称调用了不存在的 subagent（§5.4） |
| §5.5 UTF-8 First | **继承，换 Node 口径** | 脚本统一 Node，默认 UTF-8；CI 保留 Windows 中文路径全链路（§5.6） |
| §5.1 "Runtime 是唯一业务真源" | **反转** | 真源是 story repo（markdown + git），脚本只是确定性工具层（§5.1） |
| §8.3 写章硬要求（write-gate/chapter-commit/projection） | **删除** | 随 v6 架构作废；v7 的跨宿主硬要求只剩一条：事实变更必须经流程 commit（§5.1） |
| §2 当前基线（8 Skill / 4 Agent / hooks / runtime CLI / doctor / Dashboard） | **删除** | 全部是 v6 形态；v7 是单入口状态机 + Node 脚本 |
| §11 doctor / project-status 双状态入口 | **删除** | v7 状态入口 = 启动序列与状态机（story repo spec §10），解析失败走修复确认，不需要平行的 doctor 体系 |

---

## 2. 当前真实基线（2026-06 核验）

### 2.1 SKILL.md 已是开放标准

Anthropic 2025-12 开放 SKILL.md 规范后，Codex、Gemini CLI、Cursor、Copilot、Windsurf 等 30+ 工具支持，发现路径为 `.claude|.codex|.cursor|.gemini/skills/`。**skills 层零适配，拷目录即用**。

约束：Codex 对 skill 列表有约 8k 字符预算，`description` 必须精简。

### 2.2 Subagent 三大平台都有，但无标准

| 平台 | 格式 | 状态 |
|---|---|---|
| Claude Code | markdown + frontmatter（`agents/`） | 稳定 |
| Gemini CLI | markdown + frontmatter（路径不同） | 可用 |
| Codex | TOML | experimental |

结论：角色定义**单源 markdown，构建时生成三平台壳**；格式三家三样，手维护必漂移。

### 2.3 Hook 只有 Claude Code 完整

核心流程必须显式调脚本；hook 只能是 Claude Code 上的自动兜底，不能承载任何关键能力。

### 2.4 弱模型现实

Codex 跑 GPT、Cursor 什么模型都有。"流程薄 + 脚本确定性"不是优雅偏好，是跨宿主正确性的必需——能数的绝不让模型估（story repo spec 不变量 6 在弱模型下更硬）。

以上每条在实现对应宿主前必须按 §7.2 重新核验，本节不是免检通行证。

---

## 3. 目标

### 3.1 一句话目标

> 以 story repo（markdown + git）为唯一真源，向多个宿主分发同一套 SKILL.md 入口、生成各平台角色壳、用 npx 一键安装的长篇写作系统。

### 3.2 具体目标

1. 状态机单入口落成标准 SKILL.md，在所有支持 SKILL.md 的宿主上可发现、可执行。
2. 角色（三审：读者审/编辑审/设定校对）单源定义，构建时生成各平台壳。
3. 所有宿主复用同一套 Node 脚本（机检、定稿、全书近况、体检），零业务逻辑复制。
4. `npx` 安装器一条命令完成环境检测与 skills 分发（根治 v6 #90/#103/#69 安装类 issue）。
5. 每个宿主的支持状态可验证：support.md + smoke + 分级 registry，不承诺未核验的能力。
6. 宿主不支持 subagent / hook 时有明确降级模式，输出如实声明。

## 4. 非目标

- 不为任何宿主复制或改写章流程八阶段逻辑。
- 不把格式层（story repo spec）的任何内容绑定到宿主能力上。
- 不维护手写的"宿主能力矩阵"。
- 不承诺未经官方文档核验和本地 smoke 的宿主支持。
- 不做常驻服务、不自动安装依赖（npx 安装器只拷文件 + 报告，不装运行时）。
- 不把 hook 变成隐藏业务流程。

---

## 5. 设计原则

### 5.1 Story repo 是唯一真源（反转 v2 §5.1）

Skill、agent、hook、安装器全部只是入口或调度层。真正修改项目事实的路径只有一条：

```text
任意宿主入口（SKILL.md / 命令 / 对话）
    ↓
启动序列与状态机（story repo spec §10）
    ↓
写章流程八阶段（story repo spec §8）
    ↓
定稿 / 吃书 / 补登 原子 commit → story repo
```

**跨宿主唯一硬要求**：事实变更必须经流程 commit 入 git，任何宿主不得绕过定稿流程直写 `定稿/` 与 `大纲/伏笔|悬念|感情线/`。v2 §8.3 的 write-gate/chapter-commit/projection 硬要求随 v6 架构作废，不替换、不变形保留。

### 5.2 Claude Code 是第一宿主，但分发只走 npx

Claude Code 的使用体验是其他宿主的对照基准。**插件市场渠道放弃**（市场版停在 v6 并指引新装法）：v7 所有宿主统一 `npx webnovel-writer init` 安装到工作目录（§8）——一套渠道一套支持口径。`.claude-plugin/` 结构仅作为 v6 遗留保留在 master 分支，v7 不再维护。

### 5.3 Skills 层零适配，靠精简而不是靠转换

- SKILL.md 是开放标准，分发 = 拷目录，不做格式转换。
- `description` 按 Codex 8k 预算写：触发条件 + 一句话职责，不塞流程。
- Skill 主体只写状态机入口和阶段流程，题材知识、宿主差异、工具映射下沉 `references/`。

### 5.4 Subagent 只做增强，不做依赖

- 三审（story repo spec §8 第 6 步：读者审/编辑审/设定校对）在支持 subagent 的宿主上用独立 subagent 保证"各自新鲜上下文"。
- 不支持的宿主降级：主 agent 按同一份三审任务书顺序执行，输出必须明确声明"未调用 subagent，使用兼容模式"。
- **降级诚实条款（继承 v2）**：不允许声称调用了不存在的能力；机检与定稿是脚本，不参与降级。

### 5.5 Hook 只是 Claude Code 上的自动兜底

- **SessionStart 注入**：读工作目录 `.webnovel/books.jsonl`，注入"当前在写哪本、共几本书、全书近况入口"；再读当前书状态报全书近况。无 hook 宿主由状态机入口启动时读同一文件，行为等价。
- **Hook 语义是 ask，不是 deny**：PreToolUse 检测到直写 `定稿/` 或 `大纲/伏笔|悬念|感情线/` 时提醒"这是定稿区，确认直写还是走写章流程？"，确认后放行；事后由手改检测（story repo spec §9）提议补登兜底。deny 式 hook 无法区分"绕过定稿破坏一致性"和"替作者批量修数据"，被拦的往往是后者——v6 的 state.json guard 即此教训（#113，已于 73447d7 放开）。这与 story repo spec 不变量 1（"检测手改并提议补登，永不报错拒绝"）和"可靠性来自自愈，不来自门禁"原则自洽。
- 任何关键能力不得只存在于 hook 中；无 hook 宿主由状态机入口（每次启动先跑全书近况与手改检测）补足，行为等价。

### 5.6 零依赖与 UTF-8 First（Node 口径）

- 脚本统一 Node：装任何 agent CLI 的用户必有 Node；无 Python、无 pip、无 .env。
- 一切文件 IO 显式 UTF-8 无 BOM，`.gitattributes` 锁 LF；不用 .bat/.sh。
- CI 保留 Windows 中文路径全链路测试（建库→写章→定稿→重建缓存，story repo spec §2.2）。

### 5.7 不相信手写矩阵（继承 v2 §5.4）

宿主能力变化快，spec 不记"某宿主现在支持什么"的口头事实；一切支持声明由 `support.md` + smoke 支撑（§7）。

### 5.8 AGENTS.md 是最大公约数层

- **工作目录根部**放 `AGENTS.md`（开放标准，30+ 工具自动读取）：说明这是 webnovel-writer 工作目录、入口怎么进、脚本在哪——任何平台哪怕什么都不支持，至少能从这里找到入口。
- 用 `<!-- WEBNOVEL:START -->` / `<!-- WEBNOVEL:END -->` 标记块管理：块内允许 update 覆写，块外用户内容保留。
- **书仓库根部**的指路 `AGENTS.md`（story repo spec §2.1）由建书/迁移生成：误在书目录启动或单独 clone 时指引回工作目录。

### 5.9 共享模板 + 平台条件块（Trellis 模式）

- skills/命令文本单源维护，模板里用平台上下文变量（命令引用语法、路径差异）与条件块（有无 subagent / 有无 hook）。
- **降级路径在安装时编译进生成物，不靠运行时判断**：没有 subagent 的平台，生成出来的 skill 正文就是顺序执行版（含兼容模式声明，§5.4）。
- 平台能力声明只留模板渲染真正需要的最小布尔集（如 agentCapable / hasHooks），不维护大能力矩阵（§5.7）。

---

## 6. 目标架构

### 6.1 仓库结构（宿主适配相关部分）

```text
webnovel-writer/（插件仓库）
├── skills/                        # 单源 SKILL.md 模板（含平台条件块，§5.9），开放标准
│   └── <v7 实现阶段定名>/          # 状态机单入口 + /migrate；清单由 v7 实现定
├── roles/                         # 角色单源定义（markdown + frontmatter）
│   ├── 读者审.md
│   ├── 编辑审.md
│   └── 设定校对.md
├── adapters/
│   ├── registry.json              # 宿主注册表 + 支持分级（§7.1）
│   └── <host>/support.md          # 每宿主核验记录（§7.2）
├── scripts/                       # Node ≥22，确定性工具层：机检/定稿/全书近况/体检/生成器
│   └── build-host-shells.mjs      # roles/ + skills/ → 各平台产物；--check 即 drift check
├── installer/                     # npx 安装器源码（§8）
└── dist/<host>/                   # 生成包，不提交
```

### 6.2 真源与生成物

| 类型 | 路径 | 真源 | 提交 |
|---|---|---:|---:|
| Skill 源（含条件块模板） | `skills/*/SKILL.md` | 是 | 是 |
| 角色源 | `roles/*.md` | 是 | 是 |
| Node 脚本与生成器 | `scripts/` | 是 | 是 |
| 宿主注册表与核验记录 | `adapters/` | 是 | 是 |
| 各宿主壳与编译后 skill | `dist/<host>/` → 安装到用户工作目录 | 否（生成物） | 否 |

所有宿主壳一律由生成器产出、安装器分发到用户工作目录；插件仓库不再提交任何生成物（v3.1 及之前"Claude Code 壳提交 + drift check"的做法随插件市场渠道一起废止，drift check 改为 CI 中对比生成器输出的确定性）。

### 6.3 生成器

```bash
node scripts/build-host-shells.mjs --target all
node scripts/build-host-shells.mjs --target codex
node scripts/build-host-shells.mjs --check     # drift check，CI 必跑
```

生成器只读 `roles/`、`skills/`、`adapters/registry.json`，产出各平台 agent 壳与 manifest；不改业务源、不联网、不运行写作流程。

---

## 7. 支持分级与核验纪律

### 7.1 Registry 分级

```json
{
  "schema_version": "webnovel-host-registry/v2",
  "hosts": {
    "claude-code": { "tier": 1, "verified": "亲测", "smoke": "node scripts/smoke.mjs --host claude-code" },
    "codex":       { "tier": 1, "verified": "亲测", "smoke": "node scripts/smoke.mjs --host codex" },
    "gemini-cli":  { "tier": 2, "verified": "社区反馈" },
    "cursor":      { "tier": 2, "verified": "社区反馈" },
    "_default":    { "tier": 3, "verified": "标准 SKILL.md 理论可用" }
  }
}
```

- **一级**（Claude Code + Codex）：维护者亲测，发布前必须过 smoke。
- **二级**（Gemini CLI / Cursor）：社区反馈确认，README 如实标注。
- **三级**：凡支持标准 SKILL.md 的宿主理论可用，不单独承诺。

`supports` 类字段不允许手写猜测，必须由对应 `support.md` 支撑。

### 7.2 support.md（继承 v2，逐宿主必备）

实现某宿主适配前必须重新核验官方文档，结果写入 `adapters/<host>/support.md`，至少包含：官方文档链接、核验日期、skill/subagent/hook 支持情况、本仓库降级策略、smoke 命令。无 support.md 的宿主不得进入 registry 一二级。

---

## 8. 安装与分发（npx 单渠道，强制项目级）

分发只走 `npx webnovel-writer init` / `update`（插件市场放弃，§5.2）。**强制安装到工作目录（项目级），不支持用户级**——所有用户目录结构一字不差，可诊断性优先于灵活性（v6 安装类 issue #90/#103/#69 半数根源是"装哪了/读的哪份"歧义）。

### 8.1 init

1. **检测环境**：Node ≥ 22（不足时人话提示升级）；识别已安装的 agent CLI（按 registry 顺序探测）。
2. **生成工作目录布局**（story repo spec §2.0）：`AGENTS.md`（公约数层，标记块）、`.webnovel/`（Node 脚本、角色定义、模板哈希清单、`books.jsonl`）、检测到的各平台壳（`.claude/`、`.codex/` 等，由生成器按 §5.9 条件块编译）。
3. **输出报告**：装到了哪、各宿主支持等级、降级说明、下一步（打开 agent CLI 说"开始写书"）。

### 8.2 update

- **模板哈希追踪**：安装时记录每个生成文件的哈希；update 时哈希未变的文件直接更新，用户改过的文件提示并跳过（不静默覆盖）。
- `AGENTS.md` 只更新标记块内内容，块外用户内容保留（§5.8）。

### 8.3 边界

安装器不装 Node 之外的任何运行时、不改用户全局配置、不联网下载业务逻辑、不把工作目录变成 git 仓库（书各自是 git 仓库）。

---

## 9. 验证与 CI

- **drift check**：`build-host-shells.mjs --check`，验证生成器输出确定性（同输入必同输出），CI 必跑。
- **package validator**：registry schema、逐宿主 support.md 存在性、smoke 命令声明、生成物无本机绝对路径、skill description 长度（Codex 8k 预算）。
- **行为 smoke**（每个一级宿主）：discover（skill 可发现）→ npx init → 建书 → 全书近况 → 写一章全流程（细纲→定稿）→ 删 `.cache/` 重建。Windows 中文路径全链路必测。
- **降级验收**：至少一个无 subagent 环境跑通三审兼容模式，且输出含兼容模式声明。

---

## 10. 迁移计划

随 v7 绞杀式收敛推进，不单独立项：

| Phase | 内容 | 依赖 |
|---|---|---|
| A | 本 spec v3 定稿入册；registry + Claude Code / Codex 两份 support.md（核验 + smoke 定义） | 无 |
| B | 状态机入口 SKILL.md 与 `roles/` 单源落地（随 v7 Phase 1-2 实现） | v7 数据面 |
| C | `build-host-shells.mjs` 生成器 + drift check 进 CI | B |
| D | npx 安装器 | B |
| E | Codex 亲测过 smoke，升一级；Gemini/Cursor 收集社区反馈 | C、D |
| F | README 多宿主支持表 + release note 分级口径 | E |

## 11. 风险与控制

| 风险 | 控制 |
|---|---|
| 宿主能力描述过期 | support.md 核验日期纪律；无核验不进一二级 |
| 角色壳三平台漂移 | 单源 `roles/` + 生成器，禁止手改生成物，drift check 兜底 |
| 弱模型宿主上流程失守 | 机检与定稿全是脚本；模型只做写稿与三审 |
| Codex skill 预算超限 | validator 检查 description 长度 |
| 降级模式被冒充 | 降级诚实条款进行为 smoke 验收 |
| Windows 中文路径 | Node 默认 UTF-8 + CI 全链路测试 |

## 12. 验收清单

- [ ] story repo 是唯一真源：任何宿主无绕过定稿流程的写路径。
- [ ] 状态机入口 SKILL.md 在 Claude Code 与 Codex 上可发现、可执行。
- [ ] `roles/` 单源，全部宿主壳由生成器产出，drift check 进 CI。
- [ ] npx 安装器在 Windows 中文环境一条命令完成工作目录布局（含 AGENTS.md、books.jsonl、平台壳）。
- [ ] update 哈希追踪：改过的文件不被静默覆盖。
- [ ] registry 三级分级，一级宿主有 support.md + 过 smoke。
- [ ] 无 subagent 宿主跑通三审兼容模式且如实声明。
- [ ] hook 缺席的宿主核心流程行为等价（含 books.jsonl 上下文注入的等价路径）。

## 13. 简短结论

v2 答对的是"怎么诚实地适配多宿主"（support.md、registry、生成器、降级诚实），答错的是"适配什么"——它适配的 v6 runtime 已被 v7 推翻。v3 保住前者，把基座换成 story repo：格式平台无关，入口是开放标准 SKILL.md，角色单源生成，安装一条 npx。宿主越弱，越证明"流程薄 + 脚本确定性"是对的。
