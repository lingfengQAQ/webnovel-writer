# Webnovel Writer

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-purple.svg)](https://claude.ai/claude-code)

<a href="https://trendshift.io/repositories/22487" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22487" alt="lingfengQAQ%2Fwebnovel-writer | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
## 这是什么？

`Webnovel Writer` 是一个基于 Claude Code 的长篇网文创作系统。

它的目标很简单：**让 AI 在写长篇小说时不乱编、不忘事**。

系统会自动管理角色设定、剧情伏笔、世界观规则，让你可以安心连载几百章而不用担心前后矛盾。

📖 详细文档在 `docs/` 目录：

- [架构与模块](docs/architecture/overview.md) — 系统怎么工作的
- [命令详解](docs/guides/commands.md) — 所有可用命令
- [RAG 与配置](docs/guides/rag-and-config.md) — 检索和环境变量配置
- [题材模板](docs/guides/genres.md) — 37 个内置网文题材
- [运维与恢复](docs/operations/operations.md) — 项目结构与日常运维
- [插件发版](docs/operations/plugin-release.md) — 发版流程
- [文档导航](docs/README.md) — 所有文档索引

## 快速开始

### 1) 安装插件

通过 Claude Code 官方 Marketplace 安装：

```bash
claude plugin marketplace add lingfengQAQ/webnovel-writer --scope user
claude plugin install webnovel-writer@webnovel-writer-marketplace --scope user
```

> 如果只想在当前项目生效，把 `--scope user` 改成 `--scope project`。

### 2) 安装 Python 依赖

```bash
python -m pip install -r https://raw.githubusercontent.com/lingfengQAQ/webnovel-writer/HEAD/requirements.txt
```

### 3) 初始化小说项目

在 Claude Code 中输入：

```bash
/webnovel-init
```

系统会引导你填写书名、题材、主角等信息，然后在当前工作区下创建项目目录。

### 4) 配置 RAG（必做）

进入书项目根目录，把配置模板复制为 `.env` 并填写 API Key：

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

### 5) 开始写作

```bash
/webnovel-plan 1      # 规划第 1 卷大纲
/webnovel-write 1     # 写第 1 章
/webnovel-review 1-5  # 审查第 1-5 章
```

## 命令总览（更新）

> 你可以只记住两层命令：  
> 1) Claude Code 插件命令（`/webnovel-*`）  
> 2) 统一 CLI 命令（`python .../webnovel.py <subcommand>`）

### A. Claude Code 插件命令（面向日常创作）

| 命令 | 作用 | 常见用法 |
|---|---|---|
| `/webnovel-init` | 初始化书项目目录、设定模板、状态文件 | `/webnovel-init` |
| `/webnovel-plan [卷号]` | 生成卷级规划和章节大纲 | `/webnovel-plan 1` |
| `/webnovel-write [章号]` | 执行完整写作链：上下文→起草→审查→提交 | `/webnovel-write 35` |
| `/webnovel-review [范围]` | 对已有章节做质量审查 | `/webnovel-review 31-35` |
| `/webnovel-query [关键词]` | 查询角色/伏笔/状态等运行时信息 | `/webnovel-query 萧炎` |
| `/webnovel-learn [内容]` | 抽取经验写入项目记忆 | `/webnovel-learn "这章危机钩有效"` |
| `/webnovel-dashboard` | 启动只读可视化面板 | `/webnovel-dashboard` |

### B. 统一 CLI 子命令（面向运维与自动化）

统一入口：

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" <子命令> [参数]
```

| 子命令 | 作用 |
|---|---|
| `preflight` | 校验脚本、项目根、主链健康状态 |
| `where` / `use` | 查看/绑定当前项目根目录 |
| `story-system` | 生成或刷新 Story System 合同（master/volume/chapter/review） |
| `review-pipeline` | 处理 reviewer JSON，生成报告并写审查指标 |
| `chapter-commit` | 提交章节事实并触发 projection（state/index/summary/memory/vector） |
| `orchestrate` | 批量自动编排（write/heal/nightly），减少手工逐条命令执行 |
| `rag` | 向量检索与索引管理（如按章索引、统计） |
| `index/state/entity/context/style` | 各类数据模块运维入口 |
| `status/update-state/backup/archive` | 状态巡检、手工更新、备份与归档 |
| `memory` / `memory-contract` / `project-memory` | 长期记忆查询、合同管理、项目记忆管理 |
| `story-events` | 查询章节事件或查看事件链健康 |
| `extract-context` | 提取指定章节上下文 |
| `master-outline-sync` | 卷规划后写回总纲锚点 |

`orchestrate` 示例：

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" orchestrate write --chapters 1-20 --auto-vector-heal
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" orchestrate heal --chapters 1-200 --json-report-out ".webnovel/reports/heal.json"
```

实体脏数据（如拼音/英文 snake_case）扫描与标记：

```bash
python -X utf8 "<CLAUDE_PLUGIN_ROOT>/scripts/webnovel.py" --project-root "<PROJECT_ROOT>" entity-clean --mark-invalid --format json --chapter 100
```

### Claude Code 插件内一键修复（推荐）

如果你在 **Claude Code 对话框内** 操作，优先用插件命令（不需要手动拼 Python 命令）：

```bash
/webnovel-review 1-100
```

先对 1-100 章做一次总审查，确认阻断项和偏纲章段。

然后在 Claude Code 中执行（同一项目会话内）：

```bash
/webnovel-write 100
```

用于重跑第 100 章完整链（上下文→起草/修复→审查→提交→投影）。  
如果你要批量修复多章，建议在 Claude Code 中让助手按章循环执行 `/webnovel-write N`，每 10 章做一次 `/webnovel-review A-B` 复核。

### 6) 可视化面板（可选）

```bash
/webnovel-dashboard
```

只读面板，可以浏览项目状态、实体图谱、章节内容和追读力数据。前端已随插件预构建，不需要本地 `npm build`。

## Story System 主链（Phase 5）

当前默认链路已经切到：

1. 写前读取 `.story-system/MASTER_SETTING.json`、`volumes/`、`chapters/`、`reviews/`
2. 写后提交 accepted `CHAPTER_COMMIT`
3. 由 commit projection writers 更新 `.webnovel/state.json`、`index.db`、`summaries/`、`memory_scratchpad.json`

这意味着：

- `.story-system/` 是主链真源
- `.webnovel/*` 是投影 / read-model
- `references/genre-profiles.md` 只在合同缺失时作为 fallback
- `preflight --format json` 和 dashboard 会直接暴露 `story_runtime` 健康状态

### 7) Agent 模型设置（可选）

所有内置 Agent 默认继承当前会话模型：

```yaml
model: inherit
```

如需单独指定，编辑对应 `agents/*.md` 的 frontmatter：

```yaml
---
model: sonnet  # 可选：inherit / sonnet / opus / haiku
---
```

## 更新简介

| 版本 | 主要变化 |
|------|----------|
| **v6.0.0 (当前)** | Story System 全链路上线（合同种子 + 运行时合同 + 章节提交 + 事件审计），补齐集成测试 |
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

本项目使用 `GPL v3` 协议，详见 [LICENSE](LICENSE)。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=lingfengQAQ/webnovel-writer&type=Date)](https://star-history.com/#lingfengQAQ/webnovel-writer&Date)

## 致谢

本项目使用 **Claude Code + Gemini CLI + Codex** 配合 Vibe Coding 方式开发。  
灵感来源：[Linux.do 帖子](https://linux.do/t/topic/1397944/49)

感谢 `oh-story-claudecode` 提供拆文流程参考。

## 贡献

欢迎提交 Issue 和 PR：

```bash
git checkout -b feature/your-feature
git commit -m "feat: add your feature"
git push origin feature/your-feature
```
