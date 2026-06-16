# Webnovel Writer

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-6.2.0-brightgreen.svg)](.claude-plugin/marketplace.json)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-purple.svg)](https://claude.ai/claude-code)
[![Marketplace](https://img.shields.io/badge/Claude%20Code-Marketplace-black.svg)](.claude-plugin/marketplace.json)

<a href="https://trendshift.io/repositories/22487" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22487" alt="lingfengQAQ%2Fwebnovel-writer | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

一个跑在 Claude Code 上的长篇网文创作插件。从初始化设定、规划卷纲，到写章、审查、沉淀记忆、查询状态，再到一个只读的可视化面板——整条创作流程都给你串好了。

它想解决的其实就一件事：**让 AI 写到几百章，依然记得住设定、接得住伏笔、守得住大纲。**

一句话定位：这是一套面向长篇连载的一致性系统，不是写完就忘的一次性生成器。

## Hosted Platform / Railway

本分支额外提供一个可部署的在线平台模式：

- 多用户账号：支持 SubRouter 主站/分站账号密码登录，也保留平台用户名密码。
- SubRouter 模型：后端复用 SubRouter 登录会话，自动创建或复用用户调用密钥，再调用 OpenAI 兼容接口；前端读取模型后直接选择使用。
- 多项目隔离：每个用户可以创建多个网文项目，项目文件独立存放。
- 单目录持久化：Railway 只需要挂载一个 `/data` volume，`platform.sqlite3` 和所有用户项目都在 `/data` 下。

Railway 部署时使用仓库根目录的 `Dockerfile` 和 `railway.toml`。关键环境变量：

```bash
WEBNOVEL_PLATFORM_ENABLED=true
WEBNOVEL_DATA_DIR=/data
SUBROUTER_BASE_URL=http://subrouter.railway.internal:8080
```

`SUBROUTER_BASE_URL` 是 SubRouter 管理/API 服务地址，不需要手动加 `/v1`；本平台在模型列表和生成请求时会自动调用 `${SUBROUTER_BASE_URL}/v1/...`。

如果不走 Railway 私网，也可以使用公网地址：

```bash
SUBROUTER_BASE_URL=https://api.subrouter.com
```

把 `subrouter` 换成你的 Railway SubRouter 服务名（如果不同）。这个 `.railway.internal` 地址只能由后端服务访问，浏览器不能直连；本平台所有登录、模型列表和生成请求都会从后端代理出去。

> **v7 重构 RFC 公示中**
>
> 下一代 v7 设计已经进入公开意见征集期，欢迎阅读 [Discussions #118：v7 设计公示](https://github.com/lingfengQAQ/webnovel-writer/discussions/118) 并留下反馈。只看 Issue 区的用户也可以从 [Issue #119：v7 公示指引帖](https://github.com/lingfengQAQ/webnovel-writer/issues/119) 进入；原“下一步方向投票”已结束，后续优先级将以 RFC 反馈和实施计划为准。

## 为什么需要它

长篇创作最难的不是写出第一章，而是写到第 80 章、第 200 章以后仍然保持：

- 角色动机不漂移
- 战力、时间线、地点和世界规则不互相打架
- 伏笔有登记、有推进、有回收
- 爽点、感情线、世界观扩展保持节奏
- 每章写完后事实会沉淀到可检索的状态系统

这套系统做的事，就是把上面这些“必须记住、不能写崩”的约束，变成 Claude Code 会自动执行的步骤：动笔前先查资料，写完后把新发生的事实记下来、做一致性审查，再把最新状态同步进检索索引、章节摘要、长期记忆和 Dashboard。它不只是“会写”，而是边写边攒。

## 核心能力

| 能力 | 命令 | 说明 |
|------|------|------|
| 深度初始化 | `/webnovel-init` | 分阶段问答，帮你把书的骨架、设定集、总纲和初始状态搭起来 |
| 卷纲规划 | `/webnovel-plan` | 基于总纲拆卷、拆章、补时间线，并写回新增设定 |
| 章节创作 | `/webnovel-write` | 一条龙写完一章：备上下文、起草、审查、润色、记录事实、自动备份 |
| 质量审查 | `/webnovel-review` | 从爽点、一致性、节奏、OOC、连贯性、追读力等维度审查章节 |
| 状态查询 | `/webnovel-query` | 查询角色、伏笔、节奏、实体关系和运行时信息 |
| 项目学习 | `/webnovel-learn` | 把这本书里好用的写法记下来，存进项目长期记忆 |
| 可视化面板 | `/webnovel-dashboard` | 只读浏览项目状态、实体图谱、章节内容和追读力数据 |
| 项目体检 | `/webnovel-doctor` | 阶段感知检查目录、文件、数据库、RAG、依赖和 Dashboard 产物 |

## 系统长什么样

```mermaid
flowchart LR
    User[作者 / Claude Code] --> Skills[8 个 Skill 命令]
    Skills --> Agents[Context / Reviewer / Data / Deconstruction Agent]
    Agents --> Story[.story-system 合同与提交链]
    Story --> Commit[accepted CHAPTER_COMMIT]
    Commit --> State[.webnovel/state.json]
    Commit --> Index[index.db / vectors.db]
    Commit --> Summary[summaries / memory_scratchpad]
    State --> Dashboard[只读 Dashboard]
    Index --> Dashboard
    Summary --> Dashboard
```

v6.0.0 的默认主链叫 **Story System**，几个关键角色：

- `.story-system/`：唯一的事实源头，动笔前的“合同”和写完后的“提交”都存在这里
- accepted 的 `CHAPTER_COMMIT`：一章写完，新事实从这里入账
- `.webnovel/state.json`、`index.db`、`summaries/`、`memory_scratchpad.json`：都是从主链派生出来的只读视图，供查询和展示用
- `.webnovel/projection_log.jsonl`：投影执行日志，用来定位 state/index/summary/memory/vector 哪一路没同步
- `project-status`、`doctor`、`preflight` 和 Dashboard 会把主链与运行状态直接摆出来，哪里不对一眼就能看到

## 快速开始

### 1. 安装插件

通过 Claude Code Marketplace 安装：

```bash
claude plugin marketplace add lingfengQAQ/webnovel-writer --scope user
claude plugin install webnovel-writer@webnovel-writer-marketplace --scope user
```

只想在当前项目生效时，把 `--scope user` 改成 `--scope project`。

> 插件的安装、启用与日常管理等更多用法，见 Claude Code 官方文档：[插件](https://docs.claude.com/en/docs/claude-code/plugins) · [插件市场](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces)。

### 2. 安装 Python 依赖

```bash
python -m pip install -r https://raw.githubusercontent.com/lingfengQAQ/webnovel-writer/HEAD/requirements.txt
```

### 3. 初始化一本书

在 Claude Code 中输入：

```bash
/webnovel-init
```

初始化完成后会创建书项目目录，包含：

```text
project-root/
├── .story-system/        # 合同、章节提交和事件审计
├── .webnovel/            # 状态、索引、摘要、备份和长期记忆
├── 正文/                  # 章节正文
├── 大纲/                  # 总纲、卷纲、时间线和章纲
├── 设定集/                # 世界观、角色、力量体系等设定
└── 审查报告/              # 章节审查报告
```

### 4. 配置 RAG

进入书项目根目录，把 `.env.example` 复制为 `.env` 并填写 API Key：

```bash
cp .env.example .env
```

最小配置：

```bash
EMBED_BASE_URL=https://api-inference.modelscope.cn/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
EMBED_API_KEY=your_embed_api_key

RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v3
RERANK_API_KEY=your_rerank_api_key
```

没填 Embedding Key 也能用——系统会自动退回 BM25 关键词检索，只是语义召回会弱一些。Embedding 和 Rerank 都可以换成任何兼容 OpenAI 格式的接口。

### 5. 开始规划和写作

```bash
/webnovel-plan 1      # 规划第 1 卷
/webnovel-write 1     # 写第 1 章
/webnovel-review 1-5  # 审查第 1-5 章
/webnovel-query 伏笔  # 查询项目状态
```

### 6. 打开可视化面板

```bash
/webnovel-dashboard
```

Dashboard 是个只读面板，能看项目状态、实体关系图、章节内容、伏笔和追读力数据。前端是预先打包好的，跟着插件一起发，本地不用跑 `npm build`。

## 写章工作流

`/webnovel-write` 不是把活儿丢给模型生成一次就完事，而是一条带关卡的完整流水线：

1. 预检项目根、占位符和 Story System 健康状态
2. 刷新本章 runtime contract
3. 调用 `context-agent` 生成写作任务书
4. 根据任务书起草正文
5. 调用 `reviewer` 做多维审查，blocking issue 不通过则阻断
6. 润色、排版、Anti-AI 终检
7. 调用 `data-agent` 提取事实
8. 生成 `CHAPTER_COMMIT`，驱动 state、index、summary、memory、vector 投影
9. 执行章节级备份

这么设计，是为了把“怎么写”和“写了什么”分开：文笔和节奏可以放开发挥，但发生过的事实必须登记、过审、存档，不能含糊。

### 最终报告怎么看

`/webnovel-init`、`/webnovel-plan`、`/webnovel-write` 和 `/webnovel-review` 结束时都会给一份面向作者的最终报告，不直接把内部 JSON、traceback 或长命令日志甩出来。报告先给一句总状态：

- **已完成**：目标产物和关键校验都通过，可以进入下一步。
- **部分完成**：主要产物已保留，但有跳过项、自动处理项或待确认的小尾巴。
- **需要你处理**：系统已经停在安全位置，需要你决定创作方向、事实取舍、是否覆盖文件或如何处理 blocking 问题。
- **未完成**：关键产物没有可信生成，按报告里的恢复建议重跑或排查。

下面固定三段：一是产生的文件与完成情况，二是过程中遇到的问题与异常耗时，三是下一步建议。系统自动处理过的事也会写出来，比如投影失败后已补跑成功；只有不可恢复故障才会提示查看 `.webnovel/logs/run_last.log`。

执行过程中只会看到少量进度提示，告诉你当前在做什么、会产生什么；只有创作方向、事实一致性、文件覆盖风险或 blocking issue 需要裁决时才会问你。重复执行同一条 `/webnovel-write 章号` 时，系统会先检查可信断点，尽量从失败点继续，不重写已经可信完成的正文、审查、提交或备份。

## 内置题材

内置 37 个中文网文题材模板，也支持把几个题材揉在一起写。下面只列一部分：

| 类型 | 题材示例 |
|------|----------|
| 玄幻修仙类 | 修仙、系统流、高武、西幻、无限流、末世、科幻 |
| 都市现代类 | 都市异能、都市日常、都市脑洞、现实题材、电竞、直播文 |
| 言情类 | 古言、宫斗宅斗、青春甜宠、豪门总裁、狗血言情、替身文、种田 |
| 特殊题材 | 规则怪谈、悬疑脑洞、悬疑灵异、历史古代、抗战谍战、知乎短篇、克苏鲁 |

完整列表见 [题材模板文档](docs/guides/genres.md)。

## 命令速查

### Claude Code Skill 命令

| 命令 | 示例 | 用途 |
|------|------|------|
| `/webnovel-init` | `/webnovel-init` | 初始化新书项目 |
| `/webnovel-plan` | `/webnovel-plan 1` | 生成卷纲、时间线和章纲 |
| `/webnovel-write` | `/webnovel-write 45` | 写作并提交指定章节 |
| `/webnovel-review` | `/webnovel-review 1-5` | 审查章节范围 |
| `/webnovel-query` | `/webnovel-query 萧炎` | 查询角色、伏笔、状态等信息 |
| `/webnovel-learn` | `/webnovel-learn "这个钩子设计有效"` | 写入项目经验记忆 |
| `/webnovel-dashboard` | `/webnovel-dashboard` | 启动只读可视化面板 |
| `/webnovel-doctor` | `/webnovel-doctor --chapter 12` | 只读体检项目文件、DB、RAG 和依赖 |

### CLI 入口

所有命令行工具统一从 `scripts/webnovel.py` 进入：

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" <子命令> [参数]
```

常用子命令：

| 子命令 | 说明 |
|--------|------|
| `where` | 打印当前解析出的书项目根目录 |
| `preflight` | 校验插件路径、项目根、Story System 健康状态 |
| `project-status` | 输出机器可读短状态、phase 和下一步 |
| `doctor` | 阶段感知项目体检，给出影响和修复建议 |
| `write-gate` | 写前、提交前、提交后三个自然边界校验 |
| `projections` | 基于已有 commit 补跑或重放投影 |
| `story-system` | 生成合同种子和 runtime contracts |
| `chapter-commit` | 提交章节事实并驱动投影 |
| `story-events` | 查询章节事件或检查事件链健康 |
| `memory` | 查看、查询、导出和回填长期记忆 |
| `rag` | 管理向量索引和检索状态 |
| `status` | 输出项目健康报告 |

更多命令见 [命令详解](docs/guides/commands.md)。

## 文档导航

| 文档 | 内容 |
|------|------|
| [文档中心](docs/README.md) | 所有文档索引和推荐阅读顺序 |
| [系统架构与模块](docs/architecture/overview.md) | 核心理念、Agent 分工、Story System 设计 |
| [命令详解](docs/guides/commands.md) | Skill 命令和 CLI 子命令速查 |
| [RAG 与配置](docs/guides/rag-and-config.md) | 检索流程、环境变量、默认模型 |
| [题材模板](docs/guides/genres.md) | 37 个题材模板和复合题材规则 |
| [项目结构与运维](docs/operations/operations.md) | 目录层级、健康检查、备份恢复 |
| [插件发版](docs/operations/plugin-release.md) | Marketplace 发版和版本同步流程 |

## 开发与测试

克隆仓库后安装依赖：

```bash
python -m pip install -r requirements.txt
python -m pip install -r webnovel-writer/scripts/requirements.txt
```

运行测试：

```bash
python -m pytest
```

Dashboard 前端位于 `webnovel-writer/dashboard/frontend/`，发布版已经包含 `dist/` 构建产物。开发前端时可单独进入该目录执行：

```bash
npm install
npm run dev
```

## 排查问题

优先执行预检：

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" preflight
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" doctor --format text
```

重点查看：

- `story_runtime.mainline_ready` 是否为 true
- `.story-system/commits/chapter_XXX.commit.json` 是否存在且 accepted
- `projection_status` 是否全部为 `done` 或 `skipped`
- `index.db`、`summaries/`、`memory_scratchpad.json` 是否正常生成
- RAG API Key 是否已写入书项目根目录的 `.env`

更多运维说明见 [项目结构与运维](docs/operations/operations.md)。

## 贡献

欢迎提 Issue 和 PR。最好用仓库里自带的模板，把复现步骤、环境信息、影响范围和验证方式填一下，也记得先给隐私信息脱敏。

建议流程：

```bash
git checkout -b feature/your-feature
git commit -m "feat: add your feature"
git push origin feature/your-feature
```

适合贡献的方向：

- 新题材模板和题材规则
- 更强的章节审查维度
- Dashboard 信息架构和可视化
- RAG 检索、实体消歧、长期记忆
- Windows/macOS/Linux 兼容性问题
- 文档、示例项目和新手教程

## 赞助与支持

Webnovel Writer 用业余时间维护。如果它帮你省下了梳理设定、对齐伏笔的功夫，欢迎来信交流想法、反馈使用体验，或表达对项目的支持：

📮 **ksdflisjdf@gmail.com**

## 更新简介

| 版本 | 主要变化 |
|------|----------|
| **v6.2.0 (当前)** | 写章结果更清楚，失败后更好恢复 |
| **v6.1.0** | 插件运行时加固：新增 doctor/project-status/write-gate/projection 重放、hooks、行为 eval 与发布校验 |
| **v6.0.0** | Story System 全链路上线（合同种子 + 运行时合同 + 章节提交 + 事件审计），补齐集成测试 |
| **v5.5.5** | 长期记忆闭环：写前注入 + 写后沉淀，新增 `memory` 运维命令 |
| **v5.5.4** | 写作链提示词强约束，统一中文化审查和报告文案 |
| **v5.5.3** | 统一 `preflight` 预检命令，修复 Windows 终端编码问题 |
| **v5.5.2** | 大纲章节名同步到正文文件名 |
| **v5.5.1** | 修复卷级大纲上下文提取，补齐 Dashboard 和 Learn 命令文档 |
| **v5.5.0** | 新增只读可视化 Dashboard，支持实时刷新 |
| **v5.4.4** | 接入 Plugin Marketplace 安装机制 |
| **v5.4.3** | 增强 RAG 智能上下文（`auto/graph_hybrid` 回退 BM25） |
| **v5.3** | 引入追读力系统（Hook / Cool-point / 微兑现 / 债务追踪） |

## 开源协议

本项目使用 [GPL v3](LICENSE) 协议。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=lingfengQAQ/webnovel-writer&type=Date)](https://star-history.com/#lingfengQAQ/webnovel-writer&Date)

## 致谢

本项目使用 Claude Code、Gemini CLI 与 Codex 配合 Vibe Coding 方式开发。

灵感来源：[Linux.do 帖子](https://linux.do/t/topic/1397944/49)

感谢 `oh-story-claudecode` 提供拆文流程参考。
